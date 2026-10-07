import { supabase } from '../supabaseClient';
import type { EconomicEvent, Transaction } from '../types';
import { canMarkInternalMovement, isUserInternalMovementEvent } from '../domain/economics/manualEconomicIdentity';
import { ECONOMIC_EVENT_COLUMNS, createEconomicEvent, deleteEconomicEvent } from './economicEventService';

export type EconomicIdentityErrorCode =
  | 'not_authenticated'
  | 'not_found'
  | 'not_owner'
  | 'not_markable'
  | 'already_marked'
  | 'not_undoable'
  | 'conflict'
  | 'failed';

/** Erro de domínio previsível: a mensagem é amigável (sem Postgres, RLS nem ids). */
export class EconomicIdentityError extends Error {
  readonly code: EconomicIdentityErrorCode;

  constructor(code: EconomicIdentityErrorCode, message: string) {
    super(message);
    this.name = 'EconomicIdentityError';
    this.code = code;
  }
}

const MESSAGES: Record<EconomicIdentityErrorCode, string> = {
  not_authenticated: 'Sua sessão expirou. Entre novamente para continuar.',
  not_found: 'Não encontramos este lançamento. Atualize a tela e tente de novo.',
  not_owner: 'Só quem criou o lançamento pode alterar essa classificação.',
  not_markable: 'Este lançamento não pode ser marcado como movimentação interna.',
  already_marked: 'Este lançamento já está classificado.',
  not_undoable: 'Esta classificação não pode ser desfeita por aqui.',
  conflict: 'O lançamento foi alterado enquanto você agia. Atualize a tela e tente de novo.',
  failed: 'Não foi possível concluir. Tente novamente.',
};
const fail = (code: EconomicIdentityErrorCode) => new EconomicIdentityError(code, MESSAGES[code]);

const TX_IDENTITY_COLUMNS = 'ID_Transacao,user_id,economic_event_id,Origem,Fonte,Descricao_Original';

type IdentityRow = Pick<Transaction, 'ID_Transacao' | 'user_id' | 'economic_event_id' | 'Origem' | 'Fonte' | 'Descricao_Original'>;

async function currentUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw fail('not_authenticated');
  return user.id;
}

async function loadTransaction(transactionId: string): Promise<IdentityRow> {
  const { data, error } = await supabase.from('transactions').select(TX_IDENTITY_COLUMNS).eq('ID_Transacao', transactionId).maybeSingle();
  if (error) throw fail('failed');
  if (!data) throw fail('not_found');
  return data as IdentityRow;
}

/**
 * Marca UMA transação como movimentação interna: cria um evento own_account_transfer/user e grava o id SÓ na coluna
 * `economic_event_id` (nunca por `updateTransaction`, que descartaria o campo em lançamentos importados).
 *
 * Revalida tudo aqui (a UI e o store não bastam). O UPDATE é condicional (`economic_event_id IS NULL`, dono, id): um
 * estado concorrente nunca é sobrescrito. Se o vínculo falhar, o evento recém-criado é apagado.
 */
export async function markTransactionAsInternalMovement(
  transactionId: string
): Promise<{ event: EconomicEvent; transaction: Transaction }> {
  const userId = await currentUserId();
  const tx = await loadTransaction(transactionId);
  if (!tx.user_id || tx.user_id !== userId) throw fail('not_owner');
  if (tx.economic_event_id) throw fail('already_marked');
  if (!canMarkInternalMovement(tx, userId)) throw fail('not_markable');

  let event: EconomicEvent;
  try {
    event = await createEconomicEvent({ kind: 'own_account_transfer', source: 'user' });
  } catch {
    throw fail('failed');
  }

  const cleanup = async () => {
    try {
      await deleteEconomicEvent(event.id);
    } catch (cleanupError) {
      console.error('[EconomicIdentity] Falha ao desfazer o evento órfão:', cleanupError);
    }
  };

  const { data, error } = await supabase
    .from('transactions')
    .update({ economic_event_id: event.id })
    .eq('ID_Transacao', transactionId)
    .eq('user_id', userId)
    .is('economic_event_id', null)
    .select();

  if (error) {
    await cleanup();
    throw fail('failed');
  }
  if (!data || data.length !== 1 || (data[0] as Transaction).ID_Transacao !== transactionId) {
    await cleanup();
    throw fail('conflict');
  }
  return { event, transaction: data[0] as Transaction };
}

/** Evento do usuário (consultado no banco, não no estado local). */
async function loadOwnedEvent(eventId: string, userId: string): Promise<EconomicEvent> {
  const { data, error } = await supabase.from('economic_events').select(ECONOMIC_EVENT_COLUMNS).eq('id', eventId).maybeSingle();
  if (error) throw fail('failed');
  if (!data) throw fail('not_found');
  const event = data as EconomicEvent;
  if (event.user_id !== userId) throw fail('not_owner');
  return event;
}

async function legsOf(eventId: string): Promise<string[]> {
  const { data, error } = await supabase.from('transactions').select('ID_Transacao').eq('economic_event_id', eventId);
  if (error) throw fail('failed');
  return ((data ?? []) as Array<{ ID_Transacao: string }>).map((r) => r.ID_Transacao);
}

/**
 * Desfaz a classificação manual: só evento own_account_transfer/user, do dono, com EXATAMENTE 1 perna (a pedida,
 * confirmada no banco). Apaga o evento; a FK zera `economic_event_id` e a transação permanece.
 */
export async function unmarkTransactionInternalMovement(
  transactionId: string
): Promise<{ eventId: string; transaction: Transaction }> {
  const userId = await currentUserId();
  const tx = await loadTransaction(transactionId);
  if (!tx.user_id || tx.user_id !== userId) throw fail('not_owner');
  if (!tx.economic_event_id) throw fail('not_undoable');

  const event = await loadOwnedEvent(tx.economic_event_id, userId);
  if (!isUserInternalMovementEvent(event)) throw fail('not_undoable');

  const legs = await legsOf(event.id);
  if (legs.length !== 1 || legs[0] !== transactionId) throw fail('not_undoable');

  try {
    await deleteEconomicEvent(event.id);
  } catch {
    throw fail('failed');
  }

  // Estado autoritativo da linha (o ON DELETE SET NULL já zerou a coluna).
  const { data, error } = await supabase.from('transactions').select('*').eq('ID_Transacao', transactionId).maybeSingle();
  if (error || !data) throw fail('failed');
  return { eventId: event.id, transaction: data as Transaction };
}

/**
 * Limpeza best-effort depois de excluir lançamentos MANUAIS: apaga o evento manual do usuário que ficou sem nenhuma
 * perna (confirmado no banco). Nunca apaga evento automático nem evento que ainda tenha perna.
 */
export async function cleanupOrphanUserEvent(eventId: string): Promise<boolean> {
  try {
    const userId = await currentUserId();
    const event = await loadOwnedEvent(eventId, userId);
    if (!isUserInternalMovementEvent(event)) return false;
    if ((await legsOf(event.id)).length > 0) return false;
    await deleteEconomicEvent(event.id);
    return true;
  } catch (error) {
    console.error('[EconomicIdentity] Falha ao limpar o evento órfão (sem efeito nos cálculos):', error);
    return false;
  }
}
