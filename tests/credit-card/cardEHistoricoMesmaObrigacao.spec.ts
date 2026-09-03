import { describe, expect, it } from 'vitest';
import { creditCardRebuildFromImportHistoryService } from '../../src/services/creditCardRebuildFromImportHistoryService';
import { computeAccountCardDisplay } from '../../src/components/transactions/accountBalanceCardMetrics';
import { withCanonicalEconomicBalances } from '../../src/components/transactions/competenceHistoryEconomicSource';
import { projectCardTwoLedger } from '../../src/domain/credit-card/twoLedgerProjection';
import type { Account, Transaction } from '../../src/types';

/**
 * Card e Histórico exibem a MESMA obrigação econômica.
 *
 * ===========================================================================
 * O QUE ESTAVA QUEBRADO
 * ===========================================================================
 *
 * Havia dois cálculos decidindo «saldo em aberto». O card projeta pelos dois
 * livros; o histórico exibia o `openBalance` de `applySequentialCreditCarryForward`,
 * um carry legado que empurra excedente para os meses seguintes sem perguntar
 * procedência nem liquidação.
 *
 * Enquanto os dois abatiam, coincidiam por acaso. Quando a fronteira dos livros
 * passou a exigir liquidação observada, o card disse R$ 400,00 e o histórico
 * continuou dizendo R$ 200,00 sobre a MESMA fatura — visto na conta real de
 * staging, competência 2026-07.
 *
 * Agora o histórico consome a projeção canônica. Não há segundo cálculo.
 */

const LIMITE = 10000;
const HOJE = '2026-09-03';
const ACC = 'acc-hist';

const conta = (): Account =>
  ({
    id: ACC,
    user_id: 'u1',
    Nome_Conta: 'Cartão Manual',
    Tipo_Conta: 'Cartão de Crédito',
    Saldo_Inicial: 0,
    Data_Saldo_Inicial: new Date('2026-01-01'),
    limite_credito: LIMITE,
    dia_fechamento: 20,
    dia_vencimento: 28,
  }) as Account;

let seq = 0;
const lancamento = (
  data: string,
  valor: number,
  tipo: string,
  categoria: string,
  descricao: string
): Transaction => {
  seq += 1;
  return {
    ID_Transacao: `t-${seq}`,
    ID_Conta: ACC,
    Origem: 'manual',
    Data: data,
    Valor: valor,
    Tipo: tipo,
    Descricao_Original: descricao,
    Nome_Fantasia: descricao,
    Categoria: categoria,
  } as unknown as Transaction;
};

const compra = (data: string, valor: number) =>
  lancamento(data, -Math.abs(valor), 'Despesa', 'Compras', 'Compra');
const pagamento = (data: string, valor: number) =>
  lancamento(data, Math.abs(valor), 'Renda', 'Pagamento Cartão de Crédito', 'Pagamento de fatura');
const estorno = (data: string, valor: number) =>
  lancamento(data, Math.abs(valor), 'Renda', 'Estorno', 'Estorno');

/** A série real da conta STG-CLAUDE Cartao Manual, em staging. */
const SERIE = (): Transaction[] => [
  // Junho: fatura 300, pago 500 -> excedente de 200 SEM procedência.
  compra('2026-06-05', 300),
  pagamento('2026-06-25', 500),
  // Julho: fatura 400, NENHUM pagamento.
  compra('2026-07-05', 400),
  // Agosto: fatura 350 (250 + 150 − 50 de estorno), pago 200.
  compra('2026-08-03', 250),
  compra('2026-08-12', 150),
  estorno('2026-08-18', 50),
  pagamento('2026-08-26', 200),
];

const historico = (txs: Transaction[]) => {
  const account = conta();
  const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
    accountId: ACC,
    account,
    accounts: [account],
    transactions: txs,
    importLogs: [],
  });
  return withCanonicalEconomicBalances(cards, { asOf: HOJE });
};

const card = (txs: Transaction[]) =>
  computeAccountCardDisplay(conta(), {
    transactions: txs,
    accounts: [conta()],
    importLogs: [],
    cardV2Enabled: true,
    cardEngineEnabled: true,
    cardSnapshotPipelineEnabled: false,
    reconciliationSurfaceEnabled: true,
  } as never);

describe('o cenário real de staging', () => {
  const cards = historico(SERIE());
  const porMes = new Map(cards.map((c) => [c.referenceMonth, c]));
  const d = card(SERIE());

  it('julho: sem liquidação observada, o histórico mostra a fatura inteira', () => {
    const julho = porMes.get('2026-07')!;

    expect(julho.totalPayments).toBe(0);
    expect(julho.statementTotal).toBe(400);
    expect(julho.openBalance).toBe(400);
    // Nenhum abatimento aconteceu — o painel não pode anunciar um.
    expect(julho.priorCreditApplied).toBe(0);
    expect(julho.openBalanceBeforeCarry).toBe(400);
  });

  it('julho: o card diz o mesmo número', () => {
    expect(d.faturaAtual).toBe(400);
    expect(porMes.get('2026-07')!.openBalance).toBe(d.faturaAtual);
  });

  it('agosto: com liquidação observada, o suspense explica e nada fica em aberto', () => {
    const agosto = porMes.get('2026-08')!;

    expect(agosto.statementTotal).toBe(350);
    expect(agosto.totalPayments).toBe(200);
    expect(agosto.openBalance).toBe(0);
  });

  it('o limite acompanha só a dívida econômica', () => {
    expect(LIMITE - d.limiteDisponivel).toBe(400);
  });

  it('o excedente continua no livro 2, sem virar crédito', () => {
    const p = projectCardTwoLedger(
      creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
        accountId: ACC,
        account: conta(),
        accounts: [conta()],
        transactions: SERIE(),
        importLogs: [],
      }),
      { asOf: HOJE }
    );

    const delta = new Map(
      p.competences.map((c) => [c.referenceMonth, c.unresolvedReconciliationDeltaCents])
    );

    // Junho põe 200 no livro 2. Julho, sem pagamento, NÃO consome nada — é a
    // fronteira: até aqui o saldo do livro 2 ainda é 200.
    expect(delta.get('2026-06')).toBe(20000);
    expect(delta.get('2026-07')).toBe(0);

    // Agosto tem liquidação observada, então explica os 150 que faltavam. Sobra
    // o resíduo de 50 — o mesmo que a conta de staging oferece em «A CONCILIAR».
    expect(delta.get('2026-08')).toBe(-15000);
    expect(p.suspenseBalanceCents).toBe(5000);

    expect(p.economicCarryCents).toBe(0);
    // Nenhuma competência recebeu crédito econômico: não havia crédito provado.
    expect(cards.every((c) => c.priorCreditApplied === 0)).toBe(true);
  });
});

describe('card e histórico nunca discordam', () => {
  /**
   * A garantia estrutural, não um caso: para QUALQUER série, o saldo que o
   * histórico exibe é o mesmo que a projeção entrega ao card. Se alguém
   * reintroduzir um segundo cálculo, um destes cenários quebra.
   */
  const CENARIOS: Array<{ nome: string; txs: Transaction[] }> = [
    { nome: 'a série de staging', txs: SERIE() },
    { nome: 'fatura simples sem pagamento', txs: [compra('2026-07-05', 400)] },
    {
      nome: 'pagamento parcial',
      txs: [compra('2026-07-05', 400), pagamento('2026-07-20', 150)],
    },
    {
      nome: 'fatura quitada',
      txs: [compra('2026-07-05', 400), pagamento('2026-07-25', 400)],
    },
    {
      nome: 'sobrepagamento seguido de mês pago em parte',
      txs: [
        compra('2026-06-05', 300),
        pagamento('2026-06-25', 500),
        compra('2026-07-05', 400),
        pagamento('2026-07-26', 100),
      ],
    },
    {
      nome: 'várias competências em aberto',
      txs: [compra('2026-05-05', 100), compra('2026-06-05', 200), compra('2026-07-05', 300)],
    },
    { nome: 'estorno maior que as compras', txs: [compra('2026-07-05', 100), estorno('2026-07-18', 250)] },
  ];

  CENARIOS.forEach(({ nome, txs }) => {
    it(`${nome}: cada competência tem o mesmo saldo nas duas superfícies`, () => {
      const cards = historico(txs);
      const p = projectCardTwoLedger(
        creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
          accountId: ACC,
          account: conta(),
          accounts: [conta()],
          transactions: txs,
          importLogs: [],
        }),
        { asOf: HOJE }
      );
      const projetado = new Map(
        p.competences.map((c) => [c.referenceMonth, c.economicOpenBalanceCents / 100])
      );

      for (const c of cards) {
        expect(c.openBalance).toBe(projetado.get(c.referenceMonth));
      }
    });

    it(`${nome}: o card destaca o mesmo valor que o histórico daquela competência`, () => {
      const d = card(txs);
      const cards = historico(txs);
      const emAberto = cards.filter((c) => c.openBalance > 0.005);
      if (emAberto.length === 0) {
        expect(d.faturaAtual).toBe(0);
        return;
      }
      expect(emAberto.map((c) => c.openBalance)).toContain(d.faturaAtual);
    });

    it(`${nome}: o TOTAL da fatura continua sendo o statement, intocado`, () => {
      const cru = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
        accountId: ACC,
        account: conta(),
        accounts: [conta()],
        transactions: txs,
        importLogs: [],
      });
      const depois = withCanonicalEconomicBalances(cru, { asOf: HOJE });

      expect(depois.map((c) => c.statementTotal)).toEqual(cru.map((c) => c.statementTotal));
      expect(depois.map((c) => c.totalPayments)).toEqual(cru.map((c) => c.totalPayments));
    });
  });
});

describe('a superfície não recalcula nada', () => {
  /**
   * `withCanonicalEconomicBalances` não pode ter aritmética própria: ela existe
   * para APONTAR para a projeção. Se um dia alguém puser uma regra aqui, os
   * quatro campos deixam de ser exatamente o que a projeção disse.
   */
  it('os quatro campos econômicos vêm literalmente da projeção', () => {
    const cru = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: ACC,
      account: conta(),
      accounts: [conta()],
      transactions: SERIE(),
      importLogs: [],
    });
    const p = projectCardTwoLedger(cru, { asOf: HOJE });
    const depois = withCanonicalEconomicBalances(cru, { asOf: HOJE });
    const porMes = new Map(p.competences.map((c) => [c.referenceMonth, c]));

    for (const c of depois) {
      const e = porMes.get(c.referenceMonth)!;
      expect(c.openBalance).toBe(e.economicOpenBalanceCents / 100);
      expect(c.priorCreditApplied).toBe(e.priorCreditAppliedCents / 100);
      expect(c.creditCarriedForward).toBe(e.economicCarryAfterCents / 100);
      expect(c.openBalanceBeforeCarry).toBe(
        Math.max(0, e.statementTotalCents - e.recognizedPaymentsCents) / 100
      );
    }
  });

  it('uma competência que a projeção não conhece passa intacta', () => {
    const cru = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: ACC,
      account: conta(),
      accounts: [conta()],
      transactions: SERIE(),
      importLogs: [],
    });
    expect(withCanonicalEconomicBalances([], { asOf: HOJE })).toEqual([]);
    expect(withCanonicalEconomicBalances(cru, { asOf: HOJE })).toHaveLength(cru.length);
  });
});
