import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { summarizeOwnerInvestments } from '../../src/domain/investments/ownerInvestmentTotals';
import { createOwnerInvestmentsLoader, ownerInvestmentsFor, ownerInvestmentsKey, type OwnerInvestmentsState } from '../../src/services/ownerInvestmentsLoader';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ rows: [] as Row[], queries: [] as Array<Array<[string, unknown]>>, fail: null as unknown }));

// Modelo simples do PostgREST: aplica eq/lte/order/limit/range sobre as linhas (a RLS já é provada em outros testes).
vi.mock('../../src/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      let order: { col: string; asc: boolean } | null = null;
      let lim: number | undefined;
      let rng: [number, number] | undefined;
      const exec = () => {
        if (table !== 'investments') throw new Error('tabela inesperada');
        state.queries.push(filters);
        if (state.fail) return { data: null, error: state.fail };
        let rows = state.rows.filter((r) => filters.every(([k, v]) => (k.endsWith('<=') ? String(r[k.slice(0, -2)]) <= String(v) : r[k] === v)));
        if (order) rows = [...rows].sort((a, b) => (String(a[order!.col]) < String(b[order!.col]) ? -1 : 1) * (order!.asc ? 1 : -1));
        if (rng) rows = rows.slice(rng[0], rng[1] + 1);
        if (lim !== undefined) rows = rows.slice(0, lim);
        return { data: rows, error: null };
      };
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
        lte: (k: string, v: unknown) => { filters.push([`${k}<=`, v]); return q; },
        gte: () => q,
        order: (col: string, o?: { ascending?: boolean }) => { if (!order) order = { col, asc: o?.ascending !== false }; return q; },
        limit: (n: number) => { lim = n; return q; },
        range: (a: number, b: number) => { rng = [a, b]; return q; },
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(exec()).then(ok, ko),
      };
      return q;
    },
  },
}));

import { investmentService } from '../../src/services/investmentService';
import OwnerScopeNetWorthNote from '../../src/components/dashboard/OwnerScopeNetWorthNote';

const ME = 'user-me';
const ANA = 'user-ana';
const inv = (id: string, user_id: string, reference_month: string, balance: number) => ({ id, user_id, reference_month, balance, institution: 'X' });

beforeEach(() => {
  state.rows = [
    inv('1', ME, '2026-08-01', 1000),
    inv('2', ME, '2026-09-01', 0.1),
    inv('3', ME, '2026-09-01', 0.2),
    inv('4', ANA, '2026-07-01', 500.55),
    inv('5', ME, '2026-11-01', 999), // depois da data de corte
  ];
  state.queries = [];
  state.fail = null;
});
afterEach(() => vi.restoreAllMocks());

describe('última posição POR proprietário', () => {
  it('cada dono usa o próprio último mês até o corte; a consulta sempre filtra o dono', async () => {
    const res = await investmentService.getLatestPositionsByOwner(new Date('2026-10-15T12:00:00Z'), [ME, ANA, ME]);
    expect(res).toEqual([
      { ownerUserId: ME, monthKey: '2026-09-01', balances: [0.1, 0.2] },
      { ownerUserId: ANA, monthKey: '2026-07-01', balances: [500.55] },
    ]);
    expect(state.queries.every((f) => f.some(([k, v]) => k === 'user_id' && (v === ME || v === ANA)))).toBe(true);
  });

  it('dono sem posição até o corte volta sem mês; falha de um dono falha a chamada inteira', async () => {
    expect(await investmentService.getLatestPositionsByOwner(new Date('2026-06-01T12:00:00Z'), [ME])).toEqual([{ ownerUserId: ME, monthKey: null, balances: [] }]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.fail = { message: 'rede' };
    await expect(investmentService.getLatestPositionsByOwner(new Date('2026-10-15T12:00:00Z'), [ME, ANA])).rejects.toBeTruthy();
  });
});

describe('totais em centavos e meses de referência', () => {
  it('soma exata em centavos; consolidado = soma das posições individuais; meses diferentes identificados', () => {
    const s = summarizeOwnerInvestments([
      { ownerUserId: ME, monthKey: '2026-09-01', balances: [0.1, 0.2] },
      { ownerUserId: ANA, monthKey: '2026-07-01', balances: ['500.55'] },
    ]);
    expect(s.totalCents).toBe(30 + 50055);
    expect(s.byOwner.map((o) => o.totalCents)).toEqual([30, 50055]);
    expect(s.monthKeys).toEqual(['2026-07-01', '2026-09-01']);
    expect(s.mixedMonths).toBe(true);
  });

  it('sem duplicidade: o mesmo proprietário repetido conta uma vez; sem posição não entra nos meses', () => {
    const s = summarizeOwnerInvestments([
      { ownerUserId: ME, monthKey: '2026-09-01', balances: [10] },
      { ownerUserId: ME, monthKey: '2026-09-01', balances: [10] },
      { ownerUserId: ANA, monthKey: null, balances: [] },
    ]);
    expect(s.totalCents).toBe(1000);
    expect(s.mixedMonths).toBe(false);
    expect(s.monthKeys).toEqual(['2026-09-01']);
  });
});

describe('carregamento: troca rápida de proprietário ou de sessão', () => {
  it('resposta atrasada de outro escopo nunca grava; estado só vale para a chave atual', async () => {
    const states: OwnerInvestmentsState[] = [];
    const releases: Array<() => void> = [];
    const load = (_: Date, owners: readonly string[]) =>
      new Promise<any>((resolve) => releases.push(() => resolve(owners.map((o) => ({ ownerUserId: o, monthKey: '2026-09-01', balances: [o === ME ? 1 : 2] })))));
    const run = createOwnerInvestmentsLoader(load, (s) => states.push(s));
    const end = new Date('2026-10-15T12:00:00Z');
    const kMe = ownerInvestmentsKey(`${ME}|self`, end, [ME]);
    const kAna = ownerInvestmentsKey(`${ME}|owner|${ANA}`, end, [ANA]);
    const first = run(kMe, end, [ME]);
    const second = run(kAna, end, [ANA]);
    releases[1]();
    releases[0]();
    await Promise.all([first, second]);
    const last = states[states.length - 1];
    expect(last).toMatchObject({ key: kAna, status: 'ready' });
    expect(last.summary?.totalCents).toBe(200);
    expect(states.filter((s) => s.status === 'ready').map((s) => s.key)).toEqual([kAna]);
    // a tela pedindo a chave de "Você" (ou de outra sessão) vê "carregando", nunca o valor de Ana
    expect(ownerInvestmentsFor(last, kMe)).toEqual({ key: kMe, status: 'loading', summary: null });
    expect(ownerInvestmentsFor(last, ownerInvestmentsKey(`${ANA}|self`, end, [ANA])).status).toBe('loading');
  });

  it('erro não deixa total antigo: estado "error" sem valor', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const states: OwnerInvestmentsState[] = [];
    const run = createOwnerInvestmentsLoader(async () => { throw new Error('x'); }, (s) => states.push(s));
    await run('k', new Date(), [ME]);
    expect(states[states.length - 1]).toEqual({ key: 'k', status: 'error', summary: null });
  });
});

describe('nota do patrimônio', () => {
  const label = (id: string) => (id === ME ? 'Você' : 'Ana');
  const render = (props: any) => renderToStaticMarkup(React.createElement(OwnerScopeNetWorthNote, props)).replace(/ /g, ' ');

  it('meses diferentes: diz que não é uma fotografia do mesmo mês e mostra o mês de cada proprietário', () => {
    const summary = summarizeOwnerInvestments([
      { ownerUserId: ME, monthKey: '2026-09-01', balances: [0.1, 0.2] },
      { ownerUserId: ANA, monthKey: '2026-07-01', balances: [500.55] },
    ]);
    const html = render({ scopeLabel: 'Família (consolidado)', status: 'ready', summary, ownerLabel: label });
    expect(html).toContain('data-networth-note="mixed"');
    expect(html).toContain('não uma fotografia do mesmo mês');
    expect(html).toContain('Você set/2026 — R$ 0,30');
    expect(html).toContain('Ana jul/2026 — R$ 500,55');
  });

  it('mesmo mês: informa o mês; erro: avisa que o total não inclui investimentos', () => {
    const summary = summarizeOwnerInvestments([{ ownerUserId: ME, monthKey: '2026-09-01', balances: [1] }]);
    expect(render({ scopeLabel: 'Você', status: 'ready', summary, ownerLabel: label })).toContain('investimentos com posição de set/2026');
    expect(render({ scopeLabel: 'Ana', status: 'error', summary: null, ownerLabel: label })).toContain('não foi possível carregar os investimentos');
    expect(render({ scopeLabel: 'Ana', status: 'loading', summary: null, ownerLabel: label })).toBe('');
  });
});
