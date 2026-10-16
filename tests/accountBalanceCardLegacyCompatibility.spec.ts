import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAccountCardDisplay, type ComputeAccountCardMetricsOptions } from '../src/components/transactions/accountBalanceCardMetrics';
import * as netWorthEconomics from '../src/services/accountCardEconomics';
import { isNetWorthComponentsV2Enabled } from '../src/services/featureFlagService';
import type { Account, ImportLog, Transaction } from '../src/types';

// Full display snapshots captured from cc40d32e (pre-Patrimônio V2), with the
// same canonical engine and frozen clock. No copied financial implementation.
const account = {
  id: 'card', user_id: 'owner', Nome_Conta: 'Cartão sintético', Tipo_Conta: 'Cartão de Crédito',
  Saldo_Inicial: -1471.8, Saldo_Atual_Calculado: -1471.8, limite_credito: 1000,
  dia_fechamento: 20, dia_vencimento: 10,
} as Account;
const row = (id: string, value: number, extra: Partial<Transaction> = {}): Transaction => ({
  ID_Transacao: id, user_id: 'owner', ID_Conta: 'card', Data: '2026-09-15',
  Data_Pagamento: '2026-10-10', Origem: 'manual', Fonte: 'Manual', Categoria: 'Teste',
  Tipo: value < 0 ? 'Despesa' : 'Renda', Valor: value,
  Nome_Fantasia: value < 0 ? 'Compra' : 'Pagamento de Fatura',
  Descricao_Original: (value < 0 ? 'Compra' : 'Pagamento de Fatura') + ' finelo_competence:2026-09',
  ...extra,
} as Transaction);
const imported = (id: string, value: number, file: string, extra: Partial<Transaction> = {}) =>
  row(id, value, { Origem: file, Descricao_Original: value < 0 ? 'Compra importada' : 'Pagamentos Validos Normais', ...extra });
const log = (id: string, file: string, reference: string, accountId?: string): ImportLog => ({
  id, file_name: file, import_date: '2026-10-01T12:00:00Z',
  imported_details: [{ ...(accountId ? { ID_Conta: accountId } : {}),
    Card_Reference_Label: reference, Card_Due_Date: reference === '2026-09' ? '2026-10-10' : '2026-11-10' }],
} as ImportLog);
const charge = row('charge', -100);
type Scenario = { name: string; account?: Account; options: Partial<ComputeAccountCardMetricsOptions> };
const scenarios: Scenario[] = [
  { name: 'imported history applies next statement payment to the preceding invoice', options: {
    transactions: [imported('old', -500, 'old.csv'), imported('new', -200, 'new.csv'), imported('payment', 500, 'new.csv')],
    importLogs: [log('old', 'old.csv', '2026-09', 'card'), log('new', 'new.csv', '2026-10', 'card')],
  } },
  { name: 'historical metadata without an explicit account', options: {
    transactions: [imported('charge', -100, 'history.csv')], importLogs: [log('history', 'history.csv', '2026-09')],
  } },
  { name: 'coinciding filenames with metadata for different accounts and competences', options: {
    transactions: [imported('charge', -100, 'statement.csv')],
    importLogs: [log('foreign', 'statement.csv', '2026-09', 'other'), log('own', 'statement.csv', '2026-10', 'card')],
  } },
  { name: 'legacy origin fallback when only metadata mentioning another account exists', options: {
    transactions: [imported('charge', -100, 'statement.csv')], importLogs: [log('foreign', 'statement.csv', '2026-09', 'other')],
  } },
  { name: 'imported transaction without a valid date preserves the known historical competence', options: {
    transactions: [imported('charge', -100, 'history.csv', { Data: '' })], importLogs: [log('history', 'history.csv', '2026-09', 'card')],
  } },
  { name: 'manual daily purchases and a partial payment retain overdue invoice and limit', options: {
    transactions: [row('charge', -500), row('partial', 200)],
  } },
  { name: 'fully settled invoice stays paid', options: { transactions: [charge, row('payment', 100)] } },
  { name: 'future installments consume limit while the oldest overdue invoice stays highlighted', options: {
    transactions: [charge, row('installment', -200, { Data: '2026-11-15', Data_Pagamento: '2026-12-10',
      Descricao_Original: 'Compra finelo_competence:2026-11', Parcela_Atual: 2, Total_Parcelas: 3 })],
  } },
  { name: 'manual payment confirmation settles the invoice', options: {
    transactions: [charge], userPaymentConfirmations: [{ referenceMonth: '2026-09', settledAmount: 100, confirmedAt: '2026-10-12T12:00:00Z' }],
  } },
  { name: 'confirmation without a valid historical timestamp preserves existing display', options: {
    transactions: [row('charge', -300)], userPaymentConfirmations: [{ referenceMonth: '2026-09', settledAmount: 100, confirmedAt: '' }],
  } },
  { name: 'ignored negative confirmation does not suppress other competences', options: {
    transactions: [charge], userPaymentConfirmations: [{ referenceMonth: '2026-08', settledAmount: -1, confirmedAt: '2026-09-12T12:00:00Z' }],
  } },
  { name: 'confirmation plus observed payment preserves suspense without automatic credit', options: {
    transactions: [charge, row('payment', 100)],
    userPaymentConfirmations: [{ referenceMonth: '2026-09', settledAmount: 100, confirmedAt: '2026-10-12T12:00:00Z' }],
  } },
  { name: 'pending reconciliation does not consume economic limit', options: { transactions: [charge, row('payment', 100.22)] } },
  { name: 'bank adjustment closes only the reconciliation difference', options: {
    transactions: [charge, row('payment', 100.22)], reconciliationResolutions: { '2026-09': [{ kind: 'bank_adjustment', resolvedAmountCents: 22 }] },
  } },
  { name: 'explicit economic credit resolution pays the upcoming invoice once', options: {
    transactions: [charge, row('payment', 150), row('upcoming', -200, { Descricao_Original: 'Compra finelo_competence:2026-10', Data_Pagamento: '2026-11-10' })],
    reconciliationResolutions: { '2026-09': [{ kind: 'economic_credit', resolvedAmountCents: 5000 }] },
  } },
  { name: 'unassigned import retains the existing snapshot fallback', options: {
    transactions: [imported('charge', -100, 'unknown.csv')], importLogs: [],
    cardV2Enabled: true, cardV2Snapshot: { currentOpenAmount: 80, hasData: true, fetchCompleted: true },
  } },
  { name: 'card without history and without due or closing day retains fallback', account: { ...account, dia_fechamento: undefined, dia_vencimento: undefined }, options: { transactions: [] } },
  { name: 'not-yet-due invoice retains its own dates and available limit', options: {
    transactions: [row('current', -200, { Descricao_Original: 'Compra finelo_competence:2026-10', Data_Pagamento: '2026-11-10' })],
  } },
];

beforeEach(() => {
  vi.stubEnv('TZ', 'UTC');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
  vi.stubEnv('VITE_NET_WORTH_COMPONENTS_V2_ENABLED', 'false');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('Transactions compatibility with Patrimônio V2 disabled', () => {
  it('does not delegate Transactions to the net-worth coverage adapter', () => {
    const adapter = vi.spyOn(netWorthEconomics, 'projectAccountCardEconomics').mockImplementation(() => {
      throw new Error('Net-worth coverage is unavailable');
    });
    const display = computeAccountCardDisplay(account, {
      accounts: [account], transactions: [charge], importLogs: [], cardV2Enabled: false,
      cardEngineEnabled: false, cardSnapshotPipelineEnabled: false,
    });
    expect(adapter).not.toHaveBeenCalled();
    expect(display.faturaAtual).toBe(100);
    expect(display.faturaVencida).toBe(true);
    expect(display.limiteDisponivel).toBe(900);
  });

  it.each(scenarios)('$name', ({ account: selected = account, options }) => {
    expect(isNetWorthComponentsV2Enabled({ id: 'owner', app_metadata: {}, user_metadata: {} })).toBe(false);
    const input: ComputeAccountCardMetricsOptions = {
      accounts: [selected], transactions: [], importLogs: [], cardV2Enabled: false,
      cardEngineEnabled: false, cardSnapshotPipelineEnabled: false, reconciliationSurfaceEnabled: true, ...options,
    };
    const display = computeAccountCardDisplay(selected, input);
    // Compare ALL returned fields, including diagnostics, dates and limits.
    expect(display).toMatchSnapshot();
    // A future Dashboard opt-in also must not silently migrate Transactions.
    vi.stubEnv('VITE_NET_WORTH_COMPONENTS_V2_ENABLED', 'true');
    expect(computeAccountCardDisplay(selected, input)).toEqual(display);
  });
});
