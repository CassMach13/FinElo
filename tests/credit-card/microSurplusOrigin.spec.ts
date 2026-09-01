import { describe, expect, it } from 'vitest';
import {
  applySequentialCreditCarryForward,
  MICRO_SURPLUS_CARRY_MAX,
  creditCardRebuildFromImportHistoryService,
} from '../../src/services/creditCardRebuildFromImportHistoryService';
import type { CompetenceHistoryCard } from '../../src/services/creditCardRebuildFromImportHistoryService';
import { parseDueFromReferenceMonth } from '../../src/services/creditCardManualCompetence';
import type { Account, Transaction } from '../../src/types';

/**
 * INVESTIGAÇÃO — de onde vêm os R$ 0,22 exibidos como «FATURA EM ABERTO · VENCIDA»
 * na conta de produção, quando a evidência do banco emissor diz que tudo está pago.
 *
 * Pista de produção:
 *   Fatura_Cartao_XP_Ione_Jan_2025.csv  ->  statement_total_from_file = 216.25
 *   Fatura_Cartao_XP_Ione_Fev_2025.csv  ->  «Pagamento de fatura»     = 216.47
 *   216.47 − 216.25 = +0.22  (pagamento A MAIOR, não dívida)
 */

const round2 = (v: number) => Math.round(v * 100) / 100;

const conta = (): Account =>
  ({
    id: 'acc-xp',
    user_id: 'u1',
    Nome_Conta: 'Cartão XP',
    Tipo_Conta: 'Cartão de Crédito',
    Saldo_Inicial: 0,
    Data_Saldo_Inicial: new Date('2024-12-01'),
    limite_credito: 36787.16,
    dia_vencimento: 10,
  }) as Account;

let seq = 0;
const compra = (data: string, valor: number, origem: string): Transaction => {
  seq += 1;
  return {
    ID_Transacao: `c-${seq}`,
    ID_Conta: 'acc-xp',
    Origem: origem,
    Data: data,
    Valor: -Math.abs(valor),
    Tipo: 'Despesa',
    Descricao_Original: `Compra ${seq}`,
    Nome_Fantasia: `Loja ${seq}`,
  } as unknown as Transaction;
};

/** «Pagamentos Validos» como aparece no CSV da XP: Renda positiva dentro do arquivo. */
const pagamentoNoExtrato = (data: string, valor: number, origem: string): Transaction => {
  seq += 1;
  return {
    ID_Transacao: `p-${seq}`,
    ID_Conta: 'acc-xp',
    Origem: origem,
    Data: data,
    Valor: Math.abs(valor),
    Tipo: 'Renda',
    Descricao_Original: 'Pagamentos Validos Normais',
    Nome_Fantasia: 'Pagamento de Fatura',
    Categoria: 'Pagamento Cartão de Crédito',
  } as unknown as Transaction;
};

const log = (arquivo: string, ref: string, venc: string) =>
  ({
    id: `log-${arquivo}`,
    file_name: arquivo,
    imported_details: [{ ID_Conta: 'acc-xp', Card_Reference_Label: ref, Card_Due_Date: venc }],
  }) as any;

const competencia = (ref: string, total: number, pago: number): CompetenceHistoryCard => ({
  referenceMonth: ref,
  competenceBR: ref,
  dueDate: parseDueFromReferenceMonth(ref, 10),
  vencimentoBR: '',
  dueYear: Number(ref.slice(0, 4)),
  dueMonth: Number(ref.slice(5, 7)),
  files: [{ fileName: `f_${ref}.csv`, transactionCount: 1, statementTotal: total, totalPayments: pago }],
  totalDebits: total,
  totalRefunds: 0,
  statementTotal: total,
  totalPayments: pago,
  openBalanceBeforeCarry: 0,
  priorCreditApplied: 0,
  openBalance: 0,
  creditCarriedForward: 0,
});

const JAN = 'Fatura_Cartao_XP_Ione_Jan_2025.csv';
const FEV = 'Fatura_Cartao_XP_Ione_Fev_2025.csv';

function ledger(transactions: Transaction[], importLogs: any[]) {
  const account = conta();
  return creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
    accountId: account.id,
    account,
    accounts: [account],
    transactions,
    importLogs,
  });
}

describe('o par Jan/Fev de produção, reproduzido no pipeline real', () => {
  /** Jan fatura 216,25; o pagamento de 216,47 vem no arquivo de Fev e quita Jan. */
  const cenario = () => ({
    txs: [
      compra('2025-01-08', 216.25, JAN),
      compra('2025-02-06', 300, FEV),
      pagamentoNoExtrato('2025-02-05', 216.47, FEV),
    ],
    logs: [log(JAN, '2025-01', '2025-02-10'), log(FEV, '2025-02', '2025-03-10')],
  });

  it('o pagamento do arquivo de Fev é aplicado à competência de Jan', () => {
    const { txs, logs } = cenario();
    const cards = ledger(txs, logs);
    const jan = cards.find((c) => c.referenceMonth === '2025-01');

    expect(jan?.statementTotal).toBe(216.25);
    expect(jan?.totalPayments).toBe(216.47);
  });

  it('Jan fica com excedente de 0,22 — e portanto sem dívida', () => {
    const { txs, logs } = cenario();
    const jan = ledger(txs, logs).find((c) => c.referenceMonth === '2025-01')!;

    expect(round2(jan.totalPayments - jan.statementTotal)).toBe(0.22);
    expect(jan.openBalance).toBe(0);
  });

  it('nenhuma competência do par termina com saldo de 0,22 em aberto', () => {
    const { txs, logs } = cenario();
    const cards = ledger(txs, logs);
    const comVinteEDois = cards.filter((c) => Math.abs(c.openBalance - 0.22) < 0.001);

    expect(comVinteEDois.map((c) => c.referenceMonth)).toEqual([]);
  });
});

describe('a assimetria entre excedente e déficit', () => {
  it('excedente de 0,22 é descartado como ruído de arredondamento', () => {
    const cards = [competencia('2025-01', 216.25, 216.47), competencia('2025-02', 300, 0)];
    applySequentialCreditCarryForward(cards);

    expect(MICRO_SURPLUS_CARRY_MAX).toBe(1);
    expect(cards[0].openBalance).toBe(0);
    // 0,22 < 1: não vira crédito para fevereiro.
    expect(cards[0].creditCarriedForward).toBe(0);
    expect(cards[1].priorCreditApplied).toBe(0);
  });

  /**
   * Aqui está a assimetria: o excedente abaixo de R$ 1 é tratado como ruído, mas o
   * déficit abaixo de R$ 1 é tratado como dívida real. O mesmo arredondamento entre
   * extrato e pagamento produz resultados de naturezas opostas conforme o sinal.
   */
  it('déficit de 0,22 NÃO é descartado — vira dívida e fica vencido', () => {
    const cards = [competencia('2025-01', 216.47, 216.25), competencia('2025-02', 300, 300)];
    applySequentialCreditCarryForward(cards);

    expect(cards[0].openBalance).toBe(0.22);
    expect(cards[0].openBalanceBeforeCarry).toBe(0.22);
  });

  it('o mesmo ruído, invertido o sinal, dá resultados de naturezas opostas', () => {
    const comExcedente = [competencia('2025-01', 216.25, 216.47), competencia('2025-02', 300, 300)];
    const comDeficit = [competencia('2025-01', 216.47, 216.25), competencia('2025-02', 300, 300)];
    applySequentialCreditCarryForward(comExcedente);
    applySequentialCreditCarryForward(comDeficit);

    const abertoExcedente = round2(comExcedente.reduce((a, c) => a + Math.max(c.openBalance, 0), 0));
    const abertoDeficit = round2(comDeficit.reduce((a, c) => a + Math.max(c.openBalance, 0), 0));

    expect(abertoExcedente).toBe(0);
    expect(abertoDeficit).toBe(0.22);
  });
});

describe('onde um saldo de 0,22 PODE nascer', () => {
  it('quando o pagamento fica 0,22 abaixo do total da competência', () => {
    const txs = [
      compra('2025-01-08', 216.47, JAN),
      compra('2025-02-06', 300, FEV),
      pagamentoNoExtrato('2025-02-05', 216.25, FEV),
    ];
    const logs = [log(JAN, '2025-01', '2025-02-10'), log(FEV, '2025-02', '2025-03-10')];

    const jan = ledger(txs, logs).find((c) => c.referenceMonth === '2025-01')!;
    expect(jan.openBalance).toBe(0.22);
  });

  it('quando um excedente anterior menor que R$ 1 deixa de abater o mês seguinte', () => {
    // Jan paga 0,22 a mais; Fev fica devendo exatamente 0,22. Com o crédito aplicado,
    // Fev fecharia em zero — mas o crédito foi descartado pelo piso.
    const cards = [
      competencia('2025-01', 216.25, 216.47),
      competencia('2025-02', 300.22, 300),
    ];
    applySequentialCreditCarryForward(cards);

    expect(cards[1].priorCreditApplied).toBe(0);
    expect(cards[1].openBalance).toBe(0.22);
  });
});

describe('múltiplos portadores no mesmo cartão', () => {
  const IONE_JAN = 'Fatura_Cartao_XP_Ione_Jan_2025.csv';
  const CASSIO_JAN = 'Fatura_Cartao_XP_Cassio_Jan_2025.csv';
  const IONE_FEV = 'Fatura_Cartao_XP_Ione_Fev_2025.csv';
  const CASSIO_FEV = 'Fatura_Cartao_XP_Cassio_Fev_2025.csv';

  /**
   * Dois arquivos de portadores diferentes caem na MESMA competência e são somados.
   * O pagamento de cada arquivo abate a competência anterior.
   */
  it('totais e pagamentos dos dois portadores somam na mesma competência', () => {
    const txs = [
      compra('2025-01-08', 216.25, IONE_JAN),
      compra('2025-01-09', 1000, CASSIO_JAN),
      compra('2025-02-06', 300, IONE_FEV),
      pagamentoNoExtrato('2025-02-05', 216.47, IONE_FEV),
      pagamentoNoExtrato('2025-02-05', 1000, CASSIO_FEV),
    ];
    const logs = [
      log(IONE_JAN, '2025-01', '2025-02-10'),
      log(CASSIO_JAN, '2025-01', '2025-02-10'),
      log(IONE_FEV, '2025-02', '2025-03-10'),
      log(CASSIO_FEV, '2025-02', '2025-03-10'),
    ];

    const jan = ledger(txs, logs).find((c) => c.referenceMonth === '2025-01')!;

    // 216,25 + 1.000 = 1.216,25 faturados; 216,47 + 1.000 = 1.216,47 pagos.
    expect(jan.statementTotal).toBe(1216.25);
    expect(jan.totalPayments).toBe(1216.47);
    expect(jan.openBalance).toBe(0);
  });

  it('a soma entre portadores pode esconder que um pagou a mais e outro a menos', () => {
    // Ione paga 0,22 a mais; Cássio paga 0,22 a menos. A competência fecha em zero,
    // mas nenhum dos dois está exatamente quitado individualmente.
    const txs = [
      compra('2025-01-08', 216.25, IONE_JAN),
      compra('2025-01-09', 1000, CASSIO_JAN),
      pagamentoNoExtrato('2025-02-05', 216.47, IONE_FEV),
      pagamentoNoExtrato('2025-02-05', 999.78, CASSIO_FEV),
    ];
    const logs = [
      log(IONE_JAN, '2025-01', '2025-02-10'),
      log(CASSIO_JAN, '2025-01', '2025-02-10'),
      log(IONE_FEV, '2025-02', '2025-03-10'),
      log(CASSIO_FEV, '2025-02', '2025-03-10'),
    ];

    const jan = ledger(txs, logs).find((c) => c.referenceMonth === '2025-01')!;
    expect(jan.statementTotal).toBe(1216.25);
    expect(jan.totalPayments).toBe(1216.25);
    expect(jan.openBalance).toBe(0);
  });
});
