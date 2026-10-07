import type { Account, EconomicEvent, Transaction } from '../types';
import { createEconomicEvent, deleteEconomicEvent } from './economicEventService';

type NewLeg = Omit<Transaction, 'ID_Transacao' | 'Origem'>;

export interface InvoicePaymentRegistration {
  /** Linhas gravadas pelo INSERT (com IDs reais). */
  added: Transaction[];
  /** Evento criado; `null` quando o Pagar seguiu o fluxo legado. */
  event: EconomicEvent | null;
  /** Perna do CARTÃO (Renda), localizada pela estrutura — nunca pela ordem do retorno. */
  cardLeg: Transaction | null;
}

/**
 * O Pagar só cria identidade econômica quando o cartão E a conta pagadora são do MESMO usuário autenticado.
 * Prova estrutural (`contas.user_id`); rótulo, nome ou visibilidade familiar nunca contam.
 */
export const canCreateInvoicePaymentEvent = (
  userId: string | null | undefined,
  card: Pick<Account, 'user_id'>,
  source: Pick<Account, 'user_id'>
): boolean => !!userId && card.user_id === userId && source.user_id === userId;

/** Acha a perna do cartão sem ambiguidade (exatamente uma Renda no cartão e uma Despesa na conta pagadora). */
export function findInvoicePaymentLegs(input: {
  added: Transaction[];
  cardAccountId: string;
  sourceAccountId: string;
  eventId: string;
}): { cardLeg: Transaction; bankLeg: Transaction } | null {
  const mine = input.added.filter((t) => t.economic_event_id === input.eventId);
  const cards = mine.filter((t) => t.ID_Conta === input.cardAccountId && t.Tipo === 'Renda');
  const banks = mine.filter((t) => t.ID_Conta === input.sourceAccountId && t.Tipo === 'Despesa');
  if (cards.length !== 1 || banks.length !== 1 || cards[0] === banks[0]) return null;
  return { cardLeg: cards[0], bankLeg: banks[0] };
}

/**
 * Grava as duas pernas do Pagar. Se elegível, cria UM evento `credit_card_payment` e grava o MESMO
 * `economic_event_id` nas duas pernas (um único INSERT). As pernas e seus marcadores legados não mudam.
 *
 * - Falha ao criar o evento: segue o fluxo legado (o pagamento nunca é bloqueado por isso).
 * - Falha ao gravar as pernas: tenta apagar o evento recém-criado e repropaga o erro ORIGINAL.
 */
export async function registerInvoicePayment(input: {
  userId: string | null | undefined;
  cardAccount: Pick<Account, 'id' | 'user_id'>;
  sourceAccount: Pick<Account, 'id' | 'user_id'>;
  /** [perna do cartão, perna bancária]; a ordem NÃO é usada para decidir papéis. */
  legs: NewLeg[];
  addTransaction: (legs: NewLeg[]) => Promise<Transaction[]>;
  createEvent?: typeof createEconomicEvent;
  deleteEvent?: typeof deleteEconomicEvent;
}): Promise<InvoicePaymentRegistration> {
  const createEvent = input.createEvent ?? createEconomicEvent;
  const deleteEvent = input.deleteEvent ?? deleteEconomicEvent;

  let event: EconomicEvent | null = null;
  if (canCreateInvoicePaymentEvent(input.userId, input.cardAccount, input.sourceAccount)) {
    try {
      event = await createEvent({ kind: 'credit_card_payment', source: 'pay_invoice_flow' });
    } catch (error) {
      console.warn('[Pagar] Evento econômico não criado; seguindo o fluxo legado:', error);
      event = null;
    }
  }

  let added: Transaction[];
  try {
    added = await input.addTransaction(
      event ? input.legs.map((leg) => ({ ...leg, economic_event_id: event!.id })) : input.legs
    );
  } catch (error) {
    if (event) {
      try {
        await deleteEvent(event.id);
      } catch (cleanupError) {
        console.error('[Pagar] Falha ao desfazer o evento econômico órfão:', cleanupError);
      }
    }
    throw error;
  }

  const found = event
    ? findInvoicePaymentLegs({
        added,
        cardAccountId: input.cardAccount.id,
        sourceAccountId: input.sourceAccount.id,
        eventId: event.id,
      })
    : null;
  return { added, event, cardLeg: found?.cardLeg ?? null };
}
