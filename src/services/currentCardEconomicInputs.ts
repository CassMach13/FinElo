import type { Account } from '../types';
import { listCompetencePaymentConfirmationsReadOnly } from './competenceInvoiceUserConfirmations';
import { supabase } from '../supabaseClient';
import { collectPaginatedRows } from '../utils/paginatedFetch';
import { groupActiveCardResolutions, type ActiveCardResolutionRow } from './cardReconciliationService';
import { RESOLUTION_ROW_SELECT } from '../domain/credit-card/reconciliationRows';

export async function readCurrentCardEconomicInputs(accounts: readonly Account[]) {
  const cards = accounts.filter((a) => a.Tipo_Conta === 'Cartão de Crédito');
  const ids = [...new Set(cards.map((a) => a.id))];
  if (!ids.length) return { confirmations: [], resolutions: {} };
  const [confirmations, rows] = await Promise.all([
    listCompetencePaymentConfirmationsReadOnly(cards),
    collectPaginatedRows<ActiveCardResolutionRow>(async (from, to) => {
      const { data, error } = await supabase.from('credit_card_reconciliation_resolutions')
        .select(RESOLUTION_ROW_SELECT)
        .in('account_id', ids).order('resolved_at', { ascending: true }).order('id', { ascending: true }).range(from, to);
      return { data: data as ActiveCardResolutionRow[] | null, error };
    }),
  ]);
  return { confirmations, resolutions: groupActiveCardResolutions(rows) };
}
export type CurrentCardEconomicInputs = Awaited<ReturnType<typeof readCurrentCardEconomicInputs>>;
