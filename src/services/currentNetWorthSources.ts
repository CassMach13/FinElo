import type { Account, Asset, ImportLog, Transaction } from '../types';
import { supabase } from '../supabaseClient';
import { collectPaginatedRows } from '../utils/paginatedFetch';
import { readCurrentCardEconomicInputs } from './currentCardEconomicInputs';
import { investmentService } from './investmentService';
import { summarizeOwnerInvestments } from '../domain/investments/ownerInvestmentTotals';

export interface CurrentNetWorthRequest {
  sessionUserId: string;
  scopeKey: string;
  asOf: string;
  accounts: readonly Account[];
  ownerIds: readonly string[];
}
async function readRows<T>(table: string, filter?: { column: string; ids: readonly string[] }, order = 'id'): Promise<T[]> {
  if (filter && !filter.ids.length) return [];
  return collectPaginatedRows<T>(async (from, to) => {
    let query = supabase.from(table).select(table === 'import_logs' ? 'id, user_id, file_name, import_date, imported_details' : '*');
    if (filter) query = query.in(filter.column, [...filter.ids]);
    query = table === 'import_logs'
      ? query.order('import_date', { ascending: false }).order('id', { ascending: false })
      : query.order(order, { ascending: true });
    const { data, error } = await query.range(from, to);
    return { data: data as T[] | null, error };
  });
}
/** An all-or-nothing read snapshot. No fetchAllData, motor sync, migrations or persistence calls. */
export async function readCurrentNetWorthSources(request: CurrentNetWorthRequest) {
  const ids = [...new Set(request.accounts.map((a) => a.id))];
  const hasCards = request.accounts.some((a) => a.Tipo_Conta === 'Cartão de Crédito');
  const [accounts, transactions, assets, importLogs, cardInputs, positions] = await Promise.all([
    readRows<Account>('contas', { column: 'id', ids }),
    readRows<Transaction>('transactions', { column: 'ID_Conta', ids }, 'ID_Transacao'),
    readRows<Asset>('assets', { column: 'user_id', ids: request.ownerIds }),
    hasCards ? readRows<ImportLog>('import_logs') : Promise.resolve([] as ImportLog[]),
    readCurrentCardEconomicInputs(request.accounts),
    investmentService.getLatestPositionsByOwner(new Date(request.asOf + 'T12:00:00Z'), request.ownerIds),
  ]);
  // A revoked/moved account must not quietly become zero in the old owner's scope.
  const actual = new Map(accounts.map((a) => [a.id, a]));
  if (actual.size !== ids.length || request.accounts.some((a) => actual.get(a.id)?.user_id !== a.user_id || actual.get(a.id)?.Tipo_Conta !== a.Tipo_Conta)) {
    throw new Error('Account scope changed during the current-position read.');
  }
  if (request.ownerIds.some((id) => !positions.some((p) => p.ownerUserId === id))
    || positions.some((p) => p.monthKey && p.balances.some((n) => n == null || !Number.isFinite(Number(n))))) {
    throw new Error('Incomplete investment position sources.');
  }
  const investmentSummary = summarizeOwnerInvestments(positions);
  return { accounts, transactions, assets, importLogs, cardInputs,
    investmentsCents: investmentSummary.totalCents, investmentSummary };
}
export type CurrentNetWorthSources = Awaited<ReturnType<typeof readCurrentNetWorthSources>>;
export interface CurrentNetWorthLoadState {
  request: CurrentNetWorthRequest | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  sources: CurrentNetWorthSources | null;
}
export const CURRENT_NET_WORTH_IDLE: CurrentNetWorthLoadState = { request: null, status: 'idle', sources: null };
export function currentNetWorthStateFor(state: CurrentNetWorthLoadState, request: CurrentNetWorthRequest | null): CurrentNetWorthLoadState {
  if (!request) return CURRENT_NET_WORTH_IDLE;
  return state.request === request ? state : { request, status: 'loading', sources: null };
}
export function createCurrentNetWorthLoader(
  read: (request: CurrentNetWorthRequest) => Promise<CurrentNetWorthSources>,
  publish: (state: CurrentNetWorthLoadState) => void
) {
  let generation = 0;
  return {
    invalidate: () => { generation++; },
    async load(request: CurrentNetWorthRequest) {
      const id = ++generation;
      publish({ request, status: 'loading', sources: null });
      try {
        const sources = await read(request);
        if (id === generation) publish({ request, status: 'ready', sources });
      } catch {
        if (id === generation) publish({ request, status: 'error', sources: null });
      }
    },
  };
}
