import { supabase } from '../supabaseClient';
import type { AuthoritativeSource, ResolutionKind } from '../domain/credit-card/twoLedgerBalance';

/**
 * A porta única para a reconciliação de cartão.
 *
 * Todo o cálculo acontece na Edge Function. O cliente diz qual conta, qual
 * competência e — ao resolver — o que a diferença SIGNIFICA. Nunca quanto ela
 * vale: o valor sai do snapshot que o servidor calculou.
 *
 * ===========================================================================
 * A RESPOSTA AMBÍGUA
 * ===========================================================================
 *
 * A validação do 4B1 mediu, em staging, duas resoluções concorrentes sobre a
 * mesma competência: uma respondeu em 3s e a outra levou de 50 a 130 segundos,
 * devolvendo `upstream request timeout` ao cliente. Em um dos casos a operação
 * JÁ TINHA SIDO GRAVADA quando o cliente desistiu — o retry devolveu
 * `idempotent_replay: true` com o id da linha que havia sido criada.
 *
 * Ou seja: erro de rede aqui NÃO significa «não aconteceu». Significa «não
 * sabemos». Tratar isso como falha e deixar o usuário clicar de novo criaria
 * uma segunda resolução — dinheiro duplicado por um problema de transporte.
 *
 * Por isso a chave de idempotência é gerada UMA VEZ por intenção, pelo chamador,
 * e repetida em toda tentativa daquela mesma intenção. Repetir com a mesma chave
 * é seguro por construção: o servidor devolve a linha original.
 */

export type ReconciliationOutcome =
  /** O servidor confirmou. `replay` indica que a linha já existia. */
  | { status: 'confirmada'; resolutionId: string; replay: boolean; resolvedAmount: number | null }
  /** O servidor recusou por uma razão do domínio, e a razão está aqui. */
  | { status: 'recusada'; motivo: string }
  /**
   * A resposta se perdeu. Não sabemos se gravou, e conferir é a única saída
   * honesta — nunca oferecer «tentar de novo» com uma chave nova.
   */
  | { status: 'indeterminada'; motivo: string };

export interface ReconciliationSnapshot {
  referenceMonth: string;
  deltaCents: number;
  economicOpenBalanceCents: number;
  economicStatus: string;
  reconciliationStatus: string;
  economicUsedCents: number;
  economicCarryCents: number;
}

export interface ResolveInput {
  accountId: string;
  referenceMonth: string;
  resolution: ResolutionKind;
  /** Gerada UMA vez por intenção, pelo chamador, e repetida em cada tentativa. */
  idempotencyKey: string;
  authoritativeTotalCents?: number;
  authoritativeSource?: AuthoritativeSource;
}

/** Uma chave por INTENÇÃO. Nunca por tentativa. */
export function novaIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Distingue «o servidor disse não» de «não recebemos resposta».
 *
 * A primeira é informação; a segunda é ausência dela, e as duas exigem condutas
 * opostas na tela.
 */
function classificarErro(err: unknown): ReconciliationOutcome {
  const msg = err instanceof Error ? err.message : String(err);
  const ambigua =
    /timeout|network|fetch|aborted|failed to send|load failed/i.test(msg) || msg.trim() === '';

  return ambigua
    ? { status: 'indeterminada', motivo: msg || 'sem resposta do servidor' }
    : { status: 'recusada', motivo: msg };
}

async function invocar<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('card-reconciliation', { body });
  if (error) {
    // O corpo do erro traz a mensagem do domínio; a do transporte é genérica.
    const detalhe = await (error as { context?: Response }).context
      ?.json?.()
      .then((j: { error?: string }) => j?.error)
      .catch(() => undefined);
    throw new Error(detalhe || error.message);
  }
  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as T;
}

/**
 * Calcula a diferença da competência e materializa o snapshot no servidor.
 *
 * Chamado SÓ quando o usuário entra no fluxo de reconciliação — leva alguns
 * segundos e não tem por que rodar a cada renderização do dashboard.
 */
export async function computeReconciliation(
  accountId: string,
  referenceMonth: string
): Promise<ReconciliationSnapshot> {
  return invocar<ReconciliationSnapshot>({ action: 'compute', accountId, referenceMonth });
}

/** Grava a classificação. Repetir com a mesma chave é seguro. */
export async function resolveReconciliation(input: ResolveInput): Promise<ReconciliationOutcome> {
  try {
    const data = await invocar<{
      id: string;
      idempotent_replay: boolean;
      resolved_amount: number | null;
    }>({
      action: 'resolve',
      accountId: input.accountId,
      referenceMonth: input.referenceMonth,
      resolution: input.resolution,
      idempotencyKey: input.idempotencyKey,
      authoritativeTotalCents: input.authoritativeTotalCents ?? null,
      authoritativeSource: input.authoritativeSource ?? null,
    });

    return {
      status: 'confirmada',
      resolutionId: data.id,
      replay: Boolean(data.idempotent_replay),
      resolvedAmount: data.resolved_amount,
    };
  } catch (err) {
    return classificarErro(err);
  }
}

/** Desfaz. A linha original não é apagada — a reversão é um registro novo. */
export async function reverseReconciliation(
  resolutionId: string,
  idempotencyKey: string,
  reason?: string
): Promise<ReconciliationOutcome> {
  try {
    const data = await invocar<{ id: string; idempotent_replay: boolean }>({
      action: 'reverse',
      resolutionId,
      idempotencyKey,
      reason: reason ?? null,
    });
    return {
      status: 'confirmada',
      resolutionId: data.id,
      replay: Boolean(data.idempotent_replay),
      resolvedAmount: null,
    };
  } catch (err) {
    return classificarErro(err);
  }
}

/**
 * Resolve com uma segunda tentativa quando a resposta se perde.
 *
 * A segunda tentativa usa A MESMA chave, então ou encontra a linha que a
 * primeira criou (e volta como `replay`), ou grava pela primeira vez. Nunca
 * duas. Uma tentativa extra basta: se ela também se perder, quem decide o que
 * fazer é o usuário, olhando o estado recarregado — e não um laço automático.
 */
export async function resolveComRetrySeguro(
  input: ResolveInput
): Promise<ReconciliationOutcome> {
  const primeira = await resolveReconciliation(input);
  if (primeira.status !== 'indeterminada') return primeira;

  const segunda = await resolveReconciliation(input);
  if (segunda.status === 'indeterminada') {
    return {
      status: 'indeterminada',
      motivo:
        'A resposta do servidor se perdeu duas vezes. A operação pode ter sido gravada — recarregue para ver o estado real antes de tentar outra vez.',
    };
  }
  return segunda;
}

/** As resoluções ativas de uma competência, para oferecer «Desfazer». */
export async function listarResolucoesAtivas(
  accountId: string,
  referenceMonth: string
): Promise<Array<{ id: string; resolution: ResolutionKind; resolvedAmount: number | null }>> {
  const { data, error } = await supabase
    .from('credit_card_reconciliation_resolutions')
    .select('id, resolution, resolved_amount, credit_card_reconciliation_resolution_reversals(id)')
    .eq('account_id', accountId)
    .eq('reference_month', referenceMonth);

  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((r) => !foiRevertida(r.credit_card_reconciliation_resolution_reversals))
    .map((r) => ({
      id: r.id as string,
      resolution: r.resolution as ResolutionKind,
      resolvedAmount: r.resolved_amount == null ? null : Number(r.resolved_amount),
    }));
}

/**
 * O vínculo de reversão pode chegar como objeto ou array, conforme a
 * cardinalidade que o PostgREST infere — o índice único sobre `resolution_id`
 * mudou isso uma vez, e o desfazer parou de fazer efeito em silêncio. Aceitar
 * as duas formas tira essa dependência.
 */
function foiRevertida(vinculo: unknown): boolean {
  if (vinculo == null) return false;
  if (Array.isArray(vinculo)) return vinculo.length > 0;
  return typeof vinculo === 'object';
}
