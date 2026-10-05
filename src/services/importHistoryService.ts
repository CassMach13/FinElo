import type { SupabaseClient } from '@supabase/supabase-js';
import type { Transaction } from '../types';

export const IMPORT_BATCH_IDENTITY_MESSAGE =
  'Esta importação antiga não possui informações suficientes para que o FinElo identifique seus lançamentos com segurança. Nenhuma alteração foi realizada.';

export interface ImportBatchResult {
  updated_count?: number;
  active_transaction_ids?: string[];
  imported_details?: unknown[];
  deleted_count?: number;
  deleted_transactions?: Transaction[];
  affected_statement_ids?: string[];
}

/** O servidor valida dono e identidade antes da primeira mutação, na mesma transação. */
export async function maintainImportBatch(
  client: Pick<SupabaseClient, 'rpc'>,
  logId: string,
  action: 'reassign' | 'delete' | 'rehydrate',
  accountId?: string
): Promise<ImportBatchResult> {
  const { data, error } = action === 'reassign'
    ? await client.rpc('reassign_import_batch_atomic', { p_import_log_id: logId, p_account_id: accountId })
    : action === 'delete'
      ? await client.rpc('delete_import_batch_atomic', { p_import_log_id: logId })
      : await client.rpc('rehydrate_import_batch_atomic', { p_import_log_id: logId });
  if (error) throw new Error(error.code === 'P0001' ? IMPORT_BATCH_IDENTITY_MESSAGE : error.message);
  if (!data || typeof data !== 'object') throw new Error('O servidor não retornou a confirmação da operação.');
  return data as ImportBatchResult;
}
