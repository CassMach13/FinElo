/** Analytics only: user_metadata is editable. Never use attribution for authorization,
 * billing, security or financial audit. Persist only the closed campaign labels below. */
export interface AcquisitionAttribution {
  campaign: 'pilot_activation_01';
  source: 'instagram' | 'facebook' | 'referral';
  medium: 'organic';
}

export const ACQUISITION_PENDING_KEY = 'finelo_acquisition_v1_pending';
export const ACQUISITION_OAUTH_KEY = 'finelo_acquisition_v1_oauth';
export const ACQUISITION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const OAUTH_WINDOW_MS = 10 * 60 * 1000;
export const OAUTH_CLOCK_TOLERANCE_MS = 30 * 1000;
export type OAuthProvider = 'google' | 'github';
export type AcquisitionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface AcquisitionContext {
  pendingStorage: AcquisitionStorage | null;
  oauthStorage: AcquisitionStorage | null;
  now: () => number;
}
export interface PendingAcquisition {
  attribution: AcquisitionAttribution;
  capturedAt: number;
}
export interface OAuthAcquisitionAttempt {
  provider: OAuthProvider;
  startedAt: number;
  capturedAt: number;
}

export function browserAcquisitionContext(): AcquisitionContext {
  const storage = (key: 'localStorage' | 'sessionStorage') => {
    try { return typeof window === 'undefined' ? null : window[key]; } catch { return null; }
  };
  return { pendingStorage: storage('localStorage'), oauthStorage: storage('sessionStorage'), now: Date.now };
}

export function sanitizeAcquisition(value: unknown): AcquisitionAttribution | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.campaign !== 'pilot_activation_01' || v.medium !== 'organic'
    || (v.source !== 'instagram' && v.source !== 'facebook' && v.source !== 'referral')) return null;
  return { campaign: 'pilot_activation_01', source: v.source as AcquisitionAttribution['source'], medium: 'organic' };
}

export function removeAcquisitionKey(storage: AcquisitionStorage | null, key: string): void {
  try { storage?.removeItem(key); } catch { /* Storage cannot block authentication. */ }
}
function read(storage: AcquisitionStorage | null, key: string): Record<string, unknown> | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const value: unknown = raw.length <= 512 ? JSON.parse(raw) : null;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* Corrupt/unavailable storage means unknown attribution. */ }
  removeAcquisitionKey(storage, key);
  return null;
}
function write(storage: AcquisitionStorage | null, key: string, value: unknown): boolean {
  try { if (!storage) return false; storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function readPendingAcquisition(context = browserAcquisitionContext()): PendingAcquisition | null {
  const value = read(context.pendingStorage, ACQUISITION_PENDING_KEY);
  if (!value) return null;
  const attribution = sanitizeAcquisition(value.attribution);
  const age = context.now() - Number(value.capturedAt);
  if (!attribution || typeof value.capturedAt !== 'number' || !Number.isFinite(age) || age < 0 || age >= ACQUISITION_TTL_MS) {
    removeAcquisitionKey(context.pendingStorage, ACQUISITION_PENDING_KEY);
    return null;
  }
  return { attribution, capturedAt: value.capturedAt };
}

export function captureAcquisition(search: string, context = browserAcquisitionContext()): PendingAcquisition | null {
  const existing = readPendingAcquisition(context);
  if (existing) return existing; // First valid touch, including across landing -> signup.
  const params = new URLSearchParams(search);
  if (['utm_campaign', 'utm_source', 'utm_medium'].some(key => params.getAll(key).length !== 1)) return null;
  const attribution = sanitizeAcquisition({ campaign: params.get('utm_campaign'), source: params.get('utm_source'), medium: params.get('utm_medium') });
  if (!attribution) return null;
  const pending = { attribution, capturedAt: context.now() };
  return write(context.pendingStorage, ACQUISITION_PENDING_KEY, pending) ? pending : null;
}

export function consumePendingAcquisition(pending: PendingAcquisition, context = browserAcquisitionContext()): void {
  const current = readPendingAcquisition(context);
  if (current?.capturedAt === pending.capturedAt && current.attribution.source === pending.attribution.source) {
    removeAcquisitionKey(context.pendingStorage, ACQUISITION_PENDING_KEY);
  }
}
export function clearAcquisition(context = browserAcquisitionContext()): void {
  removeAcquisitionKey(context.pendingStorage, ACQUISITION_PENDING_KEY);
  removeAcquisitionKey(context.oauthStorage, ACQUISITION_OAUTH_KEY);
}
export function cancelOAuthAcquisition(context = browserAcquisitionContext()): void {
  removeAcquisitionKey(context.oauthStorage, ACQUISITION_OAUTH_KEY);
}
export function beginOAuthAcquisition(provider: OAuthProvider, signup: boolean, context = browserAcquisitionContext()): void {
  cancelOAuthAcquisition(context);
  if (!signup) { clearAcquisition(context); return; }
  const pending = readPendingAcquisition(context);
  if (signup && pending) write(context.oauthStorage, ACQUISITION_OAUTH_KEY,
    { provider, startedAt: context.now(), capturedAt: pending.capturedAt });
}
export function readOAuthAcquisition(context = browserAcquisitionContext()): OAuthAcquisitionAttempt | null {
  const value = read(context.oauthStorage, ACQUISITION_OAUTH_KEY);
  if (!value) return null;
  const age = context.now() - Number(value.startedAt);
  if (!['google', 'github'].includes(String(value.provider)) || typeof value.startedAt !== 'number'
    || typeof value.capturedAt !== 'number' || !Number.isFinite(value.capturedAt) || !Number.isFinite(age) || age < 0 || age > OAUTH_WINDOW_MS) {
    cancelOAuthAcquisition(context);
    return null;
  }
  return { provider: value.provider as OAuthProvider, startedAt: value.startedAt, capturedAt: value.capturedAt };
}
