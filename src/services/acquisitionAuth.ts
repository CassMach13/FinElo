import type { SupabaseClient } from '@supabase/supabase-js';
import {
  beginOAuthAcquisition, browserAcquisitionContext, cancelOAuthAcquisition,
  consumePendingAcquisition, OAUTH_CLOCK_TOLERANCE_MS, OAUTH_WINDOW_MS,
  readOAuthAcquisition, readPendingAcquisition, sanitizeAcquisition,
  type AcquisitionContext, type OAuthProvider,
} from '../domain/auth/acquisitionAttribution';

export type AcquisitionAuth = Pick<SupabaseClient['auth'], 'signUp' | 'signInWithOAuth' | 'getUser' | 'updateUser'>;

export async function signUpWithAcquisition(
  auth: AcquisitionAuth, credentials: Parameters<AcquisitionAuth['signUp']>[0],
  context: AcquisitionContext = browserAcquisitionContext(),
) {
  cancelOAuthAcquisition(context); // An email attempt cannot resolve a stale OAuth intent.
  const pending = readPendingAcquisition(context);
  const metadata = credentials.options?.data ?? {};
  const result = await auth.signUp({ ...credentials, options: { ...credentials.options,
    data: { ...metadata, ...(pending && !Object.prototype.hasOwnProperty.call(metadata, 'acquisition_v1')
      ? { acquisition_v1: pending.attribution } : {}) },
  } });
  const user = result.data.user;
  if (!result.error && user && !user.recovery_sent_at && pending) consumePendingAcquisition(pending, context);
  return result;
}

export async function startOAuthWithAcquisition(
  auth: AcquisitionAuth, provider: OAuthProvider, signup: boolean, redirectTo: string,
  context: AcquisitionContext = browserAcquisitionContext(),
) {
  beginOAuthAcquisition(provider, signup, context);
  try {
    const result = await auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (result.error) cancelOAuthAcquisition(context); // Retain pending for another signup attempt.
    return result;
  } catch (error) { cancelOAuthAcquisition(context); throw error; }
}

type Resolution = 'none' | 'ignored' | 'attributed' | 'retry';
const inFlight = new WeakMap<AcquisitionAuth, Promise<Resolution>>();

/** Run outside onAuthStateChange's callback (Auth calls there can deadlock).
 * Always read the user from Auth, not an unvalidated local session. This timestamp
 * heuristic is ONLY campaign analytics, never proof for authorization or billing. */
export function resolveOAuthAcquisition(auth: AcquisitionAuth, context = browserAcquisitionContext()): Promise<Resolution> {
  const running = inFlight.get(auth);
  if (running) return running;
  const resolve = async (): Promise<Resolution> => {
    const attempt = readOAuthAcquisition(context);
    if (!attempt) return 'none';
    const pending = readPendingAcquisition(context);
    const finish = () => {
      if (pending) consumePendingAcquisition(pending, context);
      if (readOAuthAcquisition(context)?.startedAt === attempt.startedAt) cancelOAuthAcquisition(context);
    };
    if (!pending || pending.capturedAt !== attempt.capturedAt) { finish(); return 'ignored'; }
    const { data, error } = await auth.getUser();
    if (error || !data.user) return 'retry'; // Preserve within the short window after network failure.
    const user = data.user;
    const created = Date.parse(user.created_at);
    const now = context.now();
    const currentIntent = readOAuthAcquisition(context);
    const currentPending = readPendingAcquisition(context);
    const matchingProvider = user.app_metadata?.provider === attempt.provider
      && user.identities?.some(identity => identity.provider === attempt.provider);
    if (Object.prototype.hasOwnProperty.call(user.user_metadata ?? {}, 'acquisition_v1')
      || currentIntent?.startedAt !== attempt.startedAt || currentIntent.provider !== attempt.provider
      || currentPending?.capturedAt !== pending.capturedAt || currentPending.attribution.source !== pending.attribution.source
      || !matchingProvider || !Number.isFinite(created)
      || created < attempt.startedAt - OAUTH_CLOCK_TOLERANCE_MS
      || created > attempt.startedAt + OAUTH_WINDOW_MS || created > now + OAUTH_CLOCK_TOLERANCE_MS
      || now - attempt.startedAt > OAUTH_WINDOW_MS || now < attempt.startedAt) {
      finish(); return 'ignored';
    }
    // Auth merges this partial metadata patch; do not send a stale copy of profile fields.
    const updated = await auth.updateUser({ data: { acquisition_v1: pending.attribution } });
    if (updated.error || !updated.data.user
      || JSON.stringify(sanitizeAcquisition(updated.data.user.user_metadata?.acquisition_v1)) !== JSON.stringify(pending.attribution)) return 'retry';
    finish(); return 'attributed';
  };
  // Analytics failure must never prevent login. A reload can retry while intent is valid.
  const promise = resolve().catch((): Resolution => 'retry').finally(() => inFlight.delete(auth));
  inFlight.set(auth, promise);
  return promise;
}
