import { createClient, type Session, type User } from '@supabase/supabase-js';
import { requestBearer } from '../sessionFence';
import { readBearerIdentity } from '../sessionScope';
import { isAccountUserId, type KeyValueStorage } from './accountStore';

export const DEVICE_CALLBACK = '/device-auth';
const SLOT = 'finelo.deviceAuth.v2';
const INVALID = 'Tentativa inválida ou expirada. Inicie novamente nesta aba.';
type Purpose = 'password' | 'oauth' | 'recovery';
interface Attempt {
  id: string;
  purpose: Purpose;
  until: number;
  origin: string | null;
  context: string;
  expected?: string;
  email?: string;
}

export interface DeviceAuthEnv {
  url: string;
  key: string;
  origin: string;
  tab: KeyValueStorage;
  shared: KeyValueStorage;
  context(): string;
  openProvider(): { go(url: string): void; close(): void };
  current(): string | null;
  idle(): boolean;
  fetch: typeof fetch;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  remember(user: User, session: Session): void;
}

export type DeviceCallback = { id: string; code: string };
let captured: DeviceCallback | null = null;
const CHANNEL = 'finelo.deviceAuth.callback.v2';
let relayed = false;
export const isProviderReturn = () => relayed;

export function browserAttemptContext() {
  // Browser context names survive same-origin reloads. New top-level contexts have their own name.
  if (!/^finelo-auth-[0-9a-f-]{36}$/.test(window.name)) window.name = 'finelo-auth-' + crypto.randomUUID();
  return window.name;
}

export function openProviderWindow() {
  if (typeof BroadcastChannel === 'undefined') return fail();
  const popup = window.open('about:blank', '_blank', 'popup');
  if (!popup) return fail();
  popup.opener = null;
  return { go: (url: string) => popup.location.replace(url), close: () => popup.close() };
}

export function captureDeviceCallback(): void {
  if (typeof window === 'undefined' || window.location.pathname !== DEVICE_CALLBACK) return;
  const url = new URL(window.location.href);
  if (!url.search && !url.hash) return;
  captured = !url.hash && !url.searchParams.has('error') &&
    url.searchParams.getAll('attempt').length === 1 && url.searchParams.getAll('code').length === 1
    ? { id: url.searchParams.get('attempt')!, code: url.searchParams.get('code')! } : null;
  window.history.replaceState(window.history.state, '', DEVICE_CALLBACK);
  if (url.searchParams.get('relay') === '1' && captured && typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(captured);
    channel.close();
    captured = null;
    relayed = true;
  }
}

export function takeDeviceCallback() {
  const callback = captured;
  captured = null;
  return callback;
}

const fail = (): never => { throw new Error(INVALID); };
const keyFor = (id: string) => SLOT + '.' + id;
const normalize = (email?: string) => email?.trim().toLowerCase();

export class DeviceAuth {
  private recovery?: { attempt: Attempt; auth: ReturnType<DeviceAuth['client']>; token: string; userId: string };
  private readonly cleanup = new Map<string, () => void>();
  private permit?: { id: string; token: string };

  constructor(private readonly env: DeviceAuthEnv) {}

  private read(): Attempt | null {
    try {
      const a = JSON.parse(this.env.tab.getItem(SLOT) ?? 'null');
      return a && isAccountUserId(a.id) ? a : null;
    } catch { return null; }
  }

  listenForProviderReturn(navigate: (url: string) => void) {
    if (typeof BroadcastChannel === 'undefined' || typeof window === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = ({ data }) => {
      const a = this.read();
      if (!a || a.purpose !== 'oauth' || data?.id !== a.id || typeof data.code !== 'string') return;
      try { this.check(a); } catch { return; }
      const url = new URL(DEVICE_CALLBACK, this.env.origin);
      url.searchParams.set('attempt', a.id);
      url.searchParams.set('code', data.code);
      navigate(url.href);
    };
  }

  private check(a: Attempt) {
    if (a.context !== this.env.context() || this.read()?.id !== a.id || this.env.shared.getItem(keyFor(a.id)) !== String(a.until) ||
        !(a.until > Date.now()) || a.origin !== this.env.current() || !this.env.idle()) fail();
  }

  private clear(a: Attempt) {
    this.cleanup.get(a.id)?.();
    this.cleanup.delete(a.id);
    if (a.context === this.env.context() && this.env.shared.getItem(keyFor(a.id)) === String(a.until)) {
      this.env.shared.removeItem(keyFor(a.id));
    }
    this.env.tab.removeItem(keyFor(a.id) + '-code-verifier');
    if (this.read()?.id === a.id) this.env.tab.removeItem(SLOT);
    if (this.recovery?.attempt.id === a.id) this.recovery = undefined;
    if (this.permit?.id === a.id) this.permit = undefined;
  }

  cancel() {
    const a = this.read();
    if (a) this.clear(a);
  }

  private start(purpose: Purpose, expected?: string, email?: string) {
    this.cancel();
    if (!this.env.idle() || !globalThis.crypto?.subtle) fail();
    const a: Attempt = { id: crypto.randomUUID(), until: Date.now() + 15 * 60_000,
      origin: this.env.current(), context: this.env.context(), purpose, expected, email: normalize(email) };
    this.env.tab.setItem(SLOT, JSON.stringify(a));
    this.env.shared.setItem(keyFor(a.id), String(a.until));
    return a;
  }

  private client(a: Attempt) {
    const storageKey = keyFor(a.id);
    const verifier = storageKey + '-code-verifier';
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => key === verifier ? this.env.tab.getItem(key) : memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        this.check(a);
        if (key === verifier) this.env.tab.setItem(key, value);
        else memory.set(key, value);
      },
      removeItem: (key: string) => {
        if (key === verifier) this.env.tab.removeItem(key);
        else memory.delete(key);
      },
    };
    const auth = createClient(this.env.url, this.env.key, {
      auth: { storage, storageKey, flowType: 'pkce', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (input, init) => {
        this.check(a);
        const url = new URL(input instanceof Request ? input.url : String(input));
        const base = new URL(this.env.url.replace(/\/$/, '') + '/auth/v1/');
        if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) fail();
        if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
          if (url.pathname !== base.pathname + 'user' || this.permit?.id !== a.id ||
              this.permit.token !== requestBearer(input, init)) fail();
          this.permit = undefined;
        }
        return this.env.fetch(input, init);
      } },
    }).auth;
    this.cleanup.set(a.id, () => { memory.clear(); void auth.stopAutoRefresh(); });
    return auth;
  }

  private async confirmed(a: Attempt, auth: ReturnType<DeviceAuth['client']>, session: Session) {
    const { data, error } = await auth.getUser(session.access_token);
    this.check(a);
    const identity = readBearerIdentity(session.access_token);
    const user = data.user;
    if (error || !user || !identity?.sessionId || identity.sub !== user.id || session.user.id !== user.id ||
        (a.expected && user.id !== a.expected) || (a.email && normalize(user.email) !== a.email)) return fail();
    return user;
  }

  async password(email: string, password: string, expected?: string) {
    const a = this.start('password', expected);
    try {
      const auth = this.client(a);
      const { data, error } = await auth.signInWithPassword({ email, password });
      if (error || !data.session) return fail();
      const session = data.session;
      const user = await this.confirmed(a, auth, session);
      await this.env.exclusive(async () => { this.check(a); this.env.remember(user, session); });
    } finally { this.clear(a); }
  }

  async redirect(kind: 'google' | 'github' | 'recovery', expected?: string, email?: string) {
    const a = this.start(kind === 'recovery' ? 'recovery' : 'oauth', expected, email);
    let popup: ReturnType<DeviceAuthEnv['openProvider']> | undefined;
    try {
      if (kind !== 'recovery') popup = this.env.openProvider();
      const auth = this.client(a);
      const redirectTo = new URL(DEVICE_CALLBACK, this.env.origin);
      redirectTo.searchParams.set('attempt', a.id);
      if (kind === 'recovery') {
        if (!a.email) fail();
        const { error } = await auth.resetPasswordForEmail(a.email!, { redirectTo: redirectTo.href });
        if (error) fail();
        this.check(a);
      } else {
        redirectTo.searchParams.set('relay', '1');
        const { data, error } = await auth.signInWithOAuth({ provider: kind, options: { redirectTo: redirectTo.href, skipBrowserRedirect: true } });
        this.check(a);
        if (error || !data.url) return fail();
        popup!.go(data.url);
      }
    } catch (error) { popup?.close(); this.clear(a); throw error; }
  }

  async callback(input: DeviceCallback | null) {
    const a = this.read();
    if (!a || !input?.code || a.id !== input.id || a.purpose === 'password') return fail();
    return this.env.exclusive(async () => {
      this.check(a);
      // Claim once across tabs, including copies of sessionStorage. Recovery continues only in this document.
      const verifier = this.env.tab.getItem(keyFor(a.id) + '-code-verifier');
      if (!verifier) return fail();
      this.cleanup.get(a.id)?.();
      const auth = this.client(a);
      try {
        const { data, error } = await auth.exchangeCodeForSession(input.code);
        if (error || !data.session) return fail();
        const recovery = 'redirectType' in data && data.redirectType === 'PASSWORD_RECOVERY';
        if (recovery !== (a.purpose === 'recovery')) return fail();
        const user = await this.confirmed(a, auth, data.session);
        if (recovery) {
          // Rotate the shared capability; a duplicated tab retains the old value.
          a.until = Math.min(a.until - 1, Date.now() + 5 * 60_000);
          this.env.tab.setItem(SLOT, JSON.stringify(a));
          this.env.shared.setItem(keyFor(a.id), String(a.until));
          this.recovery = { attempt: a, auth, token: data.session.access_token, userId: user.id };
          return 'recovery' as const;
        }
        this.env.remember(user, data.session);
        this.clear(a);
        return 'added' as const;
      } catch (error) { this.clear(a); throw error; }
    });
  }

  async updatePassword(password: string) {
    const bound = this.recovery;
    if (!bound) return fail();
    this.recovery = undefined;
    const { attempt, auth, token, userId } = bound;
    try {
      this.check(attempt);
      const { data } = await auth.getSession();
      if (!data.session || data.session.access_token !== token) return fail();
      const user = await this.confirmed(attempt, auth, data.session);
      if (user.id !== userId) return fail();
      this.permit = { id: attempt.id, token };
      const result = await auth.updateUser({ password });
      if (result.error || result.data.user?.id !== userId) fail();
    } finally { this.clear(attempt); }
  }
}
