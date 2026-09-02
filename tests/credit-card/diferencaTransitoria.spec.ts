import { describe, expect, it } from 'vitest';
import {
  projectCardTwoLedger,
  competenciasComDiferencaAcionavel,
} from '../../src/domain/credit-card/twoLedgerProjection';
import { diagnoseCreditCard, summarizeCardDiagnostics } from '../../src/domain/credit-card/cardDiagnostics';

/**
 * Quando o usuário precisa mesmo intervir.
 *
 * ===========================================================================
 * O QUE ACONTECEU NA CONTA REAL
 * ===========================================================================
 *
 * A convenção de pagamento faz o arquivo do mês N+1 quitar o mês N. Isso cria
 * diferenças que nascem numa competência e são devolvidas pela seguinte — elas
 * aparecem e somem sozinhas, sem ninguém decidir nada.
 *
 * O selo «A CONCILIAR» não sabia disso e oferecia todas para classificação. Na
 * conta piloto o usuário aceitou o convite e classificou R$ 60,30 e R$ 77,80
 * como CRÉDITO ECONÔMICO — crédito que nunca existiu, sobre diferenças que a
 * própria cadeia devolveria. Outra virou «ajuste do banco», encerrando no livro
 * 2 os R$ 0,94 que a última competência usaria, e a fatura subiu R$ 0,94.
 *
 * A cadeia real, somada: +0,22 +0,94 +60,30 −60,52 +77,80 −77,80 −0,94 = 0.
 * Entrou R$ 139,26, saiu R$ 139,26. Não havia nada a decidir.
 *
 * A regra passou a ser: só é oferecido o que SOBREVIVE ao fim da cadeia. Sem
 * threshold — quem decide é a série inteira, não a magnitude.
 */

const c = (reais: number) => Math.round(reais * 100);

/** A cadeia real da conta piloto, com os meses que produzem as diferenças. */
const CADEIA: Array<[string, string, number, number]> = [
  ['2024-12', '2025-01-10', 6052.63, 6052.85], // +0,22
  ['2025-01', '2025-02-10', 6261.95, 6262.89], // +0,94
  ['2025-02', '2025-03-10', 5798.44, 5858.74], // +60,30
  ['2025-03', '2025-04-10', 6777.72, 6717.20], // −60,52
  ['2025-04', '2025-05-10', 7195.36, 7195.36],
  ['2025-05', '2025-06-10', 5950.59, 5950.59],
  ['2025-06', '2025-07-10', 5692.58, 5692.58],
  ['2025-07', '2025-08-10', 5006.45, 5006.45],
  ['2025-08', '2025-09-10', 6465.46, 6465.46],
  ['2025-09', '2025-10-10', 4605.61, 4605.61],
  ['2025-10', '2025-11-10', 4610.73, 4688.53], // +77,80
  ['2025-11', '2025-12-10', 6013.11, 5935.31], // −77,80
  ['2025-12', '2026-01-10', 6304.46, 6304.46],
  ['2026-01', '2026-02-10', 7454.90, 7454.90],
  ['2026-02', '2026-03-10', 5553.44, 5553.44],
  ['2026-03', '2026-04-10', 5301.51, 5301.51],
  ['2026-04', '2026-05-10', 6402.97, 6402.97],
  ['2026-05', '2026-06-10', 6260.26, 6260.26],
  ['2026-06', '2026-07-10', 5565.08, 5565.08],
  ['2026-07', '2026-08-10', 7258.08, 0], // consome o resíduo de 0,94
];

const projetar = (linhas: Array<[string, string, number, number]>) =>
  projectCardTwoLedger(
    linhas.map(([referenceMonth, dueDate, statementTotal, totalPayments]) => ({
      referenceMonth, dueDate, statementTotal, totalPayments,
    })),
    { asOf: '2026-09-02' }
  );

describe('a cadeia real do piloto — nada aqui pede decisão', () => {
  const p = projetar(CADEIA);

  it('as diferenças EXISTEM no livro 2 e se compensam lá dentro', () => {
    const porMes = new Map(p.competences.map((x) => [x.referenceMonth, x.unresolvedReconciliationDeltaCents]));

    expect(porMes.get('2024-12')).toBe(22);
    expect(porMes.get('2025-01')).toBe(94);
    expect(porMes.get('2025-02')).toBe(6030);
    expect(porMes.get('2025-03')).toBe(-6052);
    expect(porMes.get('2025-10')).toBe(7780);
    expect(porMes.get('2025-11')).toBe(-7780);
    expect(porMes.get('2026-07')).toBe(-94);

    const entrou = p.competences.reduce((a, x) => a + Math.max(0, x.unresolvedReconciliationDeltaCents), 0);
    const saiu = -p.competences.reduce((a, x) => a + Math.min(0, x.unresolvedReconciliationDeltaCents), 0);
    expect(entrou).toBe(13926);
    expect(saiu).toBe(13926);
    expect(p.suspenseBalanceCents).toBe(0);
  });

  it('NENHUMA delas é oferecida para o usuário resolver', () => {
    expect(competenciasComDiferencaAcionavel(p.competences).size).toBe(0);
    expect(p.competences.some((x) => x.hasPendingReconciliation)).toBe(false);
    expect(p.reconciliationPending).toBe(false);
  });

  it('nenhuma vira crédito econômico', () => {
    expect(p.economicCarryCents).toBe(0);
  });

  it('o saldo econômico e o limite ficam corretos', () => {
    expect(p.current?.referenceMonth).toBe('2026-07');
    expect(p.current?.economicOpenBalanceCents).toBe(c(7257.14));
    expect(p.economicUsedCents).toBe(c(7257.14));
  });

  /** A única verdade: as duas superfícies concordam. */
  it('o diagnóstico concorda com o selo', () => {
    const achados = diagnoseCreditCard({
      competences: p.competences,
      reconciliation: { pendente: p.reconciliationPending, referenceMonth: null },
    });

    expect(achados.filter((a) => a.code === 'diferenca_a_conciliar')).toHaveLength(0);
    expect(achados.filter((a) => a.code === 'pagamento_acima_da_fatura')).toHaveLength(0);
    expect(summarizeCardDiagnostics(achados).label).toBe('Cartão consistente');
  });
});

describe('uma diferença que sobrevive continua sendo oferecida', () => {
  /** Mesma cadeia, sem a última competência: o resíduo de R$ 0,94 fica de pé. */
  const p = projetar(CADEIA.slice(0, -1));

  it('o resíduo permanece no livro 2 ao fim da série', () => {
    expect(p.suspenseBalanceCents).toBe(94);
  });

  /**
   * A fila devolve o que entrou primeiro: os R$ 60,52 de 2025-03 pagam 0,22,
   * 0,94 e quase todo o 60,30; os R$ 77,80 de 2025-11 pagam o resto e quase
   * todo o 77,80 de 2025-10. Sobra R$ 0,94 — e ele pertence a 2025-10.
   */
  it('o selo acende e aponta a competência que ainda tem a diferença, pelo valor que resta', () => {
    const acionaveis = competenciasComDiferencaAcionavel(p.competences);

    expect(p.reconciliationPending).toBe(true);
    expect([...acionaveis.entries()]).toEqual([['2025-10', 94]]);
    // As que a cadeia já devolveu ficam fora, inclusive as que entraram antes.
    expect(acionaveis.has('2024-12')).toBe(false);
    expect(acionaveis.has('2025-01')).toBe(false);
    expect(acionaveis.has('2025-02')).toBe(false);
  });

  it('o diagnóstico mostra a mesma diferença, como «vale revisar»', () => {
    const achados = diagnoseCreditCard({
      competences: p.competences,
      reconciliation: { pendente: true, referenceMonth: '2025-10' },
    });

    const item = achados.find((a) => a.code === 'diferenca_a_conciliar')!;
    expect(item).toBeDefined();
    expect(item.severity).toBe('revisar');
    // O valor é o que RESTA (R$ 0,94), não os R$ 77,80 que entraram.
    expect(item.amountCents).toBe(94);
    expect(item.competences).toEqual(['2025-10']);
    expect(summarizeCardDiagnostics(achados).label).not.toBe('Cartão consistente');
  });

  it('mesmo sobrevivendo, não vira crédito nem dívida sozinha', () => {
    expect(p.economicCarryCents).toBe(0);
    expect(p.economicUsedCents).toBe(0);
  });
});
