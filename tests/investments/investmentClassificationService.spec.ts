import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Contrato da classificação de snapshots (V2-B1B), no nível do cliente: o UPDATE leva SÓ `portfolio_id` e
 * `holding_id`, sempre filtrado pelo id E pelo proprietário. A garantia final (trigger, FKs, RLS) é provada contra o
 * banco real em `investmentClassificationContract.spec.ts`.
 */
type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]>; selected?: string };
type Result = { data: unknown; error: unknown };
const state = vi.hoisted(() => ({
  user: { id: 'actor-b' } as { id: string } | null,
  calls: [] as Call[],
  queue: [] as Result[],
}));

vi.mock('../../src/supabaseClient', () => {
  const next = () => Promise.resolve(state.queue.length ? state.queue.shift()! : { data: null, error: { code: 'XX000' } });
  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    const chain: any = {
      select: (cols?: string) => { call.selected = cols; return chain; },
      update: (p: unknown) => { call.op = 'update'; call.payload = p; return chain; },
      insert: (p: unknown) => { call.op = 'insert'; call.payload = p; return chain; },
      eq: (c: string, v: unknown) => { call.filters.push([c, v]); return chain; },
      is: (c: string, v: unknown) => { call.filters.push([`${c} is`, v]); return chain; },
      order: () => chain,
      single: () => { state.calls.push(call); return next(); },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => { state.calls.push(call); return next().then(ok, ko); },
    };
    return chain;
  };
  return { supabase: { from, auth: { getUser: async () => ({ data: { user: state.user } }) } } };
});

import { classifyInvestment, unclassifyInvestment } from '../../src/services/investmentStructureService';

const portfolio = (over: Record<string, unknown> = {}) => ({ data: { id: 'p1', user_id: 'owner-a', archived_at: null, ...over }, error: null });
const holding = (over: Record<string, unknown> = {}) => ({ data: { id: 'h1', user_id: 'owner-a', portfolio_id: 'p1', ...over }, error: null });
const row = (over: Record<string, unknown> = {}) => ({ data: [{ id: 's1', user_id: 'owner-a', reference_month: '2026-09-01', portfolio_id: 'p1', holding_id: null, classified_by: 'actor-b', classified_at: 'now', ...over }], error: null });
const updates = () => state.calls.filter((c) => c.op === 'update');

beforeEach(() => {
  state.user = { id: 'actor-b' };
  state.calls = [];
  state.queue = [];
});

describe('classificar', () => {
  it('payload = exatamente portfolio_id e holding_id; filtros = id e proprietário', async () => {
    state.queue.push(portfolio(), holding(), row({ holding_id: 'h1' }));
    const out = await classifyInvestment({ investmentId: 's1', ownerUserId: 'owner-a', portfolioId: 'p1', holdingId: 'h1' });
    const [u] = updates();
    expect(u.table).toBe('investments');
    expect(u.payload).toEqual({ portfolio_id: 'p1', holding_id: 'h1' });
    expect(Object.keys(u.payload as object).sort()).toEqual(['holding_id', 'portfolio_id']);
    expect(u.filters).toEqual([['id', 's1'], ['user_id', 'owner-a']]);
    expect(u.selected).not.toMatch(/\*/);
    expect(out.holding_id).toBe('h1');
  });

  it('atributos extras do chamador nunca chegam ao UPDATE (saldo, mês, dono, auditoria)', async () => {
    state.queue.push(portfolio(), row());
    const hostile = { investmentId: 's1', ownerUserId: 'owner-a', portfolioId: 'p1', balance: 0, reference_month: '1999-01-01', user_id: 'x', classified_by: 'x' } as Parameters<typeof classifyInvestment>[0];
    await classifyInvestment(hostile);
    expect(updates()[0].payload).toEqual({ portfolio_id: 'p1', holding_id: null });
  });

  it('mover sem holding remove a holding (ela pertence à carteira de origem)', async () => {
    state.queue.push(portfolio({ id: 'p2' }), row({ portfolio_id: 'p2' }));
    await classifyInvestment({ investmentId: 's1', ownerUserId: 'owner-a', portfolioId: 'p2' });
    expect(updates()[0].payload).toEqual({ portfolio_id: 'p2', holding_id: null });
  });

  it('carteira arquivada não recebe classificação (nenhum UPDATE)', async () => {
    state.queue.push(portfolio({ archived_at: '2026-10-01T00:00:00Z' }));
    await expect(classifyInvestment({ investmentId: 's1', ownerUserId: 'owner-a', portfolioId: 'p1' })).rejects.toMatchObject({ code: 'archived_portfolio' });
    expect(updates()).toHaveLength(0);
  });

  it('carteira ou holding de outro proprietário, ou holding de outra carteira: recusado antes do UPDATE', async () => {
    state.queue.push(portfolio({ user_id: 'owner-b' }));
    await expect(classifyInvestment({ investmentId: 's1', ownerUserId: 'owner-a', portfolioId: 'p1' })).rejects.toMatchObject({ code: 'invalid_target' });
    state.queue.push(portfolio(), holding({ user_id: 'owner-b' }));
    await expect(classifyInvestment({ investmentId: 's1', ownerUserId: 'owner-a', portfolioId: 'p1', holdingId: 'h1' })).rejects.toMatchObject({ code: 'invalid_target' });
    state.queue.push(portfolio(), holding({ portfolio_id: 'p9' }));
    await expect(classifyInvestment({ investmentId: 's1', ownerUserId: 'owner-a', portfolioId: 'p1', holdingId: 'h1' })).rejects.toMatchObject({ code: 'invalid_target' });
    expect(updates()).toHaveLength(0);
  });

  it('zero linhas atualizadas (snapshot de outro dono, invisível ou inexistente) é erro, não sucesso silencioso', async () => {
    state.queue.push(portfolio(), { data: [], error: null });
    await expect(classifyInvestment({ investmentId: 's1', ownerUserId: 'owner-a', portfolioId: 'p1' })).rejects.toMatchObject({ code: 'not_found_or_forbidden' });
  });

  it('erros do banco viram mensagens próprias: holding já usada no mês, alvo inválido, sem permissão', async () => {
    state.queue.push(portfolio(), holding(), { data: null, error: { code: '23505', message: 'investments_holding_month_key' } });
    const dup = classifyInvestment({ investmentId: 's1', ownerUserId: 'owner-a', portfolioId: 'p1', holdingId: 'h1' });
    await expect(dup).rejects.toMatchObject({ code: 'holding_month_taken' });
    await expect(dup).rejects.not.toThrow(/investments_holding_month_key/);
    state.queue.push(portfolio(), { data: null, error: { code: '23503' } });
    await expect(classifyInvestment({ investmentId: 's1', ownerUserId: 'owner-a', portfolioId: 'p1' })).rejects.toMatchObject({ code: 'invalid_target' });
    state.queue.push(portfolio(), { data: null, error: { code: '42501' } });
    await expect(classifyInvestment({ investmentId: 's1', ownerUserId: 'owner-a', portfolioId: 'p1' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('sem sessão ou sem alvo: nenhuma consulta', async () => {
    state.user = null;
    await expect(classifyInvestment({ investmentId: 's1', ownerUserId: 'owner-a', portfolioId: 'p1' })).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(unclassifyInvestment({ investmentId: 's1', ownerUserId: 'owner-a' })).rejects.toMatchObject({ code: 'unauthenticated' });
    state.user = { id: 'actor-b' };
    await expect(classifyInvestment({ investmentId: 's1', ownerUserId: 'owner-a', portfolioId: '' })).rejects.toMatchObject({ code: 'invalid_target' });
    await expect(unclassifyInvestment({ investmentId: '', ownerUserId: 'owner-a' })).rejects.toMatchObject({ code: 'invalid_target' });
    expect(state.calls).toHaveLength(0);
  });
});

describe('desfazer', () => {
  it('payload = portfolio_id e holding_id nulos; filtros = id e proprietário; nenhuma leitura prévia', async () => {
    state.queue.push(row({ portfolio_id: null }));
    const out = await unclassifyInvestment({ investmentId: 's1', ownerUserId: 'owner-a' });
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].payload).toEqual({ portfolio_id: null, holding_id: null });
    expect(state.calls[0].filters).toEqual([['id', 's1'], ['user_id', 'owner-a']]);
    expect(out.portfolio_id).toBeNull();
  });
});
