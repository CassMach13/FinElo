import type { Transaction } from '../types';
import type { FamilyOwnerContext, FamilyOwnerProfile } from './familyOwnerContext';

export type TransactionListItem =
  | { type: 'header'; profile: FamilyOwnerProfile; count: number }
  | { type: 'transaction'; transaction: Transaction };

export function countTransactionsByOwner(
  transactions: Transaction[],
  getTransactionOwnerId: (tx: Transaction) => string | undefined
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tx of transactions) {
    const ownerId = getTransactionOwnerId(tx) || '';
    counts.set(ownerId, (counts.get(ownerId) || 0) + 1);
  }
  return counts;
}

export function buildGroupedTransactionListItems(
  transactions: Transaction[],
  ownerCounts: Map<string, number>,
  context: Pick<FamilyOwnerContext, 'getTransactionOwnerId' | 'getProfile' | 'owners'>
): TransactionListItem[] {
  const items: TransactionListItem[] = [];
  let lastOwnerId: string | undefined;

  for (const transaction of transactions) {
    const ownerId = context.getTransactionOwnerId(transaction) || '';
    if (ownerId !== lastOwnerId) {
      const profile = context.getProfile(ownerId);
      if (profile) {
        items.push({
          type: 'header',
          profile,
          count: ownerCounts.get(ownerId) || 0,
        });
      }
      lastOwnerId = ownerId;
    }
    items.push({ type: 'transaction', transaction });
  }

  return items;
}

export function flattenGroupedTransactionListItems(
  transactions: Transaction[]
): TransactionListItem[] {
  return transactions.map((transaction) => ({ type: 'transaction', transaction }));
}
