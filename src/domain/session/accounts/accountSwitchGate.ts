import { useSyncExternalStore } from 'react';
import { getSessionAccountManager } from './multiAccountSessions';

const subscribe = (notify: () => void): (() => void) => {
  const unsubscribe = getSessionAccountManager()?.subscribeSwitchPhase(notify);
  return () => {
    unsubscribe?.();
  };
};

/** Passos 3–9 da troca de conta: a interface fica bloqueada (nada da conta anterior aparece nem aceita ação). */
const isBlocking = () => getSessionAccountManager()?.switchPhase() === 'switching';

/** Modo de conta única: sempre `false` (sem gerenciador, sem assinatura). */
export function useAccountSwitchBlocking(): boolean {
  return useSyncExternalStore(subscribe, isBlocking, isBlocking);
}
