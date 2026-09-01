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

/**
 * Whether an `onAuthStateChange` event must be ignored because the startup
 * validation has not finished yet.
 *
 * `INITIAL_SESSION` and `SIGNED_IN` fire within a few milliseconds of client
 * creation, carrying whatever is in local storage — long before `getUser()` has
 * asked the server whether that token is still good. Acting on them during
 * startup would mark auth as ready and render protected content from an
 * unvalidated token, which is exactly what validating server-side prevents.
 *
 * Nothing is lost by deferring: a recovered session that is genuinely valid is
 * confirmed by the startup `getUser()`, and so is a session picked up from an
 * OAuth redirect, because `getUser()` awaits the client's initialization.
 */
export function shouldDeferStartupAuthEvent(
  event: string,
  initialValidationDone: boolean
): boolean {
  if (initialValidationDone) return false;
  return event === 'INITIAL_SESSION' || event === 'SIGNED_IN';
}
