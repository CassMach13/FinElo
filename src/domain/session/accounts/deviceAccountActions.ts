import { useSyncExternalStore } from 'react';
import { supabase } from '../../../supabaseClient';
import { ACCOUNT_REGISTRY_KEY, MAX_REMEMBERED_ACCOUNTS, type RememberedAccount } from './accountStore';
import {
  authForAddingAccount,
  listRememberedAccounts,
  removeRememberedAccount,
  signOutActiveAccount,
  signOutEveryAccount,
  switchActiveAccount,
} from './appAccountSessions';
import { enableMultiAccountSessions, getSessionAccountManager } from './multiAccountSessions';
import { waitForQuiescence, type SwitchFailure } from './accountSwitch';
import type { SignOutOutcome } from '../sessionSignOut';

export const DEVICE_ACCOUNTS_ENABLED = import.meta.env.VITE_MULTI_ACCOUNT_SESSIONS === 'true';
export const DEVICE_ACCOUNT_LIMIT = MAX_REMEMBERED_ACCOUNTS;

type SessionEndPanel = { kind: 'remove' | 'signOut'; account: RememberedAccount } | { kind: 'signOutAll' };

export type AccountPanel =
  | { kind: 'manage' | 'consent' }
  | { kind: 'add'; account?: RememberedAccount }
  | { kind: 'switch'; account: RememberedAccount }
  | SessionEndPanel;

export interface AdditionalAccountFormOptions {
  email?: string;
  signIn(email: string, password: string): Promise<{ error: string | null }>;
  signInWithOAuth(provider: 'google' | 'github'): Promise<{ error: string | null }>;
  recoverPassword(email: string): Promise<{ error: string | null }>;
}

type Operation = 'enable' | 'switch' | 'remove' | 'signOut' | 'signOutAll';
interface DeviceAccountState {
  panel: AccountPanel | null;
  operation: Operation | null;
  error: string | null;
  notice: string | null;
}

let state: DeviceAccountState = { panel: null, operation: null, error: null, notice: null };
const listeners = new Set<() => void>();

function publish(patch: Partial<DeviceAccountState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const snapshot = () => state;

export function useDeviceAccountState(): DeviceAccountState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function subscribeAccounts(listener: () => void): () => void {
  const unsubscribe = subscribe(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === ACCOUNT_REGISTRY_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', listener);
  return () => {
    unsubscribe();
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('focus', listener);
  };
}

const serializeAccounts = () => JSON.stringify(listRememberedAccounts());
let previousRegistry = '';
let previousAccounts: ReadonlyArray<RememberedAccount> = [];

function accountSnapshot(): ReadonlyArray<RememberedAccount> {
  const registry = serializeAccounts();
  if (registry !== previousRegistry) {
    previousRegistry = registry;
    previousAccounts = JSON.parse(registry);
  }
  return previousAccounts;
}

export function useRememberedDeviceAccounts(): ReadonlyArray<RememberedAccount> {
  return useSyncExternalStore(subscribeAccounts, accountSnapshot, accountSnapshot);
}

export function openDeviceAccountPanel(panel: AccountPanel): void {
  if (state.operation) return;
  publish({ panel, error: null, notice: null });
}

export function closeDeviceAccountPanel(): void {
  if (state.operation) return;
  if (state.panel?.kind === 'add' && getSessionAccountManager()) authForAddingAccount().cancel();
  publish({ panel: null, error: null });
}

export const refreshDeviceAccounts = () => publish({});
export const dismissDeviceAccountNotice = () => publish({ notice: null });

const PENDING_MESSAGE = 'Há uma operação em andamento. Aguarde a conclusão e tente novamente.';

export function deviceSwitchError(reason: SwitchFailure): string {
  switch (reason) {
    case 'operations_pending':
      return PENDING_MESSAGE;
    case 'network':
      return 'Sem conexão para confirmar a conta. Tente novamente.';
    case 'account_signed_out':
    case 'reauth_required':
    case 'identity_mismatch':
      return 'Esta sessão terminou. Entre novamente para usar a conta.';
    case 'unknown_account':
      return 'Esta conta foi removida deste dispositivo.';
    case 'switch_in_progress':
      return 'Já há uma troca em andamento nesta aba.';
  }
}

export const operationMessages: Record<Operation, string> = {
  enable: 'Preparando este dispositivo…',
  switch: 'Alternando conta…',
  remove: 'Removendo conta…',
  signOut: 'Encerrando sessão…',
  signOutAll: 'Encerrando todas as sessões…',
};

const legacyRequests = { inFlightRequests: () => 0 };
const OPEN_ADD_AFTER_RELOAD = 'finelo.deviceAccounts.openAdd.v1';

export function resumeDeviceAccountPanel(): void {
  if (!DEVICE_ACCOUNTS_ENABLED || !getSessionAccountManager()) return;
  try {
    if (sessionStorage.getItem(OPEN_ADD_AFTER_RELOAD) !== '1') return;
    sessionStorage.removeItem(OPEN_ADD_AFTER_RELOAD);
    openDeviceAccountPanel({ kind: 'add' });
  } catch {
    // A pessoa pode retornar ao menu e abrir o formulário manualmente.
  }
}

export async function activateDeviceAccounts(): Promise<void> {
  if (!DEVICE_ACCOUNTS_ENABLED || state.operation || state.panel?.kind !== 'consent') return;
  publish({ operation: 'enable', error: null });
  try {
    if (!await waitForQuiescence(legacyRequests, 15_000)) {
      publish({ operation: null, error: PENDING_MESSAGE });
      return;
    }
    const result = await enableMultiAccountSessions(
      supabase,
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY,
      DEVICE_ACCOUNTS_ENABLED,
    );
    if (result.ok === false && result.reason !== 'already_enabled') {
      publish({
        operation: null,
        error: result.reason === 'network'
          ? 'Sem conexão para confirmar sua sessão. Tente novamente.'
          : 'Não foi possível ativar várias contas neste dispositivo.',
      });
      return;
    }
    try {
      sessionStorage.setItem(OPEN_ADD_AFTER_RELOAD, '1');
    } catch {
      // A ativação já foi concluída. O formulário pode ser aberto pelo menu após a recarga.
    }
    window.location.reload();
  } catch {
    publish({ operation: null, error: 'Não foi possível ativar várias contas. Tente novamente.' });
  }
}

export async function selectDeviceAccount(account: RememberedAccount): Promise<void> {
  if (state.operation || !getSessionAccountManager()) return;
  publish({ panel: { kind: 'switch', account }, operation: 'switch', error: null, notice: null });
  try {
    const result = await switchActiveAccount(account.userId);
    if (result.ok === false) {
      const requiresLogin = ['account_signed_out', 'reauth_required', 'identity_mismatch'].includes(result.reason);
      const remembered = listRememberedAccounts().find(({ userId }) => userId === account.userId);
      publish({
        panel: requiresLogin && remembered ? { kind: 'add', account: remembered } : state.panel,
        operation: null,
        error: deviceSwitchError(result.reason),
      });
      return;
    }
    // A troca normal não retorna. A Etapa 2 mantém o bloqueio até o reload da aba.
    publish({ panel: null, operation: null });
  } catch {
    // Se o protocolo já entrou na fase protegida, mantenha a tela de transição da Etapa 2.
    publish({ operation: null, error: 'Não foi possível alternar a conta. Tente novamente.' });
  }
}

export function deviceSignOutNotice(outcomes: ReadonlyArray<SignOutOutcome>): string | null {
  if (outcomes.some(({ localCleared }) => !localCleared)) {
    return 'Não foi possível confirmar que todas as sessões selecionadas foram apagadas deste navegador.';
  }
  if (outcomes.some(({ serverConfirmed }) => !serverConfirmed)) {
    return 'Sessão apagada do navegador. O servidor não confirmou o encerramento.';
  }
  return null;
}

export async function confirmDeviceSignOut(panel: SessionEndPanel): Promise<void> {
  const manager = getSessionAccountManager();
  if (!manager || state.operation) return;
  if (panel.kind === 'signOut' && manager.activeUserId() !== panel.account.userId) {
    publish({ error: 'A conta ativa mudou. Abra o menu para tentar novamente.' });
    return;
  }
  publish({ operation: panel.kind, error: null, notice: null });
  try {
    let outcomes: ReadonlyArray<SignOutOutcome>;
    if (panel.kind === 'signOutAll') {
      outcomes = (await signOutEveryAccount()).map(({ outcome }) => outcome);
    } else if (panel.kind === 'remove') {
      outcomes = [await removeRememberedAccount(panel.account.userId)];
    } else {
      const outcome = await signOutActiveAccount();
      outcomes = outcome ? [outcome] : [];
    }
    publish({
      operation: null,
      panel: panel.kind === 'remove' && manager.activeUserId() ? { kind: 'manage' } : null,
      notice: deviceSignOutNotice(outcomes),
    });
  } catch {
    publish({ panel: null, operation: null, notice: 'Não foi possível concluir a ação. Confira suas sessões e tente novamente.' });
  }
}

export function additionalAccountForm(account?: RememberedAccount): AdditionalAccountFormOptions {
  const run = async (work: () => Promise<void>) => {
    try {
      await work();
      return { error: null };
    } catch {
      return { error: 'Não foi possível confirmar a tentativa. Confira os dados e a conexão e tente novamente.' };
    }
  };
  return {
    email: account?.email ?? undefined,
    signIn: (email, password) => run(async () => {
      await authForAddingAccount().password(email, password, account?.userId);
      publish({ panel: null, error: null, notice: 'Conta disponível neste dispositivo.' });
      if (!getSessionAccountManager()?.activeUserId()) window.location.assign('/app');
    }),
    signInWithOAuth: provider => run(() => authForAddingAccount().redirect(provider, account?.userId)),
    recoverPassword: email => run(() => authForAddingAccount().redirect('recovery', account?.userId, email)),
  };
}
