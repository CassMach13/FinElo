import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  describeDelta,
  resolutionOptionsForDelta,
} from '../../src/domain/credit-card/reconciliationResolutionOptions';

/**
 * A oferta de resoluções e as garantias do fluxo de confirmação.
 *
 * A regra de oferta é por SINAL: convidar alguém a afirmar algo que o banco
 * recusaria por constraint seria levá-lo a um beco.
 */

const c = (reais: number) => Math.round(reais * 100);
const tipos = (deltaCents: number) => resolutionOptionsForDelta(deltaCents).map((o) => o.kind);

describe('oferta por sinal da diferença', () => {
  it('diferença positiva oferece crédito, nunca dívida', () => {
    expect(tipos(c(100))).toContain('economic_credit');
    expect(tipos(c(100))).not.toContain('economic_debt');
  });

  it('diferença negativa oferece dívida, nunca crédito', () => {
    expect(tipos(c(-100))).toContain('economic_debt');
    expect(tipos(c(-100))).not.toContain('economic_credit');
  });

  it('as opções neutras aparecem nos dois sinais', () => {
    for (const delta of [c(100), c(-100)]) {
      expect(tipos(delta)).toContain('bank_adjustment');
      expect(tipos(delta)).toContain('authoritative_total');
      expect(tipos(delta)).toContain('reconciliation_write_off');
    }
  });

  it('diferença zero não oferece nada — não há o que resolver', () => {
    expect(resolutionOptionsForDelta(0)).toEqual([]);
    expect(describeDelta(0).sinal).toBe('nenhuma');
  });

  it('a magnitude não muda o conjunto oferecido', () => {
    expect(tipos(c(0.22))).toEqual(tipos(c(5000)));
    expect(tipos(c(-0.22))).toEqual(tipos(c(-5000)));
  });

  it('centavos entram e saem sem deriva', () => {
    const [credito] = resolutionOptionsForDelta(c(0.22));
    expect(credito.kind).toBe('economic_credit');
    expect(credito.consequence).toContain('0,22');
  });
});

describe('cada opção declara sua consequência antes da confirmação', () => {
  it('toda opção tem rótulo e consequência não vazios', () => {
    for (const delta of [c(100), c(-100)]) {
      for (const opcao of resolutionOptionsForDelta(delta)) {
        expect(opcao.label.length).toBeGreaterThan(0);
        expect(opcao.consequence.length).toBeGreaterThan(0);
      }
    }
  });

  it('só crédito, dívida e valor oficial declaram mover o livro econômico', () => {
    const movem = (delta: number) =>
      resolutionOptionsForDelta(delta).filter((o) => o.movesEconomicLedger).map((o) => o.kind);

    expect(movem(c(100)).sort()).toEqual(['authoritative_total', 'economic_credit']);
    expect(movem(c(-100)).sort()).toEqual(['authoritative_total', 'economic_debt']);
  });

  /**
   * O texto antigo prometia que «o limite disponível não muda». Isso não é
   * verdade quando a diferença estava cobrindo o déficit de outra competência:
   * retirá-la do bolso de reconciliação descobre aquele déficit, que vira
   * obrigação econômica. Prometer o contrário levaria o usuário a clicar
   * esperando o oposto do que aconteceria.
   *
   * O que se afirma sem ressalva é que nenhuma das duas vira CRÉDITO, e o
   * efeito colateral possível fica dito.
   */
  it('ajuste e encerramento avisam que não viram crédito, e que outro mês pode reaparecer', () => {
    for (const kind of ['bank_adjustment', 'reconciliation_write_off'] as const) {
      const opcao = resolutionOptionsForDelta(c(100)).find((o) => o.kind === kind)!;
      expect(opcao.consequence).toMatch(/não vira crédito/i);
      expect(opcao.consequence).toMatch(/aquela diferença reaparece/i);
      expect(opcao.consequence).not.toMatch(/limite disponível não muda/);
      expect(opcao.movesEconomicLedger).toBe(false);
    }
  });

  it('crédito avisa que o limite aumenta; dívida, que diminui', () => {
    const credito = resolutionOptionsForDelta(c(100)).find((o) => o.kind === 'economic_credit')!;
    const divida = resolutionOptionsForDelta(c(-100)).find((o) => o.kind === 'economic_debt')!;

    expect(credito.consequence).toMatch(/limite disponível aumenta/);
    expect(divida.consequence).toMatch(/limite disponível diminui/);
  });

  it('valor oficial avisa que é recálculo, não zeragem', () => {
    const oficial = resolutionOptionsForDelta(c(100)).find(
      (o) => o.kind === 'authoritative_total'
    )!;

    expect(oficial.consequence).toMatch(/recalculada/);
    expect(oficial.requiresAuthoritativeTotal).toBe(true);
  });

  it('só o valor oficial exige dado adicional', () => {
    const exigem = resolutionOptionsForDelta(c(100))
      .filter((o) => o.requiresAuthoritativeTotal)
      .map((o) => o.kind);
    expect(exigem).toEqual(['authoritative_total']);
  });
});

describe('descrição da diferença', () => {
  it('positiva é descrita como pagamento a maior', () => {
    const d = describeDelta(c(0.22));
    expect(d.sinal).toBe('positiva');
    expect(d.resumo).toMatch(/a mais/);
  });

  it('negativa é descrita como falta', () => {
    const d = describeDelta(c(-0.22));
    expect(d.sinal).toBe('negativa');
    expect(d.resumo).toMatch(/Faltam/);
  });
});

// ---------------------------------------------------------------------------

const componente = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../src/components/modals/ReconciliationResolutionModal.tsx'
  ),
  'utf-8'
);

/**
 * Garantias estruturais do fluxo de confirmação.
 *
 * A investigação do fluxo `amount` mostrou como fica ambíguo quando o primeiro
 * botão parece final. Aqui a distinção é fixada: escolher abre o segundo passo,
 * e só o segundo passo chama `onConfirm`.
 */
describe('fluxo de confirmação do modal', () => {
  it('escolher uma opção não persiste — apenas avança de passo', () => {
    expect(componente).toMatch(/onClick=\{\(\) => setEscolhida\(opcao\)\}/);
    // O handler da lista não chama onConfirm.
    const listaAte = componente.slice(componente.indexOf('opcoes.map'));
    const primeiroConfirm = listaAte.indexOf('onConfirm');
    expect(primeiroConfirm).toBe(-1);
  });

  it('onConfirm é chamado uma única vez, e só no passo de confirmação', () => {
    expect((componente.match(/onConfirm\(\{/g) ?? []).length).toBe(1);
  });

  it('cancelar é repasse puro — nenhum handler mistura cancelar com confirmar', () => {
    // Cancelar nunca é um callback composto: é `onClick={onCancel}`, sem corpo.
    expect(componente).toMatch(/onClick=\{onCancel\}/);

    const handlers = componente.match(/onClick=\{[\s\S]*?\n\s*\}/g) ?? [];
    const misturados = handlers.filter((h) => h.includes('onCancel') && h.includes('onConfirm'));
    expect(misturados).toEqual([]);

    // E o único `onConfirm` do arquivo não menciona cancelamento.
    const chamada = componente.slice(componente.indexOf('onConfirm({'));
    expect(chamada.slice(0, 400)).not.toMatch(/onCancel/);
  });

  it('o passo final repete competência, valor, classificação e efeito', () => {
    const passo = componente.slice(componente.indexOf('Confirmar esta resolução'));
    expect(passo).toMatch(/Competência/);
    expect(passo).toMatch(/Diferença/);
    expect(passo).toMatch(/Classificação/);
    expect(passo).toMatch(/escolhida\.consequence/);
  });

  it('o botão final diz o que faz', () => {
    expect(componente).toMatch(/Confirmar resolução/);
  });

  /**
   * O quirk observado em staging: um submodal ficou exibindo a competência
   * anterior ao trocar de aba. Aqui a competência é prop obrigatória e nunca é
   * lida de estado compartilhado.
   */
  it('a competência chega por prop, não de estado stale', () => {
    expect(componente).toMatch(/referenceMonth: string;/);
    expect(componente).toMatch(/referenceMonth,\s*\n\s*competenceLabel,/);
    expect(componente).not.toMatch(/useContext|useStore|useAppStore/);
  });

  /** A lista visível é a do MVP; a completa continua no domínio. */
  it('as opções vêm do módulo de regras, não de lista embutida', () => {
    expect(componente).toMatch(/visibleResolutionOptionsForDelta\(unresolvedDeltaCents\)/);
    expect(componente).not.toMatch(/kind: 'economic_credit'/);
    expect(componente).not.toMatch(/kind: 'economic_debt'/);
  });

  it('valor oficial sem procedência não pode ser confirmado', () => {
    expect(componente).toMatch(/oficialValido/);
    expect(componente).toMatch(/disabled=\{!oficialValido \|\| busy\}/);
  });

  /**
   * O botão sai de circulação enquanto grava. A validação do 4B1 mediu uma
   * resolução concorrente devolvendo timeout ao cliente DEPOIS de gravar: um
   * botão ainda clicável nesse intervalo convida a criar a segunda resolução.
   */
  it('o botão de confirmar não aceita um segundo clique durante a gravação', () => {
    expect(componente).toMatch(/busy \? 'Processando…' : 'Confirmar resolução'/);
    expect(componente).toMatch(/disabled=\{busy\}/);
  });
});
