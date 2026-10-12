import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../../src/types';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  alert: vi.fn(),
}));
vi.mock('../../src/supabaseClient', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc, auth: { getUser: mocks.getUser, signOut: mocks.signOut } },
}));
vi.mock('../../src/hooks/useDialogStore', () => ({ appAlert: mocks.alert, appConfirm: vi.fn() }));

import { BACKGROUND_SYNC_MIN_INTERVAL_MS, useAppStore } from '../../src/hooks/useAppStore';

const MAX_AGE = BACKGROUND_SYNC_MIN_INTERVAL_MS;
const userA = { id: 'user-a', user_metadata: {}, app_metadata: {} };
const userB = { id: 'user-b', user_metadata: {}, app_metadata: {} };

const tx = (id: string, Categoria = '-'): Transaction =>
  ({ ID_Transacao: id, user_id: 'user-a', Categoria, Valor: -10, Origem: 'manual', ID_Conta: 'c1' }) as unknown as Transaction;

/** Servidor falso de `transactions`: conta requisições e permite segurar/falhar cada resposta. */
function fakeServer() {
  const state = {
    rows: [tx('t1'), tx('t2')] as Transaction[],
    requests: 0,
    gates: [] as Array<{ release: () => void; fail: (e: Error) => void }>,
    gated: false,
    failNext: false,
    accounts: [{ id: 'acc-a' }] as Array<{ id: string }>,
    accountRequests: 0,
    accountsGated: false,
    accountsFail: false,
    accountGates: [] as Array<() => void>,
  };
  mocks.from.mockImplementation((table: string) => {
    if (table === 'contas') {
      return {
        select: () => {
          state.accountRequests += 1;
          const snapshot = state.accounts;
          if (state.accountsFail) return Promise.resolve({ data: null, error: { message: 'contas fora do ar' } });
          if (!state.accountsGated) return Promise.resolve({ data: snapshot, error: null });
          return new Promise((res) => {
            state.accountGates.push(() => res({ data: snapshot, error: null }));
          });
        },
      };
    }
    if (table !== 'transactions') throw new Error(`Tabela inesperada: ${table}`);
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.order = () => builder;
    builder.range = () => {
      state.requests += 1;
      const snapshot = state.rows; // o servidor "lê" no momento do pedido
      if (state.failNext) {
        state.failNext = false;
        return Promise.resolve({ data: null, error: { message: 'rede caiu' } });
      }
      if (!state.gated) return Promise.resolve({ data: snapshot, error: null });
      return new Promise((res, rej) => {
        state.gates.push({
          release: () => res({ data: snapshot, error: null }),
          fail: (e) => rej(e),
        });
      });
    };
    return builder;
  });
  return state;
}

const stubOtherFetchers = () => {
  const noop = vi.fn().mockResolvedValue(undefined);
  useAppStore.setState({
    refreshAtomicImportEligibility: vi.fn().mockResolvedValue(false),
    fetchAccounts: noop,
    fetchCategories: noop,
    fetchBudgets: noop,
    fetchBudgetMonths: noop,
    fetchEconomicEvents: noop,
    fetchMappingRules: noop,
    fetchImportConfigs: noop,
    fetchPendingInvites: noop,
    fetchImportLogs: noop,
    fetchSubscription: noop,
    fetchAssets: noop,
    fetchFounderCount: noop,
    fetchCreditCardReprocessJobs: noop,
  } as never);
};

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Usa o fetchAccounts real (os demais seguem stubados) para observar contas de verdade. */
const useRealAccounts = () =>
  useAppStore.setState({ fetchAccounts: useAppStore.getInitialState().fetchAccounts } as never);

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState(useAppStore.getInitialState(), true);
  mocks.signOut.mockResolvedValue({ error: null });
  useAppStore.setState({ user: userA } as never);
  stubOtherFetchers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Carrega uma vez e devolve o servidor falso já "aquecido". */
async function loadedStore() {
  const server = fakeServer();
  await useAppStore.getState().fetchAllData();
  expect(server.requests).toBe(1);
  return server;
}

describe('carga inicial', () => {
  it('é bloqueante só enquanto não há dados utilizáveis e marca o dono do snapshot', async () => {
    const server = fakeServer();
    server.gated = true;
    const loading = useAppStore.getState().fetchAllData();
    await flush();
    expect(useAppStore.getState().isLoading).toBe(true);

    server.gates[0].release();
    await loading;

    const s = useAppStore.getState();
    expect(s.isLoading).toBe(false);
    expect(s.transactions.map((t) => t.ID_Transacao)).toEqual(['t1', 't2']);
    expect(s.transactionsUserId).toBe('user-a');
    expect(s.initialDataLoadStatus).toBe('ready');
  });

  it('uma conta realmente vazia conta como carregada (não fica em loading eterno)', async () => {
    const server = fakeServer();
    server.rows = [];
    await useAppStore.getState().fetchAllData();
    const s = useAppStore.getState();
    expect(s.transactionsUserId).toBe('user-a');
    expect(s.isLoading).toBe(false);
  });

  it('falha na carga inicial avisa, fica em erro e não finge que há dados', async () => {
    const server = fakeServer();
    server.failNext = true;
    await useAppStore.getState().fetchAllData();
    const s = useAppStore.getState();
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(s.initialDataLoadStatus).toBe('error');
    expect(s.transactionsUserId).toBeNull();
    expect(s.isLoading).toBe(false);
  });
});

describe('navegação repetida e eventos de foco/visibilidade', () => {
  it('entrar na tela várias vezes reaproveita o snapshot recente: nenhuma requisição nova', async () => {
    const server = await loadedStore();
    for (let i = 0; i < 5; i++) await useAppStore.getState().syncAllData({ maxAgeMs: MAX_AGE });
    expect(server.requests).toBe(1);
    expect(useAppStore.getState().isLoading).toBe(false);
  });

  it('foco + visibilidade juntos viram uma única requisição', async () => {
    const server = await loadedStore();
    useAppStore.setState({ fullSyncedAt: Date.now() - MAX_AGE - 1 });
    server.gated = true;
    const a = useAppStore.getState().syncAllData({ maxAgeMs: MAX_AGE });
    const b = useAppStore.getState().syncAllData({ maxAgeMs: MAX_AGE });
    await flush();
    expect(server.requests).toBe(2); // 1 da carga inicial + 1 compartilhada
    server.gates[0].release();
    await Promise.all([a, b]);
    expect(server.requests).toBe(2);
  });

  it('snapshot velho sincroniza em segundo plano sem bloquear nem esvaziar a lista', async () => {
    const server = await loadedStore();
    useAppStore.setState({ fullSyncedAt: Date.now() - MAX_AGE - 1 });
    server.rows = [tx('t1'), tx('t2'), tx('t3')];
    server.gated = true;

    const sync = useAppStore.getState().syncAllData({ maxAgeMs: MAX_AGE });
    await flush();
    const during = useAppStore.getState();
    expect(during.isLoading).toBe(false);
    expect(during.transactions.map((t) => t.ID_Transacao)).toEqual(['t1', 't2']);

    server.gates[0].release();
    await sync;
    expect(useAppStore.getState().transactions.map((t) => t.ID_Transacao)).toEqual(['t1', 't2', 't3']);
  });
});

describe('requisições concorrentes', () => {
  it('pedidos explícitos durante uma carga em voo colapsam em UMA recarga final', async () => {
    const server = fakeServer();
    server.gated = true;
    const first = useAppStore.getState().fetchAllData();
    const others = [
      useAppStore.getState().fetchAllData(),
      useAppStore.getState().fetchAllData(),
      useAppStore.getState().fetchAllData(),
    ];
    await flush();
    expect(server.requests).toBe(1);

    server.gated = false;
    server.gates[0].release();
    await Promise.all([first, ...others]);
    expect(server.requests).toBe(2); // em voo + uma recarga compartilhada
  });
});

describe('edições locais x respostas atrasadas', () => {
  it('snapshot iniciado antes da edição não sobrescreve a edição', async () => {
    const server = await loadedStore();
    useAppStore.setState({ fullSyncedAt: Date.now() - MAX_AGE - 1 });
    server.gated = true;
    const sync = useAppStore.getState().syncAllData({ maxAgeMs: MAX_AGE });
    await flush();

    // Edição local (o que updateTransaction faz no estado) enquanto o snapshot velho está a caminho.
    useAppStore.setState((s) => ({
      transactions: s.transactions.map((t) => (t.ID_Transacao === 't1' ? { ...t, Categoria: 'Mercado' } : t)),
    }));

    server.gates[0].release(); // chega com t1 ainda sem categoria
    await sync;

    const t1 = useAppStore.getState().transactions.find((t) => t.ID_Transacao === 't1');
    expect(t1?.Categoria).toBe('Mercado');
    expect(useAppStore.getState().isLoading).toBe(false);
  });

  it('um snapshot sem edição entre o início e o fim é aplicado normalmente', async () => {
    const server = await loadedStore();
    useAppStore.setState({ fullSyncedAt: Date.now() - MAX_AGE - 1 });
    server.rows = [tx('t1', 'Lazer'), tx('t2')];
    await useAppStore.getState().syncAllData({ maxAgeMs: MAX_AGE });
    expect(useAppStore.getState().transactions[0].Categoria).toBe('Lazer');
  });

  it('sem base carregada, edição durante a carga não deixa a lista só com a edição: busca de novo', async () => {
    const server = fakeServer();
    server.gated = true;
    const load = useAppStore.getState().fetchAllData();
    await flush();
    useAppStore.setState({ transactions: [tx('novo')] }); // lançamento criado antes da base chegar

    server.rows = [tx('t1'), tx('t2'), tx('novo')]; // o servidor já tem o novo na releitura
    server.gated = false; // a releitura (2ª requisição) não fica segurada
    server.gates[0].release(); // o snapshot velho chega e é descartado
    await load;

    const s = useAppStore.getState();
    expect(s.transactionsUserId).toBe('user-a');
    expect(s.transactions.map((t) => t.ID_Transacao)).toEqual(['t1', 't2', 'novo']);
  });
});

describe('falha de sincronização em segundo plano', () => {
  it('mantém a lista, não bloqueia, não alerta e tenta de novo no próximo gatilho', async () => {
    const server = await loadedStore();
    const before = useAppStore.getState().transactions;
    useAppStore.setState({ fullSyncedAt: Date.now() - MAX_AGE - 1 });
    server.failNext = true;

    await useAppStore.getState().syncAllData({ maxAgeMs: MAX_AGE });

    const s = useAppStore.getState();
    expect(s.transactions).toBe(before);
    expect(s.isLoading).toBe(false);
    expect(s.initialDataLoadStatus).toBe('ready');
    expect(mocks.alert).not.toHaveBeenCalled();

    // não conta como sincronizado: o próximo gatilho refaz a busca
    await useAppStore.getState().syncAllData({ maxAgeMs: MAX_AGE });
    expect(server.requests).toBe(3);
  });
});

describe('troca de usuário e logout', () => {
  it('trocar de usuário esvazia a lista anterior e o snapshot do outro não vale', async () => {
    const server = await loadedStore();
    useAppStore.setState({ fullSyncedAt: Date.now() }); // recente: pularia se fosse o mesmo usuário

    useAppStore.getState().setUser(userB as never);
    const s = useAppStore.getState();
    expect(s.transactions).toEqual([]);
    expect(s.transactionsUserId).toBeNull();

    await useAppStore.getState().syncAllData({ maxAgeMs: MAX_AGE });
    expect(server.requests).toBe(2); // não reaproveitou o snapshot do usuário A
    expect(useAppStore.getState().transactionsUserId).toBe('user-b');
  });

  it('resposta atrasada do usuário anterior nunca entra na sessão nova', async () => {
    const server = fakeServer();
    server.gated = true;
    server.rows = [tx('a1')];
    const loadA = useAppStore.getState().fetchAllData();
    await flush();

    useAppStore.getState().setUser(userB as never);
    server.rows = [tx('b1')];
    const loadB = useAppStore.getState().fetchAllData();
    await flush();

    server.gates[0].release(); // resposta de A chega depois da troca
    await flush();
    expect(useAppStore.getState().transactions.map((t) => t.ID_Transacao)).not.toContain('a1');

    server.gated = false;
    for (const gate of server.gates.slice(1)) gate.release();
    await Promise.all([loadA, loadB]);
    const ids = useAppStore.getState().transactions.map((t) => t.ID_Transacao);
    expect(ids).not.toContain('a1');
    expect(useAppStore.getState().transactionsUserId).toBe('user-b');
  });

  it('logout limpa lista e snapshot; o mesmo usuário ao voltar carrega do zero', async () => {
    const server = await loadedStore();
    await useAppStore.getState().signOut();
    let s = useAppStore.getState();
    expect(s.transactions).toEqual([]);
    expect(s.transactionsUserId).toBeNull();
    expect(s.fullSyncedAt).toBeNull();

    useAppStore.getState().setUser(userA as never);
    await useAppStore.getState().syncAllData({ maxAgeMs: MAX_AGE });
    s = useAppStore.getState();
    expect(server.requests).toBe(2);
    expect(s.transactions).toHaveLength(2);
  });
});

describe('isolamento de sessão: A em voo → B', () => {
  it('resposta tardia de contas/transações de A nunca entra no estado de B', async () => {
    const server = fakeServer();
    useRealAccounts();
    server.gated = true;
    server.accountsGated = true;
    server.accounts = [{ id: 'acc-a' }];
    server.rows = [tx('a1')];
    const loadA = useAppStore.getState().fetchAllData();
    await flush();

    useAppStore.getState().setUser(userB as never);
    server.accounts = [{ id: 'acc-b' }];
    server.rows = [tx('b1')];
    server.accountsGated = false;
    server.gated = false;
    await useAppStore.getState().fetchAllData(); // B carrega por completo (não reaproveita a carga de A)
    expect(useAppStore.getState().accounts).toEqual([{ id: 'acc-b' }]);

    // agora as respostas de A, que ficaram penduradas, chegam por último
    server.accountGates.forEach((release) => release());
    server.gates.forEach((g) => g.release());
    await loadA;

    const s = useAppStore.getState();
    expect(s.accounts).toEqual([{ id: 'acc-b' }]);
    expect(s.transactions.map((t) => t.ID_Transacao)).toEqual(['b1']);
    expect(s.transactionsUserId).toBe('user-b');
  });

  it('a recarga final agendada por A não roda para B, e B não reaproveita a carga de A', async () => {
    const server = fakeServer();
    server.gated = true;
    const loadA = useAppStore.getState().fetchAllData();
    const trailingA = useAppStore.getState().fetchAllData(); // vira a recarga final de A
    await flush();
    expect(server.requests).toBe(1);

    useAppStore.getState().setUser(userB as never);
    server.gated = false;
    server.rows = [tx('b1')];
    await useAppStore.getState().fetchAllData(); // carga própria de B
    expect(server.requests).toBe(2);

    server.gates[0].release();
    await Promise.all([loadA, trailingA]);
    expect(server.requests).toBe(2); // a recarga final de A foi descartada
    expect(useAppStore.getState().transactions.map((t) => t.ID_Transacao)).toEqual(['b1']);
  });

  it('trocar de usuário esvazia os dados do anterior e não herda o plano dele', () => {
    useAppStore.setState({
      accounts: [{ id: 'acc-a' }],
      categories: [{ id: 'cat-a' }],
      importLogs: [{ id: 'log-a' }],
      isPremium: true,
      isWealth: true,
      unlimitedSync: true,
      subscription: { status: 'active' },
    } as never);

    useAppStore.getState().setUser(userB as never);
    const s = useAppStore.getState();
    expect(s.accounts).toEqual([]);
    expect(s.categories).toEqual([]);
    expect(s.importLogs).toEqual([]);
    expect(s.subscription).toBeNull();
    expect([s.isPremium, s.isWealth, s.unlimitedSync]).toEqual([false, false, false]);
  });

  it('o mesmo usuário reautenticando (mesmo id) não perde nada', () => {
    useAppStore.setState({ accounts: [{ id: 'acc-a' }], isPremium: true } as never);
    useAppStore.getState().setUser({ ...userA, user_metadata: { x: 1 } } as never);
    expect(useAppStore.getState().accounts).toEqual([{ id: 'acc-a' }]);
    expect(useAppStore.getState().isPremium).toBe(true);
  });
});

describe('frescor: carga incompleta ou falha não vira "recente"', () => {
  it('conta falhou na carga inicial: não carimba, e a próxima sincronização tenta de novo', async () => {
    const server = fakeServer();
    useRealAccounts();
    server.accountsFail = true;
    await useAppStore.getState().fetchAllData();

    let s = useAppStore.getState();
    expect(s.transactionsUserId).toBe('user-a'); // transações chegaram
    expect(s.fullSyncedAt).toBeNull(); // mas a carga não foi completa

    server.accountsFail = false;
    await useAppStore.getState().syncAllData({ maxAgeMs: MAX_AGE }); // dentro dos 30s, e mesmo assim refaz
    expect(server.requests).toBe(2);
    expect(server.accountRequests).toBe(2);
    s = useAppStore.getState();
    expect(s.accounts).toEqual([{ id: 'acc-a' }]);
    expect(s.fullSyncedAt).not.toBeNull();

    await useAppStore.getState().syncAllData({ maxAgeMs: MAX_AGE }); // agora sim é recente
    expect(server.requests).toBe(2);
  });

  it('falha de transações em segundo plano não avança o carimbo', async () => {
    const server = await loadedStore();
    const stamp = Date.now() - MAX_AGE - 1;
    useAppStore.setState({ fullSyncedAt: stamp });
    server.failNext = true;
    await useAppStore.getState().syncAllData({ maxAgeMs: MAX_AGE });
    expect(useAppStore.getState().fullSyncedAt).toBe(stamp);
  });

  it('snapshot descartado por edição local não vira "recente"', async () => {
    const server = await loadedStore();
    const stamp = Date.now() - MAX_AGE - 1;
    useAppStore.setState({ fullSyncedAt: stamp });
    server.gated = true;
    const sync = useAppStore.getState().syncAllData({ maxAgeMs: MAX_AGE });
    await flush();
    useAppStore.setState((s) => ({ transactions: s.transactions.map((t) => ({ ...t, Categoria: 'X' })) }));
    server.gates[0].release();
    await sync;
    expect(useAppStore.getState().fullSyncedAt).toBe(stamp);
  });

  it('atualização pedida pelo usuário (fetchAllData) ignora a janela e traz dado novo', async () => {
    const server = await loadedStore();
    useAppStore.setState({ fullSyncedAt: Date.now() }); // acabou de sincronizar
    server.rows = [tx('t1'), tx('t2'), tx('t3')];

    await useAppStore.getState().fetchAllData();

    expect(server.requests).toBe(2);
    expect(useAppStore.getState().transactions.map((t) => t.ID_Transacao)).toEqual(['t1', 't2', 't3']);
  });

  it('pedido do usuário durante uma sincronização em voo ganha uma leitura posterior ao pedido', async () => {
    const server = await loadedStore();
    useAppStore.setState({ fullSyncedAt: Date.now() - MAX_AGE - 1 });
    server.gated = true;
    const background = useAppStore.getState().syncAllData({ maxAgeMs: MAX_AGE });
    await flush();

    server.rows = [tx('t1'), tx('t2'), tx('novo-no-servidor')]; // mudou depois que a em voo leu
    server.gated = false;
    const requested = useAppStore.getState().fetchAllData();
    server.gates[0].release();
    await Promise.all([background, requested]);

    expect(useAppStore.getState().transactions.map((t) => t.ID_Transacao)).toContain('novo-no-servidor');
  });
});

describe('fiação nas telas', () => {
  const read = (p: string) => readFileSync(resolve(p), 'utf8').replaceAll('\r\n', '\n');

  it('App: foco, visibilidade e SIGNED_IN usam a sincronização de segundo plano', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('syncAllData({ maxAgeMs: BACKGROUND_SYNC_MIN_INTERVAL_MS })');
    expect(app).toMatch(/if \(_event === 'SIGNED_IN'\) \{\n\s*void stableSyncAllData\(\);/);
    expect(app).toMatch(/document\.visibilityState === 'visible' && user\) \{[\s\S]*?void stableSyncAllData\(\);/);
    // a carga inicial continua completa
    expect(app).toContain('void stableFetchAllData();');
  });

  it('TransactionsView: não recarrega tudo ao montar e só bloqueia sem dados em tela', () => {
    const view = read('src/components/views/TransactionsView.tsx');
    expect(view).toContain('void syncAllData({ maxAgeMs: BACKGROUND_SYNC_MIN_INTERVAL_MS });');
    expect(view).not.toMatch(/useEffect\(\(\) => \{\s*fetchAllData\(\);\s*\}, \[fetchAllData\]\);/);
    expect(view).toContain('const showBlockingLoader = isLoading && transactions.length === 0;');
    expect(view).not.toMatch(/\{isLoading && \(/);
  });
});
