import type { EconomicEvent, Transaction } from '../../types';
import { classifyTransaction } from './transactionSemantics';

/**
 * Regras PURAS da classificação manual ("Marcar como movimentação interna") e dos selos de identidade.
 * Sem React, Supabase ou store. A persistência (e a revalidação no banco) vive no service.
 *
 * Princípio: nenhuma contraparte é procurada. 1 lançamento → 1 evento. Só o DONO real do lançamento cria ou
 * desfaz a classificação; a família apenas vê o selo.
 */

export const BADGE_CREDIT_CARD_PAYMENT = 'Pagamento de fatura';
export const BADGE_INTERNAL_MOVEMENT = 'Movimentação interna';

export const MARK_ACTION_LABEL = 'Marcar como movimentação interna';
export const UNDO_ACTION_LABEL = 'Desfazer movimentação interna';

/** Selo do evento CARREGADO. Evento desconhecido (id sem evento) ⇒ sem selo: nada é inferido. */
export function resolveEconomicIdentityBadge(event: Pick<EconomicEvent, 'kind'> | null | undefined): string | null {
  if (!event) return null;
  if (event.kind === 'credit_card_payment') return BADGE_CREDIT_CARD_PAYMENT;
  if (event.kind === 'own_account_transfer') return BADGE_INTERNAL_MOVEMENT;
  return null;
}

/**
 * Pode marcar: dono real, sem evento, não demo e sem o marcador do Pagar (as pernas legadas do Pagar são
 * tratadas pelo backfill, não por marcação manual). Lançamento importado do próprio usuário PODE.
 */
export function canMarkInternalMovement(
  tx: Pick<Transaction, 'user_id' | 'economic_event_id' | 'Origem' | 'Fonte' | 'Descricao_Original' | 'Observacoes'>,
  currentUserId: string | null | undefined
): boolean {
  if (!currentUserId || !tx.user_id || tx.user_id !== currentUserId) return false;
  if (tx.economic_event_id) return false;
  const s = classifyTransaction(tx as Transaction);
  return !s.isDemo && !s.hasFundingMarker;
}

/** Evento manual (usuário) de movimentação interna. É o único tipo que o usuário pode desfazer. */
export const isUserInternalMovementEvent = (event: Pick<EconomicEvent, 'kind' | 'source'> | null | undefined): boolean =>
  !!event && event.kind === 'own_account_transfer' && event.source === 'user';

/** Pode desfazer: evento manual do próprio usuário, ligado a ESTE lançamento, com exatamente 1 perna. */
export function canUndoInternalMovement(
  tx: Pick<Transaction, 'user_id' | 'economic_event_id'>,
  event: Pick<EconomicEvent, 'id' | 'kind' | 'source' | 'user_id'> | null | undefined,
  currentUserId: string | null | undefined,
  legCount: number
): boolean {
  if (!currentUserId || !event || !isUserInternalMovementEvent(event)) return false;
  if (event.user_id !== currentUserId) return false;
  if (!tx.economic_event_id || tx.economic_event_id !== event.id) return false;
  return legCount === 1;
}

/** Quantas transações carregadas apontam para cada evento. */
export function countLegsByEventId(transactions: ReadonlyArray<Pick<Transaction, 'economic_event_id'>>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of transactions) {
    if (!t.economic_event_id) continue;
    counts.set(t.economic_event_id, (counts.get(t.economic_event_id) ?? 0) + 1);
  }
  return counts;
}
