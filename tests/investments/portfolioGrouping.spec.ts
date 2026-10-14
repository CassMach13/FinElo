import { describe, expect, it } from 'vitest';
import {
  balanceToCents,
  classificationTargets,
  filterPositions,
  groupPositionsByPortfolio,
} from '../../src/domain/investments/portfolioGrouping';

const OWNER = 'owner-a';
const MONTH = '2026-09-01';
const pos = (id: string, balance: number | string, over: Record<string, unknown> = {}) => ({
  id, user_id: OWNER, balance: balance as number, reference_month: MONTH, portfolio_id: null as string | null, ...over,
});
const pf = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, user_id: OWNER, name, archived_at: null as string | null, ...over });

const sumGroups = (g: ReturnType<typeof groupPositionsByPortfolio>) => g.groups.reduce((s, x) => s + x.totalCents, 0) + g.unassigned.totalCents;

describe('totais por carteira em centavos', () => {
  it('soma das carteiras + Sem carteira = total do mês, exato em centavos (sem erro de ponto flutuante)', () => {
    const positions = [
      pos('1', 0.1, { portfolio_id: 'p1' }), pos('2', 0.2, { portfolio_id: 'p1' }), pos('3', '1000.10', { portfolio_id: 'p2' }),
      pos('4', 33.33), pos('5', 33.34),
    ];
    const g = groupPositionsByPortfolio({ positions, portfolios: [pf('p1', 'A'), pf('p2', 'B')], monthKey: MONTH, ownerUserId: OWNER });
    expect(g.totalCents).toBe(10 + 20 + 100010 + 3333 + 3334);
    expect(sumGroups(g)).toBe(g.totalCents);
    expect(g.groups.map((x) => [x.name, x.totalCents])).toEqual([['A', 30], ['B', 100010]]);
    expect(g.unassigned).toEqual({ totalCents: 6667, positionIds: ['4', '5'] });
    expect(g.excludedCount).toBe(0);
  });

  it('cada posição entra em exatamente um grupo; id repetido não é somado duas vezes', () => {
    const p = pos('1', 500, { portfolio_id: 'p1' });
    const g = groupPositionsByPortfolio({ positions: [p, { ...p }, pos('2', 1)], portfolios: [pf('p1', 'A')], monthKey: MONTH, ownerUserId: OWNER });
    expect(g.totalCents).toBe(50100);
    expect(g.excludedCount).toBe(1);
    const all = [...g.groups.flatMap((x) => x.positionIds), ...g.unassigned.positionIds];
    expect(all.sort()).toEqual(['1', '2']);
  });

  it('snapshots de outro mês ou de outro proprietário nunca entram no patrimônio do mês', () => {
    const positions = [pos('1', 100), pos('2', 900, { reference_month: '2026-08-01' }), pos('3', 700, { user_id: 'owner-b' }), pos('4', 5, { reference_month: '2026-09-01T00:00:00' })];
    const g = groupPositionsByPortfolio({ positions, portfolios: [], monthKey: MONTH, ownerUserId: OWNER });
    expect(g.totalCents).toBe(10500);
    expect(g.excludedCount).toBe(2);
  });

  it('carteiras de outro proprietário nunca viram grupo; ativas vazias aparecem; arquivadas só com posições', () => {
    const portfolios = [pf('p1', 'Ativa vazia'), pf('p2', 'Arquivada vazia', { archived_at: '2026-10-01' }), pf('p3', 'Arquivada com posição', { archived_at: '2026-10-01' }), pf('pb', 'De B', { user_id: 'owner-b' })];
    const g = groupPositionsByPortfolio({ positions: [pos('1', 10, { portfolio_id: 'p3' })], portfolios, monthKey: MONTH, ownerUserId: OWNER });
    expect(g.groups.map((x) => [x.name, x.kind, x.totalCents])).toEqual([['Ativa vazia', 'active', 0], ['Arquivada com posição', 'archived', 1000]]);
  });

  it('arquivar não altera totais: a mesma posição continua somando, agora sob a carteira arquivada', () => {
    const positions = [pos('1', 10, { portfolio_id: 'p1' }), pos('2', 20)];
    const active = groupPositionsByPortfolio({ positions, portfolios: [pf('p1', 'X')], monthKey: MONTH, ownerUserId: OWNER });
    const archived = groupPositionsByPortfolio({ positions, portfolios: [pf('p1', 'X', { archived_at: '2026-10-01' })], monthKey: MONTH, ownerUserId: OWNER });
    expect(archived.totalCents).toBe(active.totalCents);
    expect(archived.groups[0]).toMatchObject({ kind: 'archived', totalCents: 1000 });
  });

  it('classificada em carteira ausente da lista: continua somando como "Carteira indisponível"', () => {
    const g = groupPositionsByPortfolio({ positions: [pos('1', 10, { portfolio_id: 'p-x' })], portfolios: [], monthKey: MONTH, ownerUserId: OWNER });
    expect(g.groups).toEqual([{ portfolioId: 'p-x', name: 'Carteira indisponível', kind: 'unavailable', totalCents: 1000, positionIds: ['1'] }]);
    expect(sumGroups(g)).toBe(g.totalCents);
  });

  it('a soma bate com a mesma conversão que o resumo do mês usa (Number → centavos)', () => {
    expect(balanceToCents('1717136.96')).toBe(171713696);
    expect(balanceToCents(null)).toBe(0);
    expect(balanceToCents('abc')).toBe(0);
  });
});

describe('filtro e destinos', () => {
  const positions = [pos('1', 1, { portfolio_id: 'p1' }), pos('2', 2), pos('3', 3, { portfolio_id: 'p2' })];
  const g = groupPositionsByPortfolio({ positions, portfolios: [pf('p1', 'A'), pf('p2', 'B', { archived_at: 'x' })], monthKey: MONTH, ownerUserId: OWNER });

  it('filtro: todas, Sem carteira, uma carteira (inclusive arquivada); carteira desconhecida = vazio', () => {
    expect(filterPositions(positions, g, null).map((p) => p.id)).toEqual(['1', '2', '3']);
    expect(filterPositions(positions, g, 'unassigned').map((p) => p.id)).toEqual(['2']);
    expect(filterPositions(positions, g, 'p2').map((p) => p.id)).toEqual(['3']);
    expect(filterPositions(positions, g, 'nope')).toEqual([]);
  });

  it('destinos de classificação: só ativas do proprietário consultado', () => {
    const list = [pf('p1', 'A'), pf('p2', 'B', { archived_at: 'x' }), pf('p3', 'C', { user_id: 'owner-b' })];
    expect(classificationTargets(list, OWNER).map((p) => p.id)).toEqual(['p1']);
  });
});
