import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/supabaseClient', () => ({ supabase: {} }));
import { useAppStore } from '../../src/hooks/useAppStore';
import { computeAccountBalanceAsOf, computeAccountsTotalAsOf, computeNetWorthSnapshot } from '../../src/utils/dashboardNetWorth';
import { projectCardTwoLedger, type CompetenceHistoryLike } from '../../src/domain/credit-card/twoLedgerProjection';
import { computeTwoLedgerBalances } from '../../src/domain/credit-card/twoLedgerBalance';
import { creditCardRebuildFromImportHistoryService as rebuild } from '../../src/services/creditCardRebuildFromImportHistoryService';
import { buildDirectedPaymentDescription, buildDirectedPurchaseDescription, buildDirectedRefundDescription } from '../../src/services/creditCardDirectedPayment';
import { FAMILY_SCOPE, SELF_SCOPE, resolveDashboardScope, scopeDashboardData, type DashboardSourceData } from '../../src/domain/dashboard/dashboardOwnerScope';
import type { Account, Asset, ImportLog, Transaction } from '../../src/types';

/**
 * DIAGNOSTIC CHARACTERIZATION, not the proposed correction.
 * Assertions bearing "current limitation" intentionally expose the current behavior.
 * Change those expectations into acceptance regressions when the financial rule is implemented.
 * All data are synthetic. Supabase is inert; no network or database writes.
 */
const TODAY = '2026-10-15';
const at = (iso: string) => new Date(iso + 'T12:00:00');
const cents = (n: number) => Math.round(n * 100);
const account = (id: string, type: Account['Tipo_Conta'] = 'Conta Corrente', balance = 0, extra: Partial<Account> = {}): Account => ({
  id, user_id: 'owner-a', Nome_Conta: id, Tipo_Conta: type, Saldo_Inicial: balance,
  Data_Saldo_Inicial: at('2025-01-01'), dia_vencimento: 10, ...extra,
});
let nextId = 0;
const tx = (accountId: string, value: number, extra: Partial<Transaction> = {}): Transaction => ({
  ID_Transacao: 'synthetic-' + ++nextId, user_id: 'owner-a', ID_Conta: accountId,
  Data: at('2026-09-01'), Data_Pagamento: at('2026-10-10'),
  Valor: value, Tipo: value < 0 ? 'Despesa' : 'Renda', Categoria: 'Teste',
  Nome_Fantasia: 'Compra', Descricao_Original: 'Compra', Origem: 'manual', Fonte: 'Manual', ...extra,
});
const competence = (referenceMonth: string, statementTotal: number, totalPayments = 0, dueDate = '2026-10-10'): CompetenceHistoryLike => ({
  referenceMonth, statementTotal, totalPayments, dueDate,
});
const project = (rows: CompetenceHistoryLike[], asOf = TODAY) => projectCardTwoLedger(rows, { asOf });
const history = (card: Account, transactions: Transaction[], importLogs: ImportLog[] = [], confirmations: any[] = []) =>
  rebuild.competenceHistoryCardsForAccount({
    accountId: card.id, account: card, accounts: [card], transactions, importLogs,
    userPaymentConfirmations: confirmations,
  });
const cardProjection = (card: Account, transactions: Transaction[], importLogs: ImportLog[] = [], confirmations: any[] = []) =>
  project(history(card, transactions, importLogs, confirmations));
const purchase = (id: string, value: number, ref = '2026-09', extra: Partial<Transaction> = {}) =>
  tx(id, -value, { Descricao_Original: buildDirectedPurchaseDescription(ref, 'Compra'), ...extra });
const payment = (id: string, value: number, ref = '2026-09', extra: Partial<Transaction> = {}) =>
  tx(id, value, { Nome_Fantasia: 'Pagamento de Fatura', Descricao_Original: buildDirectedPaymentDescription(ref), ...extra });
const currentBalances = (accounts: Account[], transactions: Transaction[]) => {
  useAppStore.setState({ accounts, transactions });
  return useAppStore.getState().getAccountsWithCalculatedBalance();
};

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(at(TODAY)); nextId = 0; });
afterEach(() => { useAppStore.setState(useAppStore.getInitialState(), true); vi.useRealTimers(); });

describe('pilot divergence reproduced with synthetic data', () => {
  it('reproduces 876.28 - 1471.80 = -595.52 and net worth 153715.21', () => {
    const accounts = [
      account('benefit', 'Cartão Alimentação', 674.85), account('bank-zero'),
      account('bank-xp', 'Conta Corrente', 201.43), account('card', 'Cartão de Crédito', -6919.88),
    ];
    const rows = [tx('card', 5448.08)];
    const balances = currentBalances(accounts, rows);
    expect(cents(balances.find((a) => a.id === 'card')!.Saldo_Atual_Calculado!)).toBe(-147180);
    expect(cents(balances.reduce((sum, a) => sum + a.Saldo_Atual_Calculado!, 0))).toBe(-59552);
    const assets = [{ value: 75500, remaining_balance: 0 }] as Asset[];
    expect(cents(computeNetWorthSnapshot(accounts, rows, assets, 78810.73, at(TODAY)).total)).toBe(15371521);
  });

  it('the same negative card seed can coexist with a fully paid economic ledger', () => {
    const card = account('card', 'Cartão de Crédito', -1471.8);
    const rows = [purchase('card', 1000), payment('card', 1000)];
    expect(currentBalances([card], rows)[0].Saldo_Atual_Calculado).toBe(-1471.8);
    expect(cardProjection(card, rows).economicUsedCents).toBe(0);
  });

  it('a positive legacy card balance does not prove that there is no obligation', () => {
    const card = account('card', 'Cartão de Crédito', 1500);
    const rows = [purchase('card', 1000)];
    expect(currentBalances([card], rows)[0].Saldo_Atual_Calculado).toBe(500);
    expect(cardProjection(card, rows).economicUsedCents).toBe(100000);
  });

  it('substitution must remove the legacy card balance before subtracting economic debt', () => {
    const resources = 876.28 + 78810.73 + 75500;
    const debt = project([competence('2026-09', 7437.11)]).economicUsedCents / 100;
    expect(cents(resources - debt)).toBe(14774990);
    expect(cents(153715.21 - (resources - debt))).toBe(596531);
    expect(cents(153715.21 - debt)).not.toBe(14774990); // would count the legacy liability too
  });
});

describe('cash, benefit balances, archived accounts and cutoffs', () => {
  it.each([1000, -200, 0])('preserves a bank balance of %s without clamping a negative balance', (balance) => {
    const bank = account('bank', 'Conta Corrente', balance);
    expect(computeAccountBalanceAsOf(bank, [], at(TODAY))).toBe(balance);
  });

  it('benefit resources are currently merged into accounts despite their restricted use', () => {
    const accounts = [account('cash', 'Conta Corrente', 201.43), account('benefit', 'Cartão Alimentação', 674.85)];
    expect(cents(computeAccountsTotalAsOf(accounts, [], at(TODAY)))).toBe(87628);
    expect(accounts.filter((a) => a.Tipo_Conta !== 'Cartão Alimentação')[0].Saldo_Inicial).toBe(201.43);
  });

  it('current limitation: Dashboard includes archived balances while Transactions hides their cards', () => {
    const accounts = [account('active', 'Conta Corrente', 100), account('archived', 'Conta Corrente', 50, { is_archived: true })];
    const calculated = currentBalances(accounts, []);
    expect(calculated.filter((a) => !a.is_archived).reduce((s, a) => s + a.Saldo_Atual_Calculado!, 0)).toBe(100);
    expect(computeAccountsTotalAsOf(accounts, [], at(TODAY))).toBe(150);
  });

  it('archiving a credit card does not settle its economic obligation', () => {
    const card = account('closed-card', 'Cartão de Crédito', 0, { is_archived: true });
    expect(cardProjection(card, [purchase(card.id, 300)]).economicUsedCents).toBe(30000);
  });

  it('bank cash moves on payment date; absent payment date currently falls back to purchase date', () => {
    const bank = account('bank');
    const futurePayment = tx('bank', -100, { Data_Pagamento: at('2026-10-20') });
    expect(computeAccountBalanceAsOf(bank, [futurePayment], at(TODAY))).toBe(0);
    expect(computeAccountBalanceAsOf(bank, [futurePayment], at('2026-10-20'))).toBe(-100);
    expect(computeAccountBalanceAsOf(bank, [{ ...futurePayment, Data_Pagamento: undefined }], at(TODAY))).toBe(-100);
  });

  it('current limitation: purchase on/before the opening date is ignored even with a later payment', () => {
    const bank = account('bank');
    for (const date of ['2024-12-31', '2025-01-01']) {
      expect(computeAccountBalanceAsOf(bank, [tx(bank.id, -100, { Data: at(date) })], at(TODAY))).toBe(0);
    }
  });

  it('current limitation: a future opening balance is returned even before its opening date', () => {
    expect(computeAccountBalanceAsOf(account('future', 'Conta Corrente', 500, { Data_Saldo_Inicial: at('2026-11-01') }), [], at(TODAY))).toBe(500);
  });

  it('current limitation: toggling comparison removes future-dated card rows from the primary total', () => {
    const card = account('card', 'Cartão de Crédito');
    const rows = [purchase('card', 100), purchase('card', 200, '2026-10', { Data: at('2026-11-01') })];
    expect(currentBalances([card], rows)[0].Saldo_Atual_Calculado).toBe(-300);
    expect(computeAccountsTotalAsOf([card], rows, at(TODAY))).toBe(-100);
  });

  it('current limitation: comparison to month end can include bank outflows after today', () => {
    const bank = account('bank', 'Conta Corrente', 1000);
    const rows = [tx(bank.id, -100, { Data_Pagamento: at('2026-10-20') })];
    expect(currentBalances([bank], rows)[0].Saldo_Atual_Calculado).toBe(1000);
    expect(computeAccountsTotalAsOf([bank], rows, at('2026-10-31'))).toBe(900);
  });
});

describe('economic ledger boundary and duplicate-obligation risks', () => {
  it('the highlighted invoice is only one component when other commitments exist', () => {
    const p = project([competence('2026-09', 7437.11), competence('2026-10', 500, 0, '2026-11-10')]);
    expect(p.current!.economicOpenBalanceCents).toBe(743711);
    expect(p.economicUsedCents).toBe(793711);
  });

  it('overdue and upcoming amounts partition, rather than duplicate, total debt', () => {
    const p = project([competence('2026-09', 100), competence('2026-10', 200, 0, '2026-11-10')]);
    const overdue = p.competences.filter((c) => c.economicStatus === 'overdue').reduce((s, c) => s + c.economicOpenBalanceCents, 0);
    const upcoming = p.competences.filter((c) => c.economicStatus === 'open').reduce((s, c) => s + c.economicOpenBalanceCents, 0);
    expect(overdue).toBe(10000); expect(upcoming).toBe(20000); expect(overdue + upcoming).toBe(p.economicUsedCents);
  });

  it('a paid invoice with reconciliation surplus creates neither debt nor economic credit', () => {
    const p = project([competence('2026-09', 100, 100.22)]);
    expect(p.economicUsedCents).toBe(0); expect(p.economicCarryCents).toBe(0);
    expect(p.suspenseBalanceCents).toBe(22); expect(p.current!.economicStatus).toBe('paid');
  });

  it('reconciliation surplus does not pay a new invoice without recognized settlement', () => {
    const p = project([competence('2026-08', 100, 100.22), competence('2026-09', 500)]);
    expect(p.economicUsedCents).toBe(50000); expect(p.suspenseBalanceCents).toBe(22);
  });

  it('an explicit economic-credit resolution moves proven credit exactly once', () => {
    const p = projectCardTwoLedger([competence('2026-08', 100, 100.22), competence('2026-09', 500)], {
      asOf: TODAY, resolutionsByMonth: { '2026-08': [{ kind: 'economic_credit', resolvedAmountCents: 22 }] },
    });
    expect(p.economicUsedCents).toBe(49978); expect(p.economicCarryCents).toBe(0); expect(p.suspenseBalanceCents).toBe(0);
  });

  it('purchases, refunds and directed payments are accounted for once in the same competence', () => {
    const card = account('card', 'Cartão de Crédito');
    const rows = [purchase(card.id, 1000), tx(card.id, 100, { Descricao_Original: buildDirectedRefundDescription('2026-09') }), payment(card.id, 500)];
    expect(cardProjection(card, rows).economicUsedCents).toBe(40000);
  });

  it('a bank-funded card settlement leaves net worth unchanged', () => {
    const bank = account('bank', 'Conta Corrente', 1000), card = account('card', 'Cartão de Crédito');
    const before = [purchase(card.id, 300)];
    const after = [...before, payment(card.id, 300), tx(bank.id, -300, { economic_event_id: 'payment-pair' })];
    const net = (rows: Transaction[]) => computeAccountBalanceAsOf(bank, rows, at(TODAY)) - cardProjection(card, rows).economicUsedCents / 100;
    expect(net(before)).toBe(700); expect(net(after)).toBe(700);
  });

  it('a transfer between included bank accounts conserves the combined account balance', () => {
    const accounts = [account('a', 'Conta Corrente', 1000), account('b')];
    const rows = [tx('a', -300, { economic_event_id: 'transfer' }), tx('b', 300, { economic_event_id: 'transfer' })];
    expect(computeAccountsTotalAsOf(accounts, rows, at(TODAY))).toBe(1000);
  });

  it('duplicate import-log records for one origin do not duplicate the competence', () => {
    const card = account('card', 'Cartão de Crédito');
    const rows = [tx(card.id, -500, { Origem: 'statement.csv' })];
    const log = { id: 'log', user_id: 'owner-a', file_name: 'statement.csv', import_date: '2026-10-01', imported_details: [{ ID_Conta: card.id, Card_Reference_Label: '2026-09', Card_Due_Date: '2026-10-10' }] } as unknown as ImportLog;
    expect(cardProjection(card, rows, [log, { ...log, id: 'repeat' }]).economicUsedCents).toBe(50000);
  });

  it('current limitation: duplicate transaction facts are not deduplicated by the projection', () => {
    const card = account('card', 'Cartão de Crédito'), row = purchase(card.id, 100);
    expect(cardProjection(card, [row, { ...row }]).economicUsedCents).toBe(20000);
  });

  it('all materialized installments enter the current commitment without multiplying their totals again', () => {
    const card = account('card', 'Cartão de Crédito');
    const rows = [0, 1, 2].map((i) => purchase(card.id, 100, '2026-' + String(9 + i).padStart(2, '0'), {
      Data: at('2026-' + String(9 + i).padStart(2, '0') + '-01'),
      Data_Pagamento: at('2026-' + String(10 + i).padStart(2, '0') + '-10'),
      Parcela_Atual: i + 1, Total_Parcelas: 3,
    }));
    expect(cardProjection(card, rows).economicUsedCents).toBe(30000);
  });

  it('a single imported installment does not provide the missing future installment amounts', () => {
    const card = account('card', 'Cartão de Crédito');
    expect(cardProjection(card, [purchase(card.id, 100, '2026-09', { Parcela_Atual: 2, Total_Parcelas: 12 })]).economicUsedCents).toBe(10000);
  });

  it('multiple cards sharing a reference month remain independent', () => {
    const cards = [account('one', 'Cartão de Crédito'), account('two', 'Cartão de Crédito')];
    const rows = [purchase('one', 100), purchase('two', 200)];
    expect(cards.reduce((sum, card) => sum + cardProjection(card, rows).economicUsedCents, 0)).toBe(30000);
  });

  it('the projection replays raw statement totals and payments, not precomputed legacy carry fields', () => {
    const input = { ...competence('2026-09', 100, 50), openBalance: 10, priorCreditApplied: 40 };
    expect(project([input]).economicUsedCents).toBe(5000);
  });

  it('official totals have to enter through a supported provenance-bearing input', () => {
    const input = { ...competence('2026-09', 500), authoritativeStatementTotalCents: 30000, authoritativeSource: 'bank_app' };
    expect(project([input]).economicUsedCents).toBe(50000); // adapter does not forward these extra fields
    const core = computeTwoLedgerBalances([{ referenceMonth: '2026-09', computedLinesTotalCents: 50000, authoritativeStatementTotalCents: 30000, authoritativeSource: 'bank_app' }]);
    expect(core.competences[0].economicOpenBalanceCents).toBe(30000);
  });
});

describe('historical and family limitations must remain explicit', () => {
  it('current limitation: asOf changes due status but never filters future competences', () => {
    const input = [competence('2026-11', 500, 0, '2026-12-10')];
    expect(project(input, '2026-01-01').economicUsedCents).toBe(50000);
    expect(project(input, '2027-01-01').economicUsedCents).toBe(50000);
  });

  it.each(['payment', 'refund'])('current limitation: a future %s can reduce an earlier snapshot without upstream filtering', (kind) => {
    const card = account('card', 'Cartão de Crédito'), charge = purchase(card.id, 300);
    const future = kind === 'payment'
      ? payment(card.id, 300, '2026-09', { Data: at('2026-11-01') })
      : tx(card.id, 300, { Data: at('2026-11-01'), Descricao_Original: buildDirectedRefundDescription('2026-09') });
    expect(cardProjection(card, [charge, future]).economicUsedCents).toBe(0);
    expect(cardProjection(card, [charge]).economicUsedCents).toBe(30000);
  });

  it('current limitation: confirmation time is not an asOf cutoff in the competence builder', () => {
    const card = account('card', 'Cartão de Crédito');
    const p = cardProjection(card, [purchase(card.id, 100)], [], [{ referenceMonth: '2026-09', settledAmount: 100, confirmedAt: '2026-11-01T12:00:00Z' }]);
    expect(p.economicUsedCents).toBe(0);
  });

  it('current limitation: both period snapshots reuse current asset valuations and financing balances', () => {
    const assets = [{ value: 10000, remaining_balance: 1000 }] as Asset[];
    expect(computeNetWorthSnapshot([], [], assets, 0, at('2026-01-01')).assetsNet).toBe(9000);
    expect(computeNetWorthSnapshot([], [], assets, 0, at(TODAY)).assetsNet).toBe(9000);
  });

  it('account ownership governs stock balances even when a relative authored a movement', () => {
    const accounts = [account('own', 'Cartão de Crédito'), account('relative', 'Cartão de Crédito', 0, { user_id: 'owner-b' })];
    const rows = [purchase('own', 100), purchase('own', 20, '2026-09', { user_id: 'owner-b' }), purchase('relative', 200, '2026-09', { user_id: 'owner-b' })];
    const data: DashboardSourceData = { accounts, transactions: rows, assets: [], budgets: [], budgetMonths: [], economicEvents: [] };
    const options = [{ userId: 'owner-a', label: 'Você', isSelf: true }, { userId: 'owner-b', label: 'Familiar', isSelf: false }];
    const self = scopeDashboardData(resolveDashboardScope('owner-a', SELF_SCOPE, options), data, { sessionUserId: 'owner-a', getTransactionOwnerId: (t) => t.user_id });
    expect(computeAccountsTotalAsOf(self.accounts, rows, at(TODAY))).toBe(-120);
    expect(cardProjection(self.accounts[0], rows).economicUsedCents).toBe(12000);
    expect(cardProjection(self.accounts[0], self.transactions).economicUsedCents).toBe(10000); // would lose the relative's movement
    const family = scopeDashboardData(resolveDashboardScope('owner-a', FAMILY_SCOPE, options), data, { sessionUserId: 'owner-a', getTransactionOwnerId: (t) => t.user_id });
    expect(family.accounts.reduce((sum, card) => sum + cardProjection(card, family.transactions).economicUsedCents, 0)).toBe(32000);
  });

  it('stock balances retain both legs; economic-event neutrality is for flow metrics', () => {
    const bank = account('bank', 'Conta Corrente', 1000);
    expect(computeAccountBalanceAsOf(bank, [tx(bank.id, -300, { economic_event_id: 'card-payment' })], at(TODAY))).toBe(700);
  });

  it('confirmation and observed payment are additive: duplicated settlement becomes suspense, not spendable credit', () => {
    const card = account('card', 'Cartão de Crédito');
    const p = cardProjection(card, [purchase(card.id, 100), payment(card.id, 100)], [], [{ referenceMonth: '2026-09', settledAmount: 100, confirmedAt: '2026-10-10T12:00:00Z' }]);
    expect(p.competences[0].recognizedPaymentsCents).toBe(20000);
    expect(p.economicUsedCents).toBe(0); expect(p.economicCarryCents).toBe(0); expect(p.suspenseBalanceCents).toBe(10000);
  });
});
