import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Account, Asset, ImportLog, Transaction } from '../types';
import { localTodayIso } from '../utils/dateOnly';
import { CURRENT_NET_WORTH_IDLE, createCurrentNetWorthLoader, currentNetWorthStateFor, readCurrentNetWorthSources, type CurrentNetWorthLoadState } from '../services/currentNetWorthSources';
import { projectAccountCardEconomics, cardClassificationRulesFromMetadata } from '../services/accountCardEconomics';
import { computeCurrentNetWorth } from '../domain/dashboard/currentNetWorth';

export function useCurrentNetWorth(input: {
  sessionUserId: string; scopeKey: string; ownerIds: readonly string[];
  accounts: Account[]; transactions: Transaction[]; assets: Asset[]; importLogs: ImportLog[];
  userMetadata: Record<string, unknown>; revision: number;
}) {
  const [today, setToday] = useState(localTodayIso);
  const [refresh, setRefresh] = useState(0);
  const retry = useCallback(() => { setToday(localTodayIso()); setRefresh((v) => v + 1); }, []);
  useEffect(() => {
    const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
    const timer = window.setTimeout(retry, midnight.getTime() - Date.now() + 25);
    const visible = () => { if (document.visibilityState === 'visible') retry(); };
    window.addEventListener('focus', retry);
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', retry); document.removeEventListener('visibilitychange', visible); };
  }, [today, retry]);
  const [state, setState] = useState<CurrentNetWorthLoadState>(CURRENT_NET_WORTH_IDLE);
  const loader = useRef(createCurrentNetWorthLoader(readCurrentNetWorthSources, setState));
  const request = useMemo(() => ({
    sessionUserId: input.sessionUserId, scopeKey: input.scopeKey, asOf: today,
    accounts: input.accounts, ownerIds: input.ownerIds,
  }), [input.sessionUserId, input.scopeKey, today, input.accounts, input.ownerIds,
    input.transactions, input.assets, input.importLogs, input.userMetadata, input.revision, refresh]);
  useEffect(() => {
    void loader.current.load(request);
    return () => loader.current.invalidate();
  }, [request]);
  const current = currentNetWorthStateFor(state, request);
  const position = useMemo(() => {
    if (!current.sources) return null;
    const { sources } = current;
    const rules = cardClassificationRulesFromMetadata(input.userMetadata);
    const cards = sources.accounts.filter((a) => a.Tipo_Conta === 'Cartão de Crédito').map((account) =>
      projectAccountCardEconomics({
        account, accounts: sources.accounts, transactions: sources.transactions, importLogs: sources.importLogs,
        asOf: today, rules,
        userPaymentConfirmations: sources.cardInputs.confirmations.filter((c) => c.accountId === account.id),
        reconciliationResolutions: sources.cardInputs.resolutions[account.id],
      }));
    return computeCurrentNetWorth({ ...sources, asOf: today, cards });
  }, [current.sources, input.userMetadata, today]);
  return { status: current.status, position, retry };
}
