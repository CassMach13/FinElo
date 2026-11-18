/**
 * Etapa 2 — concorrência dirigida da troca de conta (revisão do PR #101).
 *
 * Operações de SERVIÇO/COMPONENTE que não passam pelo `useAppStore` usam o cliente global (a fachada). Elas não são
 * rastreadas: entre duas chamadas Supabase, uma espera fora do cliente (Promise, timer, processamento local em
 * etapas, confirmação do usuário) deixa a aba "quieta" para a troca. Aqui se prova que, mesmo assim, uma gravação
 * iniciada por A nunca sai com a identidade de B — com supabase-js REAL sobre o servidor falso.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deferred, FakeSupabase, freshTabModules, MemoryStorage, URL_BASE, USERS, type Deferred, type Label, type TabModules } from './harness';
import { tabEnv } from './harness';

const waitUntil = async (cond: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('tempo esgotado esperando condição');
    await new Promise((r) => setTimeout(r, 5));
  }
};

/**
 * Anfitrião da troca como o do app: depois de uma troca CONCLUÍDA, o passo 8 reinicia a página (a promessa nunca
 * resolve, como `location.reload()`); no rollback, recarrega os dados na mesma página.
 */
function pageHost(scope: TabModules['scope']) {
  const log: string[] = [];
  let user: { id: string } | null = null;
  return {
    log,
    host: {
      currentUser: () => user as never,
      clearSessionState: () => {
        log.push('clear');
        scope.commitSessionIdentity(null);
        user = null;
      },
      commitUser: (u: { id: string }) => {
        log.push(`commit:${u.id.slice(-1)}`);
        scope.commitSessionIdentity(u.id);
        user = u;
      },
      reload: (after?: 'switched' | 'rolled_back') => {
        log.push(`reload:${after ?? 'none'}`);
        return after === 'switched' ? new Promise<never>(() => undefined) : Promise.resolve();
      },
    },
    setUser(u: { id: string } | null) {
      user = u;
      scope.commitSessionIdentity(u?.id ?? null);
    },
  };
}

async function openTab(server: FakeSupabase, storage: MemoryStorage) {
  const mods = await freshTabModules();
  const manager = new mods.SessionAccountManager(tabEnv({ server, storage }));
  const page = pageHost(mods.scope);
  mods.binding.setOperationClientResolver(() => manager.activeAccountClient());
  return { mods, manager, page };
}
type Tab = Awaited<ReturnType<typeof openTab>>;

async function login(tab: Tab, label: Label) {
  const auth = tab.manager.activeUserId() ? tab.manager.pendingAuth() : tab.manager.client.auth;
  const { error } = await auth.signInWithPassword({ email: USERS[label].email, password: USERS[label].password });
  expect(error).toBeNull();
  if (tab.manager.activeUserId() === USERS[label].id) tab.page.setUser({ id: USERS[label].id });
}

async function twoAccounts() {
  const server = new FakeSupabase();
  const storage = new MemoryStorage();
  const tab = await openTab(server, storage);
  await login(tab, 'A');
  await login(tab, 'B');
  expect(tab.manager.activeUserId()).toBe(USERS.A.id);
  return { server, storage, tab };
}

const writesAs = (server: FakeSupabase, label: Label) => server.rest.filter((c) => c.method !== 'GET' && c.sub === USERS[label].id);

/** Começa a troca A → B sem esperar o fim (no app, a página reinicia no passo 8). */
const startSwitch = (tab: Tab) => {
  const run = tab.mods.switchAccount(tab.manager, tab.page.host, USERS.B.id, { drainTimeoutMs: 2000 });
  let settled: unknown = 'pending';
  void run.then((r) => (settled = r));
  return { run, settled: () => settled };
};

/**
 * Serviço fora do store, com o cliente global (fachada): 1ª chamada Supabase, espera fora do cliente, gravação.
 * Devolve o resultado da gravação (supabase-js transforma erro de rede/cerca em `{ error }`).
 */
async function serviceOperation(client: SupabaseClient, pause: () => Promise<unknown>, write: 'insert' | 'rpc' | 'update' = 'insert') {
  const first = await client.from('transactions').select('id');
  expect(first.error).toBeNull();
  await pause();
  if (write === 'rpc') return client.rpc('save_transaction', { amount_cents: 1234 });
  if (write === 'update') return client.from('accounts').update({ name: 'A' }).eq('id', 'acc-a');
  return client.from('transactions').insert({ amount_cents: 1234, description: 'iniciada por A' });
}

afterEach(() => undefined);

describe('troca A → B com operação de serviço de A suspensa fora do cliente Supabase', () => {
  const pauses: Array<[string, (gate: Deferred) => () => Promise<unknown>]> = [
    ['Promise pendente', (gate) => () => gate.promise],
    ['timer', (gate) => () => gate.promise.then(() => new Promise((r) => setTimeout(r, 20)))],
    [
      'processamento local em etapas (yield ao loop)',
      (gate) => async () => {
        let acc = 0;
        for (let i = 0; i < 50; i += 1) {
          for (let j = 0; j < 2000; j += 1) acc += j % 7;
          await new Promise((r) => setTimeout(r, 0));
        }
        await gate.promise;
        return acc;
      },
    ],
    ['confirmação assíncrona do usuário (diálogo)', (gate) => () => gate.promise.then(() => ({ confirmed: true }))],
  ];

  for (const [name, makePause] of pauses) {
    for (const write of ['insert', 'rpc', 'update'] as const) {
      it(`${name} → ${write}: a gravação de A não sai como B (nem como A depois da troca)`, async () => {
        const { server, tab } = await twoAccounts();
        const gate = deferred();
        const op = serviceOperation(tab.manager.client, makePause(gate), write);
        await waitUntil(() => server.rest.some((c) => c.method === 'GET' && c.sub === USERS.A.id));
        const restBefore = server.rest.length;
        const sw = startSwitch(tab);
        // A troca encontra a aba quieta (a operação está fora do cliente) e avança até reiniciar a página.
        await waitUntil(() => tab.page.log.includes('reload:switched') || sw.settled() !== 'pending');
        gate.resolve();
        const result = await op;
        expect(writesAs(server, 'B')).toEqual([]);
        expect(result.error).not.toBeNull();
        expect(server.rest.slice(restBefore).filter((c) => c.method !== 'GET')).toEqual([]);
      });
    }
  }

  it('operação NOVA iniciada durante a fase draining: lê como A, e a gravação dela depois da troca é bloqueada', async () => {
    const { server, tab } = await twoAccounts();
    // Uma requisição de A em voo segura a troca na fase draining.
    const inFlight = deferred();
    server.gates.set('/rest/v1/categories', inFlight);
    const holding = (async () => await tab.manager.client.from('categories').select('id'))();
    await waitUntil(() => tab.manager.inFlightRequests() > 0);
    const sw = startSwitch(tab);
    await waitUntil(() => tab.manager.switchPhase() === 'draining');
    // Nova operação começa no meio do draining (a fachada ainda é A).
    const gate = deferred();
    const op = serviceOperation(tab.manager.client, () => gate.promise);
    await waitUntil(() => server.rest.some((c) => c.method === 'GET' && c.path === '/rest/v1/transactions' && c.sub === USERS.A.id));
    expect(tab.manager.switchPhase()).toBe('draining');
    server.gates.delete('/rest/v1/categories');
    inFlight.resolve();
    await holding;
    await waitUntil(() => tab.page.log.includes('reload:switched') || sw.settled() !== 'pending');
    gate.resolve();
    const result = await op;
    expect(writesAs(server, 'B')).toEqual([]);
    expect(result.error).not.toBeNull();
  });

  it('gravação de A que retoma ANTES do ponto quieto termina como A e segura a troca (nada se perde, nada vira B)', async () => {
    const { server, tab } = await twoAccounts();
    const slow = deferred();
    server.gates.set('/rest/v1/transactions', slow);
    const write = (async () => await tab.manager.client.from('transactions').insert({ amount_cents: 1, description: 'em voo' }))();
    await waitUntil(() => tab.manager.inFlightRequests() > 0);
    const sw = startSwitch(tab);
    await new Promise((r) => setTimeout(r, 60));
    expect(tab.manager.switchPhase()).toBe('draining');
    server.gates.delete('/rest/v1/transactions');
    slow.resolve();
    const { error } = await write;
    expect(error).toBeNull();
    await waitUntil(() => tab.page.log.includes('reload:switched') || sw.settled() !== 'pending');
    expect(server.rest.filter((c) => c.method === 'POST').map((c) => c.sub)).toEqual([USERS.A.id]);
    expect(writesAs(server, 'B')).toEqual([]);
  });

  it('cliente da operação capturado ANTES da espera (builder/cliente de A guardado): bloqueado, nunca sai como B', async () => {
    const { server, tab } = await twoAccounts();
    const gate = deferred();
    const op = (async () => {
      const table = tab.manager.client.from('transactions');
      await gate.promise;
      return table.insert({ amount_cents: 99 });
    })();
    const sw = startSwitch(tab);
    await waitUntil(() => tab.page.log.includes('reload:switched') || sw.settled() !== 'pending');
    gate.resolve();
    const result = await op;
    expect(result.error).not.toBeNull();
    expect(server.rest.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('rollback (B inválida): a operação de A retoma depois e grava como A, na conta que a iniciou', async () => {
    const { server, tab } = await twoAccounts();
    server.revokeAll('B');
    const gate = deferred();
    const op = serviceOperation(tab.manager.client, () => gate.promise);
    await waitUntil(() => server.rest.some((c) => c.method === 'GET' && c.sub === USERS.A.id));
    const result = await tab.mods.switchAccount(tab.manager, tab.page.host, USERS.B.id);
    expect(result).toMatchObject({ ok: false, reason: 'reauth_required', restoredUserId: USERS.A.id });
    expect(tab.page.log).toContain('reload:rolled_back');
    gate.resolve();
    const write = await op;
    expect(write.error).toBeNull();
    expect(server.rest.filter((c) => c.method === 'POST').map((c) => c.sub)).toEqual([USERS.A.id]);
    expect(writesAs(server, 'B')).toEqual([]);
  });

  it('depois de iniciada a troca, nada da fachada sai pela rede até a página reiniciar (leituras inclusive)', async () => {
    const { server, tab } = await twoAccounts();
    const sw = startSwitch(tab);
    await waitUntil(() => tab.page.log.includes('reload:switched') || sw.settled() !== 'pending');
    const before = server.rest.length;
    const read = await tab.manager.client.from('transactions').select('id');
    const write = await tab.manager.client.from('transactions').insert({ amount_cents: 5 });
    expect(server.rest.slice(before).map((c) => c.method + ':' + (c.sub === USERS.B.id ? 'B' : c.sub === USERS.A.id ? 'A' : 'anon'))).toEqual([]);
    expect(read.error).not.toBeNull();
    expect(write.error).not.toBeNull();
    expect(tab.manager.switchPhase()).toBe('switching');
    expect(URL_BASE).toContain('supabase');
  });
});
