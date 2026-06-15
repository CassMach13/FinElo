import { describe, expect, it } from 'vitest';
import { buildFamilyOwnerContext } from '../src/utils/familyOwnerContext';
import {
  buildGroupedTransactionListItems,
  countTransactionsByOwner,
} from '../src/utils/familyOwnerGrouping';
import type { Account, FamilyMember, Transaction } from '../src/types';

const cassioId = 'user-cassio';
const markusId = 'user-markus';

const ctx = buildFamilyOwnerContext({
  currentUserId: cassioId,
  currentUserEmail: 'cassio@example.com',
  familyMembers: [
    {
      id: 'fm-1',
      owner_id: cassioId,
      owner_email: 'cassio@example.com',
      member_email: 'markus@example.com',
      status: 'accepted',
      created_at: '2026-01-01',
    },
  ] as FamilyMember[],
  accounts: [
    { id: 'acc-1', user_id: cassioId } as Account,
    { id: 'acc-2', user_id: markusId } as Account,
  ],
  transactions: [
    { ID_Transacao: '1', ID_Conta: 'acc-1', user_id: cassioId, Tipo: 'Despesa', Valor: -10 } as Transaction,
    { ID_Transacao: '2', ID_Conta: 'acc-2', user_id: markusId, Tipo: 'Despesa', Valor: -20 } as Transaction,
    { ID_Transacao: '3', ID_Conta: 'acc-2', user_id: markusId, Tipo: 'Despesa', Valor: -30 } as Transaction,
  ],
  memberNicknames: { 'markus@example.com': 'Markus' },
});

describe('familyOwnerGrouping', () => {
  it('conta lançamentos por responsável', () => {
    const counts = countTransactionsByOwner(ctx.owners.flatMap(() => []) as never, ctx.getTransactionOwnerId);
    expect(counts.size).toBe(0);

    const txs = [
      { ID_Transacao: '1', ID_Conta: 'acc-1', user_id: cassioId } as Transaction,
      { ID_Transacao: '2', ID_Conta: 'acc-2', user_id: markusId } as Transaction,
      { ID_Transacao: '3', ID_Conta: 'acc-2', user_id: markusId } as Transaction,
    ];
    const realCounts = countTransactionsByOwner(txs, ctx.getTransactionOwnerId);
    expect(realCounts.get(cassioId)).toBe(1);
    expect(realCounts.get(markusId)).toBe(2);
  });

  it('insere cabeçalhos ao agrupar por pessoa', () => {
    const txs = [
      { ID_Transacao: '1', ID_Conta: 'acc-1', user_id: cassioId } as Transaction,
      { ID_Transacao: '2', ID_Conta: 'acc-2', user_id: markusId } as Transaction,
      { ID_Transacao: '3', ID_Conta: 'acc-2', user_id: markusId } as Transaction,
    ];
    const counts = countTransactionsByOwner(txs, ctx.getTransactionOwnerId);
    const items = buildGroupedTransactionListItems(txs, counts, ctx);

    expect(items[0]).toMatchObject({ type: 'header', profile: { label: 'Você' }, count: 1 });
    expect(items[1]).toMatchObject({ type: 'transaction', transaction: { ID_Transacao: '1' } });
    expect(items[2]).toMatchObject({ type: 'header', profile: { label: 'Markus' }, count: 2 });
    expect(items[3]).toMatchObject({ type: 'transaction', transaction: { ID_Transacao: '2' } });
  });
});
