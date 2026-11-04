import type {
  AuthoritativeSource,
  ReconciliationResolutionInput,
  ResolutionKind,
} from './twoLedgerBalance.ts';

/**
 * Linhas do banco → entrada do núcleo de cartão. Uma implementação só.
 *
 * O card, o patrimônio e a Edge function `card-reconciliation` liam as mesmas
 * tabelas com três conversões próprias, e elas divergiam:
 *  - a ordem das resoluções de uma competência (por `id` na Edge, sem ordem no
 *    card, por `resolved_at` no patrimônio). A ordem decide qual total
 *    autoritativo vale e como resoluções parciais se somam;
 *  - o arredondamento para centavos (`+ EPSILON` só na Edge): 1,005 virava 100
 *    centavos numa rota e 101 na outra.
 * Mesmos dados, números diferentes conforme a tela. Agora todas chamam daqui.
 *
 * Puro: sem cliente Supabase, sem `Deno`, importável pelo browser, pela Edge e
 * pelos testes.
 */

/** Real → centavos inteiros. A única conversão usada nas linhas do cartão. */
export const rowAmountToCents = (v: number | string | null | undefined): number =>
  Math.round((Number(v ?? 0) + Number.EPSILON) * 100);

/**
 * Se uma resolução foi revertida, segundo o vínculo embutido pelo PostgREST.
 *
 * O vínculo chega como array ou, depois que o índice único sobre
 * `resolution_id` tornou a relação «para um», como objeto ou `null`. Testar só
 * `Array.isArray` fez a Edge contar resoluções já revertidas.
 */
export function foiRevertida(vinculo: unknown): boolean {
  if (vinculo == null) return false;
  if (Array.isArray(vinculo)) return vinculo.length > 0;
  return typeof vinculo === 'object';
}

export interface ResolutionRow {
  id?: string | null;
  account_id?: string | null;
  reference_month: string;
  resolution: string;
  resolved_amount: number | string | null;
  /** A diferença que a tela mostrava quando o usuário resolveu. */
  delta_amount?: number | string | null;
  authoritative_total: number | string | null;
  authoritative_source: string | null;
  resolved_at?: string | null;
  credit_card_reconciliation_resolution_reversals: unknown;
}

/** Colunas que toda rota precisa ler para chegar ao mesmo resultado. */
export const RESOLUTION_ROW_SELECT =
  'id, account_id, reference_month, resolution, resolved_amount, delta_amount, authoritative_total, authoritative_source, resolved_at, credit_card_reconciliation_resolution_reversals(id)';

function compareResolutionRows(a: ResolutionRow, b: ResolutionRow): number {
  const at = String(a.resolved_at ?? '');
  const bt = String(b.resolved_at ?? '');
  if (at !== bt) return at < bt ? -1 : 1;
  const ai = String(a.id ?? '');
  const bi = String(b.id ?? '');
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

export function resolutionInputFromRow(r: ResolutionRow): ReconciliationResolutionInput {
  return {
    kind: r.resolution as ResolutionKind,
    resolvedAmountCents: r.resolved_amount == null ? undefined : rowAmountToCents(r.resolved_amount),
    recordedDeltaCents: r.delta_amount == null ? undefined : rowAmountToCents(r.delta_amount),
    authoritativeStatementTotalCents:
      r.authoritative_total == null ? undefined : rowAmountToCents(r.authoritative_total),
    // Sem a PROCEDÊNCIA o núcleo descarta a resolução autoritativa inteira.
    authoritativeSource: (r.authoritative_source ?? null) as AuthoritativeSource | null,
  };
}

/**
 * Resoluções ativas de UMA conta, por competência, na ordem em que foram
 * registradas (`resolved_at`, depois `id`). Revertidas ficam de fora: a
 * reversão é uma linha nova e a original nunca é apagada.
 */
export function activeResolutionsByMonth(
  rows: readonly ResolutionRow[]
): Record<string, ReconciliationResolutionInput[]> {
  const out: Record<string, ReconciliationResolutionInput[]> = {};
  [...rows]
    .filter((r) => !foiRevertida(r.credit_card_reconciliation_resolution_reversals))
    .sort(compareResolutionRows)
    .forEach((r) => {
      (out[String(r.reference_month)] ??= []).push(resolutionInputFromRow(r));
    });
  return out;
}

/** O mesmo, para várias contas de uma vez: conta → competência → resoluções. */
export function activeResolutionsByAccountAndMonth(
  rows: readonly ResolutionRow[]
): Record<string, Record<string, ReconciliationResolutionInput[]>> {
  const porConta = new Map<string, ResolutionRow[]>();
  rows.forEach((r) => {
    const conta = String(r.account_id);
    porConta.set(conta, [...(porConta.get(conta) ?? []), r]);
  });
  const out: Record<string, Record<string, ReconciliationResolutionInput[]>> = {};
  porConta.forEach((linhas, conta) => {
    out[conta] = activeResolutionsByMonth(linhas);
  });
  return out;
}

export interface PaymentConfirmationRow {
  reference_month: string;
  settled_amount: number | string | null;
  confirmed_at?: string | null;
}

export function paymentConfirmationInputsFromRows(rows: readonly PaymentConfirmationRow[]) {
  return rows.map((c) => ({
    referenceMonth: String(c.reference_month),
    settledAmount: rowAmountToCents(c.settled_amount) / 100,
    confirmedAt: String(c.confirmed_at ?? ''),
  }));
}
