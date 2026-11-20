import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { GoTrueClient } from '@supabase/supabase-js';
import { DeviceAuth, type DeviceAuthEnv } from '../../../src/domain/session/accounts/deviceAuth';
import { SessionAccountManager } from '../../../src/domain/session/accounts/accountManager';
import { accountStorageKey, writeAccountRegistry } from '../../../src/domain/session/accounts/accountStore';
import { deferred, FakeSupabase, KEY, MemoryStorage, sharedLock, tabEnv, URL_BASE, USERS } from './harness';

function setup() {
  const server = new FakeSupabase();
  const shared = new MemoryStorage();
  const tab = new MemoryStorage();
  const origin = 'https://finelo.test';
  const sessionA = JSON.stringify(server.issue('A'));
  const keyA = accountStorageKey(URL_BASE, USERS.A.id);
  shared.setItem(keyA, sessionA);
  writeAccountRegistry(shared, { version: 1, accounts: [{ userId: USERS.A.id, email: USERS.A.email, addedAt: 1, lastUsedAt: 1, signedOut: false }] });
  const manager = new SessionAccountManager(tabEnv({ server, storage: shared, tabStorage: tab }));
  let challenge = '';
  let id = '';
  let used = false;
  const updates: string[] = [];
  const lock = sharedLock();
  const capture = (url: string) => { id = new URL(url).searchParams.get('attempt')!; };
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const env: DeviceAuthEnv = {
    origin, url: URL_BASE, key: KEY, tab, shared, current: () => manager.activeUserId(),
    idle: () => manager.switchPhase() === 'idle', exclusive: fn => lock('commit', -1, fn),
    remember: (user, session) => manager.rememberConfirmedSession(user, session),
    context: () => 'original-context',
    openProvider: () => ({ close: () => {}, go: value => {
      const url = new URL(value);
      expect(url.searchParams.get('code_challenge_method')?.toLowerCase()).toBe('s256');
      challenge = url.searchParams.get('code_challenge')!;
      capture(url.searchParams.get('redirect_to')!);
    } }),
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (url.pathname.endsWith('/recover')) {
        challenge = body.code_challenge;
        expect(body.code_challenge_method?.toLowerCase()).toBe('s256');
        capture(url.searchParams.get('redirect_to')!);
        return json({});
      }
      if (url.searchParams.get('grant_type') === 'pkce') {
        const hash = createHash('sha256').update(body.code_verifier).digest('base64url');
        if (used || body.auth_code !== 'one-use-code' || hash !== challenge) return json({ message: 'invalid code' }, 400);
        used = true;
        return json(server.issue('B'));
      }
      const reply = await server.fetch(input, init);
      if (init?.method === 'PUT' && reply.ok) updates.push((await reply.clone().json()).id);
      return reply;
    },
  };
  const auth = new DeviceAuth(env);
  const callback = () => ({ id, code: 'one-use-code' });
  const reset = () => auth.redirect('recovery', USERS.B.id, USERS.B.email);
  const intact = () => {
    expect(shared.getItem(keyA)).toBe(sessionA);
    expect(manager.activeUserId()).toBe(USERS.A.id);
    expect(server.authCalls.filter(x => x.path.endsWith('logout'))).toHaveLength(0);
    expect(updates.filter(sub => sub === USERS.A.id)).toHaveLength(0);
  };
  return { server, manager, shared, tab, auth, callback, env, updates, reset, intact };
}

describe('Device Auth · SDK real e backend isolado', () => {
  it('A ativa, recarga antes do retorno PKCE, um PUT autorizado para B e zero para A', async () => {
    const t = setup();
    await t.reset();
    const resumed = new DeviceAuth(t.env);
    expect(await resumed.callback(t.callback())).toBe('recovery');
    await resumed.updatePassword('synthetic-new-password');
    expect(t.updates).toEqual([USERS.B.id]);
    await expect(resumed.updatePassword('synthetic-repeat')).rejects.toThrow();
    await expect(resumed.callback(t.callback())).rejects.toThrow();
    expect(t.manager.rememberedAccounts()).toHaveLength(1);
    t.intact();
  });

  it.each(['google', 'github'] as const)('adiciona B via %s após recarga, mantendo A ativa', async provider => {
    const t = setup();
    await t.auth.redirect(provider, USERS.B.id);
    expect(await new DeviceAuth(t.env).callback(t.callback())).toBe('added');
    expect(t.manager.rememberedAccounts().map(a => a.userId)).toEqual([USERS.A.id, USERS.B.id]);
    await expect(t.auth.callback(t.callback())).rejects.toThrow();
    t.intact();
  });

  it('preserva a duplicata e exige o id confirmado na reautenticação dirigida', async () => {
    const t = setup();
    await t.auth.password(USERS.A.email, USERS.A.password);
    await expect(t.auth.password(USERS.C.email, USERS.C.password, USERS.B.id)).rejects.toThrow();
    await t.auth.password(USERS.B.email, USERS.B.password, USERS.B.id);
    const key = accountStorageKey(URL_BASE, USERS.B.id);
    const first = t.shared.getItem(key);
    await t.auth.password(USERS.B.email, USERS.B.password, USERS.B.id);
    expect(t.shared.getItem(key)).toBe(first);
    t.intact();
  });

  it.each(['cancel', 'expired', 'otherTab', 'clonedTab', 'wrongAttempt', 'badCode', 'direct', 'wrongEmail', 'wrongId', 'revoked', 'reloadAfter', 'changedAccount'] as const)
  ('recusa %s com zero gravações de senha', async reason => {
    const t = setup();
    await t.auth.redirect('recovery', reason === 'wrongId' ? USERS.C.id : USERS.B.id,
      reason === 'wrongEmail' ? USERS.C.email : USERS.B.email);
    if (reason === 'cancel') t.auth.cancel();
    if (reason === 'expired') {
      const now = Date.now;
      try {
        Date.now = () => now() + 16 * 60_000;
        await expect(t.auth.callback(t.callback())).rejects.toThrow();
      } finally { Date.now = now; }
    } else if (['revoked', 'reloadAfter', 'changedAccount'].includes(reason)) {
      await t.auth.callback(t.callback());
      if (reason === 'revoked') t.server.revokeAll('B');
      if (reason === 'changedAccount') t.manager.setSwitchPhase('draining');
      const client = reason === 'reloadAfter' ? new DeviceAuth(t.env) : t.auth;
      await expect(client.updatePassword('synthetic-new-password')).rejects.toThrow();
    } else {
      const client = reason === 'otherTab' ? new DeviceAuth({ ...t.env, tab: new MemoryStorage() }) : reason === 'clonedTab' ? new DeviceAuth({ ...t.env, context: () => 'another-context' }) : t.auth;
      const input = t.callback();
      if (reason === 'wrongAttempt') input.id = crypto.randomUUID();
      if (reason === 'badCode') input.code = 'invalid';
      await expect(client.callback(reason === 'direct' ? null : input)).rejects.toThrow();
      await expect(client.updatePassword('synthetic-new-password')).rejects.toThrow();
    }
    expect(t.updates).toEqual([]);
    t.intact();
  });

  it('verifica o portador no envio mesmo se o SDK mudar de sessão depois do último getUser', async () => {
    const t = setup();
    await t.reset();
    await t.auth.callback(t.callback());
    const alternative = t.server.issue('A');
    const update = GoTrueClient.prototype.updateUser;
    const changed = vi.spyOn(GoTrueClient.prototype, 'updateUser').mockImplementationOnce(async function (attributes) {
      await this.setSession(alternative);
      return update.call(this, attributes);
    });
    try {
      await expect(t.auth.updatePassword('synthetic-new-password')).rejects.toThrow();
      expect(changed).toHaveBeenCalledTimes(1);
      expect(t.updates).toEqual([]);
      t.intact();
    } finally { changed.mockRestore(); }
  });

  it('falha de rede após confirmação e resposta tardia após cancelamento preservam A', async () => {
    const t = setup();
    await t.reset();
    await t.auth.callback(t.callback());
    t.server.network = false;
    await expect(t.auth.updatePassword('synthetic-new-password')).rejects.toThrow();
    t.server.network = true;
    const gate = deferred();
    t.server.gates.set('/auth/v1/user', gate);
    const login = t.auth.password(USERS.B.email, USERS.B.password);
    await new Promise(resolve => setTimeout(resolve, 20));
    t.auth.cancel();
    gate.resolve();
    await expect(login).rejects.toThrow();
    expect(t.manager.rememberedAccounts()).toHaveLength(1);
    expect(t.updates).toEqual([]);
    t.intact();
  });
});
