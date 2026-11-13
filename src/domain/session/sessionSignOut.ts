import type { SupabaseClient } from '@supabase/supabase-js';

type AuthClient = Pick<SupabaseClient['auth'], 'signOut' | 'getSession'>;

export interface SignOutOutcome {
  /** O servidor revogou a sessão. */
  readonly serverConfirmed: boolean;
  /** Nenhuma sessão ficou guardada neste dispositivo. */
  readonly localCleared: boolean;
  readonly error: string | null;
}

/**
 * Logout que nunca deixa a credencial neste dispositivo.
 *
 * No supabase-js 2.x, quando `/auth/v1/logout` falha por rede ou erro 5xx, `signOut()` — inclusive com
 * `scope: 'local'`, que também chama o servidor — devolve o erro e MANTÉM a sessão persistida: a interface mostraria
 * "saiu", mas um recarregamento entraria de novo na mesma conta, sem senha. Nesse caso a sessão local é removida pelo
 * mesmo caminho interno que o SDK usa depois de um logout confirmado (apaga o token guardado e emite `SIGNED_OUT`).
 * A revogação no servidor fica sem confirmação (o token expira sozinho); isso é devolvido para registro.
 *
 * `_removeSession` é interno ao SDK: `tests/security/sessionSignOut.spec.ts` usa o cliente real e falha se uma
 * atualização do pacote mudar esse contrato.
 */
export async function signOutAndForgetLocalSession(auth: AuthClient): Promise<SignOutOutcome> {
  let error: string | null;
  try {
    const result = await auth.signOut();
    if (!result.error) return { serverConfirmed: true, localCleared: true, error: null };
    error = result.error.message || 'logout não confirmado';
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const internal = auth as unknown as { _removeSession?: () => Promise<void> };
  try {
    await internal._removeSession?.();
  } catch {
    // A verificação abaixo decide.
  }

  let localCleared = false;
  try {
    const { data } = await auth.getSession();
    localCleared = !data.session;
  } catch {
    localCleared = false;
  }
  return { serverConfirmed: false, localCleared, error };
}
