import { supabase } from '../supabaseClient';
import type { EconomicEvent, EconomicEventKind, EconomicEventSource } from '../types';

export const ECONOMIC_EVENT_COLUMNS = 'id,user_id,kind,source,counterparty_account_id,created_by,created_at';
const COLUMNS = ECONOMIC_EVENT_COLUMNS;

/**
 * Cria um evento econômico para o usuário autenticado.
 *
 * `user_id`/`created_by` vêm SEMPRE da sessão: o chamador não escolhe o dono. `kind` e `source` são
 * contrato interno do fluxo que cria as pernas (nunca inferidos por valor, data ou texto).
 */
export async function createEconomicEvent(input: {
  kind: EconomicEventKind;
  source: EconomicEventSource;
  counterpartyAccountId?: string | null;
}): Promise<EconomicEvent> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Usuário não autenticado.');

  const { data, error } = await supabase
    .from('economic_events')
    .insert({
      user_id: user.id,
      created_by: user.id,
      kind: input.kind,
      source: input.source,
      counterparty_account_id: input.counterpartyAccountId ?? null,
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  if (!data) throw new Error('Evento econômico não foi criado.');
  return data as EconomicEvent;
}

/** Remove o evento. As transações vinculadas permanecem (o banco zera só `economic_event_id`). */
export async function deleteEconomicEvent(eventId: string): Promise<void> {
  const { error } = await supabase.from('economic_events').delete().eq('id', eventId);
  if (error) throw error;
}
