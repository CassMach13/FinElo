import { describe, expect, it } from 'vitest';
import {
  projectCardTwoLedger,
  competenciasComDiferencaAcionavel,
  valorAcionavelDaCompetencia,
  type CompetenceHistoryLike,
} from '../../src/domain/credit-card/twoLedgerProjection';
import { diagnoseCreditCard } from '../../src/domain/credit-card/cardDiagnostics';
import { visibleResolutionOptionsForDelta } from '../../src/domain/credit-card/reconciliationResolutionOptions';

/**
 * Três telas, um número.
 *
 * ===========================================================================
 * O QUE ESTAVA QUEBRADO
 * ===========================================================================
 *
 * O selo «A CONCILIAR» e o diagnóstico já liam a fila que devolve o que
 * SOBREVIVE ao fim da cadeia. O modal de conciliação lia o delta BRUTO da
 * competência — e, pior, era esse bruto que o servidor gravava no snapshot e
 * que a RPC usava para decidir quanto resolver.
 *
 * Na conta piloto: selo R$ 0,94, diagnóstico R$ 0,94, modal R$ 77,80. Aceitar a
 * oferta do modal moveria para o livro econômico R$ 76,86 que a própria cadeia
 * já havia devolvido.
 *
 * Agora as três consultam `competenciasComDiferencaAcionavel`. Não há segunda
 * fila, segundo FIFO nem segundo arredondamento.
 */

const c = (reais: number) => Math.round(reais * 100);

const comp = (
  referenceMonth: string,
  statementTotal: number,
  totalPayments: number
): CompetenceHistoryLike => ({
  referenceMonth,
  competenceBR: referenceMonth,
  dueDate: `${referenceMonth}-10`,
  statementTotal,
  totalPayments,
});

/**
 * O que cada superfície mostra, cada uma pelo seu próprio caminho.
 *
 *   selo       — o mapa de acionáveis que acende «A CONCILIAR»
 *   diagnostico— `diagnoseCreditCard`, que lê a projeção
 *   modal      — `valorAcionavelDaCompetencia`, que a Edge envia como deltaCents
 */
function tresSuperficies(linhas: CompetenceHistoryLike[], asOf = '2026-09-03') {
  const p = projectCardTwoLedger(linhas, { asOf });
  const acionaveis = competenciasComDiferencaAcionavel(p.competences);
  const mes = p.competences.find((x) => x.hasPendingReconciliation)?.referenceMonth ?? null;

  const achados = diagnoseCreditCard({
    competences: p.competences,
    reconciliation: { pendente: p.reconciliationPending, referenceMonth: mes },
  });
  const item = achados.find((a) => a.code === 'diferenca_a_conciliar');

  return {
    competencia: mes,
    selo: mes ? (acionaveis.get(mes) ?? 0) : 0,
    diagnostico: item?.amountCents ?? 0,
    modal: mes ? valorAcionavelDaCompetencia(p.competences, mes) : 0,
    projecao: p,
  };
}

describe('a cadeia real do piloto', () => {
  /** +0,22 +0,94 +60,30 −60,52 +77,80 −77,80 → resíduo 0,94 em 2025-10. */
  const CADEIA = [
    comp('2024-12', 6052.63, 6052.85),
    comp('2025-01', 6261.95, 6262.89),
    comp('2025-02', 5798.44, 5858.74),
    comp('2025-03', 6777.72, 6717.2),
    comp('2025-10', 4610.73, 4688.53),
    comp('2025-11', 6013.11, 5935.31),
  ];

  const t = tresSuperficies(CADEIA);

  it('a competência apontada é 2025-10', () => {
    expect(t.competencia).toBe('2025-10');
  });

  it('as três dizem R$ 0,94 — nunca R$ 77,80', () => {
    expect(t.selo).toBe(c(0.94));
    expect(t.diagnostico).toBe(c(0.94));
    expect(t.modal).toBe(c(0.94));
  });

  /**
   * A prova de que o bug era real: o bruto da competência é OUTRO número. Se o
   * modal voltar a usá-lo, esta é a distância que ele passaria a oferecer.
   */
  it('o bruto da competência continua sendo R$ 77,80, e o modal NÃO o usa', () => {
    const bruto = t.projecao.competences.find((x) => x.referenceMonth === '2025-10')!
      .unresolvedReconciliationDeltaCents;

    expect(bruto).toBe(c(77.8));
    expect(t.modal).not.toBe(bruto);
    expect(t.modal).toBe(c(0.94));
  });

  it('o modal ofereceria classificar exatamente R$ 0,94', () => {
    const opcoes = visibleResolutionOptionsForDelta(t.modal);

    expect(opcoes.length).toBeGreaterThan(0);
    expect(opcoes.some((o) => o.consequence.includes('0,94'))).toBe(true);
    expect(opcoes.some((o) => o.consequence.includes('77,80'))).toBe(false);
  });
});

describe('o cenário de staging', () => {
  /** Bruto 200 em junho, 150 consumidos em agosto, resíduo 50. */
  const CADEIA = [
    comp('2026-06', 300, 500),
    comp('2026-07', 400, 0),
    comp('2026-08', 350, 200),
  ];

  const t = tresSuperficies(CADEIA);

  it('as três dizem R$ 50,00 — nunca R$ 200,00', () => {
    expect(t.competencia).toBe('2026-06');
    expect(t.selo).toBe(c(50));
    expect(t.diagnostico).toBe(c(50));
    expect(t.modal).toBe(c(50));
  });

  it('o bruto de junho continua sendo R$ 200,00, e o modal não o usa', () => {
    const bruto = t.projecao.competences.find((x) => x.referenceMonth === '2026-06')!
      .unresolvedReconciliationDeltaCents;

    expect(bruto).toBe(c(200));
    expect(t.modal).toBe(c(50));
  });
});

describe('sem diferença acionável, o modal não oferece nada', () => {
  /**
   * A cadeia devolve tudo. O selo não acende, e o modal — se alguém abrir a
   * competência pela URL ou por um estado antigo — chega a zero e não oferece
   * ação nenhuma. A RPC recusa `delta_cents = 0` pelo mesmo motivo.
   */
  const CADEIA = [
    comp('2026-06', 300, 500),
    comp('2026-07', 400, 200),
    comp('2026-08', 350, 350),
  ];

  const t = tresSuperficies(CADEIA);

  it('nada é apontado', () => {
    expect(t.projecao.reconciliationPending).toBe(false);
    expect(t.competencia).toBeNull();
  });

  it('a competência que gerou a diferença já não tem valor acionável', () => {
    expect(valorAcionavelDaCompetencia(t.projecao.competences, '2026-06')).toBe(0);
    expect(visibleResolutionOptionsForDelta(0)).toEqual([]);
  });

  it('uma competência que apenas CONSUMIU diferença não tem o que resolver', () => {
    const julho = t.projecao.competences.find((x) => x.referenceMonth === '2026-07')!;

    expect(julho.unresolvedReconciliationDeltaCents).toBeLessThan(0);
    expect(valorAcionavelDaCompetencia(t.projecao.competences, '2026-07')).toBe(0);
  });

  it('competência inexistente devolve zero, não explode', () => {
    expect(valorAcionavelDaCompetencia(t.projecao.competences, '1999-01')).toBe(0);
  });
});

describe('a garantia estrutural', () => {
  /**
   * Para QUALQUER série: se o selo aponta uma competência, as três superfícies
   * dizem o mesmo número. Se alguém reintroduzir o bruto em uma delas, um
   * destes cenários quebra.
   */
  const CENARIOS: Array<{ nome: string; linhas: CompetenceHistoryLike[] }> = [
    { nome: 'piloto', linhas: [comp('2024-12', 6052.63, 6052.85), comp('2025-01', 6261.95, 6262.89), comp('2025-02', 5798.44, 5858.74), comp('2025-03', 6777.72, 6717.2), comp('2025-10', 4610.73, 4688.53), comp('2025-11', 6013.11, 5935.31)] },
    { nome: 'staging', linhas: [comp('2026-06', 300, 500), comp('2026-07', 400, 0), comp('2026-08', 350, 200)] },
    { nome: 'excedente único, nunca devolvido', linhas: [comp('2026-06', 300, 500)] },
    { nome: 'excedente devolvido pela metade', linhas: [comp('2026-06', 300, 500), comp('2026-07', 400, 300)] },
    { nome: 'dois excedentes, um consumo', linhas: [comp('2026-05', 100, 180), comp('2026-06', 200, 260), comp('2026-07', 400, 300)] },
    { nome: 'nada a conciliar', linhas: [comp('2026-07', 400, 400), comp('2026-08', 300, 300)] },
  ];

  CENARIOS.forEach(({ nome, linhas }) => {
    it(`${nome}: selo, diagnóstico e modal dizem o mesmo`, () => {
      const t = tresSuperficies(linhas);

      expect(t.modal).toBe(t.selo);
      expect(t.diagnostico).toBe(t.selo);
    });

    it(`${nome}: o modal nunca oferece mais do que sobrou`, () => {
      const t = tresSuperficies(linhas);
      if (!t.competencia) return;

      const bruto = t.projecao.competences.find((x) => x.referenceMonth === t.competencia)!
        .unresolvedReconciliationDeltaCents;

      expect(t.modal).toBeLessThanOrEqual(bruto);
      expect(t.modal).toBeGreaterThan(0);
    });
  });
});
