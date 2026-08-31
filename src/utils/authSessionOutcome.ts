import { isAuthRetryableFetchError, isAuthSessionMissingError } from '@supabase/supabase-js';

/**
 * How the app should react to the result of the startup `supabase.auth.getUser()` call.
 *
 * - `authenticated`: the server validated the token; render protected content.
 * - `offline-fallback`: the request never reached Supabase Auth. A network failure is
 *   not proof of an invalid token, so the persisted session is honoured instead of
 *   signing the user out on a connectivity blip.
 * - `rejected`: Supabase Auth answered and refused the token. The dead credential must
 *   be purged from local storage.
 * - `anonymous`: no session was persisted in the first place; nothing to purge.
 */
export type AuthInitOutcome = 'authenticated' | 'offline-fallback' | 'rejected' | 'anonymous';

export function classifyAuthInit(hasUser: boolean, error: unknown): AuthInitOutcome {
  if (!error && hasUser) return 'authenticated';
  if (isAuthRetryableFetchError(error)) return 'offline-fallback';
  if (!error || isAuthSessionMissingError(error)) return 'anonymous';
  return 'rejected';
}
