import { useAppStore } from '../../../hooks/useAppStore';
import { useDialogStore } from '../../../hooks/useDialogStore';
import {
  removeAccountFromBrowser,
  signOutAllAccounts,
  signOutCurrentAccount,
  switchAccount,
  type SwitchHost,
  type SwitchOptions,
  type SwitchResult,
} from './accountSwitch';
import { getSessionAccountManager } from './multiAccountSessions';
import type { RememberedAccount } from './accountStore';

/**
 * API INTERNA da Etapa 2 (sem interface: o seletor de contas é a Etapa 3). Tudo aqui é inerte no modo de conta única.
 */

export const appSwitchHost: SwitchHost = {
  currentUser: () => useAppStore.getState().user,
  clearSessionState: () => {
    useAppStore.getState().setUser(null);
    useDialogStore.getState().closeDialog(false);
  },
  commitUser: (user) => useAppStore.getState().setUser(user),
  reload: () => useAppStore.getState().fetchAllData(),
};

const requireManager = () => {
  const manager = getSessionAccountManager();
  if (!manager) throw new Error('Várias contas não estão ativas neste navegador.');
  return manager;
};

export const isMultiAccountActive = (): boolean => getSessionAccountManager() !== null;

export const listRememberedAccounts = (): ReadonlyArray<RememberedAccount> => getSessionAccountManager()?.rememberedAccounts() ?? [];

export const switchActiveAccount = (userId: string, options?: SwitchOptions): Promise<SwitchResult> =>
  switchAccount(requireManager(), appSwitchHost, userId, options);

export const signOutActiveAccount = () => signOutCurrentAccount(requireManager(), appSwitchHost);

export const removeRememberedAccount = (userId: string) => removeAccountFromBrowser(requireManager(), appSwitchHost, userId);

export const signOutEveryAccount = () => signOutAllAccounts(requireManager(), appSwitchHost);

/** Auth do login pendente, para incluir outra conta sem trocar a conta ativa desta aba. */
export const authForAddingAccount = () => requireManager().pendingAuth();
