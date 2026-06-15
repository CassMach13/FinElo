import { describe, expect, it } from 'vitest';
import { buildFamilyOwnerContext } from '../src/utils/familyOwnerContext';
import {
  buildFamilyOwnerPeriodTotals,
  formatFamilyOwnerExpenseSummary,
} from '../src/utils/familyOwnerSummary';
import { matchesTransactionFilters } from '../src/utils/transactionPeriodFilters';
import type { Account, FamilyMember, Transaction } from '../src/types';

const cassioId = 'user-cassio';
const alcioneId = 'user-alcione';

const familyMembers: FamilyMember[] = [
  {
    id: 'fm-1',
    owner_id: cassioId,
    owner_email: 'cassio@example.com',
    member_email: 'alcione@example.com',
    status: 'accepted',
    created_at: '2026-01-01',
  },
];

const accounts: Account[] = [
  { id: 'acc-cassio', user_id: cassioId } as Account,
  { id: 'acc-alcione', user_id: alcioneId } as Account,
];

const transactions: Transaction[] = [
  {
    ID_Transacao: 'tx-1',
    Data: '2026-05-10',
    Valor: -100,
    Tipo: 'Despesa',
    Categoria: 'Mercado',
    ID_Conta: 'acc-cassio',
    user_id: cassioId,
    Origem: 'manual',
  } as Transaction,
  {
    ID_Transacao: 'tx-2',
    Data: '2026-05-11',
    Valor: -250,
    Tipo: 'Despesa',
    Categoria: 'Restaurante',
    ID_Conta: 'acc-alcione',
    user_id: alcioneId,
    Origem: 'manual',
  } as Transaction,
];

describe('familyOwnerSummary', () => {
  it('agrega gastos por responsável no período', () => {
    const ctx = buildFamilyOwnerContext({
      currentUserId: cassioId,
      currentUserEmail: 'cassio@example.com',
      familyMembers,
      accounts,
      transactions,
    });

    const totals = buildFamilyOwnerPeriodTotals(transactions, ctx);
    expect(totals).toHaveLength(2);
    expect(totals.find((t) => t.userId === cassioId)?.expenseTotal).toBe(100);
    expect(totals.find((t) => t.userId === alcioneId)?.expenseTotal).toBe(250);
    expect(formatFamilyOwnerExpenseSummary(totals)).toContain('(Você)');
    expect(formatFamilyOwnerExpenseSummary(totals)).toContain('(Alcione)');
  });
});

describe('matchesTransactionFilters owner filter', () => {
  const baseFilters = {
    text: '',
    startDate: '',
    endDate: '',
    dateField: 'Data' as const,
    category: [],
    type: '',
    accountId: [],
    ownerUserId: alcioneId,
    viewScope: 'operation' as const,
    periodPreset: 'all' as const,
  };

  const ctx = buildFamilyOwnerContext({
    currentUserId: cassioId,
    currentUserEmail: 'cassio@example.com',
    familyMembers,
    accounts,
    transactions,
  });

  it('aplica filtro por responsável', () => {
    expect(
      matchesTransactionFilters(transactions[0], baseFilters, {
        getTransactionOwnerId: ctx.getTransactionOwnerId,
      })
    ).toBe(false);
    expect(
      matchesTransactionFilters(transactions[1], baseFilters, {
        getTransactionOwnerId: ctx.getTransactionOwnerId,
      })
    ).toBe(true);
  });

  it('ignora filtro de responsável quando skipOwnerFilter', () => {
    expect(
      matchesTransactionFilters(transactions[0], baseFilters, {
        getTransactionOwnerId: ctx.getTransactionOwnerId,
        skipOwnerFilter: true,
      })
    ).toBe(true);
  });
});
