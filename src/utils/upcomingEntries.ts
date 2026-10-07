import type { Account, Category, Transaction } from '../types';
import { classifyTransaction, isUpcomingEligibleTransaction } from '../domain/economics/transactionSemantics';
import { buildCategorySets, getTransactionEffectiveDate } from './dashboardMetrics';
import { addDaysToDateOnly, localTodayIso, toDateOnlyIso } from './dateOnly';
import {
  SMART_TRANSACTION_FILTERS_STORAGE_KEY,
  TRANSACTION_FILTERS_STORAGE_KEY,
  getDefaultTransactionFilters,
  resolveTransactionFilters,
  savePersistedTransactionFilters,
  type TransactionFiltersState,
} from './transactionPeriodFilters';

/**
 * Próximos lançamentos: o que JÁ está registrado com data efetiva depois de hoje.
 *
 * Não é previsão de saldo. Data efetiva = `Data_Pagamento || Data` (a mesma da Dashboard e do
 * filtro "Pagamento" de Transações); "hoje" não entra, porque o saldo das contas já trata
 * `data <= hoje` como realizado. Sem heurística: as exclusões usam só o que o modelo prova
 * (demo, categoria Ambos/investimento, Renda em conta de cartão, marcador do fluxo Pagar).
 */

export const UPCOMING_HORIZONS = [30, 60, 90] as const;
export type UpcomingHorizon = (typeof UPCOMING_HORIZONS)[number];
export const DEFAULT_UPCOMING_HORIZON: UpcomingHorizon = 30;

export interface UpcomingEntry {
  kind: 'entry';
  id: string;
  effectiveDate: string;
  transactionType: 'Renda' | 'Despesa';
  description: string;
  category: string;
  accountName: string | null;
  /** Valor absoluto. */
  amount: number;
  installment: { current: number; total: number } | null;
}

export interface UpcomingCardGroup {
  kind: 'credit_card_group';
  key: string;
  accountId: string;
  accountName: string;
  effectiveDate: string;
  amount: number;
  count: number;
  entries: UpcomingEntry[];
}

export type UpcomingItem = UpcomingEntry | UpcomingCardGroup;

export interface UpcomingEntries {
  horizonDays: number;
  /** Amanhã (primeiro dia incluído). */
  startDate: string;
  /** Último dia incluído. */
  endDate: string;
  incomeTotal: number;
  expenseTotal: number;
  items: UpcomingItem[];
  /** Itens da lista principal (um grupo de cartão = 1). */
  totalItemCount: number;
  /** Lançamentos individuais, contando os dentro de grupos. */
  entryCount: number;
}

const isPositiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const entrySortKey = (e: UpcomingEntry): [string, string, string] => [e.effectiveDate, e.description, e.id];

function compareEntries(a: UpcomingEntry, b: UpcomingEntry): number {
  const ka = entrySortKey(a);
  const kb = entrySortKey(b);
  return cmp(ka[0], kb[0]) || cmp(ka[1], kb[1]) || cmp(ka[2], kb[2]);
}

function compareItems(a: UpcomingItem, b: UpcomingItem): number {
  if (a.effectiveDate !== b.effectiveDate) return cmp(a.effectiveDate, b.effectiveDate);
  if (a.kind !== b.kind) return a.kind === 'entry' ? -1 : 1;
  if (a.kind === 'entry' && b.kind === 'entry') return compareEntries(a, b);
  const ga = a as UpcomingCardGroup;
  const gb = b as UpcomingCardGroup;
  return cmp(ga.accountName, gb.accountName) || cmp(ga.key, gb.key);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeUpcomingEntries(input: {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  /** Data civil de hoje; injetável. */
  today?: Date | string;
  horizonDays?: number;
}): UpcomingEntries {
  const todayIso = typeof input.today === 'string' ? toDateOnlyIso(input.today) : localTodayIso(input.today);
  const horizonDays = input.horizonDays ?? DEFAULT_UPCOMING_HORIZON;
  const startDate = addDaysToDateOnly(todayIso, 1);
  const endDate = addDaysToDateOnly(todayIso, horizonDays);

  const empty: UpcomingEntries = {
    horizonDays,
    startDate,
    endDate,
    incomeTotal: 0,
    expenseTotal: 0,
    items: [],
    totalItemCount: 0,
    entryCount: 0,
  };
  if (!todayIso || !startDate || !endDate) return empty;

  const categorySets = buildCategorySets(input.categories);
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));

  const singles: UpcomingEntry[] = [];
  const groups = new Map<string, UpcomingCardGroup>();
  let incomeTotal = 0;
  let expenseTotal = 0;
  let entryCount = 0;

  for (const t of input.transactions) {
    if (!isUpcomingEligibleTransaction(classifyTransaction(t, { categorySets, accountById }))) continue;

    const date = getTransactionEffectiveDate(t);
    if (Number.isNaN(date.getTime())) continue;
    const effectiveDate = toDateOnlyIso(date);
    if (!effectiveDate || effectiveDate <= todayIso || effectiveDate > endDate) continue;

    const account = t.ID_Conta ? accountById.get(t.ID_Conta) : undefined;
    const isCard = account?.Tipo_Conta === 'Cartão de Crédito';

    const entry: UpcomingEntry = {
      kind: 'entry',
      id: String(t.ID_Transacao ?? `${effectiveDate}|${t.Nome_Fantasia}|${t.Valor}`),
      effectiveDate,
      transactionType: t.Tipo,
      description: String(t.Nome_Fantasia || t.Descricao_Original || '').trim(),
      category: String(t.Categoria ?? ''),
      accountName: account?.Nome_Conta ?? null,
      amount: Math.abs(t.Valor),
      installment:
        isPositiveInt(t.Parcela_Atual) && isPositiveInt(t.Total_Parcelas)
          ? { current: t.Parcela_Atual, total: t.Total_Parcelas }
          : null,
    };

    entryCount += 1;
    if (t.Tipo === 'Renda') incomeTotal += entry.amount;
    else expenseTotal += entry.amount;

    if (isCard && account) {
      const key = `${account.id}|${effectiveDate}`;
      const group =
        groups.get(key) ??
        ({
          kind: 'credit_card_group',
          key,
          accountId: account.id,
          accountName: account.Nome_Conta,
          effectiveDate,
          amount: 0,
          count: 0,
          entries: [],
        } as UpcomingCardGroup);
      group.entries.push(entry);
      group.count += 1;
      group.amount += entry.amount;
      groups.set(key, group);
    } else {
      singles.push(entry);
    }
  }

  const cardGroups = [...groups.values()].map((g) => ({
    ...g,
    amount: round2(g.amount),
    entries: [...g.entries].sort(compareEntries),
  }));
  const items = [...singles, ...cardGroups].sort(compareItems);

  return {
    ...empty,
    incomeTotal: round2(incomeTotal),
    expenseTotal: round2(expenseTotal),
    items,
    totalItemCount: items.length,
    entryCount,
  };
}

/** Filtros de Transações que reproduzem exatamente o horizonte da Agenda. */
export function buildUpcomingTransactionFilters(range: { startDate: string; endDate: string }): TransactionFiltersState {
  return resolveTransactionFilters({
    ...getDefaultTransactionFilters(),
    viewScope: 'operation',
    periodPreset: 'custom',
    dateField: 'Pagamento',
    startDate: range.startDate,
    endDate: range.endDate,
    text: '',
    category: [],
    type: '',
    accountId: [],
    ownerUserId: '',
    sourceScope: 'all',
  });
}

/**
 * Persiste os filtros na chave que a tela Transações vai ler (v2 com filtros inteligentes, v1
 * sem) e só então navega. Nada de query string nem estado novo.
 */
export function openUpcomingInTransactions(args: {
  range: { startDate: string; endDate: string };
  smartFiltersEnabled: boolean;
  navigate: (view: 'transactions') => void;
}): void {
  const key = args.smartFiltersEnabled ? SMART_TRANSACTION_FILTERS_STORAGE_KEY : TRANSACTION_FILTERS_STORAGE_KEY;
  savePersistedTransactionFilters(buildUpcomingTransactionFilters(args.range), key);
  args.navigate('transactions');
}
