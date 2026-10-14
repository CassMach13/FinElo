/**
 * D1 (V2-B1B): ao "Copiar do mês anterior", quais classificações seguem para o novo mês. Função pura.
 *
 *  - a carteira segue só se existir, for do MESMO proprietário e estiver ativa; senão a nova posição fica sem carteira;
 *  - o ativo (holding) segue só se for do proprietário, da mesma carteira e ainda não tiver posição no mês de destino
 *    (nem receber outra nesta mesma cópia); senão a posição fica só na carteira;
 *  - `classified_by`/`classified_at` nunca são copiados: o banco registra quem fez a cópia.
 */

export interface CopySource {
  portfolio_id?: string | null;
  holding_id?: string | null;
}

export interface CopyContext {
  ownerUserId: string;
  portfolios: ReadonlyArray<{ id: string; user_id: string; archived_at: string | null }>;
  holdings: ReadonlyArray<{ id: string; user_id: string; portfolio_id: string }>;
  /** Ativos que já têm posição no mês de destino. */
  holdingsUsedInTarget: ReadonlySet<string>;
}

export interface CopiedClassification {
  portfolio_id: string | null;
  holding_id: string | null;
}

export function resolveCopiedClassifications(sources: readonly CopySource[], ctx: CopyContext): CopiedClassification[] {
  const portfolios = new Map(ctx.portfolios.map((p) => [p.id, p]));
  const holdings = new Map(ctx.holdings.map((h) => [h.id, h]));
  const used = new Set(ctx.holdingsUsedInTarget);
  return sources.map((source) => {
    const portfolio = source.portfolio_id ? portfolios.get(source.portfolio_id) : undefined;
    if (!portfolio || portfolio.user_id !== ctx.ownerUserId || portfolio.archived_at) return { portfolio_id: null, holding_id: null };
    const holding = source.holding_id ? holdings.get(source.holding_id) : undefined;
    if (!holding || holding.user_id !== ctx.ownerUserId || holding.portfolio_id !== portfolio.id || used.has(holding.id)) {
      return { portfolio_id: portfolio.id, holding_id: null };
    }
    used.add(holding.id);
    return { portfolio_id: portfolio.id, holding_id: holding.id };
  });
}
