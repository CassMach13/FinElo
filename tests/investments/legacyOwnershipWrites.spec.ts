import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  rows: [] as Row[],
  visibleOwners: ['owner-a', 'owner-b'],
  actorId: 'actor-b',
  authCalls: [] as string[],
  insertCalls: [] as Row[][],
  selectError: null as unknown,
  insertError: null as unknown,
}));

// O familiar B pode ler A e B. O modelo aplica esse escopo e os filtros reais
// da query; não devolve uma resposta pronta que esconderia a ausência de user_id.
vi.mock('../../src/supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: async () => {
        state.authCalls.push('getUser');
        return { data: { user: { id: state.actorId } }, error: null };
      },
      signOut: async () => {
        state.authCalls.push('signOut');
        return { error: null };
      },
    },
    from: (table: string) => {
      let columns = '*';
      let limit: number | undefined;
      let inserted: Row[] | undefined;
      const filters: Array<[string, unknown]> = [];
      const execute = () => {
        if (table !== 'investments') throw new Error('Tabela inesperada');
        if (inserted !== undefined) {
          state.insertCalls.push(inserted.map((row) => ({ ...row })));
          if (state.insertError) return { data: null, error: state.insertError };
          if (inserted.some((row) => !state.visibleOwners.includes(String(row.user_id)))) {
            return { data: null, error: { code: '42501' } };
          }
          state.rows.push(...inserted.map((row) => ({ ...row })));
          return { data: null, error: null };
        }
        if (state.selectError) return { data: null, error: state.selectError };
        let rows = state.rows.filter((row) =>
          state.visibleOwners.includes(String(row.user_id))
          && filters.every(([key, value]) => row[key] === value)
        );
        if (limit !== undefined) rows = rows.slice(0, limit);
        const data = rows.map((row) => columns === '*'
          ? { ...row }
          : Object.fromEntries(columns.split(',').map((key) => [key, row[key]])));
        return { data, error: null };
      };
      const query: any = {
        select: (value = '*') => { columns = value; return query; },
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        limit: (value: number) => { limit = value; return query; },
        insert: (rows: Row[]) => { inserted = rows; return query; },
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
          Promise.resolve().then(execute).then(resolve, reject),
      };
      return query;
    },
  },
}));

import { investmentService } from '../../src/services/investmentService';

const row = (id: string, owner: string, month = '2026-09-01', balance = 100): Row => ({
  id,
  user_id: owner,
  institution: 'XP',
  product_type: 'CDB',
  product_name: id,
  balance,
  reference_month: month,
  source_file: 'extrato.xlsx',
  portfolio_id: `${owner}-portfolio`,
  holding_id: `${owner}-holding`,
  classified_by: 'previous-actor',
  classified_at: '2026-09-01T12:00:00Z',
});

const targetMonth = new Date(2026, 9, 1);

beforeEach(() => {
  state.rows = [];
  state.visibleOwners = ['owner-a', 'owner-b'];
  state.actorId = 'actor-b';
  state.authCalls = [];
  state.insertCalls = [];
  state.selectError = null;
  state.insertError = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  try {
    expect(state.authCalls).toEqual([]);
    expect(state.actorId).toBe('actor-b');
  } finally {
    vi.restoreAllMocks();
  }
});

describe('arquivo importado pertence ao proprietário solicitado', () => {
  it('arquivo do familiar não bloqueia A; instituição, mês e nome continuam sendo filtros', async () => {
    state.rows = [
      row('b-match', 'owner-b'),
      { ...row('a-institution', 'owner-a'), institution: 'Inter' },
      row('a-month', 'owner-a', '2026-08-01'),
      { ...row('a-file', 'owner-a'), source_file: 'outro.xlsx' },
    ];
    const before = state.rows.map((value) => ({ ...value }));
    expect(await investmentService.checkIfFileAlreadyImported('owner-a', 'XP', '2026-09-01', 'extrato.xlsx')).toBe(false);
    expect(state.rows).toEqual(before);
    expect(state.insertCalls).toEqual([]);
  });

  it('o próprio arquivo de A continua sendo detectado quando A e B têm o mesmo nome', async () => {
    state.rows = [row('b-match', 'owner-b'), row('a-match', 'owner-a')];
    expect(await investmentService.checkIfFileAlreadyImported('owner-a', 'XP', '2026-09-01', 'extrato.xlsx')).toBe(true);
    expect(await investmentService.checkIfFileAlreadyImported('owner-b', 'XP', '2026-09-01', 'extrato.xlsx')).toBe(true);
    expect(state.insertCalls).toEqual([]);
  });

  it('erro de leitura é propagado sem escrita ou alteração de sessão', async () => {
    const failure = new Error('duplicate lookup failed');
    state.selectError = failure;
    await expect(investmentService.checkIfFileAlreadyImported('owner-a', 'XP', '2026-09-01', 'extrato.xlsx')).rejects.toBe(failure);
    expect(state.insertCalls).toEqual([]);
  });
});

describe('cópia mensal preserva o proprietário solicitado', () => {
  it('B operando para A copia só posições de A do mês anterior, sem carregar classificação', async () => {
    state.rows = [
      row('b-previous', 'owner-b', '2026-09-01', 900),
      row('a-first', 'owner-a', '2026-09-01', 100),
      row('a-second', 'owner-a', '2026-09-01', 200),
      row('a-target', 'owner-a', '2026-10-01', 300),
      row('a-other-month', 'owner-a', '2026-08-01', 400),
    ];
    const before = state.rows.map((value) => ({ ...value }));
    await investmentService.copyFromPreviousMonth('owner-a', targetMonth);
    expect(state.insertCalls).toHaveLength(1);
    const copied = state.insertCalls[0];
    expect(copied.map(({ user_id, product_name, balance, reference_month }) =>
      ({ user_id, product_name, balance, reference_month }))).toEqual([
      { user_id: 'owner-a', product_name: 'a-first', balance: 100, reference_month: '2026-10-01' },
      { user_id: 'owner-a', product_name: 'a-second', balance: 200, reference_month: '2026-10-01' },
    ]);
    for (const value of copied) {
      for (const key of ['id', 'source_file', 'portfolio_id', 'holding_id', 'classified_by', 'classified_at']) {
        expect(value).not.toHaveProperty(key);
      }
    }
    expect(state.rows.slice(0, before.length)).toEqual(before);
  });

  it('só haver posições do familiar no mês anterior não cria posições para A', async () => {
    state.rows = [row('b-previous', 'owner-b')];
    const before = state.rows.map((value) => ({ ...value }));
    await investmentService.copyFromPreviousMonth('owner-a', targetMonth);
    expect(state.insertCalls).toEqual([]);
    expect(state.rows).toEqual(before);
  });

  it('erro ao buscar o mês anterior impede qualquer INSERT', async () => {
    const failure = new Error('previous month lookup failed');
    state.rows = [row('a-previous', 'owner-a')];
    state.selectError = failure;
    await expect(investmentService.copyFromPreviousMonth('owner-a', targetMonth)).rejects.toBe(failure);
    expect(state.insertCalls).toEqual([]);
    expect(state.rows).toHaveLength(1);
  });

  it('erro no INSERT é propagado e não altera as posições de origem', async () => {
    const failure = new Error('copy insert failed');
    state.rows = [row('a-previous', 'owner-a')];
    const before = state.rows.map((value) => ({ ...value }));
    state.insertError = failure;
    await expect(investmentService.copyFromPreviousMonth('owner-a', targetMonth)).rejects.toBe(failure);
    expect(state.insertCalls).toHaveLength(1);
    expect(state.rows).toEqual(before);
  });
});
