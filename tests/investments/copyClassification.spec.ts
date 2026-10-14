import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCopiedClassifications, type CopyContext } from '../../src/domain/investments/classificationCopy';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { A, B, SNAP2, as, closeDatabases, createDatabase, newHolding, newPortfolio, q } from '../helpers/investmentsPgFixture';

/**
 * D1 — "Copiar do mês anterior" preserva carteira e ativo quando continuam válidos. Desligada (flag off), a cópia é a de
 * sempre e não consulta as tabelas novas.
 */
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  queries: [] as string[],
  inserts: [] as Row[][],
  insertErrors: [] as unknown[],
  selectErrors: {} as Record<string, unknown>,
}));

vi.mock('../../src/supabaseClient', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'actor' } }, error: null }) },
    from: (table: string) => {
      let inserted: Row[] | undefined;
      const filters: Array<[string, unknown]> = [];
      const execute = () => {
        if (inserted) {
          state.inserts.push(inserted.map((r) => ({ ...r })));
          const err = state.insertErrors.shift();
          if (err) return { data: null, error: err };
          state.tables[table] = [...(state.tables[table] ?? []), ...inserted];
          return { data: null, error: null };
        }
        state.queries.push(table);
        if (state.selectErrors[table]) return { data: null, error: state.selectErrors[table] };
        return { data: (state.tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v)).map((r) => ({ ...r })), error: null };
      };
      const query: any = {
        select: () => query,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return query; },
        insert: (rows: Row[]) => { inserted = rows; return query; },
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(execute()).then(ok, ko),
      };
      return query;
    },
  },
}));

import { investmentService } from '../../src/services/investmentService';

const OWNER = 'owner-a';
const target = new Date(2026, 9, 1); // outubro → copia setembro
const src = (id: string, over: Row = {}): Row => ({
  id, user_id: OWNER, institution: 'XP', product_type: 'Renda Fixa', product_name: `P${id}`, balance: 100.5, reference_month: '2026-09-01',
  invested_principal: 90, portfolio_id: null, holding_id: null, classified_by: 'someone', classified_at: '2026-09-02T00:00:00Z', ...over,
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  state.tables = {
    investments: [],
    investment_portfolios: [
      { id: 'p1', user_id: OWNER, archived_at: null },
      { id: 'p-arq', user_id: OWNER, archived_at: '2026-10-01' },
    ],
    investment_holdings: [
      { id: 'h1', user_id: OWNER, portfolio_id: 'p1' },
      { id: 'h2', user_id: OWNER, portfolio_id: 'p1' },
    ],
  };
  state.queries = [];
  state.inserts = [];
  state.insertErrors = [];
  state.selectErrors = {};
});
afterEach(() => vi.restoreAllMocks());

describe('regra pura da D1', () => {
  const ctx = (over: Partial<CopyContext> = {}): CopyContext => ({
    ownerUserId: OWNER,
    portfolios: [{ id: 'p1', user_id: OWNER, archived_at: null }, { id: 'p-arq', user_id: OWNER, archived_at: 'x' }, { id: 'pb', user_id: 'owner-b', archived_at: null }],
    holdings: [{ id: 'h1', user_id: OWNER, portfolio_id: 'p1' }, { id: 'h-outra', user_id: OWNER, portfolio_id: 'p-arq' }, { id: 'hb', user_id: 'owner-b', portfolio_id: 'p1' }],
    holdingsUsedInTarget: new Set(),
    ...over,
  });

  it('carteira ativa do proprietário e ativo válido seguem; o resto vira Sem carteira ou só carteira', () => {
    expect(resolveCopiedClassifications([
      { portfolio_id: 'p1', holding_id: 'h1' },
      { portfolio_id: 'p1', holding_id: null },
      { portfolio_id: 'p-arq', holding_id: 'h-outra' },
      { portfolio_id: 'pb' },
      { portfolio_id: 'p-sumiu' },
      { portfolio_id: null, holding_id: 'h1' },
      { portfolio_id: 'p1', holding_id: 'h-outra' },
      { portfolio_id: 'p1', holding_id: 'hb' },
    ], ctx())).toEqual([
      { portfolio_id: 'p1', holding_id: 'h1' },
      { portfolio_id: 'p1', holding_id: null },
      { portfolio_id: null, holding_id: null },
      { portfolio_id: null, holding_id: null },
      { portfolio_id: null, holding_id: null },
      { portfolio_id: null, holding_id: null },
      { portfolio_id: 'p1', holding_id: null },
      { portfolio_id: 'p1', holding_id: null },
    ]);
  });

  it('ativo já usado no mês de destino (ou repetido na própria cópia) não é reutilizado: fica só a carteira', () => {
    expect(resolveCopiedClassifications([{ portfolio_id: 'p1', holding_id: 'h1' }], ctx({ holdingsUsedInTarget: new Set(['h1']) })))
      .toEqual([{ portfolio_id: 'p1', holding_id: null }]);
    expect(resolveCopiedClassifications([{ portfolio_id: 'p1', holding_id: 'h1' }, { portfolio_id: 'p1', holding_id: 'h1' }], ctx()))
      .toEqual([{ portfolio_id: 'p1', holding_id: 'h1' }, { portfolio_id: 'p1', holding_id: null }]);
  });
});

describe('cópia mensal com a D1', () => {
  it('flag desligada: cópia de sempre — sem carteira, sem consulta às tabelas novas, mesmo com origem classificada', async () => {
    state.tables.investments = [src('1', { portfolio_id: 'p1', holding_id: 'h1' })];
    const result = await investmentService.copyFromPreviousMonth(OWNER, target);
    expect(state.queries).toEqual(['investments']);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0][0]).not.toHaveProperty('portfolio_id');
    expect(state.inserts[0][0]).not.toHaveProperty('holding_id');
    expect(result).toEqual({ copied: 1, classified: 0, leftUnclassified: 0 });
  });

  it('flag ligada: preserva carteira/ativo válidos, nunca copia a auditoria e mantém os valores financeiros', async () => {
    state.tables.investments = [
      src('1', { portfolio_id: 'p1', holding_id: 'h1' }),
      src('2', { portfolio_id: 'p-arq' }),
      src('3'),
      src('4', { portfolio_id: 'p1', holding_id: 'h2' }),
      // posição já existente no destino usa h2: não é sobrescrita e h2 não é reutilizado
      src('x', { reference_month: '2026-10-01', portfolio_id: 'p1', holding_id: 'h2' }),
    ];
    const result = await investmentService.copyFromPreviousMonth(OWNER, target, { preserveClassification: true });
    expect(state.inserts).toHaveLength(1);
    const rows = state.inserts[0];
    expect(rows.map((r) => [r.product_name, r.portfolio_id ?? null, r.holding_id ?? null])).toEqual([
      ['P1', 'p1', 'h1'],
      ['P2', null, null],
      ['P3', null, null],
      ['P4', 'p1', null],
    ]);
    for (const r of rows) {
      expect(r).not.toHaveProperty('classified_by');
      expect(r).not.toHaveProperty('classified_at');
      expect(r).not.toHaveProperty('id');
      expect(r).toMatchObject({ user_id: OWNER, reference_month: '2026-10-01', balance: 100.5, invested_principal: 90 });
    }
    expect(result).toEqual({ copied: 4, classified: 2, leftUnclassified: 1 });
    expect(state.tables.investments.find((r) => r.id === 'x')).toMatchObject({ portfolio_id: 'p1', holding_id: 'h2' });
  });

  it('flag ligada mas nada classificado na origem: nenhuma consulta extra', async () => {
    state.tables.investments = [src('1'), src('2')];
    const result = await investmentService.copyFromPreviousMonth(OWNER, target, { preserveClassification: true });
    expect(state.queries).toEqual(['investments']);
    expect(result).toEqual({ copied: 2, classified: 0, leftUnclassified: 0 });
  });

  it('carteiras ilegíveis: copia sem classificação, sem perder a cópia', async () => {
    state.tables.investments = [src('1', { portfolio_id: 'p1' })];
    state.selectErrors.investment_portfolios = { code: '42501' };
    const result = await investmentService.copyFromPreviousMonth(OWNER, target, { preserveClassification: true });
    expect(state.inserts[0][0]).not.toHaveProperty('portfolio_id');
    expect(result).toEqual({ copied: 1, classified: 0, leftUnclassified: 1 });
  });

  it('associação invalidada entre leitura e gravação (23505/23503): uma única nova tentativa, sem classificação', async () => {
    state.tables.investments = [src('1', { portfolio_id: 'p1', holding_id: 'h1' })];
    state.insertErrors = [{ code: '23505' }];
    const result = await investmentService.copyFromPreviousMonth(OWNER, target, { preserveClassification: true });
    expect(state.inserts).toHaveLength(2);
    expect(state.inserts[0][0]).toMatchObject({ portfolio_id: 'p1', holding_id: 'h1' });
    expect(state.inserts[1][0]).not.toHaveProperty('portfolio_id');
    expect(result).toEqual({ copied: 1, classified: 0, leftUnclassified: 1 });
    expect(state.tables.investments.filter((r) => r.reference_month === '2026-10-01')).toHaveLength(1);
  });

  it('outros erros (ou erro sem classificação) são propagados sem nova tentativa', async () => {
    state.tables.investments = [src('1', { portfolio_id: 'p1' })];
    state.insertErrors = [{ code: '42501' }];
    await expect(investmentService.copyFromPreviousMonth(OWNER, target, { preserveClassification: true })).rejects.toEqual({ code: '42501' });
    expect(state.inserts).toHaveLength(1);
    state.inserts = [];
    state.insertErrors = [{ code: '23505' }];
    state.tables.investments = [src('1')];
    await expect(investmentService.copyFromPreviousMonth(OWNER, target, { preserveClassification: true })).rejects.toEqual({ code: '23505' });
    expect(state.inserts).toHaveLength(1);
  });
});

describe('D1 contra o banco real', () => {
  afterEach(closeDatabases);
  vi.setConfig({ testTimeout: 120_000 });

  it('INSERT da cópia: auditoria do banco = quem copiou; ativo já usado no mês derruba o lote inteiro (nada gravado)', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p = await newPortfolio(db, A, 'P');
    const h = await newHolding(db, A, p, 'CDB X');
    await q(db, 'update public.investments set portfolio_id = $1, holding_id = $2 where id = $3', [p, h, SNAP2]); // set/2026: usa h

    await as(db, 'authenticated', B); // familiar copia para A
    const inserted = await q<{ classified_by: string; user_id: string }>(db,
      "insert into public.investments (user_id, institution, product_type, balance, reference_month, portfolio_id, holding_id) values ($1,'XP','RF',10,'2026-10-01',$2,$3) returning classified_by, user_id",
      [A, p, h]);
    expect(inserted[0]).toEqual({ classified_by: B, user_id: A });

    const before = (await q<{ n: number }>(db, "select count(*)::int n from public.investments where reference_month = '2026-09-01'"))[0].n;
    await expect(q(db,
      "insert into public.investments (user_id, institution, product_type, balance, reference_month, portfolio_id, holding_id) values ($1,'XP','RF',1,'2026-09-01',$2,null), ($1,'XP','RF',2,'2026-09-01',$2,$3)",
      [A, p, h])).rejects.toMatchObject({ code: '23505' });
    expect((await q<{ n: number }>(db, "select count(*)::int n from public.investments where reference_month = '2026-09-01'"))[0].n).toBe(before);
  });
});

describe('fronteira da D1 no serviço legado', () => {
  it('fora da cópia mensal, investmentService não conhece carteiras nem ativos (nenhuma outra escrita os toca)', () => {
    const svc = readFileSync(resolve('src/services/investmentService.ts'), 'utf8').replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));
    const rest = svc
      .replace(/type ClassificationKey = [^;]+;/, '')
      .replace(/async function loadCopyContext[\s\S]*?\n}\n/, '')
      .replace(/\/\*\*\n     \* `preserveClassification`[\s\S]*?\n    },\n/, '');
    expect(rest.length).toBeLessThan(svc.length - 3000);
    expect(rest).not.toMatch(/portfolio_id|holding_id|investment_portfolios|investment_holdings|preserveClassification/);
    expect(svc).toContain("async addInvestment(investment: Omit<Investment, 'id' | 'created_at' | 'updated_at' | ClassificationKey>)");
    expect(svc).toContain("updates: Partial<Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at' | ClassificationKey>>");
  });
});
