/**
 * Etapa 2 — gerenciador de múltiplas sessões: cenários 1–15 do pedido, com supabase-js REAL e servidor falso.
 * Cada "aba" é um grafo de módulos isolado (escopo de sessão, cercas e gerenciador próprios) sobre o MESMO
 * localStorage, como num navegador.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { create, type StateCreator } from 'zustand';
import {
  deferred,
  FakeSupabase,
  fakeHost,
  freshTabModules,
  jwt,
  MemoryStorage,
  sharedLock,
  tabEnv,
  URL_BASE,
  USERS,
  type Label,
  type TabModules,
} from './harness';

const consoleLines: string[] = [];
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const original = console[level].bind(console);
  vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
    consoleLines.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    void original;
  });
}

const waitUntil = async (cond: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('tempo esgotado esperando condição');
    await new Promise((r) => setTimeout(r, 5));
  }
};

type Tab = Awaited<ReturnType<typeof openTab>>;

async function openTab(server: FakeSupabase, storage: MemoryStorage, extra: { tabStorage?: MemoryStorage; lock?: ReturnType<typeof sharedLock> } = {}) {
  const mods: TabModules = await freshTabModules();
  const created: Array<{ storageKey: string; detectSessionInUrl: boolean; accountUserId: string | null }> = [];
  const env = tabEnv({ server, storage, tabStorage: extra.tabStorage, lock: extra.lock, created: created as never });
  const manager = new mods.SessionAccountManager(env);
  const host = fakeHost(mods.scope);
  mods.binding.setOperationClientResolver(() => manager.activeAccountClient());
  if (manager.activeUserId()) host.setUser({ id: manager.activeUserId()! });
  return { mods, manager, host, env, created };
}

/** Login por senha como o app faz: sem conta ativa, pela fachada; com conta ativa, pelo login pendente (incluir conta). */
async function login(tab: Tab, label: Label) {
  tab.manager.lastAdoption = null;
  const auth = tab.manager.activeUserId() ? tab.manager.pendingAuth() : tab.manager.client.auth;
  const { error } = await auth.signInWithPassword({ email: USERS[label].email, password: USERS[label].password });
  expect(error).toBeNull();
  await waitUntil(() => tab.manager.lastAdoption !== null);
  const outcome = tab.manager.lastAdoption!;
  if (outcome.status === 'adopted' && outcome.activated) tab.host.setUser({ id: outcome.userId });
  return outcome;
}

const passwordGrants = (server: FakeSupabase) => server.authCalls.filter((c) => c.grant === 'password').length;
const lastRest = (server: FakeSupabase) => server.rest[server.rest.length - 1];

afterEach(() => {
  vi.useRealTimers();
});

describe('Etapa 2 — registro e chaves (sem tokens, sem duplicatas, limite de 5)', () => {
  it('cada conta tem chave própria determinística; o registro não guarda token nem senha', async () => {
    const server = new FakeSupabase();
    const storage = new MemoryStorage();
    const tab = await openTab(server, storage);
    await login(tab, 'A');
    await login(tab, 'B');
    const keyA = tab.mods.store.accountStorageKey(URL_BASE, USERS.A.id);
    const keyB = tab.mods.store.accountStorageKey(URL_BASE, USERS.B.id);
    expect(keyA).toBe(`sb-projref-auth-token.account.${USERS.A.id}`);
    expect(storage.getItem(keyA)).toContain(USERS.A.id);
    expect(storage.getItem(keyB)).toContain(USERS.B.id);
    const registry = storage.getItem(tab.mods.store.ACCOUNT_REGISTRY_KEY)!;
    for (const secret of server.issued) expect(registry).not.toContain(secret);
    expect(registry).not.toMatch(/senha-|password|refresh|access_token/);
    expect(tab.manager.rememberedAccounts().map((a) => a.userId)).toEqual([USERS.A.id, USERS.B.id]);
    // Nenhum resto de login pendente nem a chave de conta única.
    expect([...storage.map.keys()].filter((k) => k.includes('.pending.') || k === 'sb-projref-auth-token')).toEqual([]);
  });

  it('logar de novo na mesma conta não duplica; a 6ª conta é recusada e a sessão dela não fica no navegador', async () => {
    const mods = await freshTabModules();
    const { upsertRememberedAccount, MAX_REMEMBERED_ACCOUNTS } = mods.store;
    let registry = { version: 1 as const, accounts: [] as never[] } as Parameters<typeof upsertRememberedAccount>[0];
    const ids = Array.from({ length: 6 }, (_, i) => `b1a10909-1009-4e65-8a49-10000000001${i}`);
    for (const id of ids.slice(0, 5)) registry = upsertRememberedAccount(registry, { userId: id, email: null }, 1).registry;
    expect(registry.accounts).toHaveLength(MAX_REMEMBERED_ACCOUNTS);
    expect(upsertRememberedAccount(registry, { userId: ids[0], email: 'x@example.com' }, 2).outcome).toBe('updated');
    expect(upsertRememberedAccount(registry, { userId: ids[0], email: null }, 2).registry.accounts).toHaveLength(5);
    expect(upsertRememberedAccount(registry, { userId: ids[5], email: null }, 2).outcome).toBe('limit_reached');
    // Registro adulterado com duplicata e lixo: lido sem duplicar e sem aceitar ids inválidos.
    const storage = new MemoryStorage();
    storage.setItem(mods.store.ACCOUNT_REGISTRY_KEY, JSON.stringify({ version: 1, accounts: [{ userId: ids[0] }, { userId: ids[0] }, { userId: '../x' }, { userId: ids[1], token: 'segredo' }] }));
    const read = mods.store.readAccountRegistry(storage)!;
    expect(read.accounts.map((a) => a.userId)).toEqual([ids[0], ids[1]]);
    expect(JSON.stringify(read)).not.toContain('segredo');
    expect(() => mods.store.accountStorageKey(URL_BASE, '../../evil')).toThrow();
  });

  it('com 5 contas lembradas, um login novo é recusado e não sobra sessão dele', async () => {
    const server = new FakeSupabase();
    const storage = new MemoryStorage();
    const tab = await openTab(server, storage);
    const mods = tab.mods;
    const fillers = Array.from({ length: 5 }, (_, i) => ({ userId: `b1a10909-1009-4e65-8a49-10000000002${i}`, email: null, addedAt: 1, lastUsedAt: 1, signedOut: false }));
    mods.store.writeAccountRegistry(storage, { version: 1, accounts: fillers });
    const { error } = await tab.manager.pendingAuth().signInWithPassword({ email: USERS.C.email, password: USERS.C.password });
    expect(error).toBeNull();
    await waitUntil(() => tab.manager.lastAdoption !== null);
    expect(tab.manager.lastAdoption).toEqual({ status: 'limit_reached' });
    expect(tab.manager.rememberedAccounts()).toHaveLength(5);
    expect([...storage.map.values()].some((v) => v.includes(USERS.C.id))).toBe(false);
    expect(server.sessionsOf('C').every((s) => s.revoked)).toBe(true);
  });
});

describe('Etapa 2 — cenários de homologação 1–15', () => {
  it('1. A → B → A sem novo login, seguindo os 9 passos', async () => {
    const server = new FakeSupabase();
    const tab = await openTab(server, new MemoryStorage());
    await login(tab, 'A');
    await login(tab, 'B'); // incluída sem trocar a aba
    expect(tab.manager.activeUserId()).toBe(USERS.A.id);
    const grants = passwordGrants(server);

    const steps: string[] = [];
    const reloadPhases: string[] = [];
    const reload = tab.host.host.reload;
    tab.host.host.reload = async () => {
      reloadPhases.push(tab.manager.switchPhase());
      return reload();
    };
    const toB = await tab.mods.switchAccount(tab.manager, tab.host.host, USERS.B.id, { trace: (s) => steps.push(s) });
    expect(toB).toEqual({ ok: true, userId: USERS.B.id });
    expect(steps.map((s) => s.split(':')[0])).toEqual(['1', '2', '3', '4', '5', '6', '7', '9']);
    expect(tab.host.log).toEqual(['clear', 'commit:2', 'reload']);
    expect(reloadPhases).toEqual(['switching']); // dados recarregados com a interface ainda bloqueada
    expect(tab.manager.switchPhase()).toBe('idle');
    await tab.manager.client.from('transactions').select('*');
    expect(lastRest(server).sub).toBe(USERS.B.id);

    const toA = await tab.mods.switchAccount(tab.manager, tab.host.host, USERS.A.id);
    expect(toA.ok).toBe(true);
    await tab.manager.client.from('transactions').select('*');
    expect(lastRest(server).sub).toBe(USERS.A.id);
    expect(passwordGrants(server)).toBe(grants); // nenhum novo login
    // Nenhuma sessão foi encerrada no servidor pela troca.
    expect(server.authCalls.filter((c) => c.path === '/auth/v1/logout')).toEqual([]);
    expect(server.sessionsOf('A').some((s) => !s.revoked) && server.sessionsOf('B').some((s) => !s.revoked)).toBe(true);
  });

  it('2. A e B ativas ao mesmo tempo em abas diferentes, cada uma com o seu token', async () => {
    const server = new FakeSupabase();
    const storage = new MemoryStorage();
    const tab1 = await openTab(server, storage);
    await login(tab1, 'A');
    await login(tab1, 'B');
    const tab2 = await openTab(server, storage);
    expect(await tab2.mods.switchAccount(tab2.manager, tab2.host.host, USERS.B.id)).toMatchObject({ ok: true });

    await tab1.manager.client.from('accounts').select('*');
    expect(lastRest(server).sub).toBe(USERS.A.id);
    await tab2.manager.client.from('accounts').select('*');
    expect(lastRest(server).sub).toBe(USERS.B.id);
    await tab1.manager.client.from('accounts').select('*');
    expect(lastRest(server).sub).toBe(USERS.A.id);
    expect(tab1.manager.activeUserId()).toBe(USERS.A.id);
    expect(tab2.manager.activeUserId()).toBe(USERS.B.id);
  });

  it('3. gravação iniciada em A enquanto B está ativa em outra aba termina em A', async () => {
    const server = new FakeSupabase();
    const storage = new MemoryStorage();
    const tab1 = await openTab(server, storage);
    await login(tab1, 'A');
    await login(tab1, 'B');
    const tab2 = await openTab(server, storage);
    await tab2.mods.switchAccount(tab2.manager, tab2.host.host, USERS.B.id);

    const gate = deferred();
    server.gates.set('/rest/v1/transactions', gate);
    const write = tab1.manager.client.from('transactions').insert({ valor: 1 });
    const pending = write.then((r) => r);
    await waitUntil(() => server.rest.some((c) => c.method === 'POST'));
    await tab2.manager.client.from('accounts').select('*'); // B trabalha na outra aba
    expect(lastRest(server).sub).toBe(USERS.B.id);
    gate.resolve();
    const { error } = await pending;
    expect(error).toBeNull();
    const posts = server.rest.filter((c) => c.method === 'POST');
    expect(posts.map((c) => c.sub)).toEqual([USERS.A.id]);
  });

  it('4. resposta tardia da primeira sessão de A: a troca espera ou é recusada; a operação nunca usa o cliente de B', async () => {
    const server = new FakeSupabase();
    const tab = await openTab(server, new MemoryStorage());
    await login(tab, 'A');
    await login(tab, 'B');
    const { scope, fence, binding } = tab.mods;

    // Ação de store REAL (zustand + cerca de commit): captura o cliente de A no início, demora, depois grava.
    const shared = tab.manager.client;
    const late = deferred();
    type S = { saved: string[]; act(): Promise<string> };
    const creator: StateCreator<S, [], []> = (set) => {
      const db = binding.operationClient(shared);
      return {
        saved: [],
        act: async () => {
          await late.promise;
          const { error } = await db.from('transactions').insert({ valor: 9 });
          set((s) => ({ saved: [...s.saved, error ? 'erro' : 'ok'] }));
          return error ? (error as { message: string }).message : 'ok';
        },
      };
    };
    const useStore = create<S>()(fence.withSessionCommitFence(creator, { unfenced: [] }));
    const state = { get saved() { return useStore.getState().saved; }, act: () => useStore.getState().act() };
    const op = state.act();
    expect(scope.pendingSessionOperations()).toHaveLength(1);

    // Com a operação de A em voo, a troca não acontece no meio dela: recusada no prazo, nada muda.
    const refused = await tab.mods.switchAccount(tab.manager, tab.host.host, USERS.B.id, { drainTimeoutMs: 60 });
    expect(refused).toEqual({ ok: false, reason: 'operations_pending', restoredUserId: USERS.A.id });
    expect(tab.manager.activeUserId()).toBe(USERS.A.id);

    // Mesmo se a aba mudasse de conta por baixo (sem o protocolo), o cliente da operação continua sendo o de A:
    // a gravação sai com o token de A ou é bloqueada — nunca com o de B.
    tab.manager.selectTabAccount(USERS.B.id);
    scope.commitSessionIdentity(USERS.B.id);
    late.resolve();
    const result = await op;
    expect(result).toMatch(/sessão desta aba mudou|identity_mismatch|sessão anterior/);
    expect(server.rest.filter((c) => c.method === 'POST')).toEqual([]);
    expect(state.saved).toEqual([]); // resposta tardia não chega ao estado da nova geração
  });

  it('5. troca pedida durante importação/sincronização espera o fim; tudo de A sai como A, nada de A sai como B', async () => {
    const server = new FakeSupabase();
    const tab = await openTab(server, new MemoryStorage());
    await login(tab, 'A');
    await login(tab, 'B');
    const { scope } = tab.mods;
    const db = tab.manager.activeAccountClient()!;
    const gate = deferred();
    server.gates.set('/rest/v1/import_logs', gate);
    // Importação rastreada (ação do store) com três gravações em sequência.
    const ticket = scope.captureSession();
    const importing = scope.trackSessionOperation(ticket, (async () => {
      for (let i = 0; i < 3; i++) await db.from('import_logs').insert({ i });
    })(), 'importTransactions');
    // Laço NÃO rastreado (componente) com gravações em sequência pela fachada.
    const untracked = (async () => {
      for (let i = 0; i < 3; i++) await tab.manager.client.from('import_configs').update({ i }).eq('id', 'x');
    })();
    await waitUntil(() => server.rest.some((c) => c.path === '/rest/v1/import_logs'));
    const switching = tab.mods.switchAccount(tab.manager, tab.host.host, USERS.B.id);
    await new Promise((r) => setTimeout(r, 40));
    expect(tab.manager.switchPhase()).toBe('draining'); // ainda esperando a importação
    gate.resolve();
    await importing;
    await untracked;
    expect(await switching).toMatchObject({ ok: true });
    const writes = server.rest.filter((c) => c.method !== 'GET');
    expect(writes).toHaveLength(6);
    expect(new Set(writes.map((c) => c.sub))).toEqual(new Set([USERS.A.id]));
    await tab.manager.client.from('import_logs').insert({ depois: true });
    expect(lastRest(server).sub).toBe(USERS.B.id);
  });

  it('6. renovação simultânea de token: uma única chamada de refresh para a mesma conta entre abas', async () => {
    const server = new FakeSupabase();
    const storage = new MemoryStorage();
    const lock = sharedLock();
    const tab1 = await openTab(server, storage, { lock });
    await login(tab1, 'A');
    // Expira a sessão de A guardada (access token vencido; refresh token válido).
    const key = tab1.mods.store.accountStorageKey(URL_BASE, USERS.A.id);
    const saved = JSON.parse(storage.getItem(key)!);
    saved.expires_at = Math.floor(Date.now() / 1000) - 10;
    saved.access_token = jwt(USERS.A.id, 'sess-expired', saved.expires_at);
    storage.setItem(key, JSON.stringify(saved));
    const tab2 = await openTab(server, storage, { lock });
    expect(tab2.manager.activeUserId()).toBe(USERS.A.id);
    const before = server.authCalls.filter((c) => c.grant === 'refresh_token').length;
    const [s1, s2] = await Promise.all([
      tab1.manager.activeAccountClient()!.auth.getSession(),
      tab2.manager.activeAccountClient()!.auth.getSession(),
    ]);
    expect(server.authCalls.filter((c) => c.grant === 'refresh_token').length - before).toBe(1);
    expect(s1.data.session?.access_token).toBe(s2.data.session?.access_token);
    // Só a conta ativa renova automaticamente; a inativa não.
    await login(tab1, 'B');
    tab1.manager.clientFor(USERS.B.id);
    tab1.manager.applyRefreshPolicy();
    expect(tab1.manager.isRefreshing(USERS.A.id)).toBe(true);
    expect(tab1.manager.isRefreshing(USERS.B.id)).toBe(false);
    for (const t of [tab1, tab2]) for (const id of [USERS.A.id, USERS.B.id]) void t.manager.clientFor(id).auth.stopAutoRefresh();
  });

  it('7. sessão de B revogada: só B pede novo login; A continua ativa e intacta', async () => {
    const server = new FakeSupabase();
    const storage = new MemoryStorage();
    const tab = await openTab(server, storage);
    await login(tab, 'A');
    await login(tab, 'B');
    const keyA = tab.mods.store.accountStorageKey(URL_BASE, USERS.A.id);
    const sessionA = storage.getItem(keyA);
    server.revokeAll('B');
    const result = await tab.mods.switchAccount(tab.manager, tab.host.host, USERS.B.id);
    expect(result).toEqual({ ok: false, reason: 'reauth_required', restoredUserId: USERS.A.id });
    expect(tab.manager.activeUserId()).toBe(USERS.A.id);
    expect(tab.host.user?.id).toBe(USERS.A.id);
    expect(storage.getItem(keyA)).toBe(sessionA);
    expect(storage.getItem(tab.mods.store.accountStorageKey(URL_BASE, USERS.B.id))).toBeNull();
    expect(tab.manager.rememberedAccounts().find((a) => a.userId === USERS.B.id)?.signedOut).toBe(true);
    await tab.manager.client.from('goals').select('*');
    expect(lastRest(server).sub).toBe(USERS.A.id);
    expect(server.sessionsOf('A').every((s) => !s.revoked)).toBe(true);
  });

  it('8. remover B deste navegador preserva A (e propaga para a aba onde B estava ativa)', async () => {
    const server = new FakeSupabase();
    const storage = new MemoryStorage();
    const tab1 = await openTab(server, storage);
    await login(tab1, 'A');
    await login(tab1, 'B');
    await tab1.manager.clientFor(USERS.B.id).auth.getSession();
    await tab1.mods.removeAccountFromBrowser(tab1.manager, tab1.host.host, USERS.B.id);
    expect(tab1.manager.rememberedAccounts().map((a) => a.userId)).toEqual([USERS.A.id]);
    expect([...storage.map.keys()].some((k) => k.includes(USERS.B.id))).toBe(false);
    expect(server.authCalls.filter((c) => c.path === '/auth/v1/logout')).toEqual([{ path: '/auth/v1/logout', scope: 'local', sub: USERS.B.id }]);
    expect(tab1.manager.activeUserId()).toBe(USERS.A.id);
    await tab1.manager.client.from('goals').select('*');
    expect(lastRest(server).sub).toBe(USERS.A.id);
    // Outra aba que tinha B ativa não consegue mais usar B: a validação falha e ela não cai em A sozinha.
    const tabStorage = new MemoryStorage();
    tabStorage.setItem(tab1.mods.store.TAB_ACTIVE_ACCOUNT_KEY, USERS.B.id);
    const tab2 = await openTab(server, storage, { tabStorage });
    expect(tab2.manager.activeUserId()).toBe(USERS.A.id); // B não é mais lembrada: a aba usa a última conta válida
  });

  it('9. sair da conta atual não remove as outras sessões', async () => {
    const server = new FakeSupabase();
    const tab = await openTab(server, new MemoryStorage());
    await login(tab, 'A');
    await login(tab, 'B');
    await tab.mods.signOutCurrentAccount(tab.manager, tab.host.host);
    expect(tab.manager.activeUserId()).toBeNull();
    expect(tab.host.user).toBeNull();
    expect(tab.manager.rememberedAccounts().map((a) => [a.userId, a.signedOut])).toEqual([[USERS.A.id, true], [USERS.B.id, false]]);
    expect(server.authCalls.filter((c) => c.path === '/auth/v1/logout').map((c) => [c.scope, c.sub])).toEqual([['local', USERS.A.id]]);
    // B segue logada: a troca não pede senha.
    const grants = passwordGrants(server);
    expect(await tab.mods.switchAccount(tab.manager, tab.host.host, USERS.B.id)).toMatchObject({ ok: true });
    expect(passwordGrants(server)).toBe(grants);
    // A não pode ser escolhida sem novo login.
    expect(await tab.mods.switchAccount(tab.manager, tab.host.host, USERS.A.id)).toMatchObject({ ok: false, reason: 'account_signed_out' });
  });

  it('7b. sessão de B rejeitada com 401: o protocolo remove só a sessão local de B', async () => {
    const server = new FakeSupabase();
    const storage = new MemoryStorage();
    const tab = await openTab(server, storage);
    await login(tab, 'A');
    await login(tab, 'B');
    const keyA = tab.mods.store.accountStorageKey(URL_BASE, USERS.A.id);
    const sessionA = storage.getItem(keyA);
    server.revokeAll('B');
    server.deadTokenStatus = 401;
    expect(await tab.mods.switchAccount(tab.manager, tab.host.host, USERS.B.id)).toEqual({ ok: false, reason: 'reauth_required', restoredUserId: USERS.A.id });
    expect(storage.getItem(tab.mods.store.accountStorageKey(URL_BASE, USERS.B.id))).toBeNull();
    expect(tab.manager.rememberedAccounts().find((a) => a.userId === USERS.B.id)?.signedOut).toBe(true);
    expect(storage.getItem(keyA)).toBe(sessionA);
    expect(tab.manager.activeUserId()).toBe(USERS.A.id);
  });

  it('10. recarregar a página recupera a conta da aba; aba nova usa a última conta usada', async () => {
    const server = new FakeSupabase();
    const storage = new MemoryStorage();
    const tabStorage = new MemoryStorage();
    const tab = await openTab(server, storage, { tabStorage });
    await login(tab, 'A');
    await login(tab, 'B');
    await tab.mods.switchAccount(tab.manager, tab.host.host, USERS.B.id);
    const reloaded = await openTab(server, storage, { tabStorage });
    expect(reloaded.manager.activeUserId()).toBe(USERS.B.id);
    const { data } = await reloaded.manager.client.auth.getUser();
    expect(data.user?.id).toBe(USERS.B.id);
    const other = await openTab(server, storage);
    expect(other.manager.activeUserId()).toBe(USERS.B.id);
    // A aba recarregada volta para a SUA conta, mesmo que outra aba tenha usado outra conta depois.
    const tabA = new MemoryStorage();
    const first = await openTab(server, storage, { tabStorage: tabA });
    await first.mods.switchAccount(first.manager, first.host.host, USERS.A.id);
    const later = await openTab(server, storage);
    await later.mods.switchAccount(later.manager, later.host.host, USERS.B.id);
    const firstReloaded = await openTab(server, storage, { tabStorage: tabA });
    expect(firstReloaded.manager.activeUserId()).toBe(USERS.A.id);
  });

  it('11. falha de rede durante a troca: volta para A, B continua lembrada e com sessão', async () => {
    const server = new FakeSupabase();
    const storage = new MemoryStorage();
    const tab = await openTab(server, storage);
    await login(tab, 'A');
    await login(tab, 'B');
    const keyB = tab.mods.store.accountStorageKey(URL_BASE, USERS.B.id);
    const sessionB = storage.getItem(keyB);
    server.network = false;
    const result = await tab.mods.switchAccount(tab.manager, tab.host.host, USERS.B.id);
    expect(result).toEqual({ ok: false, reason: 'network', restoredUserId: USERS.A.id });
    expect(tab.manager.activeUserId()).toBe(USERS.A.id);
    expect(tab.host.user?.id).toBe(USERS.A.id);
    expect(tab.manager.switchPhase()).toBe('idle');
    expect(storage.getItem(keyB)).toBe(sessionB);
    expect(tab.manager.rememberedAccounts().find((a) => a.userId === USERS.B.id)?.signedOut).toBe(false);
    server.network = true;
    expect(await tab.mods.switchAccount(tab.manager, tab.host.host, USERS.B.id)).toMatchObject({ ok: true });
  });

  it('12. armazenamento de conta única migra para o gerenciador (validado; falha deixa tudo como estava)', async () => {
    const server = new FakeSupabase();
    const storage = new MemoryStorage();
    const tabStorage = new MemoryStorage();
    const mods = await freshTabModules();
    const migration = await import('../../../src/domain/session/accounts/multiAccountSessions');
    const { createClient } = await import('@supabase/supabase-js');
    const legacyKey = mods.store.legacyStorageKey(URL_BASE);
    const legacy = createClient(URL_BASE, 'k', { auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: server.fetch } });
    expect((legacy.auth as unknown as { storageKey: string }).storageKey).toBe(legacyKey);
    await legacy.auth.signInWithPassword({ email: USERS.A.email, password: USERS.A.password });
    const raw = storage.getItem(legacyKey);
    expect(raw).toContain(USERS.A.id);

    const probe = (key: string) => async () => {
      const c = createClient(URL_BASE, 'k', { auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storageKey: key }, global: { fetch: server.fetch } });
      return (await c.auth.getUser()).data.user?.id ?? null;
    };
    // Falha de validação: nada muda.
    const failed = await migration.migrateLegacySession(legacy, { supabaseUrl: URL_BASE, storage, tabStorage, validateAccountCopy: async () => USERS.B.id });
    expect(failed).toEqual({ ok: false, reason: 'validation_failed' });
    expect(storage.getItem(legacyKey)).toBe(raw);
    expect(mods.store.readAccountRegistry(storage)).toBeNull();
    expect([...storage.map.keys()].filter((k) => k.includes('.account.'))).toEqual([]);

    const messages: unknown[] = [];
    const ok = await migration.migrateLegacySession(legacy, {
      supabaseUrl: URL_BASE,
      storage,
      tabStorage,
      broadcast: (m) => messages.push(m),
      validateAccountCopy: (key) => probe(key)(),
    });
    expect(ok).toEqual({ ok: true, userId: USERS.A.id });
    expect(storage.getItem(legacyKey)).toBeNull();
    expect(storage.getItem(mods.store.accountStorageKey(URL_BASE, USERS.A.id))).toBe(raw);
    expect(messages).toEqual([{ type: 'mode-changed' }]);
    expect(server.authCalls.filter((c) => c.path === '/auth/v1/logout')).toEqual([]); // sessão não revogada
    const tab = await openTab(server, storage, { tabStorage });
    expect(tab.manager.activeUserId()).toBe(USERS.A.id);
    expect((await tab.manager.client.auth.getUser()).data.user?.id).toBe(USERS.A.id);
    expect(await migration.migrateLegacySession(legacy, { supabaseUrl: URL_BASE, storage, tabStorage, validateAccountCopy: async () => null })).toEqual({ ok: false, reason: 'already_enabled' });
  });

  it('13. login OAuth/callback: a sessão vai para a conta que o Auth confirma, nunca para a conta ativa', async () => {
    const server = new FakeSupabase();
    const storage = new MemoryStorage();
    const tab = await openTab(server, storage);
    await login(tab, 'A');
    const keyA = tab.mods.store.accountStorageKey(URL_BASE, USERS.A.id);
    const sessionA = storage.getItem(keyA);
    // Só o cliente PENDENTE lê a URL de callback; nenhum cliente de conta.
    expect(tab.created.filter((c) => c.detectSessionInUrl).every((c) => c.accountUserId === null)).toBe(true);
    expect(tab.created.filter((c) => c.accountUserId).every((c) => !c.detectSessionInUrl)).toBe(true);
    // Callback (como o SDK grava a sessão do retorno) com um JWT cujo `sub` local diz "A", mas o Auth diz "B".
    const forged = server.issue('B', 3600, USERS.A.id);
    expect(JSON.parse(Buffer.from(forged.access_token.split('.')[1], 'base64url').toString()).sub).toBe(USERS.A.id);
    tab.manager.lastAdoption = null;
    await tab.manager.pendingAuth().setSession({ access_token: forged.access_token, refresh_token: forged.refresh_token });
    await waitUntil(() => tab.manager.lastAdoption !== null);
    expect(tab.manager.lastAdoption).toEqual({ status: 'adopted', userId: USERS.B.id, activated: false });
    expect(storage.getItem(keyA)).toBe(sessionA);
    expect(storage.getItem(tab.mods.store.accountStorageKey(URL_BASE, USERS.B.id))).toContain(forged.access_token);
    expect(tab.manager.activeUserId()).toBe(USERS.A.id);
    // Callback com sessão inválida: nada é lembrado.
    tab.manager.lastAdoption = null;
    const dead = server.issue('C');
    server.revokeAll('C');
    const rejected = await tab.manager.pendingAuth().setSession({ access_token: dead.access_token, refresh_token: dead.refresh_token });
    expect(rejected.error).not.toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(tab.manager.rememberedAccounts().some((a) => a.userId === USERS.C.id)).toBe(false);
  });

  it('14. acesso familiar legítimo: com B ativa, tudo sai com o token de B; sessão alheia na chave de B é bloqueada', async () => {
    const server = new FakeSupabase();
    const storage = new MemoryStorage();
    const tab = await openTab(server, storage);
    await login(tab, 'A');
    await login(tab, 'B');
    await tab.mods.switchAccount(tab.manager, tab.host.host, USERS.B.id);
    // Leitura de dados compartilhados pela família (linhas de A): quem pede é B, a RLS decide.
    await tab.manager.client.from('family_members').select('*');
    await tab.manager.client.from('investments').select('user_id').eq('user_id', USERS.A.id);
    expect(server.rest.slice(-2).map((c) => c.sub)).toEqual([USERS.B.id, USERS.B.id]);
    // Adulteração: a chave de B passa a conter a sessão de A. O cliente de B não envia o token de A.
    const keyA = tab.mods.store.accountStorageKey(URL_BASE, USERS.A.id);
    const keyB = tab.mods.store.accountStorageKey(URL_BASE, USERS.B.id);
    const original = storage.getItem(keyB);
    storage.setItem(keyB, storage.getItem(keyA)!);
    const before = server.rest.length;
    const { error } = await tab.manager.client.from('transactions').select('*');
    expect(error).not.toBeNull();
    expect(server.rest.length).toBe(before);
    storage.setItem(keyB, original!);
    // Chave de A com a sessão de B (que É a conta ativa): a R1 passaria; a regra do cliente da conta bloqueia.
    const originalA = storage.getItem(keyA);
    storage.setItem(keyA, original!);
    const beforeA = server.rest.length;
    const viaA = await tab.manager.clientFor(USERS.A.id).from('transactions').select('*');
    expect(viaA.error).not.toBeNull();
    expect(server.rest.length).toBe(beforeA);
    storage.setItem(keyA, originalA!);
  });

  it('eventos de Auth: o app só ouve a conta ativa da aba, e nada durante a troca', async () => {
    const server = new FakeSupabase();
    const tab = await openTab(server, new MemoryStorage());
    await login(tab, 'A');
    await login(tab, 'B');
    const events: string[] = [];
    tab.manager.client.auth.onAuthStateChange((event, session) => events.push(`${event}:${session?.user?.id?.slice(-1) ?? '-'}`));
    await waitUntil(() => events.length > 0);
    expect(events).toEqual(['INITIAL_SESSION:1']);
    await tab.manager.signOutAccount(USERS.B.id); // B não é a conta da aba: o app não vê o SIGNED_OUT dela
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toEqual(['INITIAL_SESSION:1']);
    await login(tab, 'B');
    // Sessão de B vencida: a validação da troca renova o token (TOKEN_REFRESHED no meio da troca).
    const keyB = tab.mods.store.accountStorageKey(URL_BASE, USERS.B.id);
    const savedB = JSON.parse(tab.env.storage.getItem(keyB)!);
    savedB.expires_at = Math.floor(Date.now() / 1000) - 10;
    tab.env.storage.setItem(keyB, JSON.stringify(savedB));
    const refreshesBefore = server.authCalls.filter((c) => c.grant === 'refresh_token').length;
    const phases: string[] = [];
    const unsubscribe = tab.manager.subscribeSwitchPhase(() => phases.push(tab.manager.switchPhase()));
    expect(await tab.mods.switchAccount(tab.manager, tab.host.host, USERS.B.id)).toMatchObject({ ok: true });
    unsubscribe();
    expect(phases).toEqual(['draining', 'switching', 'idle']);
    expect(server.authCalls.filter((c) => c.grant === 'refresh_token').length).toBe(refreshesBefore + 1);
    expect(events).toEqual(['INITIAL_SESSION:1']); // a troca conduz o estado sozinha, sem eventos no meio
    await tab.manager.activeAccountClient()!.auth.refreshSession();
    expect(events.at(-1)).toBe('TOKEN_REFRESHED:2');
    await tab.manager.activeAccountClient()!.auth.signOut({ scope: 'local' });
    await waitUntil(() => events.at(-1) === 'SIGNED_OUT:-');
    expect(tab.manager.activeUserId()).toBeNull();
  });

  it('15. nenhum token em logs, mensagens de erro, registro ou resultados', async () => {
    const server = new FakeSupabase();
    const storage = new MemoryStorage();
    const tab = await openTab(server, storage);
    await login(tab, 'A');
    await login(tab, 'B');
    const results: unknown[] = [];
    results.push(await tab.mods.switchAccount(tab.manager, tab.host.host, USERS.B.id));
    server.network = false;
    results.push(await tab.mods.switchAccount(tab.manager, tab.host.host, USERS.A.id));
    server.network = true;
    server.revokeAll('A');
    results.push(await tab.mods.switchAccount(tab.manager, tab.host.host, USERS.A.id));
    const blocked = await tab.manager.clientFor(USERS.A.id).from('x').select('*');
    results.push(blocked.error?.message);
    const haystack = [consoleLines.join('\n'), JSON.stringify(results), storage.getItem(tab.mods.store.ACCOUNT_REGISTRY_KEY)].join('\n');
    expect(server.issued.length).toBeGreaterThanOrEqual(4);
    for (const secret of server.issued) expect(haystack).not.toContain(secret);
    for (const label of ['A', 'B'] as const) expect(haystack).not.toContain(USERS[label].password);
  });
});
