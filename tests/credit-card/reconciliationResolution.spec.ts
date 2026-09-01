import { describe, expect, it } from 'vitest';
import {
  applyResolutions,
  computeTwoLedgerBalances,
  suspenseConservation,
  twoLedgerConservation,
} from '../../src/domain/credit-card/twoLedgerBalance';
import type {
  CompetenceLedgerInput,
  ReconciliationResolutionInput,
} from '../../src/domain/credit-card/twoLedgerBalance';

/**
 * Resolução explícita de diferenças de reconciliação.
 *
 * A regra que tudo aqui protege: uma diferença só produz efeito econômico quando
 * alguém a classifica. E quando classifica, o valor é MOVIDO entre os livros, não
 * duplicado — as duas identidades de conservação continuam fechando.
 */

const c = (reais: number) => Math.round(reais * 100);

/** Competência importada com excedente: gera diferença positiva no livro 2. */
const comExcedente = (
  ref: string,
  totalReais: number,
  pagoReais: number,
  resolutions: ReconciliationResolutionInput[] = []
): CompetenceLedgerInput => ({
  referenceMonth: ref,
  computedLinesTotalCents: c(totalReais),
  observedPaymentCents: c(pagoReais),
  resolutions,
});

const soma = (r: ReturnType<typeof computeTwoLedgerBalances>, campo: 'economicOpenBalanceCents') =>
  r.competences.reduce((a, x) => a + x[campo], 0);

// ---------------------------------------------------------------------------

describe('sem resolução, nada acontece', () => {
  it('a diferença permanece inerte no livro 2', () => {
    const r = computeTwoLedgerBalances([comExcedente('2026-01', 1000, 1100)]);

    expect(r.suspenseBalanceCents).toBe(c(100));
    expect(r.economicCarryCents).toBe(0);
    expect(soma(r, 'economicOpenBalanceCents')).toBe(0);
    expect(r.reconciliationClosedCents).toBe(0);
    expect(r.competences[0].reconciliationStatus).toBe('unreconciled');
  });
});

describe('economic_credit — move valor para o livro 1 conservando', () => {
  const resolvido = () =>
    computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [
        { kind: 'economic_credit', resolvedAmountCents: c(100) },
      ]),
      comExcedente('2026-02', 300, 0),
    ]);

  it('o suspense sai e o carry entra pelo mesmo valor', () => {
    const r = resolvido();

    expect(r.competences[0].resolvedToCarryCents).toBe(c(100));
    expect(r.competences[0].suspenseInCents).toBe(0);
    expect(r.competences[0].reconciliationStatus).toBe('resolved');
  });

  it('o crédito passa a abater a competência seguinte', () => {
    const r = resolvido();

    expect(r.competences[1].priorCreditAppliedCents).toBe(c(100));
    expect(r.competences[1].economicOpenBalanceCents).toBe(c(200));
    expect(r.suspenseBalanceCents).toBe(0);
  });

  it('as duas conservações continuam fechando', () => {
    const r = resolvido();
    expect(twoLedgerConservation(r).conservado).toBe(true);
    expect(suspenseConservation(r)).toBe(true);
  });

  /**
   * Sem resolução o saldo cai para o mesmo lugar, porque a diferença do livro 2
   * compensa o déficit seguinte. O que muda é POR QUAL LIVRO: com a resolução há
   * crédito econômico aplicado e nada pendente; sem ela há consumo de suspense e
   * conciliação em aberto.
   */
  it('sem a resolução o abatimento vem do livro 2, não do crédito', () => {
    const sem = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100),
      comExcedente('2026-02', 300, 0),
    ]);
    const com = resolvido();

    expect(sem.competences[1].economicOpenBalanceCents).toBe(
      com.competences[1].economicOpenBalanceCents
    );
    expect(sem.competences[1].priorCreditAppliedCents).toBe(0);
    expect(sem.competences[1].suspenseOutCents).toBe(c(100));
    expect(com.competences[1].priorCreditAppliedCents).toBe(c(100));
    expect(com.competences[1].suspenseOutCents).toBe(0);
  });
});

describe('economic_debt — existe na taxonomia, sem entrada alcançável hoje', () => {
  /**
   * Pela regra vigente, déficit inexplicado vira dívida econômica na hora, então
   * o saldo de reconciliação nunca fica negativo e `economic_debt` não encontra
   * diferença para resolver. A taxonomia é simétrica de propósito — o domínio
   * precisa poder RECUSAR sinal incompatível de forma explícita, não por omissão.
   */
  it('não encontra diferença negativa para resolver', () => {
    const r = computeTwoLedgerBalances([
      {
        referenceMonth: '2026-01',
        computedLinesTotalCents: c(1000),
        observedPaymentCents: c(900),
        resolutions: [{ kind: 'economic_debt', resolvedAmountCents: c(-100) }],
      },
    ]);

    // O déficit já é dívida econômica; não há nada no livro 2.
    expect(r.competences[0].economicOpenBalanceCents).toBe(c(100));
    expect(r.competences[0].resolvedToDebtCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(0);
    expect(twoLedgerConservation(r).conservado).toBe(true);
  });

  /**
   * Limite conhecido da cobertura, registrado de propósito.
   *
   * A distribuição (`applyResolutions`) tem o ramo de dívida testado direto, mais
   * abaixo. Já a LIGAÇÃO entre `paraDividaCents` e o saldo econômico dentro de
   * `computeTwoLedgerBalances` é inalcançável: sem diferença negativa, aquele
   * termo é sempre zero. Zerá-lo por mutação não quebra teste algum — é mutante
   * equivalente, não lacuna de teste.
   *
   * Só passa a ser exercitável se a regra de déficit mudar. Até lá, o contrato
   * fica garantido pelos testes diretos da distribuição.
   */
  it('nenhum cenário do modelo produz saldo de reconciliação negativo', () => {
    const cenarios: CompetenceLedgerInput[][] = [
      [comExcedente('2026-01', 1000, 900)],
      [comExcedente('2026-01', 6000, 0)],
      [comExcedente('2026-01', 100, 150), comExcedente('2026-02', 1000, 0)],
    ];
    for (const entrada of cenarios) {
      const r = computeTwoLedgerBalances(entrada);
      expect(r.suspenseBalanceCents).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('sinal incompatível é recusado', () => {
  it('economic_credit não resolve diferença negativa', () => {
    const r = computeTwoLedgerBalances([
      {
        referenceMonth: '2026-01',
        computedLinesTotalCents: c(1000),
        observedPaymentCents: c(900),
        resolutions: [{ kind: 'economic_credit', resolvedAmountCents: c(-100) }],
      },
    ]);

    expect(r.economicCarryCents).toBe(0);
    expect(r.competences[0].resolvedToCarryCents).toBe(0);
  });

  it('economic_debt não resolve diferença positiva', () => {
    const r = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [
        { kind: 'economic_debt', resolvedAmountCents: c(-100) },
      ]),
    ]);

    expect(r.competences[0].resolvedToDebtCents).toBe(0);
    expect(soma(r, 'economicOpenBalanceCents')).toBe(0);
    expect(r.suspenseBalanceCents).toBe(c(100));
  });

  it('economic_credit com valor negativo é ignorado, não convertido', () => {
    const r = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [
        { kind: 'economic_credit', resolvedAmountCents: c(-40) },
      ]),
    ]);

    expect(r.economicCarryCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(c(100));
  });
});

describe('bank_adjustment e written_off encerram sem mover o livro econômico', () => {
  it('bank_adjustment não gera crédito, dívida nem carry', () => {
    const r = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [
        { kind: 'bank_adjustment', resolvedAmountCents: c(100) },
      ]),
      comExcedente('2026-02', 300, 0),
    ]);

    expect(r.economicCarryCents).toBe(0);
    expect(r.competences[1].priorCreditAppliedCents).toBe(0);
    expect(r.competences[1].economicOpenBalanceCents).toBe(c(300));
    expect(r.suspenseBalanceCents).toBe(0);
    expect(r.reconciliationClosedCents).toBe(c(100));
  });

  /**
   * `written_off` é encerramento consciente SEM afirmar crédito, dívida ou total
   * oficial. Portanto move exatamente o mesmo que `bank_adjustment` no livro
   * econômico: nada. A diferença entre os dois é o que o usuário AFIRMOU, e isso
   * vive na trilha de auditoria, não no saldo.
   */
  it('written_off tem o mesmo efeito econômico que bank_adjustment: nenhum', () => {
    const ajuste = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [
        { kind: 'bank_adjustment', resolvedAmountCents: c(100) },
      ]),
    ]);
    const baixa = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [{ kind: 'written_off', resolvedAmountCents: c(100) }]),
    ]);

    expect(baixa.economicCarryCents).toBe(ajuste.economicCarryCents);
    expect(baixa.suspenseBalanceCents).toBe(ajuste.suspenseBalanceCents);
    expect(baixa.reconciliationClosedCents).toBe(ajuste.reconciliationClosedCents);
    expect(baixa.economicCarryCents).toBe(0);
  });

  it('o valor encerrado aparece na conservação em vez de evaporar', () => {
    const r = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [
        { kind: 'bank_adjustment', resolvedAmountCents: c(100) },
      ]),
    ]);
    const cons = twoLedgerConservation(r);

    expect(cons.cobrado - cons.reconhecido).toBe(c(-100));
    expect(cons.encerrado).toBe(c(100));
    expect(cons.conservado).toBe(true);
  });
});

describe('authoritative_total recalcula em vez de mascarar', () => {
  const base = () =>
    comExcedente('2026-01', 1000, 1100, [
      {
        kind: 'authoritative_total',
        authoritativeStatementTotalCents: c(1100),
        authoritativeSource: 'bank_pdf',
      },
    ]);

  it('o total da competência passa a ser o oficial, não o das linhas', () => {
    const r = computeTwoLedgerBalances([base()]);
    const x = r.competences[0];

    // Mascarar deixaria o total em 1000 e apenas zeraria o delta.
    expect(x.statementTotalCents).toBe(c(1100));
    expect(x.totalSource).toBe('authoritative');
  });

  it('saldo, carry e diferença são derivados de novo a partir da fonte superior', () => {
    const r = computeTwoLedgerBalances([base()]);
    const x = r.competences[0];

    expect(x.economicOpenBalanceCents).toBe(0);
    expect(r.economicCarryCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(0);
    // A distância até as linhas vira ajuste registrado, não some.
    expect(x.reconciliationAdjustmentCents).toBe(c(100));
  });

  it('um total oficial MENOR que o pago vira crédito econômico legítimo', () => {
    const r = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [
        {
          kind: 'authoritative_total',
          authoritativeStatementTotalCents: c(1050),
          authoritativeSource: 'bank_app',
        },
      ]),
    ]);

    // Agora sabemos quanto era devido: o excedente de 50 é dinheiro provado.
    expect(r.economicCarryCents).toBe(c(50));
    expect(r.suspenseBalanceCents).toBe(0);
  });

  it('sem procedência a resolução não vale — o total não é promovido', () => {
    const r = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [
        { kind: 'authoritative_total', authoritativeStatementTotalCents: c(1100) },
      ]),
    ]);

    expect(r.competences[0].totalSource).not.toBe('authoritative');
    expect(r.competences[0].statementTotalCents).toBe(c(1000));
    expect(r.suspenseBalanceCents).toBe(c(100));
  });

  it('a resolução vigente é a mais recente, e a anterior fica na trilha', () => {
    const r = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [
        {
          kind: 'authoritative_total',
          authoritativeStatementTotalCents: c(1020),
          authoritativeSource: 'bank_app',
        },
        {
          kind: 'authoritative_total',
          authoritativeStatementTotalCents: c(1100),
          authoritativeSource: 'bank_pdf',
        },
      ]),
    ]);

    expect(r.competences[0].statementTotalCents).toBe(c(1100));
  });
});

describe('resoluções parciais', () => {
  it('uma diferença de 100 vira 30 de crédito e 70 de ajuste', () => {
    const r = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [
        { kind: 'economic_credit', resolvedAmountCents: c(30) },
        { kind: 'bank_adjustment', resolvedAmountCents: c(70) },
      ]),
    ]);

    expect(r.economicCarryCents).toBe(c(30));
    expect(r.reconciliationClosedCents).toBe(c(70));
    expect(r.suspenseBalanceCents).toBe(0);
    expect(twoLedgerConservation(r).conservado).toBe(true);
  });

  it('resolver só parte deixa o resto pendente', () => {
    const r = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [
        { kind: 'economic_credit', resolvedAmountCents: c(30) },
      ]),
    ]);

    expect(r.economicCarryCents).toBe(c(30));
    expect(r.suspenseBalanceCents).toBe(c(70));
    expect(twoLedgerConservation(r).conservado).toBe(true);
  });

  it('três classificações na mesma competência somam sem sobrepor', () => {
    const r = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [
        { kind: 'economic_credit', resolvedAmountCents: c(20) },
        { kind: 'bank_adjustment', resolvedAmountCents: c(30) },
        { kind: 'written_off', resolvedAmountCents: c(50) },
      ]),
    ]);

    expect(r.economicCarryCents).toBe(c(20));
    expect(r.reconciliationClosedCents).toBe(c(80));
    expect(r.suspenseBalanceCents).toBe(0);
  });
});

describe('nenhuma resolução excede a diferença disponível', () => {
  it('pedir mais do que existe aplica só o disponível', () => {
    const r = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [
        { kind: 'economic_credit', resolvedAmountCents: c(500) },
      ]),
    ]);

    expect(r.economicCarryCents).toBe(c(100));
    expect(r.suspenseBalanceCents).toBe(0);
    expect(twoLedgerConservation(r).conservado).toBe(true);
  });

  it('a segunda resolução encontra o saldo já consumido', () => {
    const r = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [
        { kind: 'economic_credit', resolvedAmountCents: c(100) },
        { kind: 'bank_adjustment', resolvedAmountCents: c(100) },
      ]),
    ]);

    expect(r.economicCarryCents).toBe(c(100));
    expect(r.reconciliationClosedCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(0);
  });

  /** Idempotência por construção: repetir a mesma resolução não dobra o efeito. */
  it('a mesma resolução repetida não é aplicada duas vezes', () => {
    const uma = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [
        { kind: 'economic_credit', resolvedAmountCents: c(100) },
      ]),
    ]);
    const duas = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [
        { kind: 'economic_credit', resolvedAmountCents: c(100) },
        { kind: 'economic_credit', resolvedAmountCents: c(100) },
      ]),
    ]);

    expect(duas.economicCarryCents).toBe(uma.economicCarryCents);
    expect(duas.economicCarryCents).toBe(c(100));
  });

  it('resolução não alcança diferença de OUTRA competência', () => {
    const r = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100),
      comExcedente('2026-02', 500, 500, [
        { kind: 'economic_credit', resolvedAmountCents: c(100) },
      ]),
    ]);

    // 2026-02 não gerou diferença; não pode consumir a de 2026-01.
    expect(r.economicCarryCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(c(100));
  });

  it('consumo de diferença anterior não é resolvível', () => {
    // 2026-02 apenas COMPENSA a diferença de 2026-01; não há o que classificar.
    const r = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100),
      comExcedente('2026-02', 500, 400, [
        { kind: 'economic_credit', resolvedAmountCents: c(100) },
      ]),
    ]);

    expect(r.competences[1].suspenseOutCents).toBe(c(100));
    expect(r.competences[1].resolvedToCarryCents).toBe(0);
    expect(r.economicCarryCents).toBe(0);
  });
});

describe('o limite só se move quando há efeito econômico', () => {
  const usado = (r: ReturnType<typeof computeTwoLedgerBalances>) =>
    soma(r, 'economicOpenBalanceCents');

  it('bank_adjustment isolado não muda o limite utilizado', () => {
    const sem = computeTwoLedgerBalances([comExcedente('2026-01', 1000, 1100)]);
    const com = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [{ kind: 'bank_adjustment', resolvedAmountCents: c(100) }]),
    ]);

    expect(usado(com)).toBe(usado(sem));
    expect(usado(com)).toBe(0);
  });

  it('written_off isolado não muda o limite utilizado', () => {
    const com = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [{ kind: 'written_off', resolvedAmountCents: c(100) }]),
    ]);

    expect(usado(com)).toBe(0);
  });

  /**
   * Nuance deliberada, e a única forma em que uma resolução SEM efeito econômico
   * mexe no limite: declarar que a diferença não é dinheiro remove a capacidade
   * dela de explicar um déficit posterior.
   *
   * Deixar a compensação acontecer mesmo assim usaria não-dinheiro para apagar
   * dívida real. O déficit de 2026-02 volta a aparecer inteiro porque é isso que
   * ele sempre foi — o que o encobria era uma diferença que o usuário acaba de
   * declarar inexistente.
   */
  it('declarar a diferença como não-dinheiro devolve o déficit posterior', () => {
    const sem = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100),
      comExcedente('2026-02', 300, 0),
    ]);
    const com = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [{ kind: 'bank_adjustment', resolvedAmountCents: c(100) }]),
      comExcedente('2026-02', 300, 0),
    ]);

    // Sem resolução, os 100 compensavam parte do déficit de 300.
    expect(sem.competences[1].suspenseOutCents).toBe(c(100));
    expect(usado(sem)).toBe(c(200));

    // Declarados como ajuste do banco, não compensam mais nada.
    expect(com.competences[1].suspenseOutCents).toBe(0);
    expect(usado(com)).toBe(c(300));
    expect(twoLedgerConservation(com).conservado).toBe(true);
  });

  it('economic_credit muda o limite, porque produz efeito econômico', () => {
    const com = computeTwoLedgerBalances([
      comExcedente('2026-01', 1000, 1100, [{ kind: 'economic_credit', resolvedAmountCents: c(100) }]),
      comExcedente('2026-02', 300, 0),
    ]);

    expect(usado(com)).toBe(c(200));
  });
});

describe('conservação sob todas as formas de resolução', () => {
  const cenarios: Array<[string, CompetenceLedgerInput[]]> = [
    ['sem resolução', [comExcedente('2026-01', 1000, 1100)]],
    ['economic_credit total', [comExcedente('2026-01', 1000, 1100, [{ kind: 'economic_credit', resolvedAmountCents: c(100) }])]],
    ['economic_credit parcial', [comExcedente('2026-01', 1000, 1100, [{ kind: 'economic_credit', resolvedAmountCents: c(30) }])]],
    ['bank_adjustment', [comExcedente('2026-01', 1000, 1100, [{ kind: 'bank_adjustment', resolvedAmountCents: c(100) }])]],
    ['written_off', [comExcedente('2026-01', 1000, 1100, [{ kind: 'written_off', resolvedAmountCents: c(100) }])]],
    ['mista 30/70', [comExcedente('2026-01', 1000, 1100, [{ kind: 'economic_credit', resolvedAmountCents: c(30) }, { kind: 'bank_adjustment', resolvedAmountCents: c(70) }])]],
    ['excedendo o disponível', [comExcedente('2026-01', 1000, 1100, [{ kind: 'economic_credit', resolvedAmountCents: c(999) }])]],
    ['sinal incompatível', [comExcedente('2026-01', 1000, 1100, [{ kind: 'economic_debt', resolvedAmountCents: c(-50) }])]],
    ['authoritative_total', [comExcedente('2026-01', 1000, 1100, [{ kind: 'authoritative_total', authoritativeStatementTotalCents: c(1050), authoritativeSource: 'bank_app' }])]],
    ['crédito resolvido abatendo o mês seguinte', [
      comExcedente('2026-01', 1000, 1100, [{ kind: 'economic_credit', resolvedAmountCents: c(100) }]),
      comExcedente('2026-02', 300, 0),
    ]],
  ];

  it.each(cenarios)('os dois livros fecham em «%s»', (_nome, entrada) => {
    const r = computeTwoLedgerBalances(entrada);
    expect(twoLedgerConservation(r).conservado).toBe(true);
    expect(suspenseConservation(r)).toBe(true);
  });

  it('nenhum cenário produz saldo econômico negativo', () => {
    for (const [, entrada] of cenarios) {
      const r = computeTwoLedgerBalances(entrada);
      expect(r.competences.every((x) => x.economicOpenBalanceCents >= 0)).toBe(true);
      expect(r.economicCarryCents).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('determinismo', () => {
  const serie = (): CompetenceLedgerInput[] => [
    comExcedente('2026-01', 1000, 1100, [
      { kind: 'economic_credit', resolvedAmountCents: c(30) },
      { kind: 'bank_adjustment', resolvedAmountCents: c(70) },
    ]),
    comExcedente('2026-02', 300, 0),
  ];

  it('a mesma entrada produz exatamente a mesma saída', () => {
    expect(computeTwoLedgerBalances(serie())).toEqual(computeTwoLedgerBalances(serie()));
  });

  it('rodar dez vezes não faz o resultado derivar', () => {
    const primeiro = computeTwoLedgerBalances(serie());
    for (let i = 0; i < 10; i++) {
      expect(computeTwoLedgerBalances(serie())).toEqual(primeiro);
    }
  });

  it('a função não muta as resoluções recebidas', () => {
    const entrada = serie();
    const copia = JSON.parse(JSON.stringify(entrada));
    computeTwoLedgerBalances(entrada);
    expect(entrada).toEqual(copia);
  });
});

describe('não-regressão da cadeia real dos R$ 0,22', () => {
  /** Sem nenhuma resolução explícita, o resultado histórico não pode mudar. */
  const cadeiaReal = (): CompetenceLedgerInput[] => [
    comExcedente('2024-12', 6052.63, 6052.85),
    comExcedente('2025-02', 5798.44, 5858.74),
    {
      referenceMonth: '2025-03',
      computedLinesTotalCents: c(6777.72),
      observedPaymentCents: c(6716.48),
      amountConfirmationCents: c(0.72),
    },
  ];

  it('o livro de reconciliação continua fechando em zero', () => {
    const r = computeTwoLedgerBalances(cadeiaReal());

    expect(r.competences.map((x) => x.suspenseInCents)).toEqual([c(0.22), c(60.3), 0]);
    expect(r.competences[2].suspenseOutCents).toBe(c(60.52));
    expect(r.suspenseBalanceCents).toBe(0);
  });

  it('nenhuma dívida, nenhum crédito e nada encerrado', () => {
    const r = computeTwoLedgerBalances(cadeiaReal());

    expect(soma(r, 'economicOpenBalanceCents')).toBe(0);
    expect(r.economicCarryCents).toBe(0);
    expect(r.reconciliationClosedCents).toBe(0);
  });

  it('a maquinaria de resolução não alterou o resultado histórico', () => {
    const r = computeTwoLedgerBalances(cadeiaReal());

    expect(r.competences.every((x) => x.resolvedToCarryCents === 0)).toBe(true);
    expect(r.competences.every((x) => x.resolvedToDebtCents === 0)).toBe(true);
    expect(r.competences.every((x) => x.reconciliationStatus !== 'resolved')).toBe(true);
    expect(twoLedgerConservation(r).conservado).toBe(true);
  });
});

describe('legado nunca é ativado automaticamente', () => {
  /**
   * Produção tem 5 `micro_divergence_feedback` (credit = 2, offset_prior_credit =
   * 2, bank_adjustment = 1). Nenhum deles é resolução: são campo legado inerte.
   * O domínio só reage a `resolutions` explicitamente passadas.
   */
  it('uma competência sem `resolutions` não produz efeito econômico algum', () => {
    const r = computeTwoLedgerBalances([
      { referenceMonth: '2026-01', computedLinesTotalCents: c(1000), observedPaymentCents: c(1100) },
    ]);

    expect(r.economicCarryCents).toBe(0);
    expect(r.reconciliationClosedCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(c(100));
  });

  it('lista de resoluções vazia é idêntica a ausência de resoluções', () => {
    const semCampo = computeTwoLedgerBalances([
      { referenceMonth: '2026-01', computedLinesTotalCents: c(1000), observedPaymentCents: c(1100) },
    ]);
    const vazia = computeTwoLedgerBalances([comExcedente('2026-01', 1000, 1100, [])]);

    expect(vazia).toEqual(semCampo);
  });
});

// ---------------------------------------------------------------------------

/**
 * O contrato de sinal, testado direto na distribuição.
 *
 * `computeTwoLedgerBalances` nunca produz diferença negativa hoje, então o ramo
 * simétrico da taxonomia é inalcançável por ela. Isso não o torna dispensável: é
 * justamente com disponibilidade NEGATIVA que a guarda genérica de sinal deixaria
 * passar um `economic_credit` de valor negativo — os dois seriam negativos e os
 * sinais casariam. As guardas por tipo existem para esse caso.
 *
 * Testar aqui mantém o contrato verificável enquanto a entrada não existe.
 */
describe('contrato de sinal da distribuição de resoluções', () => {
  it('economic_credit é recusado contra diferença negativa', () => {
    const r = applyResolutions(
      [{ kind: 'economic_credit', resolvedAmountCents: c(-100) }],
      c(-100)
    );

    expect(r.paraCarryCents).toBe(0);
    expect(r.paraDividaCents).toBe(0);
    expect(r.encerradoCents).toBe(0);
  });

  it('economic_debt é recusado contra diferença positiva', () => {
    const r = applyResolutions([{ kind: 'economic_debt', resolvedAmountCents: c(100) }], c(100));

    expect(r.paraDividaCents).toBe(0);
    expect(r.paraCarryCents).toBe(0);
  });

  it('economic_debt resolve diferença negativa e vira dívida pelo valor absoluto', () => {
    const r = applyResolutions([{ kind: 'economic_debt', resolvedAmountCents: c(-100) }], c(-100));

    expect(r.paraDividaCents).toBe(c(100));
    expect(r.paraCarryCents).toBe(0);
    expect(r.encerradoCents).toBe(0);
  });

  it('economic_credit resolve diferença positiva e vira carry', () => {
    const r = applyResolutions([{ kind: 'economic_credit', resolvedAmountCents: c(100) }], c(100));

    expect(r.paraCarryCents).toBe(c(100));
    expect(r.paraDividaCents).toBe(0);
  });

  it('nenhuma resolução ultrapassa a diferença disponível, nos dois sinais', () => {
    const positivo = applyResolutions(
      [{ kind: 'economic_credit', resolvedAmountCents: c(500) }],
      c(100)
    );
    const negativo = applyResolutions(
      [{ kind: 'economic_debt', resolvedAmountCents: c(-500) }],
      c(-100)
    );

    expect(positivo.paraCarryCents).toBe(c(100));
    expect(negativo.paraDividaCents).toBe(c(100));
  });

  it('a segunda resolução encontra o disponível já consumido, nos dois sinais', () => {
    const positivo = applyResolutions(
      [
        { kind: 'economic_credit', resolvedAmountCents: c(100) },
        { kind: 'economic_credit', resolvedAmountCents: c(100) },
      ],
      c(100)
    );
    const negativo = applyResolutions(
      [
        { kind: 'economic_debt', resolvedAmountCents: c(-100) },
        { kind: 'economic_debt', resolvedAmountCents: c(-100) },
      ],
      c(-100)
    );

    expect(positivo.paraCarryCents).toBe(c(100));
    expect(negativo.paraDividaCents).toBe(c(100));
  });

  it('resolução parcial funciona também no sinal negativo', () => {
    const r = applyResolutions(
      [
        { kind: 'economic_debt', resolvedAmountCents: c(-30) },
        { kind: 'bank_adjustment', resolvedAmountCents: c(-70) },
      ],
      c(-100)
    );

    expect(r.paraDividaCents).toBe(c(30));
    expect(r.encerradoCents).toBe(c(-70));
  });

  it('sem diferença disponível, nada é aplicado', () => {
    const r = applyResolutions([{ kind: 'economic_credit', resolvedAmountCents: c(100) }], 0);

    expect(r.paraCarryCents).toBe(0);
    expect(r.encerradoCents).toBe(0);
  });

  it('authoritative_total não consome porção alguma da diferença', () => {
    const r = applyResolutions(
      [
        {
          kind: 'authoritative_total',
          authoritativeStatementTotalCents: c(1000),
          authoritativeSource: 'bank_app',
        },
      ],
      c(100)
    );

    expect(r.paraCarryCents).toBe(0);
    expect(r.paraDividaCents).toBe(0);
    expect(r.encerradoCents).toBe(0);
  });
});
