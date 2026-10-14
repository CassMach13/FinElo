/**
 * Investimentos do Dashboard por proprietário (flag `dashboard_owner_scope_enabled`). Função pura.
 *
 * Cada proprietário contribui com a SUA última posição até a data de corte (o mês pode ser diferente entre eles).
 * O consolidado soma essas posições individuais em centavos, sem repetir proprietário, e informa quando os meses de
 * referência diferem — não é uma fotografia única de um mesmo mês.
 */

export interface OwnerLatestPosition {
  ownerUserId: string;
  /** YYYY-MM-01 da última posição até a data de corte; null = sem posição. */
  monthKey: string | null;
  balances: Array<number | string | null | undefined>;
}

export interface OwnerInvestmentSummary {
  totalCents: number;
  byOwner: Array<{ ownerUserId: string; monthKey: string | null; totalCents: number; positions: number }>;
  /** Meses de referência distintos entre proprietários com posição (ordem crescente). */
  monthKeys: string[];
  mixedMonths: boolean;
}

const toCents = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export function summarizeOwnerInvestments(positions: readonly OwnerLatestPosition[]): OwnerInvestmentSummary {
  const seen = new Set<string>();
  const byOwner: OwnerInvestmentSummary['byOwner'] = [];
  for (const p of positions) {
    if (!p.ownerUserId || seen.has(p.ownerUserId)) continue;
    seen.add(p.ownerUserId);
    const totalCents = p.monthKey ? p.balances.reduce<number>((sum, b) => sum + toCents(b), 0) : 0;
    byOwner.push({ ownerUserId: p.ownerUserId, monthKey: p.monthKey, totalCents, positions: p.monthKey ? p.balances.length : 0 });
  }
  const monthKeys = [...new Set(byOwner.filter((o) => o.monthKey && o.positions > 0).map((o) => o.monthKey as string))].sort();
  return {
    totalCents: byOwner.reduce((sum, o) => sum + o.totalCents, 0),
    byOwner,
    monthKeys,
    mixedMonths: monthKeys.length > 1,
  };
}
