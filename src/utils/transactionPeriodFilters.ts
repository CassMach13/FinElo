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
  viewScope: TransactionViewScope;
  periodPreset: TransactionPeriodPreset;
}

export const TRANSACTION_FILTERS_STORAGE_KEY = 'finelo_transaction_filters_v1';
export const TRANSACTION_FILTERS_PANEL_EXPANDED_KEY = 'finelo_transactions_filters_expanded';

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
    viewScope: 'operation',
    periodPreset: 'current_month',
  };
}

/** Reaplica intervalos dinâmicos (ex.: «este mês» sempre no mês corrente). */
export function resolveTransactionFilters(
  partial?: Partial<TransactionFiltersState> | null
): TransactionFiltersState {
  const merged: TransactionFiltersState = {
    ...getDefaultTransactionFilters(),
    ...partial,
    ownerUserId: partial?.ownerUserId ?? getDefaultTransactionFilters().ownerUserId,
  };

  if (merged.viewScope === 'all' || merged.periodPreset === 'all') {
    return {
      ...merged,
      viewScope: 'all',
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

export function loadPersistedTransactionFilters(): Partial<TransactionFiltersState> | null {
  try {
    const raw = localStorage.getItem(TRANSACTION_FILTERS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TransactionFiltersState>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function savePersistedTransactionFilters(filters: TransactionFiltersState): void {
  try {
    localStorage.setItem(TRANSACTION_FILTERS_STORAGE_KEY, JSON.stringify(filters));
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

export function matchesTransactionFilters(
  transaction: Transaction,
  filters: TransactionFiltersState,
  options?: {
    getTransactionOwnerId?: (tx: Transaction) => string | undefined;
    skipOwnerFilter?: boolean;
  }
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

  const searchQuery = filters.text.trim().toLowerCase();
  const matchesText =
    searchQuery === '' ||
    (transaction.Nome_Fantasia || '').toLowerCase().includes(searchQuery) ||
    (transaction.Descricao_Original || '').toLowerCase().includes(searchQuery) ||
    transaction.Valor.toString().includes(filters.text) ||
    transaction.Valor.toFixed(2).includes(filters.text) ||
    transaction.Valor.toString().replace('.', ',').includes(filters.text) ||
    transaction.Valor.toFixed(2).replace('.', ',').includes(filters.text);

  const matchesDate =
    !applyDateFilter ||
    (Boolean(transactionDate) &&
      (!startDate || transactionDate >= startDate) &&
      (!endDate || transactionDate <= endDate));

  const matchesOwner =
    options?.skipOwnerFilter ||
    !filters.ownerUserId ||
    options?.getTransactionOwnerId?.(transaction) === filters.ownerUserId;

  return (
    matchesText &&
    matchesDate &&
    matchesOwner &&
    (filters.category.length === 0 || filters.category.includes(transaction.Categoria)) &&
    (filters.accountId.length === 0 ||
      (transaction.ID_Conta && filters.accountId.includes(transaction.ID_Conta))) &&
    (filters.type === '' || transaction.Tipo === filters.type)
  );
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
