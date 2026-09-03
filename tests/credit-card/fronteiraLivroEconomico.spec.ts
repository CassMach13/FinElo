import { describe, expect, it } from 'vitest';
import {
  computeTwoLedgerBalances,
  suspenseConservation,
  twoLedgerConservation,
  type CompetenceLedgerInput,
} from '../../src/domain/credit-card/twoLedgerBalance';

/**
 * A FRONTEIRA entre o livro econômico e o livro de reconciliação.
 *
 * ===========================================================================
 * O BUG QUE ESTE ARQUIVO FECHA
 * ===========================================================================
 *
 * O suspense compensava QUALQUER déficit posterior. Na conta piloto isso fazia
 * R$ 0,94 que ninguém explicou abaterem uma fatura de R$ 7.258,08 — o card
 * mostrava R$ 7.257,14, o limite utilizado seguia o número menor, e o histórico
 * discordava do card por exatamente aquele centavo-e-noventa-e-quatro.
 *
 * Era a porta dos fundos do carry: `carryIsSupported` exigia procedência para o
 * excedente virar crédito gastável, e o mesmo excedente sem procedência abatia
 * dívida assim mesmo. Enquanto ela existiu, o porteiro era enfeite.
 *
 * ===========================================================================
 * A REGRA
 * ===========================================================================
 *
 * O suspense pode explicar a DISTRIBUIÇÃO de uma liquidação entre ciclos — a
 * convenção faz o arquivo do mês N+1 quitar o mês N, então o mesmo dinheiro
 * aparece com folga num mês e em falta no seguinte. Compensar isso não atravessa
 * livro nenhum: cancela uma diferença contra a outra dentro do livro 2.
 *
 * Sem NENHUMA liquidação observada não existe dinheiro que possa ter caído no
 * ciclo errado. Não há o que redistribuir, e a obrigação é o valor cheio.
 *
 * A porta é CATEGÓRICA: pergunta se houve liquidação, nunca quanto. E lê a mesma
 * liquidação que o livro 1 já reconhece — pagamento observado e confirmação de
 * valor —, sem inventar uma segunda fonte de verdade.
 */

const c = (reais: number) => Math.round(reais * 100);

/** Excedente de R$ 100 sem procedência: vai para o livro 2, não para o carry. */
const excedenteSemProva = (): CompetenceLedgerInput => ({
  referenceMonth: '2026-01',
  computedLinesTotalCents: c(1000),
  observedPaymentCents: c(1100),
});

const ambosOsLivrosFecham = (r: ReturnType<typeof computeTwoLedgerBalances>) => {
  expect(twoLedgerConservation(r).conservado).toBe(true);
  expect(suspenseConservation(r)).toBe(true);
};

describe('sem liquidação observada, o suspense não abate nada', () => {
  const r = computeTwoLedgerBalances([
    excedenteSemProva(),
    { referenceMonth: '2026-02', computedLinesTotalCents: c(800), observedPaymentCents: 0 },
  ]);
  const fevereiro = r.competences[1];

  it('a fatura fica em aberto pelo valor cheio', () => {
    expect(fevereiro.recognizedPaymentsCents).toBe(0);
    expect(fevereiro.suspenseOutCents).toBe(0);
    expect(fevereiro.economicOpenBalanceCents).toBe(c(800));
  });

  it('o excedente continua no livro 2, sem virar crédito nem sumir', () => {
    expect(r.suspenseBalanceCents).toBe(c(100));
    expect(r.economicCarryCents).toBe(0);
    expect(r.resolvedNonEconomicCents).toBe(0);
  });

  it('as duas conservações continuam fechando', () => ambosOsLivrosFecham(r));
});

describe('com liquidação observada, o suspense explica a distribuição', () => {
  /** Fevereiro cobra 800 e recebe 750: faltam 50, e o livro 2 tem 100. */
  const r = computeTwoLedgerBalances([
    excedenteSemProva(),
    { referenceMonth: '2026-02', computedLinesTotalCents: c(800), observedPaymentCents: c(750) },
  ]);
  const fevereiro = r.competences[1];

  it('o déficit some sem virar dívida — é o mesmo dinheiro visto dos dois lados', () => {
    expect(fevereiro.suspenseOutCents).toBe(c(50));
    expect(fevereiro.economicOpenBalanceCents).toBe(0);
    expect(fevereiro.economicStatus).toBe('paid');
  });

  it('só o que foi usado sai do livro 2', () => {
    expect(r.suspenseBalanceCents).toBe(c(50));
    expect(r.economicCarryCents).toBe(0);
  });

  it('as duas conservações continuam fechando', () => ambosOsLivrosFecham(r));

  /**
   * A porta é categórica, não proporcional: um pagamento de R$ 1 abre a mesma
   * porta que um de R$ 750. Amarrar a compensação à MAGNITUDE do pagamento seria
   * um threshold — exatamente o que este módulo não admite.
   */
  it('a porta pergunta SE houve liquidação, nunca quanto', () => {
    const comUmReal = computeTwoLedgerBalances([
      excedenteSemProva(),
      { referenceMonth: '2026-02', computedLinesTotalCents: c(800), observedPaymentCents: c(1) },
    ]);

    expect(comUmReal.competences[1].suspenseOutCents).toBe(c(100));
    expect(comUmReal.competences[1].economicOpenBalanceCents).toBe(c(699));
    ambosOsLivrosFecham(comUmReal);
  });
});

describe('confirmação de valor é liquidação, como sempre foi', () => {
  /**
   * `amountConfirmationCents` é pagamento reconhecido no livro 1 desde o início —
   * é o degrau que a confirmação de R$ 0,72 da conta piloto ocupa. A fronteira lê
   * a MESMA soma, sem criar fonte nova de verdade: uma competência confirmada
   * abre a porta igual a uma com pagamento no extrato.
   */
  const r = computeTwoLedgerBalances([
    excedenteSemProva(),
    {
      referenceMonth: '2026-02',
      computedLinesTotalCents: c(800),
      observedPaymentCents: 0,
      amountConfirmationCents: c(750),
    },
  ]);

  it('confirmação sozinha já é liquidação observada', () => {
    expect(r.competences[1].recognizedPaymentsCents).toBe(c(750));
    expect(r.competences[1].suspenseOutCents).toBe(c(50));
    expect(r.competences[1].economicOpenBalanceCents).toBe(0);
  });

  it('as duas conservações continuam fechando', () => ambosOsLivrosFecham(r));
});

describe('crédito econômico REAL continua abatendo, com ou sem pagamento', () => {
  /**
   * A fronteira governa o livro 2. O livro 1 não mudou: crédito com procedência é
   * dinheiro provado e abate antes de qualquer suspense — inclusive uma fatura
   * que não recebeu pagamento nenhum.
   */
  const porAutoridade = (): CompetenceLedgerInput => ({
    referenceMonth: '2026-01',
    computedLinesTotalCents: c(1000),
    authoritativeStatementTotalCents: c(1000),
    authoritativeSource: 'bank_app',
    observedPaymentCents: c(1100),
  });

  const semPagamentoDepois = {
    referenceMonth: '2026-02',
    computedLinesTotalCents: c(800),
    observedPaymentCents: 0,
  };

  it('porta 1 · total autoritativo: o crédito abate a fatura não paga', () => {
    const r = computeTwoLedgerBalances([porAutoridade(), semPagamentoDepois]);

    expect(r.competences[1].priorCreditAppliedCents).toBe(c(100));
    expect(r.competences[1].economicOpenBalanceCents).toBe(c(700));
    expect(r.suspenseBalanceCents).toBe(0);
    ambosOsLivrosFecham(r);
  });

  it('porta 2 · resolução explícita: mesmo efeito', () => {
    const r = computeTwoLedgerBalances([
      {
        ...excedenteSemProva(),
        resolutions: [{ kind: 'economic_credit', resolvedAmountCents: c(100) }],
      },
      semPagamentoDepois,
    ]);

    expect(r.competences[0].resolvedToCarryCents).toBe(c(100));
    expect(r.competences[1].priorCreditAppliedCents).toBe(c(100));
    expect(r.competences[1].economicOpenBalanceCents).toBe(c(700));
    expect(r.suspenseBalanceCents).toBe(0);
    ambosOsLivrosFecham(r);
  });

  /**
   * O caminho de saída para o usuário, medido: a mesma série, com e sem a
   * classificação. Classificar move R$ 100 do livro 2 para o livro 1 e a fatura
   * cai exatamente esses R$ 100 — nem um centavo é criado no caminho.
   */
  it('classificar o excedente é o que o move de um livro para o outro', () => {
    const inerte = computeTwoLedgerBalances([excedenteSemProva(), semPagamentoDepois]);
    const classificado = computeTwoLedgerBalances([
      {
        ...excedenteSemProva(),
        resolutions: [{ kind: 'economic_credit', resolvedAmountCents: c(100) }],
      },
      semPagamentoDepois,
    ]);

    expect(
      inerte.competences[1].economicOpenBalanceCents -
        classificado.competences[1].economicOpenBalanceCents
    ).toBe(inerte.suspenseBalanceCents);
  });
});

describe('bank_adjustment segue sendo não econômico', () => {
  /**
   * Declarar a diferença como ajuste do banco a encerra no livro 2. Ela não vira
   * crédito, não volta e não compensa nada — antes ou depois da fronteira.
   */
  const r = computeTwoLedgerBalances([
    {
      ...excedenteSemProva(),
      resolutions: [{ kind: 'bank_adjustment', resolvedAmountCents: c(100) }],
    },
    { referenceMonth: '2026-02', computedLinesTotalCents: c(800), observedPaymentCents: c(750) },
  ]);

  it('o valor encerrado não explica déficit posterior nenhum', () => {
    expect(r.resolvedNonEconomicCents).toBe(c(100));
    expect(r.competences[1].suspenseOutCents).toBe(0);
    expect(r.competences[1].economicOpenBalanceCents).toBe(c(50));
    expect(r.economicCarryCents).toBe(0);
    expect(r.suspenseBalanceCents).toBe(0);
  });

  it('as duas conservações continuam fechando', () => ambosOsLivrosFecham(r));
});
