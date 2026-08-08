import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  buildTransactionFiltersCollapsedSummary,
  getDefaultTransactionFilters,
  getPeriodRange,
  getShowAllTransactionFilters,
  isCommitmentTransaction,
  loadTransactionFiltersPanelExpanded,
  resolveTransactionFilters,
  saveTransactionFiltersPanelExpanded,
  shouldApplyDateFilter,
  matchesTransactionFilters,
  SMART_TRANSACTION_FILTERS_STORAGE_KEY,
  TRANSACTION_FILTERS_STORAGE_KEY,
  TRANSACTION_FILTERS_PANEL_EXPANDED_KEY,
  UNASSIGNED_ACCOUNT_FILTER_ID,
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

  it('todo o período preserva o atalho de parcelas e recorrências', () => {
    const resolved = resolveTransactionFilters({
      viewScope: 'commitments',
      periodPreset: 'all',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    expect(resolved.viewScope).toBe('commitments');
    expect(resolved.periodPreset).toBe('all');
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

  it('mantém transações do primeiro e do último dia no filtro mensal', () => {
    const filters = {
      ...getDefaultTransactionFilters(),
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      periodPreset: 'custom' as const,
    };
    const makeTx = (date: string) => ({
      Data: date,
      Nome_Fantasia: 'Teste',
      Descricao_Original: 'Teste',
      Valor: -10,
      Tipo: 'Despesa',
      Categoria: 'Teste',
      Origem: 'manual',
      Fonte: 'Manual',
    }) as Transaction;

    expect(matchesTransactionFilters(makeTx('2026-08-01'), filters)).toBe(true);
    expect(matchesTransactionFilters(makeTx('2026-08-31'), filters)).toBe(true);
    expect(matchesTransactionFilters(makeTx('2026-07-31'), filters)).toBe(false);
    expect(matchesTransactionFilters(makeTx('2026-09-01'), filters)).toBe(false);
  });

  it('permite localizar transações sem conta sem misturá-las às contas existentes', () => {
    const base = {
      Data: '2026-08-01',
      Nome_Fantasia: 'Teste',
      Descricao_Original: 'Teste',
      Valor: -10,
      Tipo: 'Despesa',
      Categoria: 'Teste',
      Origem: 'arquivo.csv',
      Fonte: 'Importação',
    } as Transaction;
    const filters = {
      ...getDefaultTransactionFilters(),
      viewScope: 'all' as const,
      periodPreset: 'all' as const,
      startDate: '',
      endDate: '',
      accountId: [UNASSIGNED_ACCOUNT_FILTER_ID],
    };

    expect(matchesTransactionFilters(base, filters)).toBe(true);
    expect(matchesTransactionFilters({ ...base, ID_Conta: 'account-a' }, filters)).toBe(false);
  });

  it('busca por múltiplos termos em descrição, conta, categoria e arquivo sem diferenciar acentos', () => {
    const transaction = {
      Data: '2026-07-15',
      Nome_Fantasia: 'Supermercado Central',
      Descricao_Original: 'Compra débito',
      Valor: -120,
      Tipo: 'Despesa',
      Categoria: 'Alimentação',
      Origem: 'extrato_nubank_julho.csv',
      Fonte: 'Importação',
      ID_Conta: 'account-nubank',
    } as Transaction;
    const filters = {
      ...getShowAllTransactionFilters(),
      text: 'nubank alimentacao 120,00',
    };

    expect(matchesTransactionFilters(transaction, filters, {
      getAccountName: () => 'Conta Nubank Principal',
    })).toBe(true);
    expect(matchesTransactionFilters(transaction, { ...filters, text: 'nubank farmacia' }, {
      getAccountName: () => 'Conta Nubank Principal',
    })).toBe(false);
  });

  it('separa lançamentos manuais, importados e de cartão sem alterar os dados', () => {
    const manual = {
      Data: '2026-08-01',
      Nome_Fantasia: 'Manual',
      Descricao_Original: 'Manual',
      Valor: -10,
      Tipo: 'Despesa',
      Categoria: 'Teste',
      Origem: 'manual',
      Fonte: 'Manual',
      ID_Conta: 'cash-account',
    } as Transaction;
    const imported = {
      ...manual,
      Nome_Fantasia: 'Importada',
      Origem: 'extrato.csv',
      Fonte: 'Importação',
      ID_Conta: 'card-account',
    } as Transaction;

    expect(matchesTransactionFilters(manual, {
      ...getShowAllTransactionFilters(),
      sourceScope: 'manual',
    })).toBe(true);
    expect(matchesTransactionFilters(imported, {
      ...getShowAllTransactionFilters(),
      sourceScope: 'manual',
    })).toBe(false);
    expect(matchesTransactionFilters(imported, {
      ...getShowAllTransactionFilters(),
      sourceScope: 'imported',
    })).toBe(true);
    expect(matchesTransactionFilters(imported, {
      ...getShowAllTransactionFilters(),
      sourceScope: 'credit_card',
    }, {
      isCreditCardAccount: (accountId) => accountId === 'card-account',
    })).toBe(true);
  });

  it('Mostrar todo o histórico remove todos os filtros restritivos', () => {
    expect(getShowAllTransactionFilters()).toMatchObject({
      text: '',
      startDate: '',
      endDate: '',
      category: [],
      type: '',
      accountId: [],
      ownerUserId: '',
      sourceScope: 'all',
      viewScope: 'all',
      periodPreset: 'all',
    });
  });

  it('usa armazenamento separado para a experiência inteligente', () => {
    expect(SMART_TRANSACTION_FILTERS_STORAGE_KEY).not.toBe(TRANSACTION_FILTERS_STORAGE_KEY);
    expect(SMART_TRANSACTION_FILTERS_STORAGE_KEY).toContain('v2');
  });

  it('filtra uma conta com mais de 3 mil transações sem modificar a coleção original', () => {
    const transactions = Array.from({ length: 3500 }, (_, index) => ({
      Data: `2026-07-${String((index % 31) + 1).padStart(2, '0')}`,
      Nome_Fantasia: `Cliente ${index}`,
      Descricao_Original: `Pagamento de transporte ${index}`,
      Valor: -(index + 0.99),
      Tipo: 'Despesa',
      Categoria: index % 2 === 0 ? 'Transporte' : 'Operacional',
      Origem: `lote-${index % 8}.csv`,
      Fonte: 'Importação',
      ID_Conta: 'conta-volume',
    })) as Transaction[];
    const snapshot = JSON.stringify(transactions);

    const visible = transactions.filter((transaction) => matchesTransactionFilters(
      transaction,
      {
        ...getShowAllTransactionFilters(),
        text: 'cliente 3499 lote-3',
        sourceScope: 'imported',
      },
      { getAccountName: () => 'Conta com 3 mil registros' }
    ));

    expect(visible).toHaveLength(1);
    expect(visible[0].Nome_Fantasia).toBe('Cliente 3499');
    expect(JSON.stringify(transactions)).toBe(snapshot);
  });
});
