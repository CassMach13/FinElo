import { supabase } from '../supabaseClient';
import { useAppStore } from '../hooks/useAppStore';
import { PluggyTransactionDraft, PluggyConnection } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Token
// ─────────────────────────────────────────────────────────────────────────────

export async function getPluggyConnectToken(itemId?: string, options?: any): Promise<string> {
  const res = await fetch('/api/pluggy-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, options }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch token');
  return data.accessToken;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connections
// ─────────────────────────────────────────────────────────────────────────────

export async function savePluggyConnection(userId: string, itemId: string, bankName: string = 'Open Finance Bank') {
  const { error } = await supabase
    .from('pluggy_connections')
    .insert([{ user_id: userId, item_id: itemId, bank_name: bankName, status: 'active' }]);
  if (error) throw error;
  return true;
}

export async function loadPluggyConnections(userId: string): Promise<PluggyConnection[]> {
  const { data, error } = await supabase
    .from('pluggy_connections')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PluggyConnection[];
}

export async function deletePluggyConnection(connectionId: string) {
  const { error } = await supabase
    .from('pluggy_connections')
    .delete()
    .eq('id', connectionId);
  if (error) throw error;
}

export async function updatePluggyConnectionAccount(connectionId: string, accountId: string | null) {
  const { error } = await supabase
    .from('pluggy_connections')
    .update({ ID_Conta_Associada: accountId })
    .eq('id', connectionId);
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// Smart Category Suggestion
// ─────────────────────────────────────────────────────────────────────────────

function detectType(pTx: any): 'Despesa' | 'Renda' {
  // 1. Open Finance Brazil spec field
  if (pTx.creditDebitType) {
    return pTx.creditDebitType.toUpperCase() === 'DEBITO' ? 'Despesa' : 'Renda';
  }
  // 2. Standard Pluggy field
  if (pTx.type) {
    return pTx.type.toUpperCase() === 'DEBIT' ? 'Despesa' : 'Renda';
  }
  // 3. Fallback: sign of amount
  return pTx.amount < 0 ? 'Despesa' : 'Renda';
}

/**
 * Suggests a category for an incoming transaction.
 * Priority: mappingRules keywords → transaction history → 'Outros'
 * Returns the category name and a confidence level.
 */
function suggestCategory(
  description: string,
  tipo: 'Despesa' | 'Renda'
): { categoria: string; confianca: 'alta' | 'media' | 'nova' } {
  const store = useAppStore.getState();
  const descUpper = description.toUpperCase();

  // 1. Check user's mapping rules (keyword match)
  const matchingRule = store.mappingRules?.find(rule => {
    const keyword = (rule.Texto_Contido_Descricao || '').toUpperCase();
    return keyword && descUpper.includes(keyword);
  });
  if (matchingRule?.Categoria_Sugerida) {
    return { categoria: matchingRule.Categoria_Sugerida, confianca: 'alta' };
  }

  // 2. Check transaction history for same description (learning from past)
  const historicalMatch = store.transactions.find(t =>
    t.Tipo === tipo &&
    t.Descricao_Original?.toUpperCase().includes(descUpper.split(' ')[0])
  );
  if (historicalMatch?.Categoria) {
    return { categoria: historicalMatch.Categoria, confianca: 'media' };
  }

  // 3. No match found — needs user input
  return { categoria: tipo === 'Renda' ? 'Renda' : 'Outros', confianca: 'nova' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch for Review (does NOT save anything)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches transactions from Pluggy for the specified date range
 * and returns them as PluggyTransactionDraft[] enriched with category suggestions.
 * Nothing is saved to the database — the user must confirm via the review modal.
 */
export async function fetchTransactionsForReview(
  itemId: string,
  fromDate: string,
  toDate: string
): Promise<PluggyTransactionDraft[]> {
  const res = await fetch('/api/pluggy-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, fromDate, toDate }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch Pluggy data');

  const { transactions: pluggyTxs } = data;
  const store = useAppStore.getState();
  const existingTxIds = new Set(
    store.transactions.map(t => (t as any).pluggy_transaction_id).filter(Boolean)
  );

  const drafts: PluggyTransactionDraft[] = [];

  for (const pTx of (pluggyTxs as any[])) {
    // Skip already imported
    if (existingTxIds.has(pTx.id)) continue;

    const tipo = detectType(pTx);
    const valor = Math.abs(pTx.amount);
    const dateStr: string = typeof pTx.date === 'string' ? pTx.date.split('T')[0] : pTx.date;
    const descricao: string = pTx.description || pTx.name || 'Sem descrição';

    const { categoria, confianca } = suggestCategory(descricao, tipo);

    // Check for potential manual match (for deduplication display)
    const pDate = new Date(`${dateStr}T00:00:00`);
    const manualMatch = store.transactions.find(eTx => {
      if ((eTx as any).pluggy_transaction_id) return false;
      const eDate = new Date(`${eTx.Data}`);
      const diffDays = Math.ceil(Math.abs(eDate.getTime() - pDate.getTime()) / 86400000);
      return eTx.Valor === valor && eTx.Tipo === tipo && diffDays <= 3;
    });

    drafts.push({
      pluggy_id: pTx.id,
      data: dateStr,
      descricao,
      valor,
      tipo,
      categoria,
      confianca,
      selecionada: true, // selected by default
      id_match_manual: manualMatch?.ID_Transacao,
    });
  }

  return drafts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirm Reviewed Transactions (this saves to DB)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Takes the user-reviewed list of drafts and saves them to the DB.
 * - Merges with matching manual transactions (adds pluggy_transaction_id)
 * - Inserts truly new ones
 * - Learns from confirmed categories by creating/updating mappingRules
 */
export async function confirmReviewedTransactions(
  userId: string,
  drafts: PluggyTransactionDraft[],
  accountId?: string | null
): Promise<{ inserted: number; merged: number }> {
  const store = useAppStore.getState();
  const selected = drafts.filter(d => d.selecionada);

  let inserted = 0;
  let merged = 0;

  for (const draft of selected) {
    if (draft.id_match_manual) {
      // MERGE: update existing manual transaction
      await store.updateTransaction({
        ID_Transacao: draft.id_match_manual,
        pluggy_transaction_id: draft.pluggy_id,
        Categoria: draft.categoria,
      } as any);
      merged++;
    } else {
      // INSERT: new transaction
      await store.addTransaction({
        user_id: userId,
        Data: draft.data,
        Data_Pagamento: draft.data,
        Descricao_Original: draft.descricao,
        Nome_Fantasia: draft.descricao,
        Categoria: draft.categoria,
        Tipo: draft.tipo,
        Valor: draft.tipo === 'Despesa' ? -Math.abs(draft.valor) : Math.abs(draft.valor),
        Parcela_Atual: 1,
        Total_Parcelas: 1,
        Fonte: 'Conta',
        ID_Conta: accountId || null,
        Origem: 'Open Finance',
        pluggy_transaction_id: draft.pluggy_id,
      } as any);
      inserted++;
    }

    // LEARN: if confidence was not 'alta', save as a new mapping rule
    if (draft.confianca !== 'alta' && draft.descricao && draft.categoria) {
      const keyword = draft.descricao.split(' ')[0].toUpperCase();
      const alreadyHasRule = store.mappingRules?.some(
        r => (r.Texto_Contido_Descricao || '').toUpperCase() === keyword && r.Categoria_Sugerida === draft.categoria
      );
      if (!alreadyHasRule && keyword.length > 3) {
        try {
          await store.addMappingRule({
            Texto_Contido_Descricao: keyword,
            Categoria_Sugerida: draft.categoria,
            Nome_Fantasia_Sugerido: draft.descricao,
          } as any);
        } catch {
          // Non-critical — don't fail the whole import if rule saving fails
        }
      }
    }
  }

  return { inserted, merged };
}
