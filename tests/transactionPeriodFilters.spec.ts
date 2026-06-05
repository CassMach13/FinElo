import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  buildTransactionFiltersCollapsedSummary,
  getDefaultTransactionFilters,
  getPeriodRange,
  isCommitmentTransaction,
  loadTransactionFiltersPanelExpanded,
  resolveTransactionFilters,
  saveTransactionFiltersPanelExpanded,
  shouldApplyDateFilter,
  TRANSACTION_FILTERS_PANEL_EXPANDED_KEY,
} from '../src/utils/transactionPeriodFilters';
import type { Transaction } from '../src/types';

describe('transactionPeriodFilters', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('current_month cobre o mês civil corrente', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 15)); // 15/05/2026
    expect(getPeriodRange('current_month')).toEqual({
      startDate: '2026-05-01',
      endDate: '2026-05-31',
    });
  });

  it('resolveTransactionFilters reaplica este mês ao reabrir', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10)); // junho
    const resolved = resolveTransactionFilters({
      periodPreset: 'current_month',
      viewScope: 'operation',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    expect(resolved.startDate).toBe('2026-06-01');
    expect(resolved.endDate).toBe('2026-06-30');
  });

  it('histórico completo remove intervalo de datas', () => {
    const resolved = resolveTransactionFilters({ viewScope: 'all', periodPreset: 'all' });
    expect(resolved.startDate).toBe('');
    expect(resolved.endDate).toBe('');
    expect(shouldApplyDateFilter(resolved)).toBe(false);
  });

  it('identifica compromissos parcelados', () => {
    const tx = {
      Nome_Fantasia: 'Carro (2/36)',
      Parcela_Atual: 2,
      Total_Parcelas: 36,
      Valor: -3000,
      Tipo: 'Despesa',
      Data: '2026-06-01',
    } as Transaction;
    expect(isCommitmentTransaction(tx)).toBe(true);
  });

  it('buildTransactionFiltersCollapsedSummary resume filtros ativos', () => {
    const summary = buildTransactionFiltersCollapsedSummary({
      ...getDefaultTransactionFilters(),
      text: 'ifood',
      accountId: ['a1', 'a2'],
    });
    expect(summary).toContain('Tudo do período');
    expect(summary).toContain('Busca');
    expect(summary).toContain('2 contas');
  });

  it('persiste painel de filtros expandido', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
    store.set(TRANSACTION_FILTERS_PANEL_EXPANDED_KEY, 'true');
    expect(loadTransactionFiltersPanelExpanded()).toBe(true);
    saveTransactionFiltersPanelExpanded(false);
    expect(store.get(TRANSACTION_FILTERS_PANEL_EXPANDED_KEY)).toBe('false');
    vi.unstubAllGlobals();
  });

  it('padrão usa Data e mês atual', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 20));
    const defaults = getDefaultTransactionFilters();
    expect(defaults.dateField).toBe('Data');
    expect(defaults.viewScope).toBe('operation');
    expect(defaults.periodPreset).toBe('current_month');
    expect(defaults.startDate).toBe('2026-01-01');
    expect(defaults.endDate).toBe('2026-01-31');
  });
});
