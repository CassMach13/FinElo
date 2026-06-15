import { describe, expect, it } from 'vitest';
import {
  buildFamilyOwnerContext,
  emailToDisplayLabel,
} from '../src/utils/familyOwnerContext';
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
  {
    id: 'acc-cassio',
    Nome_Conta: 'Nubank Cassio',
    Tipo_Conta: 'Conta Corrente',
    user_id: cassioId,
  } as Account,
  {
    id: 'acc-alcione',
    Nome_Conta: 'XP Alcione',
    Tipo_Conta: 'Cartão de Crédito',
    user_id: alcioneId,
  } as Account,
];

const transactions: Transaction[] = [
  {
    ID_Transacao: 'tx-1',
    Data: '2026-05-10',
    Valor: -50,
    Tipo: 'Despesa',
    Categoria: 'Mercado',
    ID_Conta: 'acc-cassio',
    user_id: cassioId,
    Origem: 'manual',
  } as Transaction,
  {
    ID_Transacao: 'tx-2',
    Data: '2026-05-11',
    Valor: -120,
    Tipo: 'Despesa',
    Categoria: 'Restaurante',
    ID_Conta: 'acc-alcione',
    user_id: alcioneId,
    Origem: 'manual',
  } as Transaction,
];

describe('familyOwnerContext', () => {
  it('emailToDisplayLabel retorna Você para o próprio usuário', () => {
    expect(emailToDisplayLabel('alcione@example.com', true)).toBe('Você');
    expect(emailToDisplayLabel('alcione@example.com', false)).toBe('Alcione');
  });

  it('permanece inativo sem vínculo familiar aceito', () => {
    const ctx = buildFamilyOwnerContext({
      currentUserId: cassioId,
      currentUserEmail: 'cassio@example.com',
      familyMembers: [],
      accounts,
      transactions,
    });
    expect(ctx.showAttribution).toBe(false);
    expect(ctx.owners).toHaveLength(0);
  });

  it('permanece inativo com família mas dados de um único usuário', () => {
    const ctx = buildFamilyOwnerContext({
      currentUserId: cassioId,
      currentUserEmail: 'cassio@example.com',
      familyMembers,
      accounts: [accounts[0]],
      transactions: [transactions[0]],
    });
    expect(ctx.showAttribution).toBe(false);
  });

  it('ativa atribuição com múltiplos responsáveis no plano família', () => {
    const ctx = buildFamilyOwnerContext({
      currentUserId: cassioId,
      currentUserEmail: 'cassio@example.com',
      familyMembers,
      accounts,
      transactions,
    });

    expect(ctx.showAttribution).toBe(true);
    expect(ctx.owners).toHaveLength(2);
    expect(ctx.getProfile(cassioId)?.label).toBe('Você');
    expect(ctx.getProfile(alcioneId)?.label).toBe('Alcione');
    expect(ctx.getTransactionOwnerId(transactions[1])).toBe(alcioneId);
    expect(ctx.getAccountOwnerId(accounts[1])).toBe(alcioneId);
  });

  it('usa apelido configurado em user_metadata', () => {
    const ctx = buildFamilyOwnerContext({
      currentUserId: cassioId,
      currentUserEmail: 'cassio@example.com',
      familyMembers,
      accounts,
      transactions,
      memberNicknames: { 'alcione@example.com': 'Ali' },
    });
    expect(ctx.getProfile(alcioneId)?.label).toBe('Ali');
  });
});
