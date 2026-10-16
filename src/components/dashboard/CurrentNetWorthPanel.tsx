import React from 'react';
import type { Account, Asset, ImportLog, Transaction } from '../../types';
import { useCurrentNetWorth } from '../../hooks/useCurrentNetWorth';
import CurrentNetWorthCard from './CurrentNetWorthCard';

export default function CurrentNetWorthPanel(props: {
  sessionUserId: string; scopeKey: string; scopeLabel: string; ownerIds: readonly string[];
  accounts: Account[]; transactions: Transaction[]; assets: Asset[]; importLogs: ImportLog[];
  userMetadata: Record<string, unknown>; revision: number;
}) {
  const { position, status, retry } = useCurrentNetWorth(props);
  return <CurrentNetWorthCard position={position} status={status} scopeLabel={props.scopeLabel} onRetry={retry} />;
}
