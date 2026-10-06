import { describe, expect, it, vi } from 'vitest';
import {
  ACQUISITION_OAUTH_KEY, ACQUISITION_PENDING_KEY, ACQUISITION_TTL_MS,
  beginOAuthAcquisition, captureAcquisition, clearAcquisition, OAUTH_WINDOW_MS,
  readOAuthAcquisition, readPendingAcquisition, sanitizeAcquisition,
  type AcquisitionContext, type AcquisitionStorage,
} from '../../src/domain/auth/acquisitionAttribution';
import {
  resolveOAuthAcquisition, signUpWithAcquisition, startOAuthWithAcquisition,
  type AcquisitionAuth,
} from '../../src/services/acquisitionAuth';

const T = Date.parse('2026-10-06T12:00:00Z');
const instagram = { campaign: 'pilot_activation_01', source: 'instagram', medium: 'organic' };
const link = (source = 'instagram') => `?utm_source=${source}&utm_medium=organic&utm_campaign=pilot_activation_01`;
function memory() {
  const values = new Map<string, string>();
  return { values, getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
}
function setup() {
  const pending = memory(); const oauth = memory(); let now = T;
  const context: AcquisitionContext = { pendingStorage: pending, oauthStorage: oauth, now: () => now };
  const user = { id: 'qa', created_at: new Date(T).toISOString(), user_metadata: { full_name: 'QA' } as Record<string, unknown>,
    app_metadata: { provider: 'google' }, identities: [{ provider: 'google' }] };
  const signUp = vi.fn(async (_input: unknown) => ({ data: { user, session: null }, error: null }));
  const signInWithOAuth = vi.fn(async (_input: unknown) => ({ data: { provider: 'google', url: 'https://oauth.example' }, error: null }));
  const getUser = vi.fn(async () => ({ data: { user }, error: null }));
  const updateUser = vi.fn(async (input: { data: Record<string, unknown> }) => {
    user.user_metadata = { ...user.user_metadata, ...input.data };
    return { data: { user }, error: null };
  });
  const auth = { signUp, signInWithOAuth, getUser, updateUser } as unknown as AcquisitionAuth;
  return { context, pending, oauth, user, auth, signUp, signInWithOAuth, getUser, updateUser, time: (t: number) => { now = t; } };
}
const credentials = { email: 'synthetic@example.test', password: 'not-a-real-password',
  options: { emailRedirectTo: 'https://qa.example/app', data: { full_name: 'QA', app_preference: true } } };

describe('allowlisted acquisition — local first attribution', () => {
  it.each(['instagram', 'facebook', 'referral'])('accepts %s and reconstructs exactly three metadata keys', source => {
    const s = setup(); const p = captureAcquisition(link(source), s.context);
    expect(p?.attribution).toEqual({ ...instagram, source });
    expect(Object.keys(p!.attribution).sort()).toEqual(['campaign', 'medium', 'source']);
  });
  it.each([
    '?utm_source=instagram&utm_medium=organic&utm_campaign=other',
    '?utm_source=unknown&utm_medium=organic&utm_campaign=pilot_activation_01',
    '?utm_source=instagram&utm_medium=paid&utm_campaign=pilot_activation_01',
    '?utm_source=instagram&utm_campaign=pilot_activation_01',
    '?utm_source=instagram&utm_source=facebook&utm_medium=organic&utm_campaign=pilot_activation_01',
  ])('ignores invalid combinations entirely: %s', search => {
    const s = setup(); expect(captureAcquisition(search, s.context)).toBeNull(); expect(s.pending.values.size).toBe(0);
  });
  it('never retains extra UTM, URL, referrer, email, financial or device data', () => {
    const s = setup(); captureAcquisition(link() + '&utm_content=sensitive&utm_term=sensitive&email=private&referrer=private&ip=private&user_agent=private&balance=999', s.context);
    const saved = JSON.parse(s.pending.getItem(ACQUISITION_PENDING_KEY)!);
    expect(saved).toEqual({ attribution: instagram, capturedAt: T });
    expect(s.pending.getItem(ACQUISITION_PENDING_KEY)).not.toContain('private');
    expect(s.pending.getItem(ACQUISITION_PENDING_KEY)).not.toContain('sensitive');
    expect(sanitizeAcquisition({ ...instagram, source: { toString: () => 'instagram', email: 'private' } })).toBeNull();
  });
  it('keeps landing attribution after navigating to signup with no UTM', () => {
    const s = setup(); captureAcquisition(link(), s.context); s.time(T + 1000);
    expect(captureAcquisition('?view=signup', s.context)?.attribution).toEqual(instagram);
  });
  it('never overwrites a valid pending attribution with invalid or later valid touches', () => {
    const s = setup(); captureAcquisition(link(), s.context);
    captureAcquisition('?utm_source=unknown', s.context); captureAcquisition(link('facebook'), s.context);
    expect(readPendingAcquisition(s.context)?.attribution).toEqual(instagram);
  });
  it('expires and removes at exactly seven days, then accepts a new touch', () => {
    const s = setup(); captureAcquisition(link(), s.context); s.time(T + ACQUISITION_TTL_MS);
    expect(readPendingAcquisition(s.context)).toBeNull(); expect(s.pending.values.size).toBe(0);
    expect(captureAcquisition(link('referral'), s.context)?.attribution.source).toBe('referral');
  });
  it('rejects corrupt, future-dated and unsafe stored records', () => {
    const s = setup();
    for (const value of ['{', JSON.stringify({ attribution: instagram, capturedAt: T + 1 }), JSON.stringify({ attribution: { ...instagram, source: 'other' }, capturedAt: T })]) {
      s.pending.setItem(ACQUISITION_PENDING_KEY, value);
      expect(readPendingAcquisition(s.context)).toBeNull(); expect(s.pending.values.size).toBe(0);
    }
  });
  it('storage failures do not throw or fall back to unsafe attribution', () => {
    const broken: AcquisitionStorage = { getItem: () => { throw Error(); }, setItem: () => { throw Error(); }, removeItem: () => { throw Error(); } };
    const c: AcquisitionContext = { pendingStorage: broken, oauthStorage: broken, now: () => T };
    expect(captureAcquisition(link(), c)).toBeNull(); expect(() => beginOAuthAcquisition('google', true, c)).not.toThrow();
    expect(readOAuthAcquisition(c)).toBeNull(); expect(() => clearAcquisition(c)).not.toThrow();
  });
});

describe('email signup through the Auth service', () => {
  it('sends sanitized acquisition alongside legitimate metadata and consumes after acceptance', async () => {
    const s = setup(); captureAcquisition(link(), s.context);
    await signUpWithAcquisition(s.auth, credentials, s.context);
    expect(s.signUp).toHaveBeenCalledWith({ ...credentials, options: { ...credentials.options,
      data: { ...credentials.options.data, acquisition_v1: instagram } } });
    expect(readPendingAcquisition(s.context)).toBeNull();
    expect(JSON.stringify(s.signUp.mock.calls[0][0])).not.toContain('capturedAt');
  });
  it('does not attach acquisition without UTM or when expired', async () => {
    const s = setup(); await signUpWithAcquisition(s.auth, credentials, s.context);
    expect(s.signUp).toHaveBeenLastCalledWith(credentials);
    captureAcquisition(link(), s.context); s.time(T + ACQUISITION_TTL_MS);
    await signUpWithAcquisition(s.auth, credentials, s.context); expect(s.signUp).toHaveBeenLastCalledWith(credentials);
  });
  it('keeps pending when signup fails', async () => {
    const s = setup(); captureAcquisition(link(), s.context);
    s.signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: 'failed' } } as never);
    await signUpWithAcquisition(s.auth, credentials, s.context); expect(readPendingAcquisition(s.context)).not.toBeNull();
  });
  it('keeps pending on thrown network error or nonaccepted recovery response', async () => {
    const s = setup(); captureAcquisition(link(), s.context);
    s.signUp.mockRejectedValueOnce(Error('offline')); await expect(signUpWithAcquisition(s.auth, credentials, s.context)).rejects.toThrow('offline');
    expect(readPendingAcquisition(s.context)).not.toBeNull();
    s.signUp.mockResolvedValueOnce({ data: { user: { ...s.user, recovery_sent_at: new Date(T).toISOString() } }, error: null } as never);
    await signUpWithAcquisition(s.auth, credentials, s.context); expect(readPendingAcquisition(s.context)).not.toBeNull();
  });
  it('preserves a first attribution already supplied in signup metadata', async () => {
    const s = setup(); captureAcquisition(link(), s.context);
    const c = { ...credentials, options: { ...credentials.options, data: { ...credentials.options.data, acquisition_v1: { ...instagram, source: 'referral' } } } };
    await signUpWithAcquisition(s.auth, c, s.context); expect(s.signUp).toHaveBeenCalledWith(c);
  });
});

describe('OAuth signup — server-validated new user, no reattribution', () => {
  const begin = async (s: ReturnType<typeof setup>, signup = true) => {
    captureAcquisition(link(), s.context); await startOAuthWithAcquisition(s.auth, 'google', signup, 'https://qa.example/app', s.context);
  };
  it('records signup intent per tab, preserves pending, does not put metadata into OAuth options', async () => {
    const s = setup(); await begin(s);
    expect(readOAuthAcquisition(s.context)).toEqual({ provider: 'google', startedAt: T, capturedAt: T });
    expect(readPendingAcquisition(s.context)?.attribution).toEqual(instagram);
    expect(s.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'https://qa.example/app' } });
  });
  it('new OAuth user receives only sanitized patch; normal metadata survives, local intent is consumed', async () => {
    const s = setup(); await begin(s); s.time(T + 2000); s.user.created_at = new Date(T + 1000).toISOString();
    expect(await resolveOAuthAcquisition(s.auth, s.context)).toBe('attributed');
    expect(s.getUser).toHaveBeenCalledTimes(1);
    expect(s.updateUser).toHaveBeenCalledWith({ data: { acquisition_v1: instagram } });
    expect(s.user.user_metadata).toEqual({ full_name: 'QA', acquisition_v1: instagram });
    expect(s.pending.values.size).toBe(0); expect(s.oauth.values.size).toBe(0);
  });
  it('an old Google user clicking the campaign and starting signup is never attributed', async () => {
    const s = setup(); await begin(s); s.user.created_at = new Date(T - 86400000).toISOString();
    expect(await resolveOAuthAcquisition(s.auth, s.context)).toBe('ignored'); expect(s.updateUser).not.toHaveBeenCalled();
    expect(s.oauth.values.size).toBe(0); expect(s.pending.values.size).toBe(0);
  });
  it('a preexisting first attribution, even null/unknown, is never overwritten', async () => {
    for (const existing of [{ ...instagram, source: 'facebook' }, null, {}]) {
      const s = setup(); await begin(s); s.user.user_metadata.acquisition_v1 = existing;
      expect(await resolveOAuthAcquisition(s.auth, s.context)).toBe('ignored'); expect(s.updateUser).not.toHaveBeenCalled();
      expect(s.user.user_metadata.acquisition_v1).toEqual(existing);
    }
  });
  it('OAuth started in login mode cannot attribute even a recently-created user', async () => {
    const s = setup(); await begin(s, false);
    expect(await resolveOAuthAcquisition(s.auth, s.context)).toBe('none'); expect(s.getUser).not.toHaveBeenCalled(); expect(s.updateUser).not.toHaveBeenCalled();
  });
  it('expired pending, expired OAuth intent or missing tab intent cannot write', async () => {
    const s = setup(); await begin(s); s.time(T + OAUTH_WINDOW_MS + 1);
    expect(await resolveOAuthAcquisition(s.auth, s.context)).toBe('none'); expect(s.oauth.values.size).toBe(0);
    s.time(T); await begin(s); s.time(T + ACQUISITION_TTL_MS);
    expect(readPendingAcquisition(s.context)).toBeNull(); expect(await resolveOAuthAcquisition(s.auth, s.context)).toBe('none');
    expect(s.updateUser).not.toHaveBeenCalled();
  });
  it('refuses unknown dates, excessive skew and another provider', async () => {
    for (const date of ['invalid', new Date(T - 30001).toISOString(), new Date(T + 30001).toISOString()]) {
      const s = setup(); await begin(s); s.user.created_at = date;
      expect(await resolveOAuthAcquisition(s.auth, s.context)).toBe('ignored'); expect(s.updateUser).not.toHaveBeenCalled();
    }
    const s = setup(); await begin(s); s.user.app_metadata.provider = 'email';
    expect(await resolveOAuthAcquisition(s.auth, s.context)).toBe('ignored'); expect(s.updateUser).not.toHaveBeenCalled();
  });
  it('never treats an unverified/offline session as a new user', async () => {
    const s = setup(); await begin(s);
    s.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'offline' } } as never);
    expect(await resolveOAuthAcquisition(s.auth, s.context)).toBe('retry'); expect(s.updateUser).not.toHaveBeenCalled();
    expect(readOAuthAcquisition(s.context)).not.toBeNull();
  });
  it('failed update retains intent; retry re-reads server user and succeeds once', async () => {
    const s = setup(); await begin(s); s.updateUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'offline' } } as never);
    expect(await resolveOAuthAcquisition(s.auth, s.context)).toBe('retry'); expect(readPendingAcquisition(s.context)).not.toBeNull();
    expect(await resolveOAuthAcquisition(s.auth, s.context)).toBe('attributed');
    expect(await resolveOAuthAcquisition(s.auth, s.context)).toBe('none'); expect(s.getUser).toHaveBeenCalledTimes(2);
  });
  it('does not consume based on an optimistic/incorrect metadata response', async () => {
    const s = setup(); await begin(s); s.updateUser.mockResolvedValueOnce({ data: { user: { ...s.user, user_metadata: {} } }, error: null });
    expect(await resolveOAuthAcquisition(s.auth, s.context)).toBe('retry'); expect(readPendingAcquisition(s.context)).not.toBeNull();
  });
  it('two callback effects share one verified read/update', async () => {
    const s = setup(); await begin(s);
    expect(await Promise.all([resolveOAuthAcquisition(s.auth, s.context), resolveOAuthAcquisition(s.auth, s.context)])).toEqual(['attributed', 'attributed']);
    expect(s.getUser).toHaveBeenCalledTimes(1); expect(s.updateUser).toHaveBeenCalledTimes(1);
  });
  it('canceling the intent while getUser is in flight prevents the metadata write', async () => {
    const s = setup(); await begin(s);
    s.getUser.mockImplementationOnce(async () => { clearAcquisition(s.context); return { data: { user: s.user }, error: null }; });
    expect(await resolveOAuthAcquisition(s.auth, s.context)).toBe('ignored'); expect(s.updateUser).not.toHaveBeenCalled();
  });
  it('failed OAuth initiation clears intent but retains pending for a retry', async () => {
    const s = setup(); s.signInWithOAuth.mockResolvedValueOnce({ data: { url: null }, error: { message: 'failed' } } as never);
    await begin(s); expect(readOAuthAcquisition(s.context)).toBeNull(); expect(readPendingAcquisition(s.context)).not.toBeNull();
  });
});
