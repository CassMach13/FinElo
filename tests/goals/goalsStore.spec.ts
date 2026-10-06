import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  rows: [] as Row[],
  currentUser: { id: 'user-a' } as { id: string } | null,
  alert: vi.fn(),
  failNext: null as null | 'select' | 'insert' | 'update' | 'delete',
  calls: [] as string[],
  seq: 0,
  /** Quando true, `select` fica pendente até `release` (para controlar corridas). */
  hold: false,
  pending: [] as Array<{ uid: string | undefined; release: (asError?: boolean) => void }>,
}));

/** Tabela falsa que imita a RLS owner-only: cada usuário só enxerga e altera as próprias linhas. */
vi.mock('../../src/supabaseClient', () => {
  const visible = () => mocks.rows.filter((r) => r.user_id === mocks.currentUser?.id);
  const fail = (op: 'select' | 'insert' | 'update' | 'delete') => {
    if (mocks.failNext === op) {
      mocks.failNext = null;
      return { message: 'boom' };
    }
    return null;
  };
  const from = (table: string) => {
    if (table !== 'financial_goals') throw new Error(`tabela inesperada: ${table}`);
    return {
      select: () => ({
        order: () => {
          mocks.calls.push('select');
          const uid = mocks.currentUser?.id;
          const snapshot = visible().map((r) => ({ ...r }));
          if (mocks.hold) {
            return new Promise((resolve) => {
              mocks.pending.push({
                uid,
                release: (asError = false) =>
                  resolve(asError ? { data: null, error: { message: 'late boom' } } : { data: snapshot, error: null }),
              });
            });
          }
          const error = fail('select');
          return Promise.resolve(error ? { data: null, error } : { data: snapshot, error: null });
        },
      }),
      insert: (payload: Row[]) => ({
        select: async () => {
          mocks.calls.push('insert');
          const error = fail('insert');
          if (error) return { data: null, error };
          const row: Row = {
            id: `g${(mocks.seq += 1)}`,
            archived_at: null,
            created_at: '2026-10-06T12:00:00Z',
            updated_at: '2026-10-06T12:00:00Z',
            ...payload[0],
            // numeric volta como string em alguns drivers
            target_amount: String(payload[0].target_amount),
            current_amount: String(payload[0].current_amount),
          };
          if (row.user_id !== mocks.currentUser?.id) return { data: null, error: { message: 'rls' } };
          mocks.rows.push(row);
          return { data: [{ ...row }], error: null };
        },
      }),
      update: (patch: Row) => ({
        eq: (_col: string, id: string) => ({
          select: async () => {
            mocks.calls.push('update');
            const error = fail('update');
            if (error) return { data: null, error };
            const row = visible().find((r) => r.id === id);
            if (!row) return { data: [], error: null };
            Object.assign(row, patch, { updated_at: '2026-10-07T09:00:00Z' });
            return { data: [{ ...row }], error: null };
          },
        }),
      }),
      delete: () => ({
        eq: async (_col: string, id: string) => {
          mocks.calls.push('delete');
          const error = fail('delete');
          if (error) return { error };
          mocks.rows = mocks.rows.filter((r) => !(r.id === id && r.user_id === mocks.currentUser?.id));
          return { error: null };
        },
      }),
    };
  };
  return {
    supabase: {
      from,
      auth: {
        getUser: async () => ({ data: { user: mocks.currentUser } }),
        signOut: async () => ({ error: null }),
      },
    },
  };
});
vi.mock('../../src/hooks/useDialogStore', () => ({ appAlert: mocks.alert, appConfirm: vi.fn() }));

import { useAppStore } from '../../src/hooks/useAppStore';

const seed = (userId: string, id: string, name: string, extra: Row = {}): Row => ({
  id,
  user_id: userId,
  name,
  target_amount: '1000.00',
  current_amount: '250.50',
  target_date: '2027-12-31',
  archived_at: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...extra,
});

const state = () => useAppStore.getState();
const setUser = (id: string | null) => {
  mocks.currentUser = id ? { id } : null;
  useAppStore.setState({ user: id ? ({ id } as never) : null });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [];
  mocks.calls = [];
  mocks.failNext = null;
  mocks.seq = 0;
  mocks.hold = false;
  mocks.pending = [];
  useAppStore.setState(useAppStore.getInitialState(), true);
  setUser('user-a');
});

describe('Objetivos — store', () => {
  it('estado inicial: vazio, idle', () => {
    expect(state().goals).toEqual([]);
    expect(state().goalsStatus).toBe('idle');
  });

  it('fetch: carrega e normaliza numeric (string → número)', async () => {
    mocks.rows = [seed('user-a', 'g1', 'Reserva')];
    await state().fetchGoals();
    expect(state().goalsStatus).toBe('success');
    expect(state().goals).toHaveLength(1);
    expect(state().goals[0]).toMatchObject({ id: 'g1', name: 'Reserva', target_amount: 1000, current_amount: 250.5, target_date: '2027-12-31', archived_at: null });
    expect(typeof state().goals[0].target_amount).toBe('number');
  });

  it('fetch não duplica: segunda chamada na mesma sessão não consulta de novo; force consulta', async () => {
    mocks.rows = [seed('user-a', 'g1', 'Reserva')];
    await state().fetchGoals();
    await state().fetchGoals();
    await state().fetchGoals();
    expect(mocks.calls.filter((c) => c === 'select')).toHaveLength(1);
    await state().fetchGoals({ force: true });
    expect(mocks.calls.filter((c) => c === 'select')).toHaveLength(2);
  });

  it('fetch concorrente (loading) não dispara segunda busca', async () => {
    mocks.rows = [seed('user-a', 'g1', 'Reserva')];
    await Promise.all([state().fetchGoals(), state().fetchGoals()]);
    expect(mocks.calls.filter((c) => c === 'select')).toHaveLength(1);
  });

  it('fetch com erro: status error, sem lista, e force tenta de novo', async () => {
    mocks.rows = [seed('user-a', 'g1', 'Reserva')];
    mocks.failNext = 'select';
    await state().fetchGoals();
    expect(state().goalsStatus).toBe('error');
    expect(state().goals).toEqual([]);
    await state().fetchGoals({ force: true });
    expect(state().goalsStatus).toBe('success');
    expect(state().goals).toHaveLength(1);
  });

  it('sem usuário no store não busca', async () => {
    setUser(null);
    await state().fetchGoals();
    expect(mocks.calls).toEqual([]);
    expect(state().goalsStatus).toBe('idle');
  });

  it('create: grava com o usuário autenticado como dono, nunca um owner vindo da UI', async () => {
    const ok = await state().createGoal({
      name: 'Viagem',
      target_amount: 15000,
      current_amount: 8000,
      target_date: '2027-05-31',
      user_id: 'outra-pessoa',
    } as never);
    expect(ok).toBe(true);
    expect(mocks.rows).toHaveLength(1);
    expect(mocks.rows[0].user_id).toBe('user-a');
    expect(state().goals).toHaveLength(1);
    expect(state().goals[0]).toMatchObject({ name: 'Viagem', target_amount: 15000, current_amount: 8000, user_id: 'user-a' });
  });

  it('create sem sessão não grava', async () => {
    mocks.currentUser = null;
    expect(await state().createGoal({ name: 'x', target_amount: 1, current_amount: 0, target_date: null })).toBe(false);
    expect(mocks.rows).toHaveLength(0);
  });

  it('create com erro: avisa, devolve false e não altera a lista', async () => {
    mocks.failNext = 'insert';
    const ok = await state().createGoal({ name: 'x', target_amount: 1, current_amount: 0, target_date: null });
    expect(ok).toBe(false);
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(state().goals).toEqual([]);
  });

  it('update edita só nome, valor desejado e prazo', async () => {
    mocks.rows = [seed('user-a', 'g1', 'Reserva')];
    await state().fetchGoals();
    const ok = await state().updateGoal('g1', { name: 'Reserva 2', target_amount: 2000, target_date: null, current_amount: 99999 } as never);
    expect(ok).toBe(true);
    expect(mocks.rows[0]).toMatchObject({ name: 'Reserva 2', target_amount: 2000, target_date: null });
    expect(mocks.rows[0].current_amount).toBe('250.50'); // intocado
    expect(state().goals[0]).toMatchObject({ name: 'Reserva 2', target_amount: 2000, target_date: null, current_amount: 250.5 });
  });

  it('updateGoalCurrentAmount altera só current_amount', async () => {
    mocks.rows = [seed('user-a', 'g1', 'Reserva')];
    await state().fetchGoals();
    expect(await state().updateGoalCurrentAmount('g1', 777.77)).toBe(true);
    expect(mocks.rows[0]).toMatchObject({ current_amount: 777.77, name: 'Reserva', target_amount: '1000.00' });
    expect(state().goals[0].current_amount).toBe(777.77);
    expect(state().goals[0].updated_at).toBe('2026-10-07T09:00:00Z');
  });

  it('archive e unarchive', async () => {
    mocks.rows = [seed('user-a', 'g1', 'Reserva')];
    await state().fetchGoals();
    expect(await state().archiveGoal('g1')).toBe(true);
    expect(state().goals[0].archived_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await state().unarchiveGoal('g1')).toBe(true);
    expect(state().goals[0].archived_at).toBeNull();
  });

  it('delete remove da lista e do banco', async () => {
    mocks.rows = [seed('user-a', 'g1', 'Reserva'), seed('user-a', 'g2', 'Viagem')];
    await state().fetchGoals();
    expect(await state().deleteGoal('g1')).toBe(true);
    expect(state().goals.map((g) => g.id)).toEqual(['g2']);
    expect(mocks.rows.map((r) => r.id)).toEqual(['g2']);
  });

  it('erro em update e delete: avisa, devolve false e preserva o estado (sem otimismo silencioso)', async () => {
    mocks.rows = [seed('user-a', 'g1', 'Reserva')];
    await state().fetchGoals();
    const before = state().goals;
    mocks.failNext = 'update';
    expect(await state().updateGoalCurrentAmount('g1', 5)).toBe(false);
    expect(state().goals).toEqual(before);
    mocks.failNext = 'delete';
    expect(await state().deleteGoal('g1')).toBe(false);
    expect(state().goals).toEqual(before);
    expect(mocks.alert).toHaveBeenCalledTimes(2);
  });

  it('atualizar objetivo que não é seu (0 linhas) falha com aviso', async () => {
    mocks.rows = [seed('user-b', 'gb', 'Do B')];
    expect(await state().updateGoalCurrentAmount('gb', 1)).toBe(false);
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(mocks.rows[0].current_amount).toBe('250.50');
  });

  it('logout limpa objetivos e status', async () => {
    mocks.rows = [seed('user-a', 'g1', 'Reserva')];
    await state().fetchGoals();
    expect(state().goals).toHaveLength(1);
    await state().signOut();
    expect(state().goals).toEqual([]);
    expect(state().goalsStatus).toBe('idle');
    expect(state().goalsUserId).toBeNull();
  });

  it('troca de usuário sem logout não mostra objetivos do anterior', async () => {
    mocks.rows = [seed('user-a', 'ga', 'Do A'), seed('user-b', 'gb', 'Do B')];
    await state().fetchGoals();
    expect(state().goals.map((g) => g.name)).toEqual(['Do A']);
    setUser('user-b');
    await state().fetchGoals();
    expect(state().goals.map((g) => g.name)).toEqual(['Do B']);
    expect(state().goalsUserId).toBe('user-b');
  });

  it('fetch que termina depois de o usuário trocar é descartado', async () => {
    mocks.rows = [seed('user-a', 'ga', 'Do A')];
    const pending = state().fetchGoals();
    setUser('user-b');
    await pending;
    expect(state().goals.map((g) => g.name)).not.toContain('Do A');
  });

  describe('troca de usuário com busca pendente', () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const twoUsers = () => {
      mocks.rows = [seed('user-a', 'ga', 'Do A'), seed('user-b', 'gb', 'Do B')];
      mocks.hold = true;
    };

    it('A pendente não impede B: a segunda consulta é disparada; B termina em success só com os seus', async () => {
      twoUsers();
      const a = state().fetchGoals();
      await tick();
      expect(mocks.pending.map((p) => p.uid)).toEqual(['user-a']);
      expect(state().goalsStatus).toBe('loading');

      setUser('user-b');
      const b = state().fetchGoals();
      await tick();
      expect(mocks.calls.filter((c) => c === 'select')).toHaveLength(2); // B não foi barrado por "loading"
      expect(mocks.pending.map((p) => p.uid)).toEqual(['user-a', 'user-b']);
      expect(state().goalsUserId).toBe('user-b');

      mocks.pending[0].release(); // A responde tarde
      await a;
      // A não consegue escrever nada: nem goals, nem status, nem dono
      expect(state().goals).toEqual([]);
      expect(state().goalsStatus).toBe('loading');
      expect(state().goalsUserId).toBe('user-b');

      mocks.pending[1].release();
      await b;
      expect(state().goalsStatus).toBe('success');
      expect(state().goalsUserId).toBe('user-b');
      expect(state().goals.map((g) => g.name)).toEqual(['Do B']);
      expect(state().goals.some((g) => g.user_id === 'user-a')).toBe(false);
    });

    it('B responde antes e A chega depois: o tardio de A não sobrescreve B', async () => {
      twoUsers();
      const a = state().fetchGoals();
      await tick();
      setUser('user-b');
      const b = state().fetchGoals();
      await tick();

      mocks.pending[1].release();
      await b;
      expect(state().goals.map((g) => g.name)).toEqual(['Do B']);

      mocks.pending[0].release();
      await a;
      expect(state().goals.map((g) => g.name)).toEqual(['Do B']);
      expect(state().goalsStatus).toBe('success');
      expect(state().goalsUserId).toBe('user-b');
    });

    it('erro tardio de A não derruba o status de B', async () => {
      twoUsers();
      const a = state().fetchGoals();
      await tick();
      setUser('user-b');
      const b = state().fetchGoals();
      await tick();

      mocks.pending[0].release(true);
      await a;
      expect(state().goalsStatus).toBe('loading');

      mocks.pending[1].release();
      await b;
      expect(state().goalsStatus).toBe('success');
      expect(state().goals.map((g) => g.name)).toEqual(['Do B']);
    });

    it('mesma pessoa + loading não duplica a busca', async () => {
      twoUsers();
      const first = state().fetchGoals();
      await tick();
      const second = state().fetchGoals();
      const forced = state().fetchGoals({ force: true });
      await tick();
      expect(mocks.calls.filter((c) => c === 'select')).toHaveLength(1);
      mocks.pending[0].release();
      await Promise.all([first, second, forced]);
      expect(state().goalsStatus).toBe('success');
      expect(state().goals.map((g) => g.name)).toEqual(['Do A']);
    });

    it('logout durante a busca: a resposta tardia não ressuscita os objetivos', async () => {
      twoUsers();
      const a = state().fetchGoals();
      await tick();
      await state().signOut();
      mocks.pending[0].release();
      await a;
      expect(state().goals).toEqual([]);
      expect(state().goalsStatus).toBe('idle');
      expect(state().goalsUserId).toBeNull();
    });

    it('A → B → A com a primeira busca de A ainda pendente termina com os dados de A', async () => {
      twoUsers();
      const a1 = state().fetchGoals();
      await tick();
      setUser('user-b');
      const b = state().fetchGoals();
      await tick();
      setUser('user-a');
      const a2 = state().fetchGoals();
      await tick();
      expect(mocks.pending.map((p) => p.uid)).toEqual(['user-a', 'user-b', 'user-a']);

      mocks.pending[1].release(); // B tardio: usuário atual é A, descartado
      await b;
      expect(state().goals).toEqual([]);
      mocks.pending[2].release();
      mocks.pending[0].release();
      await Promise.all([a1, a2]);
      expect(state().goalsStatus).toBe('success');
      expect(state().goalsUserId).toBe('user-a');
      expect(state().goals.map((g) => g.name)).toEqual(['Do A']);
    });
  });

  it('não entra na carga inicial (fetchAllData) e não toca em transações', () => {
    const src = readFileSync(resolve('src/hooks/useAppStore.ts'), 'utf8');
    const start = src.indexOf('fetchAllData: async () => {');
    const end = src.indexOf('} catch', start);
    expect(start).toBeGreaterThan(0);
    expect(src.slice(start, end)).not.toMatch(/Goals/);
    const goalsBlock = src.slice(src.indexOf('fetchGoals: async'), src.indexOf('fetchAssets: async'));
    expect(goalsBlock).not.toMatch(/from\('transactions'\)|from\('contas'\)|from\('investments'\)|recalculateAsset|addTransaction/);
  });
});
