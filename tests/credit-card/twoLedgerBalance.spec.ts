import { describe, expect, it } from 'vitest';
import {
  computeTwoLedgerBalances,
  suspenseConservation,
  twoLedgerConservation,
} from '../../src/domain/credit-card/twoLedgerBalance';
import type { CompetenceLedgerInput } from '../../src/domain/credit-card/twoLedgerBalance';

/**
 * As invariantes centrais dos dois livros.
 *
 * O que está sendo protegido aqui não é a aritmética — é a fronteira: um valor só
 * atravessa do livro de reconciliação para o econômico por procedência ou por
 * resolução explícita. Nunca por threshold, nunca por sinal, nunca por magnitude.
 */

/** Reais → centavos, só para os cenários ficarem legíveis. */
const c = (reais: number) => Math.round(reais * 100);

const competencia = (
  referenceMonth: string,
  over: Partial<CompetenceLedgerInput> = {}
): CompetenceLedgerInput => ({
  referenceMonth,
  computedLinesTotalCents: 0,
  ...over,
});

/** Cartão 100% manual: sem rodapé de arquivo, o total vem das linhas. */
const manual = (ref: string, totalReais: number, pagoReais: number) =>
  competencia(ref, {
    computedLinesTotalCents: c(totalReais),
    observedPaymentCents: c(pagoReais),
  });

/** Cartão importado: o arquivo declara um total além das linhas. */
const importado = (
  ref: string,
  linhasReais: number,
  rodapeReais: number,
  pagoReais: number
) =>
  competencia(ref, {
    computedLinesTotalCents: c(linhasReais),
    fileReportedTotalCents: c(rodapeReais),
    observedPaymentCents: c(pagoReais),
  });

/** Com valor oficial do emissor: a única procedência que autoriza carry sozinha. */
const comAutoridade = (
  ref: string,
  linhasReais: number,
  oficialReais: number,
  pagoReais: number
) =>
  competencia(ref, {
    computedLinesTotalCents: c(linhasReais),
    authoritativeStatementTotalCents: c(oficialReais),
    authoritativeSource: 'bank_app',
    observedPaymentCents: c(pagoReais),
  });

// ---------------------------------------------------------------------------

describe('a cadeia real de produção dos R$ 0,22', () => {
  /**
   * Reconstituída da evidência read-only de produção. Nenhuma competência tem
   * total autoritativo e nenhuma tem resolução explícita — o pior cenário para o
   * modelo, e o cenário real de hoje.
   *
   * A confirmação de R$ 0,72 em 2025-03 é `confirmation_type = 'amount'`:
   * dinheiro reconhecido como pago, portanto livro 1.
   */
  const cadeiaReal = (): CompetenceLedgerInput[] => [
    manual('2024-12', 6052.63, 6052.85),
    manual('2025-02', 5798.44, 5858.74),
    competencia('2025-03', {
      computedLinesTotalCents: c(6777.72),
      observedPaymentCents: c(6716.48),
      amountConfirmationCents: c(0.72),
    }),
  ];

  it('nenhuma dívida econômica fictícia aparece', () => {
    const r = computeTwoLedgerBalances(cadeiaReal());
    const dividaTotal = r.competences.reduce((a, x) => a + x.economicOpenBalanceCents, 0);

    expect(dividaTotal).toBe(0);
    expect(r.competences.map((x) => x.economicOpenBalanceCents)).toEqual([0, 0, 0]);
  });

  it('nenhum crédito econômico fictício é criado', () => {
    const r = computeTwoLedgerBalances(cadeiaReal());

    expect(r.economicCarryCents).toBe(0);
    expect(r.competences.every((x) => x.priorCreditAppliedCents === 0)).toBe(true);
  });

  it('o suspense fecha exatamente em zero', () => {
    const r = computeTwoLedgerBalances(cadeiaReal());

    // 0,22 e 60,30 entram; 60,52 saem para explicar o déficit de 2025-03.
    expect(r.competences.map((x) => x.suspenseInCents)).toEqual([c(0.22), c(60.3), 0]);
    expect(r.competences.map((x) => x.suspenseOutCents)).toEqual([0, 0, c(60.52)]);
    expect(r.suspenseBalanceCents).toBe(0);
  });

  it('a confirmação de R$ 0,72 pertence ao livro econômico', () => {
    const r = computeTwoLedgerBalances(cadeiaReal());
    const marco = r.competences.find((x) => x.referenceMonth === '2025-03')!;

    // 6.716,48 observado + 0,72 confirmado = 6.717,20 reconhecido.
    expect(marco.recognizedPaymentsCents).toBe(c(6717.2));
    expect(marco.suspenseOutCents).toBe(c(60.52));
  });

  it('nenhuma competência da cadeia é classificada como vencida', () => {
    const comVencimento = cadeiaReal().map((x) => ({ ...x, dueDate: `${x.referenceMonth}-10` }));
    const r = computeTwoLedgerBalances(comVencimento, { asOf: '2026-09-01' });

    expect(r.competences.map((x) => x.economicStatus)).toEqual(['paid', 'paid', 'paid']);
    expect(r.competences.every((x) => x.economicStatus !== 'overdue')).toBe(true);
  });

  it('as três competências ficam marcadas como não reconciliadas', () => {
    const r = computeTwoLedgerBalances(cadeiaReal());
    expect(r.competences.map((x) => x.reconciliationStatus)).toEqual([
      'unreconciled',
      'unreconciled',
      'unreconciled',
    ]);
  });

  it('os dois livros são conservados', () => {
    const r = computeTwoLedgerBalances(cadeiaReal());
    expect(twoLedgerConservation(r).conservado).toBe(true);
    expect(suspenseConservation(r)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('livro econômico', () => {
  it('pagamento exato não deixa saldo nem diferença', () => {
    const r = computeTwoLedgerBalances([manual('2026-01', 400, 400)]);
    const x = r.competences[0];

    expect(x.economicOpenBalanceCents).toBe(0);
    expect(x.economicStatus).toBe('paid');
    expect(x.reconciliationStatus).toBe('reconciled');
    expect(r.suspenseBalanceCents).toBe(0);
    expect(r.economicCarryCents).toBe(0);
  });

  it('pagamento parcial real vira dívida econômica', () => {
    const r = computeTwoLedgerBalances([manual('2026-01', 400, 150)]);
    const x = r.competences[0];

    expect(x.economicOpenBalanceCents).toBe(c(250));
    expect(x.reconciliationStatus).toBe('reconciled');
    expect(r.suspenseBalanceCents).toBe(0);
  });

  it('um déficit real de centavos continua sendo dívida — o modelo não é simétrico por magnitude', () => {
    const r = computeTwoLedgerBalances([manual('2026-01', 400, 399.78)]);

    expect(r.competences[0].economicOpenBalanceCents).toBe(c(0.22));
    expect(r.competences[0].economicStatus).toBe('open');
  });

  it('dívida vence quando passa da data, e só então', () => {
    const entrada = [competencia('2026-01', {
      computedLinesTotalCents: c(400),
      observedPaymentCents: c(150),
      dueDate: '2026-02-10',
    })];

    expect(computeTwoLedgerBalances(entrada, { asOf: '2026-02-01' }).competences[0].economicStatus)
      .toBe('open');
    expect(computeTwoLedgerBalances(entrada, { asOf: '2026-03-01' }).competences[0].economicStatus)
      .toBe('overdue');
  });

  it('excedente com total autoritativo vira carry e abate a competência seguinte', () => {
    const r = computeTwoLedgerBalances([
      comAutoridade('2026-01', 400, 400, 500),
      comAutoridade('2026-02', 300, 300, 0),
    ]);

    expect(r.competences[0].suspenseInCents).toBe(0);
    expect(r.competences[0].economicCarryCents).toBe(c(100));
    expect(r.competences[1].priorCreditAppliedCents).toBe(c(100));
    expect(r.competences[1].economicOpenBalanceCents).toBe(c(200));
    expect(r.suspenseBalanceCents).toBe(0);
  });

  it('crédito econômico abate antes de qualquer suspense', () => {
    // 2026-01 tem autoridade e gera carry de 100. 2026-02 não tem autoridade e
    // gera suspense de 50. 2026-03 cobra 400 e recebe 100: o carry provado entra
    // primeiro e o suspense só alcança o que sobra.
    const r = computeTwoLedgerBalances([
      comAutoridade('2026-01', 400, 400, 500),
      manual('2026-02', 200, 250),
      manual('2026-03', 400, 100),
    ]);
    const marco = r.competences[2];

    expect(marco.priorCreditAppliedCents).toBe(c(100));
    expect(marco.suspenseOutCents).toBe(c(50));
    expect(marco.economicOpenBalanceCents).toBe(c(150));
  });
});

// ---------------------------------------------------------------------------

describe('a fronteira entre os livros', () => {
  it('pagamento deliberadamente maior SEM procedência não vira crédito', () => {
    const r = computeTwoLedgerBalances([manual('2026-01', 1000, 1500)]);
    const x = r.competences[0];

    expect(r.economicCarryCents).toBe(0);
    expect(x.suspenseInCents).toBe(c(500));
    expect(r.suspenseBalanceCents).toBe(c(500));
    expect(x.reconciliationStatus).toBe('unreconciled');
  });

  it('o mesmo pagamento COM resolução explícita vira crédito econômico', () => {
    const r = computeTwoLedgerBalances([
      competencia('2026-01', {
        computedLinesTotalCents: c(1000),
        observedPaymentCents: c(1500),
        explicitEconomicCreditResolution: true,
      }),
    ]);

    expect(r.economicCarryCents).toBe(c(500));
    expect(r.suspenseBalanceCents).toBe(0);
    expect(r.competences[0].suspenseInCents).toBe(0);
  });

  it('nenhuma diferença não reconciliada vira overdue sozinha', () => {
    // Um excedente sem procedência, seguido de competência vazia já vencida.
    const r = computeTwoLedgerBalances(
      [
        competencia('2026-01', {
          computedLinesTotalCents: c(1000),
          observedPaymentCents: c(1000.22),
          dueDate: '2026-02-10',
        }),
      ],
      { asOf: '2027-01-01' }
    );

    expect(r.competences[0].economicStatus).toBe('paid');
    expect(r.competences[0].economicStatus).not.toBe('overdue');
    expect(r.suspenseBalanceCents).toBe(c(0.22));
  });

  it('nenhuma diferença não reconciliada vira crédito econômico sozinha', () => {
    // Suspense de 500 acumulado; a competência seguinte está quitada. O suspense
    // NÃO pode reduzir nada nem aparecer como crédito disponível.
    const r = computeTwoLedgerBalances([
      manual('2026-01', 1000, 1500),
      manual('2026-02', 300, 300),
    ]);

    expect(r.economicCarryCents).toBe(0);
    expect(r.competences[1].priorCreditAppliedCents).toBe(0);
    expect(r.competences[1].economicOpenBalanceCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(c(500));
  });

  /**
   * O piso de R$ 1,00 que existia antes decidia pela magnitude. Estes dois casos
   * têm magnitudes opostas — centavos e centenas — e recebem exatamente o mesmo
   * tratamento, porque a procedência é a mesma.
   */
  it('a magnitude não participa da decisão em ponto algum', () => {
    const centavos = computeTwoLedgerBalances([manual('2026-01', 1000, 1000.22)]);
    const centenas = computeTwoLedgerBalances([manual('2026-01', 1000, 1500)]);

    expect(centavos.economicCarryCents).toBe(0);
    expect(centenas.economicCarryCents).toBe(0);
    expect(centavos.competences[0].reconciliationStatus).toBe('unreconciled');
    expect(centenas.competences[0].reconciliationStatus).toBe('unreconciled');
  });
});

// ---------------------------------------------------------------------------

describe('divergência entre rodapé e linhas', () => {
  it('rodapé para cima: o total do arquivo manda sobre as linhas', () => {
    const r = computeTwoLedgerBalances([importado('2026-01', 399.78, 400, 400)]);
    const x = r.competences[0];

    expect(x.totalSource).toBe('file');
    expect(x.statementTotalCents).toBe(c(400));
    expect(x.economicOpenBalanceCents).toBe(0);
    // Sem autoridade não há ajuste de reconciliação a registrar.
    expect(x.reconciliationAdjustmentCents).toBe(0);
  });

  it('rodapé para baixo: idem, e a sobra de linhas não vira dívida', () => {
    const r = computeTwoLedgerBalances([importado('2026-01', 400.22, 400, 400)]);

    expect(r.competences[0].statementTotalCents).toBe(c(400));
    expect(r.competences[0].economicOpenBalanceCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(0);
  });

  it('com autoridade, a distância até as linhas vira ajuste e fica fora do carry', () => {
    const r = computeTwoLedgerBalances([comAutoridade('2026-01', 399.78, 400, 400)]);
    const x = r.competences[0];

    expect(x.totalSource).toBe('authoritative');
    expect(x.reconciliationAdjustmentCents).toBe(c(0.22));
    expect(x.reconciliationStatus).toBe('adjusted');
    expect(r.economicCarryCents).toBe(0);
    expect(x.economicOpenBalanceCents).toBe(0);
  });

  it('ajuste para baixo é registrado com sinal negativo', () => {
    const r = computeTwoLedgerBalances([comAutoridade('2026-01', 400.22, 400, 400)]);
    expect(r.competences[0].reconciliationAdjustmentCents).toBe(c(-0.22));
  });

  it('um total autoritativo sem procedência não é autoritativo', () => {
    const r = computeTwoLedgerBalances([
      competencia('2026-01', {
        computedLinesTotalCents: c(399.78),
        authoritativeStatementTotalCents: c(400),
        authoritativeSource: null,
        observedPaymentCents: c(400.5),
      }),
    ]);

    expect(r.competences[0].totalSource).toBe('lines');
    expect(r.competences[0].statementTotalCents).toBe(c(399.78));
    // Sem procedência o excedente não pode virar crédito.
    expect(r.economicCarryCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(c(0.72));
  });

  it('a escada completa respeita a ordem autoritativo → arquivo → linhas', () => {
    const todos = computeTwoLedgerBalances([comAutoridade('2026-01', 100, 300, 0)]);
    expect(todos.competences[0].statementTotalCents).toBe(c(300));

    const semAutoridade = computeTwoLedgerBalances([importado('2026-01', 100, 200, 0)]);
    expect(semAutoridade.competences[0].statementTotalCents).toBe(c(200));

    const soLinhas = computeTwoLedgerBalances([manual('2026-01', 100, 0)]);
    expect(soLinhas.competences[0].statementTotalCents).toBe(c(100));
  });
});

// ---------------------------------------------------------------------------

/**
 * O ajuste de reconciliação é a diferença entre o que o emissor cobrou e o que as
 * linhas somam. É informação do livro 2 e não pode influenciar nenhuma quantidade
 * do livro 1 — nem o saldo, nem o carry, nem a conservação. Um ajuste grande é o
 * melhor detector de vazamento: se ele entrasse na conta econômica, apareceria
 * inteiro como dívida.
 */
describe('o ajuste de reconciliação não toca o livro econômico', () => {
  /** Oficial 1.000, linhas 400 → ajuste de 600. Pagamento cobre o oficial. */
  const ajusteGrande = () => [comAutoridade('2026-01', 400, 1000, 1000)];

  it('um ajuste de 600 não vira dívida de 600', () => {
    const r = computeTwoLedgerBalances(ajusteGrande());
    const x = r.competences[0];

    expect(x.reconciliationAdjustmentCents).toBe(c(600));
    expect(x.economicOpenBalanceCents).toBe(0);
    expect(x.economicStatus).toBe('paid');
  });

  it('um ajuste grande não desloca o carry', () => {
    const r = computeTwoLedgerBalances(ajusteGrande());
    expect(r.economicCarryCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(0);
  });

  it('o saldo econômico responde só a total menos pagamentos', () => {
    // Mesmo oficial e mesmo pagamento parcial, ajustes opostos: o saldo não muda.
    const paraCima = computeTwoLedgerBalances([comAutoridade('2026-01', 400, 1000, 700)]);
    const paraBaixo = computeTwoLedgerBalances([comAutoridade('2026-01', 1600, 1000, 700)]);

    expect(paraCima.competences[0].reconciliationAdjustmentCents).toBe(c(600));
    expect(paraBaixo.competences[0].reconciliationAdjustmentCents).toBe(c(-600));
    expect(paraCima.competences[0].economicOpenBalanceCents).toBe(c(300));
    expect(paraBaixo.competences[0].economicOpenBalanceCents).toBe(c(300));
  });

  it('a conservação continua fechando com ajuste presente', () => {
    for (const entrada of [
      ajusteGrande(),
      [comAutoridade('2026-01', 1600, 1000, 700)],
      [comAutoridade('2026-01', 400, 1000, 1200)],
    ]) {
      const r = computeTwoLedgerBalances(entrada);
      expect(twoLedgerConservation(r).conservado).toBe(true);
      expect(suspenseConservation(r)).toBe(true);
    }
  });

  it('o ajuste também não contamina competências seguintes', () => {
    const r = computeTwoLedgerBalances([
      comAutoridade('2026-01', 400, 1000, 1000),
      manual('2026-02', 500, 500),
    ]);

    expect(r.competences[1].economicOpenBalanceCents).toBe(0);
    expect(r.competences[1].priorCreditAppliedCents).toBe(0);
    expect(r.competences[1].suspenseOutCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('compensação entre competências', () => {
  it('diferenças de sinais opostos se cancelam dentro do livro 2', () => {
    const r = computeTwoLedgerBalances([
      manual('2026-01', 1000, 1000.22),
      manual('2026-02', 1000, 999.78),
    ]);

    expect(r.competences[0].suspenseInCents).toBe(c(0.22));
    expect(r.competences[1].suspenseOutCents).toBe(c(0.22));
    expect(r.suspenseBalanceCents).toBe(0);
    expect(r.competences[1].economicOpenBalanceCents).toBe(0);
    expect(r.economicCarryCents).toBe(0);
  });

  it('a compensação é parcial quando o déficit excede o suspense', () => {
    const r = computeTwoLedgerBalances([
      manual('2026-01', 1000, 1000.22),
      manual('2026-02', 1000, 900),
    ]);
    const segundo = r.competences[1];

    expect(segundo.suspenseOutCents).toBe(c(0.22));
    expect(segundo.economicOpenBalanceCents).toBe(c(99.78));
    expect(segundo.economicStatus).toBe('open');
    expect(r.suspenseBalanceCents).toBe(0);
  });

  it('diferença que nunca se compensa permanece no livro 2 indefinidamente', () => {
    const r = computeTwoLedgerBalances([
      manual('2026-01', 1000, 1000.22),
      manual('2026-02', 500, 500),
      manual('2026-03', 700, 700),
    ]);

    expect(r.suspenseBalanceCents).toBe(c(0.22));
    expect(r.economicCarryCents).toBe(0);
    expect(r.competences.reduce((a, x) => a + x.economicOpenBalanceCents, 0)).toBe(0);
    // Continua visível e auditável na competência que a originou.
    expect(r.competences[0].unresolvedReconciliationDeltaCents).toBe(c(0.22));
  });

  it('o suspense atravessa várias competências até encontrar o que explicar', () => {
    const r = computeTwoLedgerBalances([
      manual('2026-01', 100, 150),
      manual('2026-02', 200, 200),
      manual('2026-03', 300, 300),
      manual('2026-04', 400, 350),
    ]);

    expect(r.competences[0].suspenseInCents).toBe(c(50));
    expect(r.competences[3].suspenseOutCents).toBe(c(50));
    expect(r.competences[3].economicOpenBalanceCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('origens dos lançamentos', () => {
  it('manual', () => {
    const r = computeTwoLedgerBalances([manual('2026-01', 400, 250)]);
    expect(r.competences[0].totalSource).toBe('lines');
    expect(r.competences[0].economicOpenBalanceCents).toBe(c(150));
  });

  it('importado', () => {
    const r = computeTwoLedgerBalances([importado('2026-01', 400, 400, 250)]);
    expect(r.competences[0].totalSource).toBe('file');
    expect(r.competences[0].economicOpenBalanceCents).toBe(c(150));
  });

  it('misto: linhas manuais somam às importadas antes de chegar aqui', () => {
    // 400 importados + 120 manuais − 20 de estorno = 500 nas linhas; o rodapé do
    // arquivo cobre só a parte importada, então o total das linhas é maior.
    const r = computeTwoLedgerBalances([
      competencia('2026-01', {
        computedLinesTotalCents: c(500),
        fileReportedTotalCents: c(400),
        observedPaymentCents: c(500),
      }),
    ]);

    // O rodapé continua sendo a fonte declarada; a sobra manual vira diferença.
    expect(r.competences[0].statementTotalCents).toBe(c(400));
    expect(r.suspenseBalanceCents).toBe(c(100));
    expect(r.economicCarryCents).toBe(0);
  });

  it('múltiplos portadores: os arquivos somam na mesma competência', () => {
    // Ione 216,25 + Cássio 1.000 faturados; 216,47 + 1.000 pagos.
    const r = computeTwoLedgerBalances([manual('2025-01', 1216.25, 1216.47)]);

    expect(r.competences[0].statementTotalCents).toBe(c(1216.25));
    expect(r.competences[0].economicOpenBalanceCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(c(0.22));
  });

  it('múltiplos portadores: um a mais e outro a menos fecham a competência', () => {
    // Ione paga 0,22 a mais, Cássio 0,22 a menos: some antes de chegar ao livro.
    const r = computeTwoLedgerBalances([manual('2025-01', 1216.25, 1216.25)]);

    expect(r.competences[0].economicOpenBalanceCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(0);
    expect(r.competences[0].reconciliationStatus).toBe('reconciled');
  });
});

// ---------------------------------------------------------------------------

describe('determinismo do rebuild', () => {
  const serie = (): CompetenceLedgerInput[] => [
    manual('2026-01', 1000, 1000.22),
    comAutoridade('2026-02', 500, 500, 600),
    importado('2026-03', 700, 700, 650),
    manual('2026-04', 300, 300),
  ];

  it('a mesma entrada produz exatamente a mesma saída', () => {
    expect(computeTwoLedgerBalances(serie())).toEqual(computeTwoLedgerBalances(serie()));
  });

  it('rodar dez vezes seguidas não faz o resultado derivar', () => {
    const primeiro = computeTwoLedgerBalances(serie());
    for (let i = 0; i < 10; i++) {
      expect(computeTwoLedgerBalances(serie())).toEqual(primeiro);
    }
  });

  it('a ordem de entrada não altera o resultado — a competência é que ordena', () => {
    const embaralhada = [serie()[2], serie()[0], serie()[3], serie()[1]];
    expect(computeTwoLedgerBalances(embaralhada)).toEqual(computeTwoLedgerBalances(serie()));
  });

  it('a função não muta a lista recebida', () => {
    const entrada = serie();
    const copia = JSON.parse(JSON.stringify(entrada));
    computeTwoLedgerBalances(entrada);
    expect(entrada).toEqual(copia);
  });
});

// ---------------------------------------------------------------------------

describe('conservação separada dos dois livros', () => {
  const cenarios: Array<[string, CompetenceLedgerInput[]]> = [
    ['pagamento exato', [manual('2026-01', 400, 400)]],
    ['pagamento parcial', [manual('2026-01', 400, 150)]],
    ['excedente sem procedência', [manual('2026-01', 1000, 1500)]],
    [
      'excedente com resolução explícita',
      [
        competencia('2026-01', {
          computedLinesTotalCents: c(1000),
          observedPaymentCents: c(1500),
          explicitEconomicCreditResolution: true,
        }),
      ],
    ],
    ['excedente com autoridade', [comAutoridade('2026-01', 400, 400, 500)]],
    [
      'compensação total',
      [manual('2026-01', 1000, 1000.22), manual('2026-02', 1000, 999.78)],
    ],
    [
      'compensação parcial',
      [manual('2026-01', 1000, 1000.22), manual('2026-02', 1000, 900)],
    ],
    [
      'diferença que nunca se compensa',
      [manual('2026-01', 1000, 1000.22), manual('2026-02', 500, 500)],
    ],
    [
      'cadeia real de produção',
      [
        manual('2024-12', 6052.63, 6052.85),
        manual('2025-02', 5798.44, 5858.74),
        competencia('2025-03', {
          computedLinesTotalCents: c(6777.72),
          observedPaymentCents: c(6716.48),
          amountConfirmationCents: c(0.72),
        }),
      ],
    ],
    [
      'carry e suspense convivendo',
      [
        comAutoridade('2026-01', 400, 400, 500),
        manual('2026-02', 200, 250),
        manual('2026-03', 300, 0),
      ],
    ],
  ];

  it.each(cenarios)('livro econômico e livro 2 fecham em «%s»', (_nome, entrada) => {
    const r = computeTwoLedgerBalances(entrada);
    expect(twoLedgerConservation(r).conservado).toBe(true);
    expect(suspenseConservation(r)).toBe(true);
  });

  it('nenhum cenário produz saldo negativo em aberto', () => {
    for (const [, entrada] of cenarios) {
      const r = computeTwoLedgerBalances(entrada);
      expect(r.competences.every((x) => x.economicOpenBalanceCents >= 0)).toBe(true);
      expect(r.economicCarryCents).toBeGreaterThanOrEqual(0);
    }
  });

  it('a identidade de conservação é sensível — não passa por vacuidade', () => {
    const r = computeTwoLedgerBalances([manual('2026-01', 1000, 1500)]);
    const cons = twoLedgerConservation(r);

    // 1000 − 1500 = −500, distribuídos como suspense de 500.
    expect(cons.cobrado - cons.reconhecido).toBe(c(-500));
    expect(cons.suspense).toBe(c(500));
    expect(cons.emAberto - cons.carry - cons.suspense).toBe(c(-500));
  });
});

// ---------------------------------------------------------------------------

describe('aritmética exata em centavos', () => {
  it('centavos que dariam erro em ponto flutuante fecham exatamente', () => {
    // 0,1 + 0,2 !== 0,3 em float. Em centavos inteiros, fecha.
    const r = computeTwoLedgerBalances([
      manual('2026-01', 0.1, 0),
      manual('2026-02', 0.2, 0),
      manual('2026-03', 0, 0.3),
    ]);

    expect(r.competences[0].economicOpenBalanceCents).toBe(10);
    expect(r.competences[1].economicOpenBalanceCents).toBe(20);
    expect(twoLedgerConservation(r).conservado).toBe(true);
  });

  it('uma série longa de centavos não acumula deriva', () => {
    const entrada = Array.from({ length: 120 }, (_, i) =>
      manual(`20${26 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, 0.01, 0)
    );
    const r = computeTwoLedgerBalances(entrada);

    expect(r.competences.reduce((a, x) => a + x.economicOpenBalanceCents, 0)).toBe(120);
    expect(twoLedgerConservation(r).conservado).toBe(true);
  });
});

// ---------------------------------------------------------------------------

/**
 * O limite do alcance da proveniência.
 *
 * Proveniência governa o tratamento da INCERTEZA — o excedente sem prova, o
 * resíduo que nenhuma evidência explica. Ela NÃO governa a existência econômica
 * das transações: compras, tarifas e estornos importados são fatos econômicos
 * como quaisquer outros, e entram integralmente na obrigação.
 *
 * Levar a proveniência longe demais produziria o absurdo de uma fatura importada
 * de R$ 6.000 sem pagamento virar `economic_open = 0` com diferença de
 * reconciliação de −6.000, deixando o cartão sem dívida e sem limite consumido.
 */
describe('proveniência governa a incerteza, não a existência das transações', () => {
  it('fatura importada sem pagamento é dívida de valor cheio', () => {
    const r = computeTwoLedgerBalances([manual('2026-01', 6000, 0)]);
    const x = r.competences[0];

    expect(x.economicOpenBalanceCents).toBe(c(6000));
    expect(x.reconciliationStatus).toBe('reconciled');
    expect(r.suspenseBalanceCents).toBe(0);
  });

  it('excedente sobre obrigação importada vira diferença, não crédito', () => {
    const r = computeTwoLedgerBalances([manual('2026-01', 1000, 1000.22)]);

    expect(r.competences[0].economicOpenBalanceCents).toBe(0);
    expect(r.economicCarryCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(c(0.22));
  });

  it('déficit sem diferença anterior é dívida — a obrigação não se apaga', () => {
    const r = computeTwoLedgerBalances([manual('2026-01', 1000.22, 1000)]);

    expect(r.competences[0].economicOpenBalanceCents).toBe(c(0.22));
    expect(r.suspenseBalanceCents).toBe(0);
  });

  it('déficit COM diferença anterior é compensado dentro do livro 2', () => {
    const r = computeTwoLedgerBalances([
      manual('2025-12', 1000, 1000.22),
      manual('2026-01', 1000.22, 1000),
    ]);

    expect(r.competences[0].suspenseInCents).toBe(c(0.22));
    expect(r.competences[1].suspenseOutCents).toBe(c(0.22));
    expect(r.competences[1].economicOpenBalanceCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(0);
    // Compensação interna do livro 2: não é carry econômico e não é pagamento.
    expect(r.economicCarryCents).toBe(0);
    expect(r.competences[1].priorCreditAppliedCents).toBe(0);
  });

  it('manual e importado somam integralmente, mesmo com rodapé declarado', () => {
    const r = computeTwoLedgerBalances([
      competencia('2026-01', {
        manualObligationCents: c(300),
        computedLinesTotalCents: c(5000),
        fileReportedTotalCents: c(5000),
        observedPaymentCents: 0,
      }),
    ]);
    const x = r.competences[0];

    // O rodapé de 5.000 descreve só o arquivo; os 300 manuais somam por cima.
    expect(x.statementTotalCents).toBe(c(5300));
    expect(x.economicOpenBalanceCents).toBe(c(5300));
    expect(x.totalSource).toBe('mixed');
  });

  it('sem rodapé, manual e importado também somam', () => {
    const r = computeTwoLedgerBalances([
      competencia('2026-01', { manualObligationCents: c(300), computedLinesTotalCents: c(5000) }),
    ]);

    expect(r.competences[0].statementTotalCents).toBe(c(5300));
    expect(r.competences[0].economicOpenBalanceCents).toBe(c(5300));
  });

  it('o total autoritativo continua prevalecendo sobre tudo', () => {
    const r = computeTwoLedgerBalances([
      competencia('2026-01', {
        manualObligationCents: c(300),
        computedLinesTotalCents: c(5000),
        fileReportedTotalCents: c(5000),
        authoritativeStatementTotalCents: c(5100),
        authoritativeSource: 'bank_pdf',
        observedPaymentCents: c(5100),
      }),
    ]);
    const x = r.competences[0];

    expect(x.totalSource).toBe('authoritative');
    expect(x.statementTotalCents).toBe(c(5100));
    expect(x.economicOpenBalanceCents).toBe(0);
    // 5.100 oficiais contra 5.300 de linhas conhecidas: ajuste de −200.
    expect(x.reconciliationAdjustmentCents).toBe(c(-200));
  });

  it('a resolução explícita continua movendo excedente para crédito', () => {
    const semResolucao = computeTwoLedgerBalances([manual('2026-01', 1000, 1500)]);
    const comResolucao = computeTwoLedgerBalances([
      competencia('2026-01', {
        computedLinesTotalCents: c(1000),
        observedPaymentCents: c(1500),
        explicitEconomicCreditResolution: true,
      }),
    ]);

    expect(semResolucao.economicCarryCents).toBe(0);
    expect(semResolucao.suspenseBalanceCents).toBe(c(500));
    expect(comResolucao.economicCarryCents).toBe(c(500));
    expect(comResolucao.suspenseBalanceCents).toBe(0);
  });

  it('a compensação nunca apaga dívida além da diferença disponível', () => {
    const r = computeTwoLedgerBalances([
      manual('2025-12', 1000, 1000.22),
      manual('2026-01', 1000, 500),
    ]);

    expect(r.competences[1].suspenseOutCents).toBe(c(0.22));
    expect(r.competences[1].economicOpenBalanceCents).toBe(c(499.78));
    expect(r.suspenseBalanceCents).toBe(0);
  });

  it('a cadeia real segue o roteiro competência a competência', () => {
    const r = computeTwoLedgerBalances([
      manual('2024-12', 6052.63, 6052.85),
      manual('2025-02', 5798.44, 5858.74),
      competencia('2025-03', {
        computedLinesTotalCents: c(6777.72),
        observedPaymentCents: c(6716.48),
        amountConfirmationCents: c(0.72),
      }),
    ]);

    expect(r.competences[0].suspenseInCents).toBe(c(0.22));
    expect(r.competences[1].suspenseInCents).toBe(c(60.3));
    expect(r.competences[1].suspenseBalanceCents).toBe(c(60.52));
    // Déficit bruto de 61,24. A confirmação de 0,72 é pagamento reconhecido no
    // livro 1; o suspense de 60,52 explica o restante dentro do livro 2.
    expect(r.competences[2].recognizedPaymentsCents).toBe(c(6717.2));
    expect(r.competences[2].suspenseOutCents).toBe(c(60.52));
    expect(r.competences[2].economicOpenBalanceCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(0);
    expect(r.economicCarryCents).toBe(0);
  });

  it('a conservação econômica não muda quando há consumo de suspense', () => {
    const semConsumo = computeTwoLedgerBalances([manual('2026-01', 1000, 500)]);
    const comConsumo = computeTwoLedgerBalances([
      manual('2025-12', 1000, 1000.22),
      manual('2026-01', 1000, 500),
    ]);

    expect(twoLedgerConservation(semConsumo).conservado).toBe(true);
    expect(twoLedgerConservation(comConsumo).conservado).toBe(true);
    expect(suspenseConservation(comConsumo)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

/**
 * O rodapé do arquivo descreve o ARQUIVO, não a competência.
 *
 * Deixá-lo substituir o total inteiro faz obrigações registradas por fora
 * desaparecerem sem deixar rastro — e o desaparecimento é silencioso, porque o
 * número resultante continua parecendo plausível. Estes casos cercam a diferença
 * de perto, com e sem pagamento, sozinha e em série.
 */
describe('o rodapé não engole obrigação registrada por fora', () => {
  const mistoComRodape = (ref: string, manualReais: number, arquivoReais: number, pagoReais: number) =>
    competencia(ref, {
      manualObligationCents: c(manualReais),
      computedLinesTotalCents: c(arquivoReais),
      fileReportedTotalCents: c(arquivoReais),
      observedPaymentCents: c(pagoReais),
    });

  it('pagando só a parte do arquivo, a manual continua devida', () => {
    const r = computeTwoLedgerBalances([mistoComRodape('2026-01', 300, 5000, 5000)]);

    expect(r.competences[0].statementTotalCents).toBe(c(5300));
    expect(r.competences[0].economicOpenBalanceCents).toBe(c(300));
  });

  it('pagando tudo, a competência fecha sem sobra nem falta', () => {
    const r = computeTwoLedgerBalances([mistoComRodape('2026-01', 300, 5000, 5300)]);

    expect(r.competences[0].economicOpenBalanceCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(0);
    expect(r.competences[0].reconciliationStatus).toBe('reconciled');
  });

  it('pagando além de tudo, o excedente vai para o livro 2', () => {
    const r = computeTwoLedgerBalances([mistoComRodape('2026-01', 300, 5000, 5300.22)]);

    expect(r.economicCarryCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(c(0.22));
  });

  it('em série, a parte manual continua consumindo limite mês a mês', () => {
    const r = computeTwoLedgerBalances([
      mistoComRodape('2026-01', 300, 5000, 5000),
      mistoComRodape('2026-02', 200, 4000, 4000),
    ]);

    const emAberto = r.competences.reduce((a, x) => a + x.economicOpenBalanceCents, 0);
    expect(emAberto).toBe(c(500));
    expect(twoLedgerConservation(r).conservado).toBe(true);
  });

  it('uma obrigação manual pequena não some diante de um arquivo grande', () => {
    const r = computeTwoLedgerBalances([mistoComRodape('2026-01', 0.22, 9000, 9000)]);
    expect(r.competences[0].economicOpenBalanceCents).toBe(c(0.22));
  });
});
