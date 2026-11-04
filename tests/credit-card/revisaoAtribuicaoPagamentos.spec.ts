import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/creditCardEngineService', () => ({
  creditCardEngineService: {
    ensureCreditCardForAccount: vi.fn(async () => ({ id: 'card-motor' })),
    buildImportRowsFromTransactionsPreservingIndices: vi.fn(async () => []),
    normalizeAndPersistImportLot: vi.fn(async () => undefined),
    recalculateAllStatementsForCard: vi.fn(async () => undefined),
  },
}));

import {
  buildImportHistoryPreview,
  creditCardRebuildFromImportHistoryService as svc,
  importedPaymentAllocationsByTransaction,
  lateImportedPaymentPriorCapacity,
} from '../../src/services/creditCardRebuildFromImportHistoryService';
import { creditCardRebuildPersistService } from '../../src/services/creditCardRebuildPersistService';
import { projectCardAccountFromRows } from '../../src/services/cardServerProjection';
import { projectAccountCardEconomics } from '../../src/services/accountCardEconomics';
import { groupActiveCardResolutions } from '../../src/services/cardReconciliationService';
import { computeAccountCardDisplay } from '../../src/components/transactions/accountBalanceCardMetrics';
import { withCanonicalEconomicBalances } from '../../src/components/transactions/competenceHistoryEconomicSource';
import {
  competenciasComDiferencaAcionavel,
  projectCardTwoLedger,
} from '../../src/domain/credit-card/twoLedgerProjection';
import { diagnoseCreditCard } from '../../src/domain/credit-card/cardDiagnostics';
import {
  computeTwoLedgerBalances,
  suspenseConservation,
  twoLedgerConservation,
  type ReconciliationResolutionInput,
} from '../../src/domain/credit-card/twoLedgerBalance';
import {
  activeResolutionsByMonth,
  paymentConfirmationInputsFromRows,
  rowAmountToCents,
  type ResolutionRow,
} from '../../src/domain/credit-card/reconciliationRows';
import type { Account, Transaction } from '../../src/types';

/**
 * Segunda revisão da atribuição de pagamentos do cartão.
 *
 *  1. Rotas: card, histórico, patrimônio, Edge function e persistência de
 *     faturas calculam com o mesmo preview e a mesma conversão de linhas.
 *  2. Crédito anterior: pagamento atrasado não completa fatura já compensada.
 *  3. Prazo: «em dia» é o vencimento efetivo; não há folga por data.
 *  4. Resolução órfã: fica identificada e sem efeito. Valor igual não prova
 *     que é a mesma diferença, então nada é aplicado em outra competência.
 *  2b. Pagamento antecipado: destino explícito prevalece sobre a data; sem
 *     evidência, o excedente fica rastreável no livro 2, sem competência inventada.
 */

const HOJE = '2026-11-02';
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${HOJE}T15:00:00Z`));
});
afterAll(() => {
  vi.useRealTimers();
});

const ACC = 'card-rev';
const conta: Account = {
  id: ACC,
  user_id: 'u1',
  Nome_Conta: 'Cartão Revisão',
  Tipo_Conta: 'Cartão de Crédito',
  Saldo_Inicial: 0,
  limite_credito: 20000,
  dia_fechamento: 1,
  dia_vencimento: 10,
} as unknown as Account;

let seq = 0;
const compra = (file: string, data: string, valor: number): Transaction =>
  ({
    ID_Transacao: `c${++seq}`, ID_Conta: ACC, Origem: file, Data: data, Valor: -Math.abs(valor),
    Tipo: 'Despesa', Categoria: 'Compras', Descricao_Original: `Compra ${seq}`, Nome_Fantasia: `Compra ${seq}`,
  }) as unknown as Transaction;
const estorno = (file: string, data: string, valor: number): Transaction =>
  ({
    ID_Transacao: `e${++seq}`, ID_Conta: ACC, Origem: file, Data: data, Valor: Math.abs(valor),
    Tipo: 'Renda', Categoria: 'Estornos', Descricao_Original: `Estorno loja ${seq}`, Nome_Fantasia: 'Estorno',
  }) as unknown as Transaction;
const pagamento = (file: string, data: string, valor: number, id: string): Transaction =>
  ({
    ID_Transacao: id, ID_Conta: ACC, Origem: file, Data: data, Valor: Math.abs(valor),
    Tipo: 'Renda', Categoria: 'Pagamento', Descricao_Original: 'Pagamentos Validos Normais',
    Nome_Fantasia: 'Pagamentos Validos Normais',
  }) as unknown as Transaction;
const log = (file: string, ref: string, due: string) =>
  ({ id: `log-${file}`, file_name: file, imported_details: [{ ID_Conta: ACC, Card_Reference_Label: ref, Card_Due_Date: due }] }) as any;

const cardsDe = (transactions: Transaction[], importLogs: any[], confirmations: any[] = []) =>
  svc.competenceHistoryCardsForAccount({
    accountId: ACC, account: conta, accounts: [conta], transactions, importLogs, userPaymentConfirmations: confirmations,
  });
const destino = (cards: ReturnType<typeof cardsDe>, id: string) =>
  (importedPaymentAllocationsByTransaction(cards).get(id) ?? []).map((a) => [a.referenceMonth, Math.round(a.amount * 100)]);

/**
 * Titular e adicional na mesma conta, como no cartão XP real (dados sintéticos).
 * Em 2025-01 a adicional tem estorno maior que a cobrança: crédito de 0,94, que
 * o emissor usa na fatura seguinte — ela paga 60,30 por 61,24. Em 2025-03 ela
 * paga 61,24 por 61,24, lançado em 02/04, depois do vencimento de 2025-02.
 */
function cadeiaComCreditoDaAdicional() {
  const t1 = 'T_fev.csv', a1 = 'A_fev.csv';
  const t2 = 'T_mar.csv', a2 = 'A_mar.csv';
  const t3 = 'T_abr.csv', a3 = 'A_abr.csv';
  const t4 = 'T_mai.csv';
  const tx = [
    compra(t1, '2025-01-15', 1000),
    compra(a1, '2025-01-15', 61.24), estorno(a1, '2025-01-20', 62.18),
    compra(t2, '2025-02-15', 800), pagamento(t2, '2025-02-10', 1000, 'pT1'),
    compra(a2, '2025-02-15', 61.24),
    compra(t3, '2025-03-15', 700), pagamento(t3, '2025-03-10', 800, 'pT2'),
    compra(a3, '2025-03-15', 61.24), pagamento(a3, '2025-03-02', 60.3, 'pA2'), pagamento(a3, '2025-04-02', 61.24, 'pA3'),
    compra(t4, '2025-04-15', 500), pagamento(t4, '2025-04-10', 700, 'pT3'),
  ];
  const logs = [
    log(t1, '2025-01', '2025-02-10'), log(a1, '2025-01', '2025-02-10'),
    log(t2, '2025-02', '2025-03-10'), log(a2, '2025-02', '2025-03-10'),
    log(t3, '2025-03', '2025-04-10'), log(a3, '2025-03', '2025-04-10'),
    log(t4, '2025-04', '2025-05-10'),
  ];
  return { tx, logs };
}

// ===========================================================================
// 2. Pagamento atrasado e crédito de faturas anteriores
// ===========================================================================

describe('pagamento atrasado não completa fatura já compensada', () => {
  it('crédito da adicional cobre a fatura seguinte; o pagamento posterior vai inteiro para a própria fatura', () => {
    const { tx, logs } = cadeiaComCreditoDaAdicional();
    const cards = cardsDe(tx, logs);
    expect(destino(cards, 'pA3')).toEqual([['2025-03', 6124]]);
    expect(destino(cards, 'pA2')).toEqual([['2025-02', 6030]]);

    const p = projectCardTwoLedger(cards, { asOf: '2025-05-01' });
    const m = (ref: string) => p.competences.find((c) => c.referenceMonth === ref)!;
    // 2025-01 recebeu 0,94 a mais; 2025-02 usa exatamente esse 0,94; 2025-03 fecha sozinha.
    expect(m('2025-01').unresolvedReconciliationDeltaCents).toBe(94);
    expect(m('2025-02').unresolvedReconciliationDeltaCents).toBe(-94);
    expect(m('2025-03').recognizedPaymentsCents).toBe(m('2025-03').statementTotalCents);
    expect(m('2025-03').reconciliationStatus).toBe('reconciled');
    expect(p.suspenseBalanceCents).toBe(0);
    expect(p.reconciliationPending).toBe(false);
    expect(m('2025-04').economicOpenBalanceCents).toBe(50000);
  });

  it('capacidade = menor entre o saldo da própria fatura e a dívida acumulada até ela', () => {
    const c = (referenceMonth: string, statementTotal: number, totalPayments: number) =>
      ({ referenceMonth, statementTotal, totalPayments });
    expect(lateImportedPaymentPriorCapacity([c('2025-01', 100, 100), c('2025-02', 50, 0)], '2025-02')).toBe(50);
    expect(lateImportedPaymentPriorCapacity([c('2025-01', 100, 130), c('2025-02', 50, 0)], '2025-02')).toBe(20);
    expect(lateImportedPaymentPriorCapacity([c('2025-01', 100, 160), c('2025-02', 50, 0)], '2025-02')).toBe(0);
    // Dívida mais antiga não aumenta o que o pagamento leva para N−1.
    expect(lateImportedPaymentPriorCapacity([c('2025-01', 100, 0), c('2025-02', 50, 0)], '2025-02')).toBe(50);
    // Pagamento de fatura não importada (fantasma, total 0) não vira crédito.
    expect(lateImportedPaymentPriorCapacity([c('2024-12', 0, 900), c('2025-01', 100, 0)], '2025-01')).toBe(100);
    expect(lateImportedPaymentPriorCapacity([c('2025-01', 100, 0)], '2025-02')).toBe(0);
  });

  /**
   * O cenário pedido pela revisão: a fatura anterior foi compensada por crédito
   * LEGÍTIMO (resolução econômica sobre um excedente provado). Comparar só o
   * saldo final esconderia o erro — com a regra antiga o total também zerava,
   * mas o pagamento de março aparecia como «pago com crédito» e o crédito de
   * janeiro como «pagamento» de fevereiro.
   */
  it('com crédito econômico transportado, cada pagamento fica onde foi feito e o crédito onde foi aplicado', () => {
    const f1 = 'X_fev.csv', f2 = 'X_mar.csv', f3 = 'X_abr.csv';
    const tx = [
      compra(f1, '2025-01-15', 500),
      compra(f2, '2025-02-15', 1000), pagamento(f2, '2025-02-10', 1500, 'adiantado'),
      compra(f3, '2025-03-15', 800), pagamento(f3, '2025-03-20', 800, 'marco'),
    ];
    const logs = [log(f1, '2025-01', '2025-02-10'), log(f2, '2025-02', '2025-03-10'), log(f3, '2025-03', '2025-04-10')];
    const cards = cardsDe(tx, logs);
    expect(destino(cards, 'marco')).toEqual([['2025-03', 80000]]);

    const credito = { '2025-01': [{ kind: 'economic_credit', resolvedAmountCents: 100000 }] } as Record<string, ReconciliationResolutionInput[]>;
    const p = projectCardTwoLedger(cards, { asOf: '2025-04-30', resolutionsByMonth: credito });
    const m = (ref: string) => p.competences.find((c) => c.referenceMonth === ref)!;

    expect(m('2025-02').recognizedPaymentsCents).toBe(0);
    expect(m('2025-02').priorCreditAppliedCents).toBe(100000);
    expect(m('2025-02').economicOpenBalanceCents).toBe(0);
    expect(m('2025-03').recognizedPaymentsCents).toBe(80000);
    expect(m('2025-03').priorCreditAppliedCents).toBe(0);
    expect(m('2025-03').economicOpenBalanceCents).toBe(0);
    expect(p.economicCarryCents).toBe(0);
    expect(p.suspenseBalanceCents).toBe(0);

    const ledger = computeTwoLedgerBalances(
      cards.map((c) => ({
        referenceMonth: c.referenceMonth, dueDate: c.dueDate,
        computedLinesTotalCents: Math.round(c.statementTotal * 100),
        observedPaymentCents: Math.round(c.totalPayments * 100),
        resolutions: credito[c.referenceMonth],
      })),
      { asOf: '2025-04-30' }
    );
    expect(twoLedgerConservation(ledger).conservado).toBe(true);
    expect(suspenseConservation(ledger)).toBe(true);
  });

  /**
   * Sem decisão sobre o excedente, ele NÃO é crédito (livro 2). O pagamento de
   * março continua sendo de março; fevereiro fica em aberto pelo mesmo valor que
   * está a conciliar em janeiro — os dois livros contam a mesma história.
   */
  it('sem decisão sobre o excedente: o pagamento continua no lugar e a pendência explica a dívida', () => {
    const f1 = 'Y_fev.csv', f2 = 'Y_mar.csv', f3 = 'Y_abr.csv';
    const tx = [
      compra(f1, '2025-01-15', 500),
      compra(f2, '2025-02-15', 1000), pagamento(f2, '2025-02-10', 1500, 'adiantado'),
      compra(f3, '2025-03-15', 800), pagamento(f3, '2025-03-20', 800, 'marco'),
    ];
    const logs = [log(f1, '2025-01', '2025-02-10'), log(f2, '2025-02', '2025-03-10'), log(f3, '2025-03', '2025-04-10')];
    const cards = cardsDe(tx, logs);
    const p = projectCardTwoLedger(cards, { asOf: '2025-04-30' });
    const m = (ref: string) => p.competences.find((c) => c.referenceMonth === ref)!;

    expect(m('2025-03').recognizedPaymentsCents).toBe(80000);
    expect(m('2025-03').economicOpenBalanceCents).toBe(0);
    expect(m('2025-02').economicOpenBalanceCents).toBe(100000);
    expect(competenciasComDiferencaAcionavel(p.competences).get('2025-01')).toBe(100000);
  });

  it('conservação por pagamento: cada centavo de cada linha cai em exatamente uma competência', () => {
    const { tx, logs } = cadeiaComCreditoDaAdicional();
    const cards = cardsDe(tx, logs);
    const idx = importedPaymentAllocationsByTransaction(cards);
    tx.filter((t) => String(t.ID_Transacao).startsWith('p')).forEach((t) => {
      const soma = (idx.get(String(t.ID_Transacao)) ?? []).reduce((a, x) => a + Math.round(x.amount * 100), 0);
      expect(soma).toBe(Math.round(t.Valor * 100));
    });
  });
});

// ===========================================================================
// 3. Prazo do pagamento em dia
// ===========================================================================

describe('prazo do pagamento em dia: vencimento efetivo, sem folga por data', () => {
  /** Duas faturas: N−1 = 1.000, N = 500. Varia só a data e o valor do pagamento lançado no arquivo N. */
  const cenario = (dueN1: string, dueN: string, pagamentos: Array<[string, number, string]>) => {
    const f1 = 'D_n1.csv', f2 = 'D_n.csv';
    const tx = [compra(f1, '2026-01-05', 1000), compra(f2, '2026-02-05', 500), ...pagamentos.map(([d, v, id]) => pagamento(f2, d, v, id))];
    return cardsDe(tx, [log(f1, '2026-01', dueN1), log(f2, '2026-02', dueN)]);
  };

  it('vencimento em dia útil: lançado no dia é pagamento em dia, inclusive a sobra', () => {
    const cards = cenario('2026-02-10', '2026-03-10', [['2026-02-10', 1200, 'p']]); // terça
    expect(destino(cards, 'p')).toEqual([['2026-01', 120000]]);
  });

  it('vencimento no sábado: a segunda-feira é o dia do vencimento', () => {
    const cards = cenario('2026-01-10', '2026-02-10', [['2026-01-12', 1200, 'p']]); // sáb 10 → seg 12
    expect(destino(cards, 'p')).toEqual([['2026-01', 120000]]);
  });

  it('vencimento no domingo: a segunda-feira é o dia do vencimento', () => {
    const cards = cenario('2026-05-10', '2026-06-10', [['2026-05-11', 1200, 'p']]); // dom 10 → seg 11
    expect(destino(cards, 'p')).toEqual([['2026-01', 120000]]);
  });

  it('lançamento bancário no dia seguinte: quita a anterior inteira, a sobra relevante vai para a atual', () => {
    const cards = cenario('2026-02-10', '2026-03-10', [['2026-02-11', 1200, 'p']]);
    expect(destino(cards, 'p')).toEqual([['2026-01', 100000], ['2026-02', 20000]]);
  });

  it('lançamento bancário no dia seguinte com sobra de centavos: a sobra é diferença da anterior', () => {
    const cards = cenario('2026-02-10', '2026-03-10', [['2026-02-11', 1000.94, 'p']]);
    expect(destino(cards, 'p')).toEqual([['2026-01', 100094]]);
    const p = projectCardTwoLedger(cards, { asOf: '2026-03-01' });
    expect(p.competences.find((c) => c.referenceMonth === '2026-02')!.economicOpenBalanceCents).toBe(50000);
  });

  it('pagamento realmente atrasado e parcial: tudo para a anterior, que continua devendo', () => {
    const cards = cenario('2026-02-10', '2026-03-10', [['2026-02-25', 600, 'p']]);
    expect(destino(cards, 'p')).toEqual([['2026-01', 60000]]);
    const p = projectCardTwoLedger(cards, { asOf: '2026-03-01' });
    const jan = p.competences.find((c) => c.referenceMonth === '2026-01')!;
    expect(jan.economicOpenBalanceCents).toBe(40000);
    expect(jan.economicStatus).toBe('overdue');
  });

  it('parciais antes e depois do vencimento, em datas diferentes', () => {
    const cards = cenario('2026-02-10', '2026-03-10', [
      ['2026-02-05', 300, 'antes1'],
      ['2026-02-10', 400, 'no-dia'],
      ['2026-02-20', 450, 'depois1'],
      ['2026-03-01', 250, 'depois2'],
    ]);
    expect(destino(cards, 'antes1')).toEqual([['2026-01', 30000]]);
    expect(destino(cards, 'no-dia')).toEqual([['2026-01', 40000]]);
    expect(destino(cards, 'depois1')).toEqual([['2026-01', 30000], ['2026-02', 15000]]);
    expect(destino(cards, 'depois2')).toEqual([['2026-02', 25000]]);
    const p = projectCardTwoLedger(cards, { asOf: '2026-03-05' });
    expect(p.competences.find((c) => c.referenceMonth === '2026-01')!.economicOpenBalanceCents).toBe(0);
    expect(p.competences.find((c) => c.referenceMonth === '2026-02')!.economicOpenBalanceCents).toBe(10000);
    expect(p.suspenseBalanceCents).toBe(0);
  });
});

// ===========================================================================
// 4. Resolução órfã: identificada, nunca aplicada a outra diferença
// ===========================================================================

describe('resolução órfã fica identificada e sem efeito', () => {
  const ajuste = (over: Partial<ReconciliationResolutionInput> = {}): ReconciliationResolutionInput => ({
    kind: 'bank_adjustment', resolvedAmountCents: 94, recordedDeltaCents: 94, ...over,
  });
  const livros = (p: ReturnType<typeof projectCardTwoLedger>) => ({
    usado: p.economicUsedCents, carry: p.economicCarryCents, livro2: p.suspenseBalanceCents, pendente: p.reconciliationPending,
    comp: p.competences.map((c) => [c.referenceMonth, c.recognizedPaymentsCents, c.priorCreditAppliedCents,
      c.economicOpenBalanceCents, c.economicStatus, c.unresolvedReconciliationDeltaCents, c.reconciliationStatus]),
  });

  /**
   * O caso que a revisão pediu: a diferença que o usuário classificou sumiu da
   * própria competência, e existe OUTRA diferença, independente, de mesmo valor.
   * Valor igual não é evidência de continuidade — a decisão antiga não pode
   * encerrar uma diferença que o usuário nunca viu.
   */
  it('duas diferenças independentes de mesmo valor: a classificação antiga não encerra a outra', () => {
    const cards = [
      { referenceMonth: '2025-01', dueDate: '2025-02-10', statementTotal: 1000, totalPayments: 1000.94 },
      { referenceMonth: '2025-02', dueDate: '2025-03-10', statementTotal: 800, totalPayments: 800 },
      { referenceMonth: '2025-05', dueDate: '2025-06-10', statementTotal: 500, totalPayments: 500 },
    ];
    const porMes = { '2025-05': [ajuste()] };
    const congelado = JSON.stringify(porMes);
    const com = projectCardTwoLedger(cards, { asOf: HOJE, resolutionsByMonth: porMes });
    const sem = projectCardTwoLedger(cards, { asOf: HOJE });

    expect(livros(com)).toEqual(livros(sem));
    expect(com.reconciliationPending).toBe(true);
    expect(competenciasComDiferencaAcionavel(com.competences).get('2025-01')).toBe(94);
    expect(com.orphanResolutions).toEqual([{
      referenceMonth: '2025-05', kind: 'bank_adjustment', resolvedAmountCents: 94, recordedDeltaCents: 94,
      reason: 'sem_diferenca_na_competencia', diferencasAnteriores: [{ referenceMonth: '2025-01', amountCents: 94 }],
    }]);
    expect(JSON.stringify(porMes)).toBe(congelado);
  });

  it('resolução com diferença própria vale normalmente e não é órfã', () => {
    const cards = [
      { referenceMonth: '2025-01', dueDate: '2025-02-10', statementTotal: 1000, totalPayments: 1000 },
      { referenceMonth: '2025-05', dueDate: '2025-06-10', statementTotal: 500, totalPayments: 500.94 },
    ];
    const p = projectCardTwoLedger(cards, { asOf: HOJE, resolutionsByMonth: { '2025-05': [ajuste()] } });
    expect(p.orphanResolutions).toEqual([]);
    expect(p.reconciliationPending).toBe(false);
    expect(p.suspenseBalanceCents).toBe(0);
  });

  it('total oficial não é tratado como órfão', () => {
    const cards = [{ referenceMonth: '2025-01', dueDate: '2025-02-10', statementTotal: 1000, totalPayments: 1000 }];
    const p = projectCardTwoLedger(cards, {
      asOf: HOJE,
      resolutionsByMonth: { '2025-01': [{ kind: 'authoritative_total', authoritativeStatementTotalCents: 100000, authoritativeSource: 'statement_pdf' }] },
    });
    expect(p.orphanResolutions).toEqual([]);
  });

  /**
   * Propriedade: uma resolução sem diferença na própria competência não muda
   * NADA em nenhum dos dois livros, qualquer que seja o tipo, o valor ou o mês.
   */
  it('em séries variadas, a órfã nunca altera livro 1 nem livro 2', () => {
    let s = 23;
    const rnd = (n: number) => ((s = (s * 1103515245 + 12345) % 2147483648) % n);
    const tipos = ['bank_adjustment', 'reconciliation_write_off', 'economic_credit', 'economic_debt'] as const;
    let orfasVistas = 0;
    for (let caso = 0; caso < 300; caso++) {
      const n = 3 + rnd(5);
      const cards = Array.from({ length: n }, (_, i) => {
        const total = rnd(8) === 0 ? 0 : 50 + rnd(500);
        const pago = Math.max(0, total + (rnd(3) - 1) * rnd(120) + (rnd(4) === 0 ? rnd(100) / 100 : 0));
        return {
          referenceMonth: `2025-${String(i + 1).padStart(2, '0')}`, dueDate: `2025-${String(i + 2).padStart(2, '0')}-10`,
          statementTotal: total, totalPayments: rnd(5) === 0 ? 0 : pago,
        };
      });
      const sem = projectCardTwoLedger(cards, { asOf: '2026-01-01' });
      const semDiferenca = sem.competences.filter((c) => c.unresolvedReconciliationDeltaCents === 0);
      if (semDiferenca.length === 0) continue;
      const alvo = semDiferenca[rnd(semDiferenca.length)].referenceMonth;
      const v = 1 + rnd(30000);
      const com = projectCardTwoLedger(cards, {
        asOf: '2026-01-01',
        resolutionsByMonth: { [alvo]: [{ kind: tipos[rnd(4)], resolvedAmountCents: v, recordedDeltaCents: v }] },
      });
      orfasVistas += com.orphanResolutions.length;
      expect(livros(com)).toEqual(livros(sem));
    }
    expect(orfasVistas).toBeGreaterThan(100);
  });

  /**
   * O caso histórico da conta piloto, em forma sintética. A diferença de 0,94
   * classificada em 10/2025 era 0,22 de resíduo da cadeia + 0,72 de uma
   * confirmação manual que a atribuição corrigida tornou redundante. O
   * tratamento controlado usa só fluxos existentes, com trilha: o dono remove a
   * confirmação redundante, desfaz a classificação antiga com motivo e
   * classifica a diferença que existe hoje. O livro 1 não muda em nenhum passo.
   */
  it('tratamento controlado do caso histórico: fluxos existentes, livro 1 intacto', () => {
    const cards = (confirmacao: number) => [
      { referenceMonth: '2025-01', dueDate: '2025-02-10', statementTotal: 1000, totalPayments: 1000.22 },
      { referenceMonth: '2025-03', dueDate: '2025-04-10', statementTotal: 700, totalPayments: 700 + confirmacao },
      { referenceMonth: '2025-10', dueDate: '2025-11-10', statementTotal: 400, totalPayments: 400 },
    ];
    const hoje = projectCardTwoLedger(cards(0.72), { asOf: HOJE, resolutionsByMonth: { '2025-10': [ajuste()] } });
    expect(hoje.reconciliationPending).toBe(true);
    expect(hoje.suspenseBalanceCents).toBe(94);
    expect(hoje.orphanResolutions.map((o) => o.diferencasAnteriores)).toEqual([
      [{ referenceMonth: '2025-01', amountCents: 22 }, { referenceMonth: '2025-03', amountCents: 72 }],
    ]);

    // 1. confirmação redundante removida: a classificação antiga continua órfã
    const passo1 = projectCardTwoLedger(cards(0), { asOf: HOJE, resolutionsByMonth: { '2025-10': [ajuste()] } });
    expect(passo1.orphanResolutions).toHaveLength(1);
    expect(competenciasComDiferencaAcionavel(passo1.competences).get('2025-01')).toBe(22);
    // 2 e 3. classificação antiga desfeita; a diferença atual classificada onde está
    const fim = projectCardTwoLedger(cards(0), {
      asOf: HOJE, resolutionsByMonth: { '2025-01': [ajuste({ resolvedAmountCents: 22, recordedDeltaCents: 22 })] },
    });
    expect(fim.reconciliationPending).toBe(false);
    expect(fim.suspenseBalanceCents).toBe(0);
    expect(fim.orphanResolutions).toEqual([]);

    const livro1 = (p: typeof hoje) => [p.economicUsedCents, p.economicCarryCents,
      p.competences.map((c) => [c.economicOpenBalanceCents, c.priorCreditAppliedCents, c.economicStatus])];
    expect(livro1(passo1)).toEqual(livro1(hoje));
    expect(livro1(fim)).toEqual(livro1(hoje));
  });

  it('o card mostra a órfã como item a revisar, só com a conciliação ligada', () => {
    const p = projectCardTwoLedger(
      [
        { referenceMonth: '2025-01', dueDate: '2025-02-10', statementTotal: 1000, totalPayments: 1000 },
        { referenceMonth: '2025-05', dueDate: '2025-06-10', statementTotal: 500, totalPayments: 500 },
      ],
      { asOf: HOJE, resolutionsByMonth: { '2025-05': [ajuste()] } }
    );
    const ligado = diagnoseCreditCard({ competences: p.competences, orphanResolutions: p.orphanResolutions });
    expect(ligado.map((d) => [d.code, d.severity, d.competences, d.amountCents, d.action])).toEqual([
      ['classificacao_sem_diferenca', 'revisar', ['2025-05'], 94, 'ver_diferenca'],
    ]);
    expect(diagnoseCreditCard({ competences: p.competences, orphanResolutions: null })).toEqual([]);
  });
});

// ===========================================================================
// 2b. Pagamento antecipado e destino explícito
// ===========================================================================

describe('pagamento antecipado: destino explícito prevalece; sem evidência, nada é inventado', () => {
  /** N−1 = 2026-01 (1.000, vence 10/02) · N = 2026-02 (500, vence 10/03) · N+1 = 2026-03 (300). */
  const fN1 = 'A_jan.csv', fN = 'A_fev.csv', fN2 = 'A_mar.csv';
  const base = () => [compra(fN1, '2026-01-05', 1000), compra(fN, '2026-02-05', 500), compra(fN2, '2026-03-05', 300)];
  const logs = [log(fN1, '2026-01', '2026-02-10'), log(fN, '2026-02', '2026-03-10'), log(fN2, '2026-03', '2026-04-10')];
  const dirigido = (data: string, valor: number, ref: string, id: string, origem = 'manual'): Transaction =>
    ({
      ID_Transacao: id, ID_Conta: ACC, Origem: origem, Data: data, Data_Pagamento: data, Valor: Math.abs(valor),
      Tipo: 'Renda', Categoria: 'Pagamento', Nome_Fantasia: 'Pagamento de Fatura',
      Descricao_Original: `Pagamento de Fatura (${ref}) finelo_competence:${ref}`,
    }) as unknown as Transaction;
  const rodar = (tx: Transaction[]) => {
    const antes = JSON.stringify(tx);
    const cards = cardsDe(tx, logs);
    const p = projectCardTwoLedger(cards, { asOf: '2026-03-01' });
    expect(JSON.stringify(tx)).toBe(antes); // lançamentos originais intactos
    const m = (ref: string) => p.competences.find((c) => c.referenceMonth === ref)!;
    return { cards, p, m };
  };

  it('anterior já paga + novo pagamento importado antes do vencimento, sem destino: fica rastreável e a ambiguidade é apontada', () => {
    const { cards, p, m } = rodar([...base(), pagamento(fN, '2026-02-05', 1000, 'p1'), pagamento(fN, '2026-02-08', 200, 'p2')]);
    expect(destino(cards, 'p1')).toEqual([['2026-01', 100000]]);
    expect(destino(cards, 'p2')).toEqual([['2026-01', 20000]]);
    // Não vira pagamento da próxima fatura nem crédito: fica no livro 2.
    expect(m('2026-02').recognizedPaymentsCents).toBe(0);
    expect(m('2026-02').priorCreditAppliedCents).toBe(0);
    expect(m('2026-02').economicOpenBalanceCents).toBe(50000);
    expect(m('2026-01').unresolvedReconciliationDeltaCents).toBe(20000);
    expect(p.economicCarryCents).toBe(0);
    const d = diagnoseCreditCard({ competences: p.competences });
    expect(d.find((x) => x.code === 'pagamento_acima_da_fatura')?.competences).toEqual(['2026-01']);
    expect(d.find((x) => x.code === 'pagamento_acima_da_fatura')?.message).toMatch(/adiantado/);
  });

  it('o mesmo pagamento com destino explícito vai para a fatura indicada, mesmo antes do vencimento da anterior', () => {
    const { p, m } = rodar([...base(), pagamento(fN, '2026-02-05', 1000, 'p1'), dirigido('2026-02-08', 200, '2026-02', 'p2')]);
    expect(m('2026-01').economicOpenBalanceCents).toBe(0);
    expect(m('2026-01').unresolvedReconciliationDeltaCents).toBe(0);
    expect(m('2026-02').recognizedPaymentsCents).toBe(20000);
    expect(m('2026-02').economicOpenBalanceCents).toBe(30000);
    expect(p.suspenseBalanceCents).toBe(0);
  });

  it('linha importada com destino marcado pelo usuário também prevalece sobre a data', () => {
    const { cards, m } = rodar([...base(), pagamento(fN, '2026-02-05', 1000, 'p1'), dirigido('2026-02-08', 200, '2026-02', 'p2', fN)]);
    expect(destino(cards, 'p2')).toEqual([]); // não passa pela inferência por data
    expect(m('2026-01').unresolvedReconciliationDeltaCents).toBe(0);
    expect(m('2026-02').recognizedPaymentsCents).toBe(20000);
  });

  it('parciais das duas faturas no mesmo período: dirigido para N, importados completam N−1 e o resto vai para N', () => {
    const { cards, p, m } = rodar([
      ...base(),
      pagamento(fN, '2026-02-05', 600, 'p1'),           // em dia: N−1
      dirigido('2026-02-06', 200, '2026-02', 'p2'),     // explícito: N
      pagamento(fN, '2026-02-20', 450, 'p3'),           // depois do vencimento: 400 completam N−1, 50 vão para N
    ]);
    expect(destino(cards, 'p1')).toEqual([['2026-01', 60000]]);
    expect(destino(cards, 'p3')).toEqual([['2026-01', 40000], ['2026-02', 5000]]);
    expect(m('2026-01').economicOpenBalanceCents).toBe(0);
    expect(m('2026-02').recognizedPaymentsCents).toBe(25000);
    expect(m('2026-02').economicOpenBalanceCents).toBe(25000);
    expect(p.suspenseBalanceCents).toBe(0);
    // conservação: 600 + 200 + 450 = 1.250 reconhecidos, nenhum centavo a mais ou a menos
    expect(p.competences.reduce((a, c) => a + c.recognizedPaymentsCents, 0)).toBe(125000);
  });

  it('sem destino e com N−1 em aberto, dois pagamentos antes do vencimento ficam ambos em N−1', () => {
    const { cards, m } = rodar([...base(), pagamento(fN, '2026-02-05', 700, 'p1'), pagamento(fN, '2026-02-09', 300, 'p2')]);
    expect(destino(cards, 'p2')).toEqual([['2026-01', 30000]]);
    expect(m('2026-01').economicOpenBalanceCents).toBe(0);
    expect(m('2026-02').recognizedPaymentsCents).toBe(0);
  });

  it('o excedente antecipado volta quando a própria fatura recebe o pagamento do resto', () => {
    const { p, m } = rodar([
      ...base(),
      pagamento(fN, '2026-02-05', 1000, 'p1'),
      pagamento(fN, '2026-02-08', 200, 'p2'),
      pagamento(fN2, '2026-03-09', 300, 'p3'),        // resto de N, em dia
    ]);
    expect(m('2026-02').economicOpenBalanceCents).toBe(0);
    expect(p.reconciliationPending).toBe(false);
    expect(p.suspenseBalanceCents).toBe(0);
  });
});

// ===========================================================================
// 1. Mesmas linhas, mesmo resultado em todas as rotas
// ===========================================================================

describe('mesma entrada, mesmo resultado em todas as rotas', () => {
  function estado() {
    const { tx, logs } = cadeiaComCreditoDaAdicional();
    const manual = {
      ID_Transacao: 'm1', ID_Conta: ACC, Origem: 'manual', Tipo: 'Despesa', Data: '2025-04-20', Data_Pagamento: '2025-05-12',
      Valor: -120.55, Categoria: 'Compras', Descricao_Original: 'Compra manual', Nome_Fantasia: 'Compra manual',
    } as unknown as Transaction;
    const confirmacoes = [{ reference_month: '2025-02', settled_amount: '0.10', confirmed_at: '2026-01-10T10:00:00Z' }];
    const resolucoes: ResolutionRow[] = [
      { id: 'r2', account_id: ACC, reference_month: '2025-02', resolution: 'bank_adjustment', resolved_amount: '0.10', delta_amount: '0.10',
        authoritative_total: null, authoritative_source: null, resolved_at: '2026-01-11T10:00:00Z', credit_card_reconciliation_resolution_reversals: null },
      { id: 'r1', account_id: ACC, reference_month: '2025-02', resolution: 'economic_credit', resolved_amount: '5.00', delta_amount: '5.00',
        authoritative_total: null, authoritative_source: null, resolved_at: '2026-01-12T10:00:00Z', credit_card_reconciliation_resolution_reversals: [{ id: 'rev' }] },
    ];
    return { transactions: [...tx, manual], importLogs: logs, confirmacoes, resolucoes };
  }

  it('Edge function, patrimônio, card e histórico produzem as mesmas competências e o mesmo limite', () => {
    const e = estado();
    const edge = projectCardAccountFromRows({
      accountId: ACC, contas: [conta as never], transactions: e.transactions as never, importLogs: e.importLogs,
      confirmacoes: e.confirmacoes, resolucoes: e.resolucoes, asOf: HOJE,
    })!;
    const confirmations = paymentConfirmationInputsFromRows(e.confirmacoes);
    const resolutions = groupActiveCardResolutions(e.resolucoes)[ACC];

    const patrimonio = projectAccountCardEconomics({
      account: conta, accounts: [conta], transactions: e.transactions, importLogs: e.importLogs,
      userPaymentConfirmations: confirmations, reconciliationResolutions: resolutions, asOf: HOJE,
    }).projection;
    expect(patrimonio).toEqual(edge);

    const card = computeAccountCardDisplay(conta, {
      transactions: e.transactions, accounts: [conta], importLogs: e.importLogs,
      userPaymentConfirmations: confirmations, reconciliationResolutions: resolutions,
      cardV2Enabled: false, cardEngineEnabled: false, cardSnapshotPipelineEnabled: false, reconciliationSurfaceEnabled: true,
    });
    expect(Math.round(card.faturaAtual * 100)).toBe(edge.current!.economicOpenBalanceCents);
    expect(Math.round((card.limite - card.limiteDisponivel) * 100)).toBe(edge.economicUsedCents);
    expect(Math.round((card.reconciliacaoSaldo ?? 0) * 100)).toBe(edge.suspenseBalanceCents);
    expect(card.reconciliacaoPendente).toBe(edge.reconciliationPending);

    const historico = withCanonicalEconomicBalances(cardsDe(e.transactions, e.importLogs, confirmations), {
      asOf: HOJE, resolutionsByMonth: resolutions,
    });
    edge.competences.forEach((c) => {
      const h = historico.find((x) => x.referenceMonth === c.referenceMonth)!;
      expect(Math.round(h.openBalance * 100)).toBe(c.economicOpenBalanceCents);
      expect(Math.round(h.priorCreditApplied * 100)).toBe(c.priorCreditAppliedCents);
    });
  });

  it('o card usa a projeção canônica mesmo com o motor ligado e um snapshot divergente', () => {
    const e = estado();
    const base = {
      transactions: e.transactions, accounts: [conta], importLogs: e.importLogs,
      cardV2Enabled: false, cardSnapshotPipelineEnabled: true, creditCardMetricsReady: true,
    };
    const desligado = computeAccountCardDisplay(conta, { ...base, cardEngineEnabled: false });
    const ligado = computeAccountCardDisplay(conta, {
      ...base, cardEngineEnabled: true,
      cardV2Snapshot: { hasData: true, currentOpenAmount: 9999.99 } as never,
    });
    expect(ligado.faturaAtual).toBe(desligado.faturaAtual);
    expect(ligado.limiteDisponivel).toBe(desligado.limiteDisponivel);
  });

  it('a persistência de faturas monta o mesmo preview do histórico, com cada linha de pagamento', async () => {
    const { tx, logs } = cadeiaComCreditoDaAdicional();
    const cycles = logs.map((l: any) => ({
      fileName: l.file_name, referenceMonth: l.imported_details[0].Card_Reference_Label, dueDate: l.imported_details[0].Card_Due_Date,
    }));
    const persistido = await creditCardRebuildPersistService.rebuildFromImportHistory({ userId: 'u1', account: conta, cycles, transactions: tx });
    const historico = svc.previewCycles(ACC, [...cycles].sort((a, b) => a.referenceMonth.localeCompare(b.referenceMonth)), tx);
    expect(persistido.previews).toEqual(historico);
    persistido.previews.forEach((p) => {
      expect((p.paymentLines ?? []).reduce((a, l) => a + Math.round(l.amount * 100), 0)).toBe(Math.round(p.totals.totalInvoicePayments * 100));
      expect(p).toEqual(buildImportHistoryPreview(ACC, p, tx));
    });
  });

  it('linhas de resolução: mesma ordem, mesmo arredondamento e mesma reversão em qualquer rota', () => {
    const linhas: ResolutionRow[] = [
      { id: 'b', account_id: ACC, reference_month: '2025-01', resolution: 'bank_adjustment', resolved_amount: 1.005, delta_amount: 1.005,
        authoritative_total: null, authoritative_source: null, resolved_at: '2026-01-02T00:00:00Z', credit_card_reconciliation_resolution_reversals: null },
      { id: 'a', account_id: ACC, reference_month: '2025-01', resolution: 'authoritative_total', resolved_amount: null, authoritative_total: '1000.10',
        authoritative_source: 'statement_pdf', resolved_at: '2026-01-01T00:00:00Z', credit_card_reconciliation_resolution_reversals: [] },
      { id: 'c', account_id: ACC, reference_month: '2025-01', resolution: 'economic_credit', resolved_amount: 3, authoritative_total: null,
        authoritative_source: null, resolved_at: '2026-01-03T00:00:00Z', credit_card_reconciliation_resolution_reversals: { id: 'rev' } },
    ];
    const edge = activeResolutionsByMonth([...linhas].reverse());
    const card = groupActiveCardResolutions(linhas)[ACC];
    expect(card).toEqual(edge);
    expect(edge['2025-01'].map((r) => r.kind)).toEqual(['authoritative_total', 'bank_adjustment']);
    expect(edge['2025-01'][1].resolvedAmountCents).toBe(101);
    expect(rowAmountToCents('0.29')).toBe(29);
    expect(rowAmountToCents(1.005)).toBe(101);
  });
});

// ===========================================================================
// 1b. A Edge function carrega o mesmo código: todo import relativo do grafo
//     precisa de extensão explícita (Deno não resolve './x' sem '.ts').
// ===========================================================================

describe('grafo de imports da Edge function card-reconciliation', () => {
  it('todo import relativo alcançável termina em .ts e existe', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const raiz = path.resolve(__dirname, '../../supabase/functions/card-reconciliation/index.ts');
    const visto = new Set<string>();
    const ruins: string[] = [];
    const fila = [raiz];
    const re = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;
    while (fila.length) {
      const arq = fila.pop()!;
      if (visto.has(arq)) continue;
      visto.add(arq);
      const fonte = fs.readFileSync(arq, 'utf8');
      for (const m of fonte.matchAll(re)) {
        const alvo = path.resolve(path.dirname(arq), m[1]);
        if (!m[1].endsWith('.ts') || !fs.existsSync(alvo)) ruins.push(`${path.relative(process.cwd(), arq)} → ${m[1]}`);
        else fila.push(alvo);
      }
    }
    expect(ruins).toEqual([]);
    expect([...visto].some((f) => f.endsWith(path.join('services', 'cardServerProjection.ts')))).toBe(true);
    expect([...visto].some((f) => f.endsWith(path.join('credit-card', 'reconciliationRows.ts')))).toBe(true);
  });
});
