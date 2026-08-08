import type { Transaction } from '../types';
import { parseDateOnlyLocal, toDateOnlyIso } from './dateOnly';

export type TransactionPeriodPreset =
  | 'current_month'
  | 'previous_month'
  | 'last_30_days'
  | 'all'
  | 'custom';

export type TransactionViewScope = 'operation' | 'commitments' | 'all';

export type TransactionDateField = 'Data' | 'Pagamento';

export type TransactionSourceScope = 'all' | 'manual' | 'imported' | 'credit_card';

export interface TransactionFiltersState {
  text: string;
  startDate: string;
  endDate: string;
  dateField: TransactionDateField;
  category: string[];
  type: string;
  accountId: string[];
  /** user_id do responsável; vazio = todos (plano família). */
  ownerUserId: string;
  sourceScope: TransactionSourceScope;
  viewScope: TransactionViewScope;
  periodPreset: TransactionPeriodPreset;
}

export const TRANSACTION_FILTERS_STORAGE_KEY = 'finelo_transaction_filters_v1';
export const SMART_TRANSACTION_FILTERS_STORAGE_KEY = 'finelo_transaction_filters_v2';
export const TRANSACTION_FILTERS_PANEL_EXPANDED_KEY = 'finelo_transactions_filters_expanded';
export const UNASSIGNED_ACCOUNT_FILTER_ID = '__finelo_unassigned_account__';

const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';

/** Painel de filtros aberto por padrão no desktop; no celular, fechado na primeira visita. */
export function loadTransactionFiltersPanelExpanded(): boolean {
  try {
    const saved = localStorage.getItem(TRANSACTION_FILTERS_PANEL_EXPANDED_KEY);
    if (saved === 'true') return true;
    if (saved === 'false') return false;
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
  }
  return false;
}

export function saveTransactionFiltersPanelExpanded(expanded: boolean): void {
  try {
    localStorage.setItem(TRANSACTION_FILTERS_PANEL_EXPANDED_KEY, expanded ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

export const VIEW_SCOPE_LABELS: Record<TransactionViewScope, string> = {
  operation: 'Tudo do período',
  commitments: 'Parcelas e recorrências',
  all: 'Histórico completo',
};

/** Texto de ajuda exibido abaixo dos chips de visualização. */
export const VIEW_SCOPE_HINTS: Record<TransactionViewScope, string> = {
  operation:
    'Todos os lançamentos do período escolhido — compras à vista, pagamentos e parcelas.',
  commitments:
    'Somente parcelamentos e recorrências (ex.: financiamento 3/36 ou compra em várias vezes).',
  all: 'Todas as transações, sem limite de período.',
};

/** Uma linha para o cabeçalho do painel de filtros colapsado. */
export function buildTransactionFiltersCollapsedSummary(
  filters: TransactionFiltersState
): string {
  const parts: string[] = [
    VIEW_SCOPE_LABELS[filters.viewScope],
    formatPeriodLabel(filters),
    filters.dateField === 'Data' ? 'Compra' : 'Pagamento',
  ];
  if (filters.text.trim()) parts.push('Busca');
  if (filters.accountId.length > 0) {
    parts.push(filters.accountId.length === 1 ? '1 conta' : `${filters.accountId.length} contas`);
  }
  if (filters.category.length > 0) {
    parts.push(filters.category.length === 1 ? '1 categoria' : `${filters.category.length} categorias`);
  }
  if (filters.type) parts.push(filters.type === 'Renda' ? 'Entradas' : 'Saídas');
  if (filters.ownerUserId) parts.push('1 pessoa');
  if (filters.sourceScope === 'manual') parts.push('Manuais');
  if (filters.sourceScope === 'imported') parts.push('Importadas');
  if (filters.sourceScope === 'credit_card') parts.push('Cartão');
  return parts.join(' · ');
}

export function toLocalDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getPeriodRange(
  preset: Exclude<TransactionPeriodPreset, 'custom' | 'all'>
): { startDate: string; endDate: string } {
  const now = new Date();

  if (preset === 'current_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { startDate: toLocalDateInput(start), endDate: toLocalDateInput(end) };
  }

  if (preset === 'previous_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { startDate: toLocalDateInput(start), endDate: toLocalDateInput(end) };
  }

  const start = new Date(now);
  start.setDate(start.getDate() - 29);
  return { startDate: toLocalDateInput(start), endDate: toLocalDateInput(now) };
}

export function getDefaultTransactionFilters(): TransactionFiltersState {
  const { startDate, endDate } = getPeriodRange('current_month');
  return {
    text: '',
    startDate,
    endDate,
    dateField: 'Data',
    category: [],
    type: '',
    accountId: [],
    ownerUserId: '',
    sourceScope: 'all',
    viewScope: 'operation',
    periodPreset: 'current_month',
  };
}

/** Reaplica intervalos dinâmicos (ex.: «este mês» sempre no mês corrente). */
export function resolveTransactionFilters(
  partial?: Partial<TransactionFiltersState> | null
): TransactionFiltersState {
  const validSourceScopes: TransactionSourceScope[] = ['all', 'manual', 'imported', 'credit_card'];
  const sourceScope = validSourceScopes.includes(partial?.sourceScope as TransactionSourceScope)
    ? (partial?.sourceScope as TransactionSourceScope)
    : 'all';
  const merged: TransactionFiltersState = {
    ...getDefaultTransactionFilters(),
    ...partial,
    ownerUserId: partial?.ownerUserId ?? getDefaultTransactionFilters().ownerUserId,
    sourceScope,
  };

  if (merged.viewScope === 'all') {
    return {
      ...merged,
      viewScope: 'all',
      periodPreset: 'all',
      startDate: '',
      endDate: '',
    };
  }

  if (merged.periodPreset === 'all') {
    return {
      ...merged,
      periodPreset: 'all',
      startDate: '',
      endDate: '',
    };
  }

  if (merged.periodPreset !== 'custom') {
    const range = getPeriodRange(merged.periodPreset);
    return { ...merged, ...range };
  }

  return merged;
}

export function loadPersistedTransactionFilters(
  storageKey = TRANSACTION_FILTERS_STORAGE_KEY
): Partial<TransactionFiltersState> | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TransactionFiltersState>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function savePersistedTransactionFilters(
  filters: TransactionFiltersState,
  storageKey = TRANSACTION_FILTERS_STORAGE_KEY
): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(filters));
  } catch {
    /* quota / private mode */
  }
}

export function getTransactionFilterDate(
  transaction: Transaction,
  dateField: TransactionDateField
): Date {
  const source =
    dateField === 'Pagamento'
      ? transaction.Data_Pagamento || transaction.Data
      : transaction.Data;
  return parseDateOnlyLocal(source) ?? new Date(Number.NaN);
}

/** Parcelas, financiamentos e recorrências explícitas no lançamento. */
export function isCommitmentTransaction(transaction: Transaction): boolean {
  const total = transaction.Total_Parcelas;
  const current = transaction.Parcela_Atual;
  if (total != null && total > 1) return true;
  if (current != null && current > 0) return true;
  return /\(\d+\s*\/\s*\d+\)/.test(transaction.Nome_Fantasia || '');
}

export function shouldApplyDateFilter(filters: TransactionFiltersState): boolean {
  return (
    filters.viewScope !== 'all' &&
    filters.periodPreset !== 'all' &&
    Boolean(filters.startDate || filters.endDate)
  );
}

const normalizeSearchText = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const isManualTransaction = (transaction: Transaction): boolean =>
  normalizeSearchText(transaction.Origem || 'manual') === 'manual';

export interface TransactionFilterMatchOptions {
  getTransactionOwnerId?: (tx: Transaction) => string | undefined;
  getAccountName?: (accountId: string | undefined) => string | undefined;
  isCreditCardAccount?: (accountId: string | undefined) => boolean;
  skipOwnerFilter?: boolean;
}

export function matchesTransactionFilters(
  transaction: Transaction,
  filters: TransactionFiltersState,
  options?: TransactionFilterMatchOptions
): boolean {
  if (filters.viewScope === 'commitments' && !isCommitmentTransaction(transaction)) {
    return false;
  }

  const applyDateFilter = shouldApplyDateFilter(filters);
  const startDate = toDateOnlyIso(filters.startDate) || null;
  const endDate = toDateOnlyIso(filters.endDate) || null;
  const transactionDate = toDateOnlyIso(
    filters.dateField === 'Pagamento'
      ? transaction.Data_Pagamento || transaction.Data
      : transaction.Data
  );

  const searchTokens = normalizeSearchText(filters.text).split(' ').filter(Boolean);
  const valueText = Number.isFinite(transaction.Valor)
    ? [
        transaction.Valor.toString(),
        transaction.Valor.toFixed(2),
        transaction.Valor.toString().replace('.', ','),
        transaction.Valor.toFixed(2).replace('.', ','),
      ].join(' ')
    : '';
  const searchHaystack = normalizeSearchText([
    transaction.Nome_Fantasia,
    transaction.Descricao_Original,
    transaction.Categoria,
    transaction.Tipo,
    transaction.Fonte,
    transaction.Origem,
    transaction.Data,
    transaction.Data_Pagamento,
    options?.getAccountName?.(transaction.ID_Conta),
    valueText,
  ].join(' '));
  const matchesText = searchTokens.every((token) => searchHaystack.includes(token));

  const matchesDate =
    !applyDateFilter ||
    (Boolean(transactionDate) &&
      (!startDate || transactionDate >= startDate) &&
      (!endDate || transactionDate <= endDate));

  const matchesOwner =
    options?.skipOwnerFilter ||
    !filters.ownerUserId ||
    options?.getTransactionOwnerId?.(transaction) === filters.ownerUserId;
  const matchesAccount =
    filters.accountId.length === 0 ||
    (transaction.ID_Conta
      ? filters.accountId.includes(transaction.ID_Conta)
      : filters.accountId.includes(UNASSIGNED_ACCOUNT_FILTER_ID));
  // Compatibilidade com chamadas e estados v1 que ainda não possuem sourceScope.
  const sourceScope = filters.sourceScope ?? 'all';
  const matchesSource =
    sourceScope === 'all' ||
    (sourceScope === 'manual' && isManualTransaction(transaction)) ||
    (sourceScope === 'imported' && !isManualTransaction(transaction)) ||
    (sourceScope === 'credit_card' &&
      Boolean(options?.isCreditCardAccount?.(transaction.ID_Conta)));

  return (
    matchesText &&
    matchesDate &&
    matchesOwner &&
    matchesSource &&
    (filters.category.length === 0 || filters.category.includes(transaction.Categoria)) &&
    matchesAccount &&
    (filters.type === '' || transaction.Tipo === filters.type)
  );
}

/** Exibe todos os dados e remove filtros auxiliares sem alterar qualquer transação. */
export function getShowAllTransactionFilters(): TransactionFiltersState {
  return {
    ...getDefaultTransactionFilters(),
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
  };
}

export function formatPeriodLabel(filters: TransactionFiltersState): string {
  if (filters.viewScope === 'all' || filters.periodPreset === 'all') {
    return 'Todo o histórico';
  }
  if (!filters.startDate && !filters.endDate) return 'Sem período';
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return d && m && y ? `${d}/${m}/${y}` : iso;
  };
  if (filters.startDate && filters.endDate) {
    return `${fmt(filters.startDate)} — ${fmt(filters.endDate)}`;
  }
  return filters.startDate ? `A partir de ${fmt(filters.startDate)}` : `Até ${fmt(filters.endDate)}`;
}
