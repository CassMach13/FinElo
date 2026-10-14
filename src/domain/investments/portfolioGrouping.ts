import type { Investment, InvestmentPortfolio } from '../../types';

/**
 * Totais por carteira (V2-B1B). Função pura sobre o snapshot JÁ carregado do mês (sem consulta nova).
 *
 * Invariantes (provados em teste, em centavos):
 *  - só entram posições do mês selecionado e do proprietário consultado; o resto é contado em `excludedCount`;
 *  - cada posição (por id) entra em exatamente UM grupo: nenhuma é somada duas vezes;
 *  - soma das carteiras + "Sem carteira" = total do mês;
 *  - carteiras ativas aparecem sempre (mesmo vazias); arquivadas só quando têm posições no mês consultado;
 *  - carteira de outro proprietário nunca vira grupo.
 */

export type PortfolioGroupKind = 'active' | 'archived' | 'unavailable';

export interface PortfolioGroup {
  portfolioId: string;
  name: string;
  kind: PortfolioGroupKind;
  totalCents: number;
  positionIds: string[];
}

export interface PortfolioGrouping {
  monthKey: string;
  ownerUserId: string;
  groups: PortfolioGroup[];
  unassigned: { totalCents: number; positionIds: string[] };
  totalCents: number;
  /** Posições recebidas fora do escopo (outro mês, outro dono ou id repetido). Esperado: 0. */
  excludedCount: number;
}

export const balanceToCents = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export const centsToAmount = (cents: number): number => cents / 100;

type GroupingPosition = Pick<Investment, 'id' | 'user_id' | 'balance' | 'reference_month' | 'portfolio_id'>;
type GroupingPortfolio = Pick<InvestmentPortfolio, 'id' | 'user_id' | 'name' | 'archived_at'>;

export function groupPositionsByPortfolio(params: {
  positions: readonly GroupingPosition[];
  portfolios: readonly GroupingPortfolio[];
  monthKey: string;
  ownerUserId: string;
}): PortfolioGrouping {
  const { monthKey, ownerUserId } = params;
  const own = params.portfolios.filter((p) => p.user_id === ownerUserId);
  const byId = new Map(own.map((p) => [p.id, p]));
  const buckets = new Map<string, { totalCents: number; positionIds: string[] }>();
  const unassigned = { totalCents: 0, positionIds: [] as string[] };
  const seen = new Set<string>();
  let excludedCount = 0;
  let totalCents = 0;

  for (const position of params.positions) {
    const inScope =
      position.user_id === ownerUserId && String(position.reference_month ?? '').slice(0, 10) === monthKey && !seen.has(position.id);
    if (!inScope) {
      excludedCount += 1;
      continue;
    }
    seen.add(position.id);
    const cents = balanceToCents(position.balance);
    totalCents += cents;
    const target = position.portfolio_id
      ? buckets.get(position.portfolio_id) ?? buckets.set(position.portfolio_id, { totalCents: 0, positionIds: [] }).get(position.portfolio_id)!
      : unassigned;
    target.totalCents += cents;
    target.positionIds.push(position.id);
  }

  const groups: PortfolioGroup[] = [];
  for (const p of own) {
    const bucket = buckets.get(p.id);
    if (p.archived_at && !bucket) continue;
    groups.push({ portfolioId: p.id, name: p.name, kind: p.archived_at ? 'archived' : 'active', totalCents: bucket?.totalCents ?? 0, positionIds: bucket?.positionIds ?? [] });
  }
  // Ativas primeiro (na ordem recebida), depois arquivadas com posições.
  groups.sort((a, b) => Number(a.kind === 'archived') - Number(b.kind === 'archived'));
  // Classificadas numa carteira que não veio na lista (falha parcial de leitura): continuam somando, sem nome inventado.
  for (const [portfolioId, bucket] of buckets) {
    if (!byId.has(portfolioId)) groups.push({ portfolioId, name: 'Carteira indisponível', kind: 'unavailable', ...bucket });
  }

  return { monthKey, ownerUserId, groups, unassigned, totalCents, excludedCount };
}

/** Filtro da lista por grupo: `null` = todas; 'unassigned' = Sem carteira; senão o id da carteira. */
export type PortfolioFilter = null | 'unassigned' | string;

export function filterPositions<T extends Pick<Investment, 'id'>>(positions: readonly T[], grouping: PortfolioGrouping, filter: PortfolioFilter): T[] {
  if (filter === null) return [...positions];
  const ids = new Set(filter === 'unassigned' ? grouping.unassigned.positionIds : grouping.groups.find((g) => g.portfolioId === filter)?.positionIds ?? []);
  return positions.filter((p) => ids.has(p.id));
}

/** Destinos válidos de classificação: só carteiras ATIVAS do proprietário consultado. */
export function classificationTargets<T extends GroupingPortfolio>(portfolios: readonly T[], ownerUserId: string): T[] {
  return portfolios.filter((p) => p.user_id === ownerUserId && !p.archived_at);
}
