import { isAuthRetryableFetchError, type User } from '@supabase/supabase-js';
import { endSession, observeSessionInstance, pendingSessionOperations, readBearerIdentity } from '../sessionScope';
import type { SignOutOutcome } from '../sessionSignOut';
import type { SessionAccountManager } from './accountManager';

/**
 * Protocolo transacional de troca de conta NESTA aba (Etapa 2). Não desloga a conta anterior e nunca repete
 * gravações: o que estava em voo termina na conta que o iniciou (ponto quieto), ou a troca nem começa.
 *
 *  1. Identifica a sessão atual e as operações pendentes.
 *  2. Invalida a continuação: espera o ponto quieto (nenhuma ação do store e nenhuma requisição em voo). Se não houver
 *     ponto quieto no prazo, a troca é recusada sem mudar nada (`operations_pending`).
 *  3. Invalida a geração visual anterior (epoch avança; sem identidade ativa nada sai com token de usuário — R0).
 *  4. Limpa dados e diálogos da conta anterior (store volta ao estado vazio; diálogos fecham como "cancelar").
 *  5. Seleciona a instância Supabase da nova conta.
 *  6. Valida a sessão com o Supabase Auth (`getUser`, rede). JWT local não basta.
 *  7. Atualiza a identidade ativa (store, epoch, conta da aba, instância da sessão).
 *  8. Recarrega os dados financeiros da nova conta.
 *  9. Libera a interface.
 *
 * Falha em 6 (rede, sessão revogada/expirada, identidade divergente) volta à conta anterior (rollback): ela continua
 * logada e só ela é recarregada. Sessão inválida marca SOMENTE a conta de destino para novo login.
 */

export interface SwitchHost {
  currentUser(): User | null;
  /** Passo 4: estado e diálogos da conta anterior. */
  clearSessionState(): void;
  /** Passo 7: identidade confirmada pelo Auth. */
  commitUser(user: User): void;
  /** Passo 8: carga de dados da conta ativa. */
  reload(): Promise<unknown>;
}

export type SwitchFailure =
  | 'switch_in_progress'
  | 'unknown_account'
  | 'account_signed_out'
  | 'operations_pending'
  | 'reauth_required'
  | 'network'
  | 'identity_mismatch';

export type SwitchResult =
  | { ok: true; userId: string; unchanged?: boolean }
  | { ok: false; reason: SwitchFailure; restoredUserId: string | null };

export interface SwitchOptions {
  readonly drainTimeoutMs?: number;
  /** Para testes: registro dos passos executados. */
  readonly trace?: (step: string) => void;
}

const DEFAULT_DRAIN_TIMEOUT_MS = 15_000;

/** Ponto quieto: nenhuma ação do store em voo e nenhuma requisição em voo, confirmado depois de uma volta do loop. */
export async function waitForQuiescence(manager: Pick<SessionAccountManager, 'inFlightRequests'>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const busy = () => pendingSessionOperations().length > 0 || manager.inFlightRequests() > 0;
  for (;;) {
    if (!busy()) {
      await new Promise((r) => setTimeout(r, 0));
      if (!busy()) return true;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
}

const sessionInstanceOf = async (manager: SessionAccountManager, userId: string) => {
  const { data } = await manager.clientFor(userId).auth.getSession();
  return readBearerIdentity(data.session?.access_token)?.sessionId ?? null;
};

export async function switchAccount(
  manager: SessionAccountManager,
  host: SwitchHost,
  targetUserId: string,
  options: SwitchOptions = {}
): Promise<SwitchResult> {
  const trace = options.trace ?? (() => undefined);
  const target = targetUserId.toLowerCase();
  // 1. sessão atual e operações pendentes
  const from = manager.activeUserId();
  if (manager.switchPhase() !== 'idle') return { ok: false, reason: 'switch_in_progress', restoredUserId: from };
  const account = manager.rememberedAccounts().find((a) => a.userId === target);
  if (!account) return { ok: false, reason: 'unknown_account', restoredUserId: from };
  if (account.signedOut) return { ok: false, reason: 'account_signed_out', restoredUserId: from };
  if (from === target) return { ok: true, userId: target, unchanged: true };
  const previousUser = host.currentUser();
  trace(`1:from=${from ?? 'none'}:pending=${pendingSessionOperations().length}`);

  // 2. invalida a continuação: ponto quieto ou recusa (nada mudou ainda)
  manager.setSwitchPhase('draining');
  if (!(await waitForQuiescence(manager, options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS))) {
    manager.setSwitchPhase('idle');
    trace('2:refused');
    return { ok: false, reason: 'operations_pending', restoredUserId: from };
  }
  trace('2:quiet');

  // 3. geração visual anterior invalidada; interface bloqueada
  manager.setSwitchPhase('switching');
  endSession();
  trace('3');
  // 4. dados e diálogos da conta anterior
  host.clearSessionState();
  trace('4');
  // 5. instância da nova conta
  manager.selectTabAccount(target);
  trace('5');

  // 6. validação com o Supabase Auth
  let failure: SwitchFailure | null = null;
  let user: User | null = null;
  try {
    const { data, error } = await manager.clientFor(target).auth.getUser();
    if (error) failure = isAuthRetryableFetchError(error) ? 'network' : 'reauth_required';
    else if (!data.user) failure = 'reauth_required';
    else if (data.user.id.toLowerCase() !== target) failure = 'identity_mismatch';
    else user = data.user;
  } catch {
    failure = 'network';
  }
  trace(`6:${failure ?? 'valid'}`);

  if (failure || !user) {
    if (failure === 'reauth_required' || failure === 'identity_mismatch') {
      // Só a conta de destino perde a sessão local; a anterior não é tocada.
      await manager.signOutAccount(target).catch(() => undefined);
    }
    // Rollback: a conta anterior volta (sem novo login) e só ela é recarregada.
    manager.selectTabAccount(from);
    if (from && previousUser) {
      host.commitUser(previousUser);
      observeSessionInstance(from, await sessionInstanceOf(manager, from));
      manager.setSwitchPhase('idle');
      await host.reload();
    } else {
      manager.setSwitchPhase('idle');
    }
    trace('rollback');
    return { ok: false, reason: failure ?? 'reauth_required', restoredUserId: from };
  }

  // 7. identidade ativa
  host.commitUser(user);
  observeSessionInstance(target, await sessionInstanceOf(manager, target));
  trace('7');
  // 8. dados da nova conta
  try {
    await host.reload();
  } finally {
    // 9. interface liberada só agora
    manager.setSwitchPhase('idle');
    trace('9');
  }
  return { ok: true, userId: target };
}

/** "Sair da conta atual": encerra só a sessão desta conta neste navegador; outras contas seguem logadas. */
export async function signOutCurrentAccount(manager: SessionAccountManager, host: SwitchHost): Promise<SignOutOutcome | null> {
  const current = manager.activeUserId();
  if (!current) return null;
  endSession();
  host.clearSessionState();
  return manager.signOutAccount(current);
}

/** "Remover conta deste navegador": encerra a sessão dela e a esquece. Se for a desta aba, a aba fica sem conta. */
export async function removeAccountFromBrowser(manager: SessionAccountManager, host: SwitchHost, userId: string): Promise<SignOutOutcome> {
  if (manager.activeUserId() === userId.toLowerCase()) {
    endSession();
    host.clearSessionState();
  }
  return manager.removeAccount(userId);
}

/** "Sair de todas as contas" deste navegador. */
export async function signOutAllAccounts(manager: SessionAccountManager, host: SwitchHost) {
  endSession();
  host.clearSessionState();
  return manager.signOutAll();
}
