/**
 * Logout com o cliente supabase-js REAL: a sessão nunca fica guardada no dispositivo, mesmo quando o servidor não
 * confirma (rede, 5xx). Fixa o contrato interno `_removeSession` usado em `signOutAndForgetLocalSession`.
 */
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { signOutAndForgetLocalSession } from '../../src/domain/session/sessionSignOut';
import { fakeJwt } from '../helpers/fakeJwt';

const URL_BASE = 'https://project.supabase.test';
type LogoutMode = 'ok' | 'network' | 'http500' | 'http401';

function setup(mode: LogoutMode) {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.endsWith('/auth/v1/logout')) {
      if (mode === 'network') throw new TypeError('Failed to fetch');
      if (mode === 'http500') return json({ code: 500, msg: 'indisponível' }, 500);
      if (mode === 'http401') return json({ code: 401, msg: 'token expirado' }, 401);
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith('/auth/v1/user')) return json({ id: 'user-A', aud: 'authenticated', role: 'authenticated' });
    return json([]);
  };
  const client = createClient(URL_BASE, 'sb_publishable_test', {
    auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchImpl },
  });
  return { client, store };
}

const signedIn = async (mode: LogoutMode) => {
  const ctx = setup(mode);
  // O auth-js valida o formato base64url das três partes: a assinatura falsa do helper ("signature") não serve.
  const accessToken = fakeJwt({
    sub: 'user-A',
    session_id: 'sess-1',
    role: 'authenticated',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }).replace(/\.signature$/, '.c2ln');
  const { error } = await ctx.client.auth.setSession({ access_token: accessToken, refresh_token: 'refresh' });
  expect(error).toBeNull();
  expect((await ctx.client.auth.getSession()).data.session).not.toBeNull();
  const events: string[] = [];
  ctx.client.auth.onAuthStateChange((event) => events.push(event));
  return { ...ctx, events };
};

const persistedTokens = (store: Map<string, string>) => [...store.keys()].filter((k) => k.endsWith('-auth-token'));

describe('logout que esquece a sessão local (supabase-js real)', () => {
  it('servidor confirma: sessão removida e SIGNED_OUT emitido', async () => {
    const { client, store, events } = await signedIn('ok');
    const outcome = await signOutAndForgetLocalSession(client.auth);
    expect(outcome).toEqual({ serverConfirmed: true, localCleared: true, error: null });
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(persistedTokens(store)).toEqual([]);
    expect(events).toContain('SIGNED_OUT');
  });

  it.each(['network', 'http500'] as const)('servidor não confirma (%s): o SDK manteria a sessão; ela é removida mesmo assim', async (mode) => {
    const { client, store, events } = await signedIn(mode);
    // Pré-condição que justifica a correção: o SDK sozinho devolve erro e mantém a sessão.
    const probe = await signedIn(mode);
    expect((await probe.client.auth.signOut()).error).not.toBeNull();
    expect((await probe.client.auth.getSession()).data.session).not.toBeNull();

    const outcome = await signOutAndForgetLocalSession(client.auth);
    expect(outcome.serverConfirmed).toBe(false);
    expect(outcome.localCleared).toBe(true);
    expect(outcome.error).toBeTruthy();
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(persistedTokens(store)).toEqual([]);
    expect(events).toContain('SIGNED_OUT');
  });

  it('token já expirado no servidor (401): o SDK trata como logout concluído', async () => {
    const { client, store } = await signedIn('http401');
    const outcome = await signOutAndForgetLocalSession(client.auth);
    expect(outcome.localCleared).toBe(true);
    expect(persistedTokens(store)).toEqual([]);
  });
});
