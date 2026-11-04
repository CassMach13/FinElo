import { supabase } from '../supabaseClient';
import type { Transaction } from '../types';
import { cleanupOrphanEconomicEvent, cleanupOrphanUserEvent } from './transactionEconomicIdentityService';

/**
 * Exclusão de lançamentos que limpa o que o «Pagar fatura» criou junto com eles.
 *
 * Ordem (cada passo só depois do anterior):
 * 1. Lê os registros de pagamento do cartão ligados às linhas, de qualquer origem (antes que a FK zere o vínculo).
 * 2. Exclui as linhas num único comando: os dois lados de um pagamento saem juntos ou nenhum sai.
 * 3. Remove os eventos que ficaram sem nenhuma linha (conferido no banco): o de pagamento de fatura, quando a linha
 *    era um lado de pagamento; o manual do usuário, como antes, nas demais.
 * 4. Remove os registros de pagamento do cartão lidos no passo 1 e recalcula as faturas desse cartão.
 *
 * Os passos 3 e 4 são limpeza: se falharem, as linhas já saíram juntas e o saldo, a fatura e o limite
 * (calculados a partir das linhas) continuam corretos.
 */
export interface PaymentCleanupDeps {
  findEnginePayments: (transactionIds: string[]) => Promise<Array<{ id: string; card_id: string | null }>>;
  deleteTransactions: (transactionIds: string[]) => Promise<string[]>;
  cleanupEvent: (eventId: string, fromInvoicePayment: boolean) => Promise<boolean>;
  deleteEnginePayments: (paymentIds: string[]) => Promise<void>;
  recalculateCard?: (cardId: string) => Promise<void>;
}

export interface PaymentCleanupResult {
  deletedIds: string[];
  removedEventIds: string[];
  removedEnginePaymentIds: string[];
}

export class TransactionDeletionError extends Error {
  constructor(message = 'Não foi possível excluir. Nada foi alterado. Tente novamente.') {
    super(message);
    this.name = 'TransactionDeletionError';
  }
}

const CHUNK = 100;

const defaultDeps: PaymentCleanupDeps = {
  async findEnginePayments(ids) {
    const out: Array<{ id: string; card_id: string | null }> = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await supabase
        .from('credit_card_payments')
        .select('id,card_id')
        // Qualquer origem: o «Pagar» grava o seu (`manual`) e a sincronização do cartão grava outro
        // (`imported_statement`) para a mesma linha. Linha excluída, os dois perdem o sentido.
        .in('payment_transaction_id', ids.slice(i, i + CHUNK));
      if (error) throw error;
      out.push(...((data ?? []) as Array<{ id: string; card_id: string | null }>));
    }
    return out;
  },
  async deleteTransactions(ids) {
    const deleted: string[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await supabase
        .from('transactions')
        .delete()
        .in('ID_Transacao', ids.slice(i, i + CHUNK))
        .select('ID_Transacao');
      if (error) throw error;
      deleted.push(...((data ?? []) as Array<{ ID_Transacao: string }>).map((r) => r.ID_Transacao));
    }
    return deleted;
  },
  cleanupEvent: (eventId, fromInvoicePayment) =>
    fromInvoicePayment ? cleanupOrphanEconomicEvent(eventId) : cleanupOrphanUserEvent(eventId),
  async deleteEnginePayments(ids) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { error } = await supabase.from('credit_card_payments').delete().in('id', ids.slice(i, i + CHUNK));
      if (error) throw error;
    }
  },
};

export async function deleteTransactionsWithPaymentCleanup(input: {
  transactions: ReadonlyArray<Pick<Transaction, 'ID_Transacao' | 'economic_event_id'>>;
  /** Linhas reconhecidas como lado de um pagamento de fatura. */
  invoicePaymentLegIds?: ReadonlySet<string>;
  deps?: Partial<PaymentCleanupDeps>;
}): Promise<PaymentCleanupResult> {
  const deps = { ...defaultDeps, ...input.deps };
  const ids = [...new Set(input.transactions.map((t) => t.ID_Transacao).filter((x): x is string => !!x))];
  if (ids.length === 0) return { deletedIds: [], removedEventIds: [], removedEnginePaymentIds: [] };

  let enginePayments: Array<{ id: string; card_id: string | null }> = [];
  try {
    enginePayments = await deps.findEnginePayments(ids);
  } catch (error) {
    console.warn('[Excluir] Registros de pagamento do cartão não lidos (sem efeito no saldo):', error);
  }

  let deletedIds: string[];
  try {
    deletedIds = await deps.deleteTransactions(ids);
  } catch (error) {
    console.error('[Excluir] Falha ao excluir lançamentos:', error);
    throw new TransactionDeletionError();
  }

  const removedEventIds: string[] = [];
  const paymentEvents = new Set<string>();
  const eventIds = new Set<string>();
  for (const t of input.transactions) {
    if (!t.economic_event_id) continue;
    eventIds.add(t.economic_event_id);
    if (t.ID_Transacao && input.invoicePaymentLegIds?.has(t.ID_Transacao)) paymentEvents.add(t.economic_event_id);
  }
  for (const eventId of eventIds) {
    if (await deps.cleanupEvent(eventId, paymentEvents.has(eventId))) removedEventIds.push(eventId);
  }

  const removedEnginePaymentIds: string[] = [];
  if (enginePayments.length > 0 && deletedIds.length > 0) {
    try {
      await deps.deleteEnginePayments(enginePayments.map((p) => p.id));
      removedEnginePaymentIds.push(...enginePayments.map((p) => p.id));
      if (deps.recalculateCard) {
        for (const cardId of new Set(enginePayments.map((p) => p.card_id).filter((x): x is string => !!x))) {
          await deps.recalculateCard(cardId);
        }
      }
    } catch (error) {
      console.warn('[Excluir] Registro de pagamento do cartão não removido (sem efeito no saldo):', error);
    }
  }

  return { deletedIds, removedEventIds, removedEnginePaymentIds };
}
