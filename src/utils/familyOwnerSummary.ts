import type { Transaction } from '../types';
import { normalizeMoney } from './formatters';
import type { FamilyOwnerContext, FamilyOwnerProfile } from './familyOwnerContext';

export type FamilyOwnerPeriodTotal = {
  userId: string;
  label: string;
  profile: FamilyOwnerProfile;
  expenseTotal: number;
  incomeTotal: number;
  transactionCount: number;
};

export function buildFamilyOwnerPeriodTotals(
  transactions: Transaction[],
  context: Pick<FamilyOwnerContext, 'getTransactionOwnerId' | 'owners'>
): FamilyOwnerPeriodTotal[] {
  const totals = new Map<string, { expense: number; income: number; count: number }>();

  for (const tx of transactions) {
    const userId = context.getTransactionOwnerId(tx);
    if (!userId) continue;

    const bucket = totals.get(userId) ?? { expense: 0, income: 0, count: 0 };
    bucket.count += 1;
    if (tx.Tipo === 'Renda') {
      bucket.income += Math.abs(tx.Valor);
    } else {
      bucket.expense += Math.abs(tx.Valor);
    }
    totals.set(userId, bucket);
  }

  return context.owners.map((owner) => {
    const bucket = totals.get(owner.userId) ?? { expense: 0, income: 0, count: 0 };
    return {
      userId: owner.userId,
      label: owner.label,
      profile: owner,
      expenseTotal: normalizeMoney(bucket.expense),
      incomeTotal: normalizeMoney(bucket.income),
      transactionCount: bucket.count,
    };
  });
}

export function formatFamilyOwnerExpenseSummary(totals: FamilyOwnerPeriodTotal[]): string {
  const parts = totals
    .filter((row) => row.expenseTotal > 0)
    .map((row) => `${formatBrl(row.expenseTotal)} (${row.label})`);
  return parts.join(' · ');
}

function formatBrl(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}
