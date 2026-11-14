/**
 * Arnês da Etapa 2: servidor Auth/REST FALSO + supabase-js REAL. Nenhuma rede, nenhum dado real.
 *
 * Tokens: JWT sintético com `sub`/`session_id`/`exp` (assinatura falsa em base64url válido). O servidor guarda as
 * sessões emitidas, gira o refresh token a cada renovação (reuso = 400) e permite revogar, cair a rede e atrasar
 * respostas. Toda requisição REST é registrada com o `sub` do portador.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AccountClientOptions, AccountManagerEnv } from '../../../src/domain/session/accounts/accountManager';
import type { KeyValueStorage } from '../../../src/domain/session/accounts/accountStore';

export const URL_BASE = 'https://projref.supabase.test';
export const KEY = 'sb_publishable_test';

export const USERS = {
  A: { id: 'b1a10909-1009-4e65-8a49-100000000001', email: 'qa-a@example.com', password: 'senha-a' },
  B: { id: 'b1a10909-1009-4e65-8a49-100000000002', email: 'qa-b@example.com', password: 'senha-b' },
  C: { id: 'b1a10909-1009-4e65-8a49-100000000003', email: 'qa-c@example.com', password: 'senha-c' },
} as const;
export type Label = keyof typeof USERS;

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const sig = () => Buffer.from(Math.random().toString(36).repeat(3)).toString('base64url').slice(0, 43);

export const jwt = (sub: string, sessionId: string, expSeconds: number) =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, session_id: sessionId, role: 'authenticated', aud: 'authenticated', exp: expSeconds })}.${sig()}`;

export class MemoryStorage implements KeyValueStorage {
  readonly map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  dump(): string {
    return JSON.stringify([...this.map.entries()]);
  }
}

export interface RestCall {
  method: string;
  path: string;
  sub: string | null;
  at: number;
}

export interface Deferred {
  resolve(): void;
  promise: Promise<void>;
}

export const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { resolve, promise };
};

export class FakeSupabase {
  readonly rest: RestCall[] = [];
  readonly authCalls: Array<{ path: string; grant?: string | null; scope?: string | null; sub?: string | null }> = [];
  readonly issued: string[] = [];
  private readonly sessions = new Map<string, { userId: string; sessionId: string; refresh: string; revoked: boolean }>();
  private readonly accessIndex = new Map<string, string>(); // access → sessionId
  private seq = 0;
  network = true;
  /** Atraso por caminho REST (ex.: '/rest/v1/transactions' → promessa que libera a resposta). */
  readonly gates = new Map<string, Deferred>();
  accessTtlSeconds = 3600;
  /** Como o Auth responde a um token sem sessão viva: 403 (session_not_found) ou 401 (bad_jwt). */
  deadTokenStatus: 401 | 403 = 403;

  private userBy(id: string) {
    return Object.values(USERS).find((u) => u.id === id)!;
  }

  issue(label: Label, ttlSeconds = this.accessTtlSeconds, claimedSub?: string) {
    const user = USERS[label];
    const sessionId = `sess-${label}-${++this.seq}`;
    return this.mint(user.id, sessionId, ttlSeconds, claimedSub);
  }

  private mint(userId: string, sessionId: string, ttlSeconds: number, claimedSub?: string) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    // claimedSub: JWT cujo `sub` LOCAL mente; o servidor sabe de quem é a sessão.
    const access = jwt(claimedSub ?? userId, sessionId, exp);
    const refresh = `rt-${sessionId}-${++this.seq}-${Math.random().toString(36).slice(2)}`;
    this.sessions.set(sessionId, { userId, sessionId, refresh, revoked: false });
    this.accessIndex.set(access, sessionId);
    this.issued.push(access, refresh);
    const user = this.userBy(userId);
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'bearer',
      expires_in: ttlSeconds,
      expires_at: exp,
      user: { id: userId, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
    };
  }

  revokeAll(label: Label) {
    for (const s of this.sessions.values()) if (s.userId === USERS[label].id) s.revoked = true;
  }

  sessionsOf(label: Label) {
    return [...this.sessions.values()].filter((s) => s.userId === USERS[label].id);
  }

  private json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }

  private live(access: string | null) {
    if (!access) return null;
    const id = this.accessIndex.get(access);
    const s = id ? this.sessions.get(id) : undefined;
    return s && !s.revoked ? s : null;
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const bearer = headers.get('Authorization')?.replace(/^Bearer /i, '') ?? null;
    const method = (init?.method ?? 'GET').toUpperCase();
    if (!this.network) throw new TypeError('Failed to fetch');
    const path = url.pathname;

    if (path === '/auth/v1/token') {
      const grant = url.searchParams.get('grant_type');
      const body = JSON.parse(String(init?.body ?? '{}'));
      this.authCalls.push({ path, grant });
      if (grant === 'password') {
        const label = (Object.keys(USERS) as Label[]).find((l) => USERS[l].email === body.email && USERS[l].password === body.password);
        if (!label) return this.json({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
        return this.json(this.issue(label));
      }
      if (grant === 'refresh_token') {
        const s = [...this.sessions.values()].find((x) => x.refresh === body.refresh_token);
        if (!s || s.revoked) return this.json({ code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }, 400);
        this.sessions.delete(s.sessionId);
        return this.json(this.mint(s.userId, s.sessionId, this.accessTtlSeconds));
      }
    }
    if (path === '/auth/v1/user') {
      const s = this.live(bearer);
      this.authCalls.push({ path, sub: s?.userId ?? null });
      if (!s && this.deadTokenStatus === 401) return this.json({ code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }, 401);
      if (!s) return this.json({ code: 403, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' }, 403);
      const u = this.userBy(s.userId);
      return this.json({ id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} });
    }
    if (path === '/auth/v1/logout') {
      const scope = url.searchParams.get('scope');
      const s = this.live(bearer);
      this.authCalls.push({ path, scope, sub: s?.userId ?? null });
      if (s) {
        if (scope === 'local') s.revoked = true;
        else for (const x of this.sessions.values()) if (x.userId === s.userId) x.revoked = true;
      }
      return new Response(null, { status: 204 });
    }
    if (path.startsWith('/rest/v1/')) {
      const s = this.live(bearer);
      const call: RestCall = { method, path, sub: s?.userId ?? null, at: Date.now() };
      this.rest.push(call);
      const gate = this.gates.get(path);
      if (gate) await gate.promise;
      if (!s && bearer && bearer !== KEY && bearer.includes('.')) return this.json({ code: 'PGRST301', message: 'JWT expired' }, 401);
      return this.json(method === 'GET' ? [] : [{ ok: true }], method === 'POST' ? 201 : 200);
    }
    return this.json({ msg: 'not found' }, 404);
  };
}

/** Mutex por nome, compartilhado entre "abas" (como navigator.locks): serializa a renovação da mesma chave. */
export const sharedLock = () => {
  const tails = new Map<string, Promise<unknown>>();
  return async <R>(name: string, _timeout: number, fn: () => Promise<R>): Promise<R> => {
    const prev = tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    tails.set(name, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  };
};

export interface TabEnvOptions {
  server: FakeSupabase;
  storage: MemoryStorage;
  tabStorage?: MemoryStorage;
  lock?: ReturnType<typeof sharedLock>;
  isAuthCallbackUrl?: () => boolean;
  created?: AccountClientOptions[];
}

export function tabEnv(opts: TabEnvOptions): AccountManagerEnv & { tabStorage: MemoryStorage } {
  const tabStorage = opts.tabStorage ?? new MemoryStorage();
  return {
    supabaseUrl: URL_BASE,
    storage: opts.storage,
    tabStorage,
    baseFetch: opts.server.fetch,
    isAuthCallbackUrl: opts.isAuthCallbackUrl,
    randomSlot: () => `slot${Math.random().toString(36).slice(2, 12)}`,
    createClient: (o: AccountClientOptions): SupabaseClient => {
      opts.created?.push(o);
      return createClient(URL_BASE, KEY, {
        auth: {
          storage: opts.storage,
          persistSession: true,
          autoRefreshToken: false,
          detectSessionInUrl: o.detectSessionInUrl,
          storageKey: o.storageKey,
          ...(opts.lock ? { lock: opts.lock } : {}),
        },
        global: { fetch: o.fetch },
      });
    },
  };
}

/** Uma "aba": grafo de módulos isolado (escopo de sessão, cercas e gerenciador próprios), como numa aba real. */
export async function freshTabModules() {
  const { vi } = await import('vitest');
  vi.resetModules();
  const manager = await import('../../../src/domain/session/accounts/accountManager');
  const sw = await import('../../../src/domain/session/accounts/accountSwitch');
  const scope = await import('../../../src/domain/session/sessionScope');
  const store = await import('../../../src/domain/session/accounts/accountStore');
  const binding = await import('../../../src/domain/session/operationBinding');
  const fence = await import('../../../src/domain/session/sessionCommitFence');
  return { ...manager, ...sw, scope, store, binding, fence };
}

export type TabModules = Awaited<ReturnType<typeof freshTabModules>>;

/** Host de troca mínimo (sem React/store real): registra identidade, limpezas e recargas. */
export function fakeHost(scope: TabModules['scope']) {
  const log: string[] = [];
  let user: { id: string; email?: string } | null = null;
  return {
    log,
    get user() {
      return user;
    },
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
      reload: async () => {
        log.push('reload');
      },
    },
    setUser(u: { id: string } | null) {
      user = u;
      scope.commitSessionIdentity(u?.id ?? null);
    },
  };
}
