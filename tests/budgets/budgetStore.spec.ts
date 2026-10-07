import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  rows: [] as Row[],
  user: { id: 'user-a' } as { id: string } | null,
  alert: vi.fn(),
  fail: null as null | 'select' | 'insert' | 'update' | 'delete',
  inserted: [] as Row[][],
  patches: [] as Row[],
  seq: 0,
}));

vi.mock('../../src/supabaseClient', () => {
  const take = (op: 'select' | 'insert' | 'update' | 'delete') => {
    if (mocks.fail === op) {
      mocks.fail = null;
      return { message: 'boom' };
    }
    return null;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table !== 'budget_months') throw new Error(`tabela inesperada: ${table}`);
        return {
          select: async () => {
            const error = take('select');
            return error ? { data: null, error } : { data: mocks.rows.map((r) => ({ ...r })), error: null };
          },
          insert: (payload: Row[]) => ({
            select: async () => {
              mocks.inserted.push(payload);
              const error = take('insert');
              if (error) return { data: null, error };
              const created = payload.map((p) => ({
                id: `bm${(mocks.seq += 1)}`,
                created_at: '2026-10-07T00:00:00Z',
                updated_at: '2026-10-07T00:00:00Z',
                ...p,
                amount: String(p.amount), // numeric pode voltar como string
              }));
              mocks.rows.push(...created);
              return { data: created, error: null };
            },
          }),
          update: (patch: Row) => ({
            eq: (_c: string, id: string) => ({
              select: async () => {
                mocks.patches.push(patch);
                const error = take('update');
                if (error) return { data: null, error };
                const row = mocks.rows.find((r) => r.id === id);
                if (!row) return { data: [], error: null };
                Object.assign(row, patch);
                return { data: [{ ...row }], error: null };
              },
            }),
          }),
          delete: () => ({
            eq: async (_c: string, id: string) => {
              const error = take('delete');
              if (error) return { error };
              mocks.rows = mocks.rows.filter((r) => r.id !== id);
              return { error: null };
            },
          }),
        };
      },
      auth: {
        getUser: async () => ({ data: { user: mocks.user } }),
        signOut: async () => ({ error: null }),
      },
    },
  };
});
vi.mock('../../src/hooks/useDialogStore', () => ({ appAlert: mocks.alert, appConfirm: vi.fn() }));

import { useAppStore } from '../../src/hooks/useAppStore';

const state = () => useAppStore.getState();
const seed = (id: string, extra: Row = {}): Row => ({
  id,
  user_id: 'user-a',
  Categoria: 'Alimentação',
  year: 2026,
  month: 10,
  amount: '1500.00',
  created_at: '',
  updated_at: '',
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [];
  mocks.inserted = [];
  mocks.patches = [];
  mocks.fail = null;
  mocks.seq = 0;
  mocks.user = { id: 'user-a' };
  useAppStore.setState(useAppStore.getInitialState(), true);
});

describe('Orçamento mensal — store', () => {
  it('fetch carrega e normaliza numeric/ano/mês', async () => {
    mocks.rows = [seed('1', { year: '2026', month: '10' })];
    await state().fetchBudgetMonths();
    expect(state().budgetMonths).toEqual([
      { id: '1', user_id: 'user-a', Categoria: 'Alimentação', year: 2026, month: 10, amount: 1500, created_at: '', updated_at: '' },
    ]);
  });

  it('erro no fetch não derruba nem apaga o estado anterior', async () => {
    mocks.rows = [seed('1')];
    await state().fetchBudgetMonths();
    mocks.fail = 'select';
    await state().fetchBudgetMonths();
    expect(state().budgetMonths).toHaveLength(1);
  });

  it('criar usa SEMPRE o usuário autenticado como dono, ignorando qualquer owner vindo da UI', async () => {
    const ok = await state().createBudgetMonths([
      { Categoria: 'Alimentação', year: 2026, month: 10, amount: 1500, user_id: 'outro' } as never,
      { Categoria: 'Transporte', year: 2026, month: 10, amount: 600 },
    ]);
    expect(ok).toBe(true);
    expect(mocks.inserted).toHaveLength(1); // um único INSERT em lote
    expect(mocks.inserted[0].every((r) => r.user_id === 'user-a')).toBe(true);
    expect(Object.keys(mocks.inserted[0][0]).sort()).toEqual(['Categoria', 'amount', 'month', 'user_id', 'year']);
    expect(state().budgetMonths.map((b) => [b.Categoria, b.amount])).toEqual([['Alimentação', 1500], ['Transporte', 600]]);
  });

  it('criar vazio é no-op; sem sessão não grava', async () => {
    expect(await state().createBudgetMonths([])).toBe(true);
    expect(mocks.inserted).toHaveLength(0);
    mocks.user = null;
    expect(await state().createBudgetMonths([{ Categoria: 'X', year: 2026, month: 1, amount: 1 }])).toBe(false);
    expect(mocks.inserted).toHaveLength(0);
  });

  it('criar com erro: avisa, devolve false e não altera o estado', async () => {
    mocks.fail = 'insert';
    const ok = await state().createBudgetMonths([{ Categoria: 'X', year: 2026, month: 1, amount: 10 }]);
    expect(ok).toBe(false);
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(state().budgetMonths).toEqual([]);
  });

  it('atualizar envia SÓ amount (nunca dono, categoria, ano ou mês)', async () => {
    mocks.rows = [seed('1')];
    await state().fetchBudgetMonths();
    expect(await state().updateBudgetMonthAmount('1', 1800.5)).toBe(true);
    expect(mocks.patches).toEqual([{ amount: 1800.5 }]);
    expect(state().budgetMonths[0].amount).toBe(1800.5);
    expect(state().budgetMonths[0].user_id).toBe('user-a');
  });

  it('atualizar com erro ou 0 linhas (RLS) avisa e preserva o estado', async () => {
    mocks.rows = [seed('1')];
    await state().fetchBudgetMonths();
    mocks.fail = 'update';
    expect(await state().updateBudgetMonthAmount('1', 5)).toBe(false);
    expect(await state().updateBudgetMonthAmount('inexistente', 5)).toBe(false);
    expect(state().budgetMonths[0].amount).toBe(1500);
    expect(mocks.alert).toHaveBeenCalledTimes(2);
  });

  it('excluir remove só após o sucesso; erro preserva', async () => {
    mocks.rows = [seed('1'), seed('2', { Categoria: 'Transporte' })];
    await state().fetchBudgetMonths();
    mocks.fail = 'delete';
    expect(await state().deleteBudgetMonth('1')).toBe(false);
    expect(state().budgetMonths).toHaveLength(2);
    expect(await state().deleteBudgetMonth('1')).toBe(true);
    expect(state().budgetMonths.map((b) => b.id)).toEqual(['2']);
  });

  it('logout limpa os orçamentos mensais e o pedido de abrir o gerenciador', async () => {
    mocks.rows = [seed('1')];
    await state().fetchBudgetMonths();
    state().requestBudgetManager();
    expect(state().budgetManagerRequested).toBe(true);
    await state().signOut();
    expect(state().budgetMonths).toEqual([]);
    expect(state().budgetManagerRequested).toBe(false);
  });

  it('o pedido transitório do Gerenciador é consumível', () => {
    state().requestBudgetManager();
    expect(state().budgetManagerRequested).toBe(true);
    state().clearBudgetManagerRequest();
    expect(state().budgetManagerRequested).toBe(false);
  });

  it('entra na carga normal (fetchAllData), junto de fetchBudgets, sem fetch por render', () => {
    const src = readFileSync(resolve('src/hooks/useAppStore.ts'), 'utf8');
    const start = src.indexOf('fetchAllData: async () => {');
    const block = src.slice(start, src.indexOf('} catch', start));
    expect(block).toContain('get().fetchBudgets(),');
    expect(block).toContain('get().fetchBudgetMonths(),');
    const dash = readFileSync(resolve('src/components/views/DashboardView.tsx'), 'utf8');
    expect(dash).not.toMatch(/fetchBudgetMonths/);
  });

  it('o store não toca em budgets legado para o mensal e o tipo Budget expõe user_id', () => {
    const types = readFileSync(resolve('src/types.ts'), 'utf8');
    expect(types).toMatch(/export interface Budget \{[\s\S]*?user_id\?: string;/);
    expect(types).toMatch(/export interface BudgetMonth \{/);
  });
});
