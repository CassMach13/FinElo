import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';
import { signOutAndForgetLocalSession, type SignOutOutcome } from '../sessionSignOut';
import { createSessionFencedFetch, requestBearer, requestUrl, SessionFenceError, type FetchLike } from '../sessionFence';
import { readBearerIdentity } from '../sessionScope';
import {
  accountStorageKey,
  markAccount,
  pendingStorageKey,
  readAccountRegistry,
  removeRememberedAccount,
  resolveTabAccount,
  SDK_KEY_SUFFIXES,
  TAB_PENDING_SLOT_KEY,
  upsertRememberedAccount,
  writeAccountRegistry,
  writeTabAccount,
  type AccountRegistry,
  type KeyValueStorage,
  type RememberedAccount,
} from './accountStore';

/**
 * Gerenciador de múltiplas sessões autenticadas (Etapa 2).
 *
 * - Um cliente Supabase independente por conta, cada um com a sua chave de armazenamento (`accountStorageKey`).
 *   Nenhum cliente de conta lê a URL (`detectSessionInUrl: false`): callbacks de OAuth/recuperação caem num cliente
 *   PENDENTE, com chave própria, e só viram conta depois que o Auth confirma (`getUser`) de quem é a sessão.
 * - A conta ativa é POR ABA (`sessionStorage`). Só o cliente da conta ativa renova token, e só com a aba visível;
 *   entre abas, a renovação da mesma conta é serializada pelo lock do próprio SDK (`lock:<chave>`).
 * - `client` é a fachada que o app usa no lugar do cliente global: sempre aponta para a conta ativa DESTA aba. A troca
 *   de conta só muda esse alvo num ponto quieto (ver `accountSwitch.ts`), e as ações do store usam o cliente capturado
 *   no início da operação (`operationBinding.ts`).
 * - Eventos de Auth chegam ao app por um multiplexador: só os da conta ativa desta aba, e nenhum durante a troca.
 */

export type AuthListener = (event: AuthChangeEvent, session: Session | null) => void;
export type SwitchPhase = 'idle' | 'draining' | 'switching';

export interface AccountClientOptions {
  readonly storageKey: string;
  readonly detectSessionInUrl: boolean;
  /** Conta dona da chave (null = login pendente). */
  readonly accountUserId: string | null;
  readonly fetch: FetchLike;
}

export interface AccountManagerEnv {
  readonly supabaseUrl: string;
  readonly createClient: (options: AccountClientOptions) => SupabaseClient;
  readonly storage: KeyValueStorage;
  readonly tabStorage: KeyValueStorage;
  readonly baseFetch?: FetchLike;
  readonly now?: () => number;
  readonly randomSlot?: () => string;
  /** A URL atual traz retorno de OAuth / link de e-mail? */
  readonly isAuthCallbackUrl?: () => boolean;
  readonly visibility?: { isVisible(): boolean; subscribe(onChange: () => void): () => void } | null;
  readonly channel?: { post(message: AccountSyncMessage): void; subscribe(onMessage: (message: AccountSyncMessage) => void): () => void } | null;
}

export type AccountSyncMessage = { type: 'registry-changed' } | { type: 'mode-changed' };

export type AdoptionOutcome =
  | { status: 'adopted'; userId: string; activated: boolean }
  | { status: 'limit_reached' }
  | { status: 'failed'; reason: 'no_session' | 'auth_rejected' | 'network' };

const randomSlot = () => {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
};

const FENCED = ['/rest/v1/', '/storage/v1/', '/functions/v1/'];

/**
 * Fetch do cliente de UMA conta: as regras R0–R2 da Etapa 1 e mais uma — o token que sai tem de ser desta conta (se
 * a chave de armazenamento contiver sessão de outro usuário, nada sai). Conta as requisições em voo (ponto quieto).
 */
export function createAccountFetch(
  supabaseUrl: string,
  accountUserId: string | null,
  track: <T>(promise: Promise<T>) => Promise<T>,
  baseFetch?: FetchLike
): FetchLike {
  const fenced = createSessionFencedFetch(supabaseUrl, baseFetch);
  const base = supabaseUrl.replace(/\/+$/, '');
  return (input, init) => {
    const url = requestUrl(input);
    if (accountUserId && url.startsWith(base) && FENCED.some((p) => url.slice(base.length).startsWith(p))) {
      const identity = readBearerIdentity(requestBearer(input, init));
      if (identity && identity.sub !== accountUserId) {
        console.warn('[session] requisição bloqueada (identity_mismatch)');
        return Promise.reject(new SessionFenceError('identity_mismatch'));
      }
    }
    return track(fenced(input, init));
  };
}

export class SessionAccountManager {
  readonly client: SupabaseClient;
  private readonly env: AccountManagerEnv;
  private readonly clients = new Map<string, SupabaseClient>();
  private readonly refreshing = new Set<string>();
  private pending: { slot: string; client: SupabaseClient } | null = null;
  private tabUserId: string | null = null;
  private readonly appListeners = new Set<AuthListener>();
  private replay: { event: AuthChangeEvent; session: Session | null } | null = null;
  private phase: SwitchPhase = 'idle';
  private readonly phaseListeners = new Set<() => void>();
  private inFlight = 0;
  private adoption: Promise<AdoptionOutcome> | null = null;
  private readyFlag = true;
  readonly ready: Promise<void>;
  /** Último resultado de adoção de login (para a interface da Etapa 3 e para testes). */
  lastAdoption: AdoptionOutcome | null = null;

  constructor(env: AccountManagerEnv) {
    this.env = env;
    const registry = readAccountRegistry(env.storage) ?? { version: 1 as const, accounts: [] };
    this.tabUserId = resolveTabAccount(registry, env.tabStorage);
    writeTabAccount(env.tabStorage, this.tabUserId);
    this.client = this.createFacade();
    env.visibility?.subscribe(() => this.applyRefreshPolicy());

    if (env.isAuthCallbackUrl?.()) {
      this.readyFlag = false;
      this.ready = this.bootFromCallback().finally(() => {
        this.readyFlag = true;
      });
    } else {
      this.ready = Promise.resolve();
    }
    if (this.tabUserId) this.clientFor(this.tabUserId);
    this.applyRefreshPolicy();
  }

  // ---------------------------------------------------------------- consulta

  isReady(): boolean {
    return this.readyFlag;
  }

  activeUserId(): string | null {
    return this.tabUserId;
  }

  /** Cliente da conta ativa desta aba (sem fachada), ou `null` sem conta ativa. */
  activeAccountClient(): SupabaseClient | null {
    return this.tabUserId ? this.clientFor(this.tabUserId) : null;
  }

  registry(): AccountRegistry {
    return readAccountRegistry(this.env.storage) ?? { version: 1, accounts: [] };
  }

  rememberedAccounts(): ReadonlyArray<RememberedAccount> {
    return this.registry().accounts;
  }

  inFlightRequests(): number {
    return this.inFlight;
  }

  switchPhase(): SwitchPhase {
    return this.phase;
  }

  subscribeSwitchPhase(listener: () => void): () => void {
    this.phaseListeners.add(listener);
    return () => this.phaseListeners.delete(listener);
  }

  // ---------------------------------------------------------------- clientes

  /** Um cliente por conta nesta aba (nunca dois para a mesma chave). */
  clientFor(userId: string): SupabaseClient {
    const id = userId.toLowerCase();
    const existing = this.clients.get(id);
    if (existing) return existing;
    const client = this.env.createClient({
      storageKey: accountStorageKey(this.env.supabaseUrl, id),
      detectSessionInUrl: false,
      accountUserId: id,
      fetch: createAccountFetch(this.env.supabaseUrl, id, this.track, this.env.baseFetch),
    });
    this.clients.set(id, client);
    client.auth.onAuthStateChange((event, session) => this.onAccountEvent(id, event, session));
    return client;
  }

  private ensurePending(): { slot: string; client: SupabaseClient } {
    if (this.pending) return this.pending;
    let slot: string | null = null;
    try {
      slot = this.env.tabStorage.getItem(TAB_PENDING_SLOT_KEY);
    } catch {
      slot = null;
    }
    if (!slot || !/^[0-9a-z]{8,40}$/i.test(slot)) {
      slot = (this.env.randomSlot ?? randomSlot)();
      try {
        this.env.tabStorage.setItem(TAB_PENDING_SLOT_KEY, slot);
      } catch {
        // Sem sessionStorage: o slot vale só para esta página (OAuth com redirecionamento cai num slot novo, vazio).
      }
    }
    const client = this.env.createClient({
      storageKey: pendingStorageKey(this.env.supabaseUrl, slot),
      detectSessionInUrl: true,
      accountUserId: null,
      fetch: createAccountFetch(this.env.supabaseUrl, null, this.track, this.env.baseFetch),
    });
    const entry = { slot, client };
    this.pending = entry;
    client.auth.onAuthStateChange((event, session) => {
      if (this.pending !== entry) return;
      if ((event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') && session) void this.adoptPending(event);
    });
    return entry;
  }

  /** Cliente que a fachada usa agora: o da conta ativa, ou o pendente (login) sem conta ativa. */
  currentClient(): SupabaseClient {
    return this.tabUserId ? this.clientFor(this.tabUserId) : this.ensurePending().client;
  }

  /** Auth para INCLUIR outra conta sem tocar na conta ativa (interface da Etapa 3). */
  pendingAuth(): SupabaseClient['auth'] {
    return this.ensurePending().client.auth;
  }

  private readonly track = <T>(promise: Promise<T>): Promise<T> => {
    this.inFlight += 1;
    const done = () => {
      this.inFlight -= 1;
    };
    promise.then(done, done);
    return promise;
  };

  private createFacade(): SupabaseClient {
    const manager = this;
    const bindValue = (target: object, prop: PropertyKey) => {
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    };
    const auth = new Proxy({} as SupabaseClient['auth'], {
      get(_t, prop) {
        if (prop === 'onAuthStateChange') return manager.onAuthStateChange;
        if (!manager.readyFlag) {
          // Antes de concluir um callback de login, nada consulta o Auth: espera a sessão ser atribuída à conta certa.
          return async (...args: unknown[]) => {
            await manager.ready;
            return (bindValue(manager.currentClient().auth, prop) as (...a: unknown[]) => unknown)(...args);
          };
        }
        return bindValue(manager.currentClient().auth, prop);
      },
    });
    return new Proxy({} as SupabaseClient, {
      get(_t, prop) {
        if (prop === 'auth') return auth;
        return bindValue(manager.currentClient(), prop);
      },
    });
  }

  // ---------------------------------------------------------------- eventos de Auth

  readonly onAuthStateChange = (callback: AuthListener) => {
    this.appListeners.add(callback);
    let active = true;
    const subscription = {
      id: `finelo-accounts-${Math.random().toString(36).slice(2)}`,
      callback,
      unsubscribe: () => {
        active = false;
        this.appListeners.delete(callback);
      },
    };
    setTimeout(async () => {
      await this.ready;
      if (!active) return;
      const { data } = await this.currentClient().auth.getSession();
      if (!active) return;
      callback('INITIAL_SESSION', data.session);
      const replay = this.replay;
      if (replay && this.replay === replay) {
        this.replay = null;
        callback(replay.event, replay.session);
      }
    }, 0);
    return { data: { subscription } };
  };

  private forward(event: AuthChangeEvent, session: Session | null): void {
    if (this.phase !== 'idle') return; // a troca de conta conduz o estado; eventos no meio dela não chegam ao app
    for (const listener of [...this.appListeners]) {
      try {
        listener(event, session);
      } catch (error) {
        console.error('[session] falha num ouvinte de Auth:', error instanceof Error ? error.name : 'erro');
      }
    }
  }

  private onAccountEvent(userId: string, event: AuthChangeEvent, session: Session | null): void {
    if (event === 'INITIAL_SESSION') return; // o multiplexador emite o seu próprio
    if (event === 'SIGNED_OUT') {
      const registry = readAccountRegistry(this.env.storage);
      if (registry?.accounts.some((a) => a.userId === userId && !a.signedOut)) {
        writeAccountRegistry(this.env.storage, markAccount(registry, userId, { signedOut: true }));
        this.env.channel?.post({ type: 'registry-changed' });
      }
      if (userId === this.tabUserId && this.phase === 'idle') {
        this.selectTabAccount(null);
        this.forward('SIGNED_OUT', null);
      }
      return;
    }
    if (userId === this.tabUserId) this.forward(event, session);
  }

  // ---------------------------------------------------------------- login novo (senha, OAuth, recuperação)

  private async bootFromCallback(): Promise<void> {
    const { client } = this.ensurePending();
    let session: Session | null = null;
    try {
      ({ data: { session } } = await client.auth.getSession());
    } catch {
      session = null;
    }
    if (!session) return;
    // O SDK emite SIGNED_IN / PASSWORD_RECOVERY logo depois de gravar a sessão do callback; a adoção começa ali.
    const started = Date.now();
    while (!this.adoption && Date.now() - started < 3000) await new Promise((r) => setTimeout(r, 10));
    if (this.adoption) await this.adoption;
  }

  /**
   * Sessão recém-criada no cliente pendente → conta lembrada. A identidade vem do Auth (`getUser`, rede), nunca do
   * JWT local. Com outra conta já ativa nesta aba, a nova só é registrada: a troca é explícita (`switchAccount`).
   */
  adoptPending(event: AuthChangeEvent = 'SIGNED_IN'): Promise<AdoptionOutcome> {
    if (this.adoption) return this.adoption;
    const run = (async (): Promise<AdoptionOutcome> => {
      // Fora do callback do SDK (que roda com o lock de Auth): chamar o Auth ali dentro trava.
      await new Promise((r) => setTimeout(r, 0));
      const entry = this.pending;
      if (!entry) return { status: 'failed', reason: 'no_session' };
      const { data, error } = await entry.client.auth.getUser();
      if (error || !data.user) {
        const status = (error as { status?: number } | null)?.status;
        const reason = !error ? 'no_session' : status && status >= 400 && status < 500 ? 'auth_rejected' : 'network';
        if (reason === 'auth_rejected') this.clearKeys(pendingStorageKey(this.env.supabaseUrl, entry.slot));
        return { status: 'failed', reason };
      }
      const user: User = data.user;
      const userId = user.id.toLowerCase();
      const registry = readAccountRegistry(this.env.storage) ?? { version: 1 as const, accounts: [] };
      const { registry: next, outcome } = upsertRememberedAccount(registry, { userId, email: user.email ?? null }, this.now());
      if (outcome === 'limit_reached') {
        await signOutAndForgetLocalSession(entry.client.auth, { scope: 'local' });
        return { status: 'limit_reached' };
      }
      const accountKey = accountStorageKey(this.env.supabaseUrl, userId);
      const pendingKey = pendingStorageKey(this.env.supabaseUrl, entry.slot);
      // Mesma conta já lembrada com outra sessão: a antiga sai deste navegador antes de a nova ocupar a chave.
      if (outcome === 'updated' && this.env.storage.getItem(accountKey) !== null) {
        await signOutAndForgetLocalSession(this.clientFor(userId).auth, { scope: 'local' });
      }
      for (const suffix of SDK_KEY_SUFFIXES) {
        const value = this.env.storage.getItem(pendingKey + suffix);
        if (suffix === '-code-verifier') continue;
        if (value !== null) this.env.storage.setItem(accountKey + suffix, value);
      }
      this.clearKeys(pendingKey);
      writeAccountRegistry(this.env.storage, next);
      this.env.channel?.post({ type: 'registry-changed' });
      this.pending = null;
      try {
        this.env.tabStorage.removeItem(TAB_PENDING_SLOT_KEY);
      } catch {
        // ignorado
      }
      const activated = !this.tabUserId && this.phase === 'idle';
      if (activated) {
        this.selectTabAccount(userId);
        const { data: fresh } = await this.clientFor(userId).auth.getSession();
        if (this.appListeners.size === 0) this.replay = event === 'PASSWORD_RECOVERY' ? { event, session: fresh.session } : null;
        this.forward(event, fresh.session);
      }
      return { status: 'adopted', userId, activated };
    })();
    this.adoption = run;
    void run.then(
      (outcome) => {
        this.lastAdoption = outcome;
        this.adoption = null;
      },
      () => {
        this.lastAdoption = { status: 'failed', reason: 'network' };
        this.adoption = null;
      }
    );
    return run;
  }

  // ---------------------------------------------------------------- conta da aba, renovação, troca

  selectTabAccount(userId: string | null): void {
    this.tabUserId = userId ? userId.toLowerCase() : null;
    writeTabAccount(this.env.tabStorage, this.tabUserId);
    if (this.tabUserId) {
      const registry = readAccountRegistry(this.env.storage);
      if (registry) writeAccountRegistry(this.env.storage, markAccount(registry, this.tabUserId, { lastUsedAt: this.now() }));
    }
    this.applyRefreshPolicy();
  }

  /** Só a conta ativa desta aba renova token, só com a aba visível e fora de uma troca. */
  applyRefreshPolicy(): void {
    const visible = this.env.visibility ? this.env.visibility.isVisible() : true;
    for (const [userId, client] of this.clients) {
      const should = userId === this.tabUserId && visible && this.phase === 'idle';
      if (should && !this.refreshing.has(userId)) {
        this.refreshing.add(userId);
        void client.auth.startAutoRefresh();
      } else if (!should && this.refreshing.has(userId)) {
        this.refreshing.delete(userId);
        void client.auth.stopAutoRefresh();
      }
    }
  }

  isRefreshing(userId: string): boolean {
    return this.refreshing.has(userId.toLowerCase());
  }

  setSwitchPhase(phase: SwitchPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.applyRefreshPolicy();
    for (const listener of [...this.phaseListeners]) listener();
  }

  // ---------------------------------------------------------------- saída e remoção

  /** Encerra (escopo local) a sessão de uma conta neste navegador; a conta continua lembrada, sem sessão. */
  async signOutAccount(userId: string): Promise<SignOutOutcome> {
    const id = userId.toLowerCase();
    if (id === this.tabUserId) this.selectTabAccount(null);
    const outcome = await signOutAndForgetLocalSession(this.clientFor(id).auth, { scope: 'local' });
    const registry = readAccountRegistry(this.env.storage);
    if (registry) writeAccountRegistry(this.env.storage, markAccount(registry, id, { signedOut: true }));
    this.env.channel?.post({ type: 'registry-changed' });
    return outcome;
  }

  /** Encerra a sessão e esquece a conta neste navegador. As demais contas não são tocadas. */
  async removeAccount(userId: string): Promise<SignOutOutcome> {
    const id = userId.toLowerCase();
    const outcome = await this.signOutAccount(id);
    this.clearKeys(accountStorageKey(this.env.supabaseUrl, id));
    const registry = readAccountRegistry(this.env.storage);
    if (registry) writeAccountRegistry(this.env.storage, removeRememberedAccount(registry, id));
    this.env.channel?.post({ type: 'registry-changed' });
    return outcome;
  }

  /** Encerra todas as contas deste navegador (escopo local) e esvazia o registro. */
  async signOutAll(): Promise<ReadonlyArray<{ userId: string; outcome: SignOutOutcome }>> {
    this.selectTabAccount(null);
    const results: Array<{ userId: string; outcome: SignOutOutcome }> = [];
    for (const account of this.registry().accounts) {
      const outcome = await signOutAndForgetLocalSession(this.clientFor(account.userId).auth, { scope: 'local' });
      this.clearKeys(accountStorageKey(this.env.supabaseUrl, account.userId));
      results.push({ userId: account.userId, outcome });
    }
    writeAccountRegistry(this.env.storage, { version: 1, accounts: [] });
    this.env.channel?.post({ type: 'registry-changed' });
    return results;
  }

  private clearKeys(key: string): void {
    for (const suffix of SDK_KEY_SUFFIXES) {
      try {
        this.env.storage.removeItem(key + suffix);
      } catch {
        // ignorado
      }
    }
  }

  private now(): number {
    return (this.env.now ?? Date.now)();
  }
}
