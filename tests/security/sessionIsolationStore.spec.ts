/**
 * Isolamento entre sessões no store do app (Etapa 1 da alternância de contas).
 *
 * O cliente é o supabase-js REAL, com a barreira de rede de produção, sobre um backend falso que imita a RLS
 * owner-only pelo `sub` do portador. Como no app, o token anexado é o da sessão ATUAL do SDK no momento do envio.
 * Respostas podem ser seguradas para reproduzir corridas (troca de conta durante carga ou gravação).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown> & { user_id: string };

const h = vi.hoisted(() => ({
  token: null as string | null,
  authUser: null as null | { id: string; email: string },
  /** Respostas seguradas por tabela até `release`. */
  holdTables: new Set<string>(),
  held: [] as Array<{ table: string; release: () => void }>,
  tables: new Map<string, Row[]>(),
  requests: [] as Array<{ method: string; table: string; sub: string | null }>,
  getUserGate: null as null | Promise<void>,
  /** Segura a resposta do servidor ao logout. */
  signOutGate: null as null | Promise<void>,
  /** O servidor não confirma o logout (rede/5xx): como o supabase-js, devolve erro e MANTÉM a sessão. */
  signOutFails: false,
  failTables: new Set<string>(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  alert: undefined as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cardStatements: undefined as any,
}));

vi.mock('../../src/supabaseClient', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const { createSessionFencedFetch } = await import('../../src/domain/session/sessionFence');
  const { readBearerIdentity } = await import('../../src/domain/session/sessionScope');
  const base = 'https://project.supabase.test';
  const backendFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const sub = readBearerIdentity((new Headers(init?.headers).get('Authorization') ?? '').replace(/^Bearer /, ''))?.sub ?? null;
    const table = url.pathname.replace('/rest/v1/', '');
    h.requests.push({ method, table, sub });
    // Resposta calculada no ENVIO (como o banco), entregue depois se a tabela estiver segurada.
    let body: unknown;
    const rows = h.tables.get(table) ?? [];
    if (method === 'POST') {
      const payload = JSON.parse(String(init?.body ?? '[]'));
      const inserted = (Array.isArray(payload) ? payload : [payload]).map((p: Row, i: number) => ({
        id: `${table}-${rows.length + i + 1}`,
        ...p,
      }));
      // RLS: só insere como o próprio portador.
      if (!sub || inserted.some((r: Row) => r.user_id !== sub)) {
        return new Response(JSON.stringify({ message: 'rls' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
      rows.push(...inserted);
      h.tables.set(table, rows);
      body = inserted;
    } else {
      body = rows.filter((r) => r.user_id === sub);
    }
    if (h.holdTables.has(table)) {
      await new Promise<void>((release) => h.held.push({ table, release }));
    }
    if (h.failTables.has(table)) {
      return new Response(JSON.stringify({ message: 'falha de rede simulada' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(body), { status: method === 'POST' ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
  };
  const real = createClient(base, 'sb_publishable_test', {
    accessToken: async () => h.token,
    global: { fetch: createSessionFencedFetch(base, backendFetch) },
  });
  const supabase = {
    from: (t: string) => real.from(t),
    rpc: async () => ({ data: null, error: { message: 'rpc indisponível no teste' } }),
    storage: real.storage,
    functions: real.functions,
    auth: {
      // getUser do SDK global: devolve a sessão ATUAL quando resolve (não a de quem chamou).
      getUser: async () => {
        if (h.getUserGate) await h.getUserGate;
        return { data: { user: h.authUser }, error: null };
      },
      getSession: async () => ({ data: { session: h.token && h.authUser ? { access_token: h.token, user: h.authUser } : null }, error: null }),
      signOut: async () => {
        if (h.signOutGate) await h.signOutGate;
        if (h.signOutFails) return { error: { message: 'Failed to fetch' } };
        h.token = null;
        h.authUser = null;
        return { error: null };
      },
      // Caminho interno do SDK que apaga a sessão guardada (contrato verificado em sessionSignOut.spec.ts).
      _removeSession: async () => {
        h.token = null;
        h.authUser = null;
      },
    },
  };
  return { supabase, persistAppearanceTheme: vi.fn(), persistUserMetadata: vi.fn() };
});

vi.mock('../../src/hooks/useDialogStore', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/hooks/useDialogStore')>();
  h.alert = vi.fn(async () => undefined);
  return { ...original, appAlert: h.alert };
});

vi.mock('../../src/services/creditCardEngineService', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/services/creditCardEngineService')>();
  h.cardStatements = vi.fn();
  return {
    ...original,
    creditCardEngineService: { ...original.creditCardEngineService, getCardStatements: h.cardStatements },
  };
});

import { useAppStore } from '../../src/hooks/useAppStore';
import { useDialogStore } from '../../src/hooks/useDialogStore';
import { getSessionEpoch, observeSessionInstance, resetSessionScopeForTests } from '../../src/domain/session/sessionScope';
import { loadPersistedTransactionFilters, savePersistedTransactionFilters, TRANSACTION_FILTERS_STORAGE_KEY } from '../../src/utils/transactionPeriodFilters';
import { getDefaultTransactionFilters } from '../../src/utils/transactionPeriodFilters';
import { userJwt } from '../helpers/fakeJwt';

const meta = { credit_card_engine_disabled: true, card_v2_disabled: true, card_v2_shadow_disabled: true };
const A = { id: 'user-A', email: 'a@example.test', user_metadata: meta, app_metadata: {}, aud: 'authenticated', created_at: '' };
const B = { id: 'user-B', email: 'b@example.test', user_metadata: meta, app_metadata: {}, aud: 'authenticated', created_at: '' };

/** O que o App faz num login/troca: o SDK passa a ter o token da conta e o App chama setUser. */
const signInAs = (u: typeof A, sessionId = `sess-${u.id}`) => {
  h.token = userJwt(u.id, sessionId);
  h.authUser = { id: u.id, email: u.email };
  useAppStore.getState().setUser(u as never);
  observeSessionInstance(u.id, sessionId);
};

const seed = (table: string, rows: Row[]) => h.tables.set(table, rows.map((r) => ({ ...r })));
const releaseAll = async () => {
  for (const item of h.held.splice(0)) item.release();
  await flush();
};
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
};

const initial = useAppStore.getState();

beforeEach(() => {
  h.token = null;
  h.authUser = null;
  h.holdTables.clear();
  h.held.splice(0);
  h.tables.clear();
  h.requests.splice(0);
  h.getUserGate = null;
  h.signOutGate = null;
  h.signOutFails = false;
  h.failTables.clear();
  h.alert.mockClear();
  h.cardStatements.mockReset();
  useAppStore.setState({ ...initial, user: null }, true);
  resetSessionScopeForTests();
  seed('contas', [
    { id: 'acc-A', user_id: A.id, Nome_Conta: 'Conta secreta de A', Tipo_Conta: 'Conta Corrente' },
    { id: 'acc-B', user_id: B.id, Nome_Conta: 'Conta de B', Tipo_Conta: 'Conta Corrente' },
  ]);
  seed('categories', [
    { id: 'cat-A', user_id: A.id, Nome_Categoria: 'Categoria de A', Tipo: 'Despesa' },
    { id: 'cat-B', user_id: B.id, Nome_Categoria: 'Categoria de B', Tipo: 'Despesa' },
  ]);
  seed('transactions', [
    { ID_Transacao: 'tx-A', user_id: A.id, Valor: -1234.56, Nome_Fantasia: 'Compra de A' },
    { ID_Transacao: 'tx-B', user_id: B.id, Valor: -10, Nome_Fantasia: 'Compra de B' },
  ]);
  seed('assets', [
    { id: 'as-A', user_id: A.id, name: 'Imóvel de A', is_financed: false },
    { id: 'as-B', user_id: B.id, name: 'Carro de B', is_financed: false },
  ]);
  seed('budgets', [{ id: 'bud-A', user_id: A.id, Categoria: 'Categoria de A', Valor: 900 }]);
  seed('mapping_rules', [{ id: 'rule-A', user_id: A.id, keyword: 'segredo' }]);
});

afterEach(async () => {
  await releaseAll();
});

const ids = (rows: ReadonlyArray<object>, key = 'id') => rows.map((r) => (r as Record<string, unknown>)[key]);

describe('1. dados financeiros de A nunca aparecem na sessão de B', () => {
  const populateAsA = () => {
    useAppStore.setState({
      transactions: [{ ID_Transacao: 'tx-A' } as never],
      transactionsUserId: A.id,
      fullSyncedAt: 1,
      accounts: [{ id: 'acc-A' } as never],
      categories: [{ id: 'cat-A' } as never],
      budgets: [{ id: 'bud-A' } as never],
      budgetMonths: [{ id: 'bm-A' } as never],
      economicEvents: [{ id: 'ev-A' } as never],
      mappingRules: [{ id: 'rule-A' } as never],
      importConfigs: [{ id: 'cfg-A' } as never],
      importLogs: [{ id: 'log-A' } as never],
      assets: [{ id: 'as-A' } as never],
      goals: [{ id: 'goal-A' } as never],
      goalsUserId: A.id,
      goalsStatus: 'success',
      pendingInvites: [{ id: 'inv-A' } as never],
      subscription: { id: 'sub-A' } as never,
      isPremium: true,
      isWealth: true,
      unlimitedSync: true,
      atomicImportEnabled: true,
      supportTickets: [{ id: 'tk-A' } as never],
      adminMetrics: { total: 1 } as never,
      helpIntent: { topic: 'x' } as never,
      budgetManagerRequested: true,
      currentView: 'investments',
      transactionFilters: { ...getDefaultTransactionFilters(), text: 'busca de A', accountId: ['acc-A'], ownerUserId: A.id },
      creditCardShadowDashboard: [{ id: 'shadow-A' } as never],
      creditCardReprocessJobs: [{ id: 'job-A' } as never],
      creditCardStatements: [{ id: 'st-A' } as never],
      creditCardStatementEntries: [{ id: 'en-A' } as never],
      selectedCreditCardStatementAudit: { statementId: 'st-A' } as never,
    });
  };

  const expectNoSessionData = () => {
    const s = useAppStore.getState();
    for (const key of [
      'transactions', 'accounts', 'categories', 'budgets', 'budgetMonths', 'economicEvents', 'mappingRules',
      'importConfigs', 'importLogs', 'assets', 'goals', 'pendingInvites', 'supportTickets',
      'creditCardShadowDashboard', 'creditCardReprocessJobs', 'creditCardStatements', 'creditCardStatementEntries',
    ] as const) {
      expect(s[key], key).toEqual([]);
    }
    expect(s.subscription).toBeNull();
    expect(s.adminMetrics).toBeNull();
    expect(s.selectedCreditCardStatementAudit).toBeNull();
    expect(s.helpIntent).toBeNull();
    expect([s.isPremium, s.isWealth, s.unlimitedSync, s.atomicImportEnabled, s.budgetManagerRequested]).toEqual([false, false, false, false, false]);
    expect(s.transactionFilters).toEqual(getDefaultTransactionFilters());
    expect(s.currentView).toBe('dashboard');
    expect([s.transactionsUserId, s.fullSyncedAt, s.goalsUserId]).toEqual([null, null, null]);
    expect(JSON.stringify(s)).not.toMatch(/-A"|user-A|busca de A/);
  };

  it('troca direta A → B limpa todo o estado escopado (inclusive cartões, faturas e auditoria)', () => {
    signInAs(A);
    populateAsA();
    const revision = useAppStore.getState().creditCardEngineRevision;
    signInAs(B);
    expectNoSessionData();
    expect(useAppStore.getState().user?.id).toBe(B.id);
    expect(useAppStore.getState().creditCardEngineRevision).toBeGreaterThan(revision);
  });

  it('logout aplica a MESMA limpeza central (antes: assinatura, plano, convites, tickets e admin ficavam)', async () => {
    signInAs(A);
    populateAsA();
    await useAppStore.getState().signOut();
    expectNoSessionData();
    expect(useAppStore.getState().user).toBeNull();
    expect(useAppStore.getState().initialDataLoadStatus).toBe('idle');
  });

  it('confirmação aberta por A fecha como "cancelar" na troca — nunca autoriza a operação de A', async () => {
    signInAs(A);
    const answer = useDialogStore.getState().openDialog({ message: 'Excluir lote de A?' });
    signInAs(B);
    await expect(answer).resolves.toBe(false);
    expect(useDialogStore.getState().isOpen).toBe(false);
    expect(useDialogStore.getState().options).toBeNull();
  });

  it('troca de usuário escrita direto no estado (fora do setUser) também invalida a sessão anterior', async () => {
    signInAs(A);
    h.holdTables.add('contas');
    const stale = useAppStore.getState().fetchAccounts();
    await flush();
    h.token = userJwt(B.id);
    useAppStore.setState({ user: B as never, isLoading: true });
    expect(useAppStore.getState().isLoading).toBe(false); // a transição libera o loading da sessão que saiu
    await releaseAll();
    await stale;
    expect(useAppStore.getState().accounts).toEqual([]);
  });

  it('nova instância de login do mesmo usuário e logout também fecham a confirmação pendente como "cancelar"', async () => {
    signInAs(A, 'sess-A-1');
    const fromOldInstance = useDialogStore.getState().openDialog({ message: 'Confirmar pagamento?' });
    observeSessionInstance(A.id, 'sess-A-2'); // mesmo usuário, novo login (sem troca de user.id)
    await expect(fromOldInstance).resolves.toBe(false);
    const beforeLogout = useDialogStore.getState().openDialog({ message: 'Excluir conta?' });
    const out = useAppStore.getState().signOut();
    await expect(beforeLogout).resolves.toBe(false);
    await out;
  });

  it('filtros persistidos de A não são lidos na sessão de B; chave antiga sem dono é descartada', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    });
    try {
      storage.set(TRANSACTION_FILTERS_STORAGE_KEY, JSON.stringify({ text: 'legado sem dono' }));
      expect(loadPersistedTransactionFilters()).toBeNull(); // sem sessão: nada lido
      signInAs(A);
      expect(loadPersistedTransactionFilters()).toBeNull(); // legado não é atribuído a A
      expect(storage.has(TRANSACTION_FILTERS_STORAGE_KEY)).toBe(false);
      savePersistedTransactionFilters({ ...getDefaultTransactionFilters(), text: 'busca de A', accountId: ['acc-A'] });
      expect(loadPersistedTransactionFilters()).toMatchObject({ text: 'busca de A' });
      signInAs(B);
      expect(loadPersistedTransactionFilters()).toBeNull();
      signInAs(A);
      expect(loadPersistedTransactionFilters()).toMatchObject({ text: 'busca de A' }); // A mantém a sua
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('2. respostas atrasadas não contaminam a nova sessão', () => {
  it('troca durante a carga de transações, contas, categorias, orçamentos, regras e patrimônio', async () => {
    signInAs(A);
    for (const t of ['transactions', 'contas', 'categories', 'budgets', 'mapping_rules', 'assets']) h.holdTables.add(t);
    const s = useAppStore.getState();
    const pending = [s.fetchTransactions(), s.fetchAccounts(), s.fetchCategories(), s.fetchBudgets(), s.fetchMappingRules(), s.fetchAssets()];
    await flush();
    expect(h.held.length).toBe(6);
    signInAs(B);
    await releaseAll();
    await Promise.all(pending);
    const after = useAppStore.getState();
    expect(after.user?.id).toBe(B.id);
    expect([after.transactions, after.accounts, after.categories, after.budgets, after.mappingRules, after.assets]).toEqual([[], [], [], [], [], []]);
    expect(after.transactionsUserId).toBeNull();
    expect(JSON.stringify(after)).not.toContain('de A');
    // Todas as leituras de A saíram com a credencial de A (nenhuma com a de B).
    expect(h.requests.every((r) => r.sub === A.id)).toBe(true);
  });

  it('troca durante a carga de faturas do cartão: faturas de A não entram (nem rotuladas como B)', async () => {
    signInAs(A);
    let deliver!: (rows: unknown[]) => void;
    h.cardStatements.mockImplementation(() => new Promise((r) => (deliver = r)));
    const loading = useAppStore.getState().getCardStatements('card-A');
    signInAs(B);
    deliver([{ id: 'st-A', cardId: 'card-A', accountId: 'acc-A', purchaseReferenceLabel: '10/2026', statementTotal: 999 }]);
    await loading;
    expect(useAppStore.getState().creditCardStatements).toEqual([]);
  });

  it('erro atrasado da sessão anterior não vira aviso na sessão atual', async () => {
    signInAs(A);
    h.holdTables.add('transactions');
    h.failTables.add('transactions');
    const loading = useAppStore.getState().fetchTransactions();
    await flush();
    signInAs(B);
    await releaseAll();
    await loading;
    expect(h.alert).not.toHaveBeenCalled();
  });
});

describe('3. A → B → A não aceita respostas da primeira sessão de A', () => {
  it('carga da primeira sessão de A chega por último e não sobrescreve a da segunda', async () => {
    signInAs(A, 'sess-A-1');
    h.holdTables.add('categories');
    const stale = useAppStore.getState().fetchCategories();
    await flush();
    signInAs(B);
    // Entre as sessões, A renomeou a categoria em outro dispositivo.
    h.tables.set('categories', [{ id: 'cat-A', user_id: A.id, Nome_Categoria: 'Categoria de A (nova)', Tipo: 'Despesa' }]);
    signInAs(A, 'sess-A-2');
    h.holdTables.clear();
    await useAppStore.getState().fetchCategories();
    expect(ids(useAppStore.getState().categories, 'Nome_Categoria')).toEqual(['Categoria de A (nova)']);
    await releaseAll(); // resposta velha (antes da renomeação) da PRIMEIRA sessão de A
    await stale;
    expect(ids(useAppStore.getState().categories, 'Nome_Categoria')).toEqual(['Categoria de A (nova)']);
  });

  it('a carga completa em voo da primeira sessão de A não é reaproveitada pela segunda', async () => {
    signInAs(A, 'sess-A-1');
    h.holdTables.add('transactions');
    const first = useAppStore.getState().fetchAllData();
    await flush();
    const txReadsBefore = h.requests.filter((r) => r.table.startsWith('transactions')).length;
    signInAs(B);
    signInAs(A, 'sess-A-2');
    h.holdTables.clear();
    const second = useAppStore.getState().syncAllData();
    expect(second).not.toBe(first);
    await second;
    expect(h.requests.filter((r) => r.table.startsWith('transactions')).length).toBeGreaterThan(txReadsBefore);
    expect(ids(useAppStore.getState().transactions, 'ID_Transacao')).toEqual(['tx-A']);
    await releaseAll();
    await first;
    expect(useAppStore.getState().transactionsUserId).toBe(A.id);
  });

  it('logout → novo login do MESMO usuário: resposta da sessão encerrada é descartada', async () => {
    signInAs(A, 'sess-A-1');
    h.holdTables.add('contas');
    const stale = useAppStore.getState().fetchAccounts();
    await flush();
    await useAppStore.getState().signOut();
    signInAs(A, 'sess-A-2');
    h.holdTables.clear();
    await releaseAll();
    await stale;
    expect(useAppStore.getState().accounts).toEqual([]);
    await useAppStore.getState().fetchAccounts();
    expect(ids(useAppStore.getState().accounts)).toEqual(['acc-A']);
  });

  it('nova instância de login do mesmo usuário sem logout nesta aba (ex.: relogin em outra aba) também invalida', async () => {
    signInAs(A, 'sess-A-1');
    h.holdTables.add('assets');
    const stale = useAppStore.getState().fetchAssets();
    await flush();
    const epoch = getSessionEpoch();
    h.token = userJwt(A.id, 'sess-A-2');
    useAppStore.getState().setUser(A as never); // SIGNED_IN do mesmo usuário
    observeSessionInstance(A.id, 'sess-A-2');
    expect(getSessionEpoch()).toBeGreaterThan(epoch);
    await releaseAll();
    await stale;
    expect(useAppStore.getState().assets).toEqual([]);
  });
});

describe('4. a conta atual é preservada em sincronizações normais', () => {
  it('renovação de token / metadados durante a carga: a resposta da mesma sessão é aplicada', async () => {
    signInAs(A, 'sess-A-1');
    h.holdTables.add('categories');
    h.holdTables.add('transactions');
    const loading = Promise.all([useAppStore.getState().fetchCategories(), useAppStore.getState().fetchTransactions()]);
    await flush();
    const epoch = getSessionEpoch();
    h.token = userJwt(A.id, 'sess-A-1'); // TOKEN_REFRESHED: novo access token, mesma instância
    useAppStore.getState().setUser({ ...A, user_metadata: { ...meta, nickname: 'novo' } } as never);
    observeSessionInstance(A.id, 'sess-A-1');
    expect(getSessionEpoch()).toBe(epoch);
    await releaseAll();
    await loading;
    expect(ids(useAppStore.getState().categories)).toEqual(['cat-A']);
    expect(ids(useAppStore.getState().transactions, 'ID_Transacao')).toEqual(['tx-A']);
    expect(useAppStore.getState().transactionsUserId).toBe(A.id);
  });

  it('carga completa normal traz só os dados da conta atual', async () => {
    signInAs(B);
    await useAppStore.getState().fetchAllData();
    const s = useAppStore.getState();
    expect(ids(s.accounts)).toEqual(['acc-B']);
    expect(ids(s.categories)).toEqual(['cat-B']);
    expect(ids(s.transactions, 'ID_Transacao')).toEqual(['tx-B']);
    expect(ids(s.assets)).toEqual(['as-B']);
    expect(s.initialDataLoadStatus).toBe('ready');
  });

  it('gravação da própria sessão continua sendo aplicada ao estado', async () => {
    signInAs(A);
    const result = await useAppStore.getState().addCategory({ Nome_Categoria: 'Nova de A', Tipo: 'Despesa' } as never);
    expect(result.status).toBe('created');
    expect(ids(useAppStore.getState().categories, 'Nome_Categoria')).toEqual(['Nova de A']);
  });
});

describe('5. nenhuma operação pendente usa credenciais de outro usuário', () => {
  it('gravação iniciada por A e retomada depois da troca não grava na conta de B', async () => {
    signInAs(A);
    let resumeGetUser!: () => void;
    h.getUserGate = new Promise((r) => (resumeGetUser = r));
    // addCategory espera o getUser do SDK global — que, depois da troca, devolveria B.
    const pending = useAppStore.getState().addCategory({ Nome_Categoria: 'Criada por A', Tipo: 'Despesa' } as never);
    await flush();
    signInAs(B);
    h.getUserGate = null;
    resumeGetUser();
    const result = await pending;
    expect(result.status).toBe('error');
    const categories = h.tables.get('categories')!;
    expect(categories.some((c) => c.Nome_Categoria === 'Criada por A')).toBe(false);
    expect(h.requests.some((r) => r.method === 'POST' && r.sub === B.id)).toBe(false);
    expect(useAppStore.getState().categories).toEqual([]);
  });

  it('gravação de A já enviada (com a credencial de A) e confirmada depois da troca não aparece em B', async () => {
    signInAs(A);
    h.holdTables.add('categories');
    const pending = useAppStore.getState().addCategory({ Nome_Categoria: 'Gravada por A', Tipo: 'Despesa' } as never);
    await flush();
    signInAs(B);
    await releaseAll();
    await pending;
    const row = h.tables.get('categories')!.find((c) => c.Nome_Categoria === 'Gravada por A');
    expect(row?.user_id).toBe(A.id); // gravou como A, com a credencial de A
    expect(useAppStore.getState().categories).toEqual([]);
  });

  it('B grava normalmente assim que não há operação pendente de A', async () => {
    signInAs(A);
    h.holdTables.add('contas');
    const stale = useAppStore.getState().fetchAccounts();
    await flush();
    signInAs(B);
    await releaseAll();
    await stale;
    const result = await useAppStore.getState().addCategory({ Nome_Categoria: 'De B', Tipo: 'Despesa' } as never);
    expect(result.status).toBe('created');
    expect(h.tables.get('categories')!.find((c) => c.Nome_Categoria === 'De B')?.user_id).toBe(B.id);
  });
});

describe('logout pendente e sessão encerrada (homologação do PR #100)', () => {
  const gateSignOut = () => {
    let finish!: () => void;
    h.signOutGate = new Promise<void>((r) => (finish = r));
    return () => finish();
  };
  const gateGetUser = () => {
    let resume!: () => void;
    h.getUserGate = new Promise<void>((r) => (resume = r));
    return () => {
      h.getUserGate = null;
      resume();
    };
  };
  const categoryNamed = (name: string) => (h.tables.get('categories') ?? []).filter((c) => c.Nome_Categoria === name);

  it('logout lento: a tela é limpa antes da resposta do servidor', async () => {
    signInAs(A);
    await useAppStore.getState().fetchAllData();
    expect(useAppStore.getState().accounts.length).toBeGreaterThan(0);
    const finish = gateSignOut();
    const out = useAppStore.getState().signOut();
    await flush();
    const during = useAppStore.getState();
    expect(during.user).toBeNull();
    expect(during.accounts).toHaveLength(0);
    expect(during.transactions).toHaveLength(0);
    expect(during.categories).toHaveLength(0);
    expect(during.assets).toHaveLength(0);
    finish();
    await out;
    expect(useAppStore.getState().user).toBeNull();
  });

  it('logout sem confirmação do servidor: estado limpo e a sessão é esquecida neste dispositivo', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    signInAs(A);
    await useAppStore.getState().fetchAllData();
    h.signOutFails = true;
    await useAppStore.getState().signOut();
    expect(useAppStore.getState().user).toBeNull();
    expect(useAppStore.getState().accounts).toHaveLength(0);
    // Um recarregamento não restauraria A.
    expect(h.token).toBeNull();
    expect(h.authUser).toBeNull();
    err.mockRestore();
  });

  it('durante o logout pendente nada sai com a credencial de A (ex.: sincronização de foco)', async () => {
    signInAs(A);
    await useAppStore.getState().fetchAllData();
    const finish = gateSignOut();
    const out = useAppStore.getState().signOut();
    await flush();
    const before = h.requests.length;
    await useAppStore.getState().fetchAccounts();
    await useAppStore.getState().addCategory({ Nome_Categoria: 'No logout', Tipo: 'Despesa' } as never);
    expect(h.requests.slice(before).filter((r) => r.sub === A.id)).toEqual([]);
    expect(useAppStore.getState().accounts).toHaveLength(0);
    expect(categoryNamed('No logout')).toHaveLength(0);
    finish();
    await out;
  });

  it('operação iniciada durante o logout pendente não grava na conta de B depois do login de B', async () => {
    signInAs(A);
    const finish = gateSignOut();
    const out = useAppStore.getState().signOut();
    await flush();
    const resume = gateGetUser();
    const op = useAppStore.getState().addCategory({ Nome_Categoria: 'Iniciada no logout', Tipo: 'Despesa' } as never);
    await flush();
    finish();
    await out;
    signInAs(B);
    resume();
    const result = await op;
    expect(result.status).not.toBe('created');
    expect(categoryNamed('Iniciada no logout')).toHaveLength(0);
    expect(h.requests.filter((r) => r.method === 'POST' && r.table === 'categories')).toHaveLength(0);
    // Terminada a operação antiga, B grava normalmente na própria conta.
    await flush();
    const own = await useAppStore.getState().addCategory({ Nome_Categoria: 'De B', Tipo: 'Despesa' } as never);
    expect(own.status).toBe('created');
    expect(categoryNamed('De B').map((c) => c.user_id)).toEqual([B.id]);
  });

  it('A → B → A pelo store: gravação da primeira sessão de A não persiste em silêncio na nova sessão de A', async () => {
    signInAs(A, 'sess-A-1');
    const resume = gateGetUser();
    const op = useAppStore.getState().addCategory({ Nome_Categoria: 'Da sessão antiga', Tipo: 'Despesa' } as never);
    await flush();
    await useAppStore.getState().signOut();
    signInAs(B);
    await useAppStore.getState().signOut();
    signInAs(A, 'sess-A-2');
    resume();
    const result = await op;
    expect(result.status).not.toBe('created');
    expect(categoryNamed('Da sessão antiga')).toHaveLength(0);
    await flush();
    const fresh = await useAppStore.getState().addCategory({ Nome_Categoria: 'Da sessão nova', Tipo: 'Despesa' } as never);
    expect(fresh.status).toBe('created');
    expect(categoryNamed('Da sessão nova').map((c) => c.user_id)).toEqual([A.id]);
  });

  it('logout → login do mesmo usuário: gravação da sessão encerrada também não persiste', async () => {
    signInAs(A, 'sess-A-1');
    const resume = gateGetUser();
    const op = useAppStore.getState().addCategory({ Nome_Categoria: 'Antes do relogin', Tipo: 'Despesa' } as never);
    await flush();
    await useAppStore.getState().signOut();
    signInAs(A, 'sess-A-2');
    await useAppStore.getState().fetchCategories();
    resume();
    const result = await op;
    expect(result.status).not.toBe('created');
    expect(categoryNamed('Antes do relogin')).toHaveLength(0);
    expect(useAppStore.getState().categories.some((c) => c.Nome_Categoria === 'Antes do relogin')).toBe(false);
  });
});
