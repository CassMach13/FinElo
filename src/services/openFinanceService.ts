import { supabase } from '../supabaseClient';
import { useAppStore } from '../hooks/useAppStore';
import { PluggyTransactionDraft, PluggyConnection } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Token (Belvo Widget)
// ─────────────────────────────────────────────────────────────────────────────

export async function getBelvoWidgetToken(): Promise<string> {
  const res = await fetch('/api/belvo-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Falha ao obter token Belvo');
  return data.accessToken;
}

// Mantido por compatibilidade (caso alguma parte do código ainda use)
export async function getPluggyConnectToken(_itemId?: string, _options?: any): Promise<string> {
  return getBelvoWidgetToken();
}

// ─────────────────────────────────────────────────────────────────────────────
// Connections (salvas na tabela pluggy_connections — reutilizando estrutura)
// item_id agora armazena o linkId do Belvo
// ─────────────────────────────────────────────────────────────────────────────

export async function savePluggyConnection(userId: string, linkId: string, bankName: string = 'Open Finance Bank') {
  // Verifica se o link já está salvo para evitar duplicatas
  const { data: existing } = await supabase
    .from('pluggy_connections')
    .select('id')
    .eq('user_id', userId)
    .eq('item_id', linkId)
    .maybeSingle();

  if (existing) return true; // já salvo

  const { error } = await supabase
    .from('pluggy_connections')
    .insert([{
      user_id: userId,
      item_id: linkId,   // item_id agora armazena o link UUID do Belvo
      bank_name: bankName,
      status: 'active',
      provider: 'belvo', // campo extra para identificar o provedor
    }]);
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
// Smart Category Suggestion (sem mudanças — lógica reutilizável)
// ─────────────────────────────────────────────────────────────────────────────

function detectType(pTx: any): 'Despesa' | 'Renda' {
  // 1. Belvo: type === 'OUTFLOW' | 'INFLOW'
  if (pTx.type === 'OUTFLOW') return 'Despesa';
  if (pTx.type === 'INFLOW') return 'Renda';

  // 2. Open Finance Brazil spec
  if (pTx.creditDebitType) {
    return pTx.creditDebitType.toUpperCase() === 'DEBITO' ? 'Despesa' : 'Renda';
  }
  // 3. Pluggy legado: DEBIT/CREDIT
  if (pTx.type === 'DEBIT') return 'Despesa';
  if (pTx.type === 'CREDIT') return 'Renda';

  // 4. Fallback: sinal do valor
  return pTx.amount < 0 ? 'Despesa' : 'Renda';
}

function suggestCategory(
  description: string,
  tipo: 'Despesa' | 'Renda',
  belvoCategory?: string | null
): { categoria: string; confianca: 'alta' | 'media' | 'nova' } {
  const store = useAppStore.getState();
  const descUpper = description.toUpperCase();

  // 1. Regras de mapeamento do usuário (maior prioridade)
  const matchingRule = store.mappingRules?.find(rule => {
    const keyword = (rule.Texto_Contido_Descricao || '').toUpperCase();
    return keyword && descUpper.includes(keyword);
  });
  if (matchingRule?.Categoria_Sugerida) {
    return { categoria: matchingRule.Categoria_Sugerida, confianca: 'alta' };
  }

  // 2. Belvo já categoriza automaticamente — usar como sugestão de média confiança
  if (belvoCategory) {
    const categoryMap: Record<string, string> = {
      'FOOD_AND_DRINK': 'Alimentação',
      'TRANSPORT': 'Transporte',
      'HOUSING': 'Moradia',
      'HEALTH': 'Saúde',
      'ENTERTAINMENT': 'Lazer',
      'EDUCATION': 'Educação',
      'SHOPPING': 'Compras',
      'PERSONAL_FINANCE': 'Finanças',
      'INCOME': 'Renda',
      'TRANSFERS': 'Transferências',
    };
    const mapped = categoryMap[belvoCategory];
    if (mapped) return { categoria: mapped, confianca: 'media' };
  }

  // 3. Histórico de transações
  const historicalMatch = store.transactions.find(t =>
    t.Tipo === tipo &&
    t.Descricao_Original?.toUpperCase().includes(descUpper.split(' ')[0])
  );
  if (historicalMatch?.Categoria) {
    return { categoria: historicalMatch.Categoria, confianca: 'media' };
  }

  // 4. Sem match
  return { categoria: tipo === 'Renda' ? 'Renda' : 'Outros', confianca: 'nova' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch for Review (Belvo — não salva nada)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca transações do Belvo para o link informado e retorna como drafts enriquecidos.
 * Nada é salvo — o usuário deve confirmar via modal de revisão.
 * linkId = item_id na tabela pluggy_connections (compatível)
 */
export async function fetchTransactionsForReview(
  linkId: string,
  fromDate: string,
  toDate: string
): Promise<PluggyTransactionDraft[]> {
  const res = await fetch('/api/belvo-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ linkId, fromDate, toDate }),
  });
  const data = await res.json();
  if (!res.ok) {
    // Propaga o erro específico do backend (ex: conexao_pluggy_legada)
    throw new Error(data.error || data.message || 'Falha ao buscar dados Belvo');
  }

  const { transactions: belvoTxs } = data;
  const store = useAppStore.getState();
  const existingTxIds = new Set(
    store.transactions.map(t => (t as any).pluggy_transaction_id).filter(Boolean)
  );

  const drafts: PluggyTransactionDraft[] = [];

  for (const tx of (belvoTxs as any[])) {
    // Pula transações já importadas
    if (existingTxIds.has(tx.id)) continue;

    const tipo = detectType(tx);
    const valor = Math.abs(tx.amount);
    const dateStr: string = typeof tx.date === 'string' ? tx.date.split('T')[0] : tx.date;
    const descricao: string = tx.description || tx.reference || 'Sem descrição';

    const { categoria, confianca } = suggestCategory(descricao, tipo, tx.category);

    // Deduplicação com transações manuais
    const pDate = new Date(`${dateStr}T00:00:00`);
    const manualMatch = store.transactions.find(eTx => {
      if ((eTx as any).pluggy_transaction_id) return false;
      const eDate = new Date(`${eTx.Data}`);
      const diffDays = Math.ceil(Math.abs(eDate.getTime() - pDate.getTime()) / 86400000);
      return eTx.Valor === valor && eTx.Tipo === tipo && diffDays <= 3;
    });

    drafts.push({
      pluggy_id: tx.id,   // reutiliza o campo pluggy_id para o ID do Belvo
      data: dateStr,
      descricao,
      valor,
      tipo,
      categoria,
      confianca,
      selecionada: true,
      id_match_manual: manualMatch?.ID_Transacao,
    });
  }

  return drafts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirm Reviewed Transactions (sem mudanças — lógica 100% reutilizável)
// ─────────────────────────────────────────────────────────────────────────────

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
      await store.updateTransaction({
        ID_Transacao: draft.id_match_manual,
        pluggy_transaction_id: draft.pluggy_id,
        Categoria: draft.categoria,
      } as any);
      merged++;
    } else {
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

    // Aprende: cria regra de mapeamento se não existia
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
          // não critico — não falha o import inteiro
        }
      }
    }
  }

  return { inserted, merged };
}
