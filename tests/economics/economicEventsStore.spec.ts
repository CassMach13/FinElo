import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  pages: [] as Array<{ data: Row[] | null; error: unknown }>,
  calls: [] as Array<{ from: number; to: number }>,
  gate: null as null | Promise<void>,
  failNext: false,
  fetched: 0,
}));

vi.mock('../../src/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'economic_events') throw new Error(`tabela inesperada: ${table}`);
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        range: async (from: number, to: number) => {
          mocks.calls.push({ from, to });
          mocks.fetched += 1;
          if (mocks.gate) await mocks.gate;
          if (mocks.failNext) {
            mocks.failNext = false;
            return { data: null, error: { message: 'boom' } };
          }
          return mocks.pages.shift() ?? { data: [], error: null };
        },
      };
      return chain;
    },
    auth: { getUser: async () => ({ data: { user: null } }), signOut: async () => ({ error: null }) },
  },
}));
vi.mock('../../src/hooks/useDialogStore', () => ({ appAlert: vi.fn(), appConfirm: vi.fn() }));

import { useAppStore } from '../../src/hooks/useAppStore';

const ev = (id: string, kind = 'credit_card_payment', user = 'user-a') => ({
  id, user_id: user, kind, source: 'pay_invoice_flow', counterparty_account_id: null, created_by: user, created_at: 't',
});
const state = () => useAppStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, { pages: [], calls: [], gate: null, failNext: false, fetched: 0 });
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ user: { id: 'user-a' } as never });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('economicEvents no store', () => {
  it('fetchEconomicEvents carrega as linhas visíveis (uma consulta paginada)', async () => {
    mocks.pages = [{ data: [ev('e1'), ev('e2', 'own_account_transfer')], error: null }];
    await state().fetchEconomicEvents();
    expect(state().economicEvents.map((e) => [e.id, e.kind])).toEqual([['e1', 'credit_card_payment'], ['e2', 'own_account_transfer']]);
    expect(mocks.calls).toEqual([{ from: 0, to: 999 }]);
  });

  it('pagina quando a primeira página vem cheia (sem consulta por transação)', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ev(`p${i}`));
    mocks.pages = [{ data: full, error: null }, { data: [ev('last')], error: null }];
    await state().fetchEconomicEvents();
    expect(state().economicEvents).toHaveLength(1001);
    expect(mocks.calls).toEqual([{ from: 0, to: 999 }, { from: 1000, to: 1999 }]);
  });

  it('erro preserva o snapshot anterior (nunca apaga eventos conhecidos)', async () => {
    mocks.pages = [{ data: [ev('e1')], error: null }];
    await state().fetchEconomicEvents();
    mocks.failNext = true;
    await state().fetchEconomicEvents();
    expect(state().economicEvents.map((e) => e.id)).toEqual(['e1']);
  });

  it('um fetch posterior SUBSTITUI o snapshot (autoritativo, sem acumular stale)', async () => {
    mocks.pages = [{ data: [ev('e1'), ev('e2')], error: null }];
    await state().fetchEconomicEvents();
    mocks.pages = [{ data: [ev('e2'), ev('e3')], error: null }];
    await state().fetchEconomicEvents();
    expect(state().economicEvents.map((e) => e.id)).toEqual(['e2', 'e3']);
  });

  it('sem sessão não consulta', async () => {
    useAppStore.setState({ user: null as never });
    await state().fetchEconomicEvents();
    expect(mocks.fetched).toBe(0);
  });

  it('logout limpa os eventos', async () => {
    mocks.pages = [{ data: [ev('e1')], error: null }];
    await state().fetchEconomicEvents();
    await state().signOut();
    expect(state().economicEvents).toEqual([]);
  });

  it('troca A → B: a resposta tardia de A NÃO entra no estado de B', async () => {
    let release!: () => void;
    mocks.gate = new Promise<void>((r) => { release = r; });
    mocks.pages = [{ data: [ev('evento-de-A', 'credit_card_payment', 'user-a')], error: null }];
    const pending = state().fetchEconomicEvents();
    useAppStore.setState({ user: { id: 'user-b' } as never, economicEvents: [] });
    release();
    await pending;
    expect(state().economicEvents).toEqual([]);
  });

  it('logout durante o fetch: a resposta tardia é descartada', async () => {
    let release!: () => void;
    mocks.gate = new Promise<void>((r) => { release = r; });
    mocks.pages = [{ data: [ev('e1')], error: null }];
    const pending = state().fetchEconomicEvents();
    await state().signOut();
    release();
    await pending;
    expect(state().economicEvents).toEqual([]);
  });

  it('um fetch mais novo vence um mais antigo que responde depois (mesmo usuário)', async () => {
    let releaseOld!: () => void;
    mocks.gate = new Promise<void>((r) => { releaseOld = r; });
    mocks.pages = [{ data: [ev('velho')], error: null }];
    const old = state().fetchEconomicEvents();
    mocks.gate = null;
    mocks.pages = [{ data: [ev('novo')], error: null }];
    await state().fetchEconomicEvents();
    releaseOld();
    await old;
    expect(state().economicEvents.map((e) => e.id)).toEqual(['novo']);
  });

  it('rememberEconomicEvent insere e é idempotente por id (sem duplicar)', () => {
    state().rememberEconomicEvent(ev('e1') as never);
    state().rememberEconomicEvent(ev('e2', 'own_account_transfer') as never);
    state().rememberEconomicEvent({ ...ev('e1'), kind: 'own_account_transfer' } as never);
    expect(state().economicEvents.map((e) => [e.id, e.kind])).toEqual([['e1', 'own_account_transfer'], ['e2', 'own_account_transfer']]);
  });

  it('entra na carga inicial (fetchAllData) e o status só fecha depois de todas as cargas', () => {
    const store = readFileSync(resolve('src/hooks/useAppStore.ts'), 'utf8');
    const start = store.indexOf('fetchAllData: async () => {');
    const block = store.slice(start, store.indexOf('} catch', start));
    expect(block).toContain('get().fetchEconomicEvents(),');
    expect(block.indexOf("await Promise.all([")).toBeLessThan(block.lastIndexOf("initialDataLoadStatus:"));
  });
});
