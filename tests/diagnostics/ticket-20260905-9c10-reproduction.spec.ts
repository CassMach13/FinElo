import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatInstallmentLabel,
  sanitizeTransactionUpdate,
} from '../../src/domain/transactions/transactionEditPolicy';
import type { Transaction } from '../../src/types';

const transactionViewSource = readFileSync(
  resolve('src/components/views/TransactionsView.tsx'),
  'utf8'
);
const transactionModalSource = readFileSync(
  resolve('src/components/modals/NewTransactionModal.tsx'),
  'utf8'
);
const appStoreSource = readFileSync(resolve('src/hooks/useAppStore.ts'), 'utf8');

const importedTransaction = (current: number): Transaction => ({
  ID_Transacao: `synthetic-${current}`,
  ID_Conta: 'synthetic-card-account',
  Data: new Date('2026-06-10T00:00:00Z'),
  Data_Pagamento: new Date(`2026-0${current + 6}-10T00:00:00Z`),
  Descricao_Original: 'SYNTHETIC MERCHANT',
  Nome_Fantasia: 'Compra sintética',
  Parcela_Atual: current,
  Total_Parcelas: 3,
  Valor: -10,
  Tipo: 'Despesa',
  Categoria: 'Teste',
  Origem: `synthetic_xp_${current}.csv`,
  Fonte: 'Cartão de Crédito XP',
});

describe('20260905-9C10 — regressão da numeração incorreta de parcelas', () => {
  it('preserva 1/3, 2/3, 3/3 mesmo diante do payload que antes anulava a parcela intermediária', () => {
    const sequence = [importedTransaction(1), importedTransaction(2), importedTransaction(3)];
    const malformedEditorPayload: Partial<Transaction> = {
      Nome_Fantasia: 'Nome cosmético',
      Parcela_Atual: undefined,
      Total_Parcelas: undefined,
      Fonte: 'Manual',
      Descricao_Original: 'Nome cosmético',
    };

    sequence[1] = {
      ...sequence[1],
      ...sanitizeTransactionUpdate(sequence[1], malformedEditorPayload),
    };

    expect(sequence.map((transaction) =>
      formatInstallmentLabel(transaction.Parcela_Atual, transaction.Total_Parcelas)
    )).toEqual(['1/3', '2/3', '3/3']);
    expect(sequence[1].Fonte).toBe('Cartão de Crédito XP');
    expect(sequence[1].Descricao_Original).toBe('SYNTHETIC MERCHANT');
  });

  it('mantém o editor completo mobile restrito a lançamentos manuais', () => {
    expect(transactionViewSource).toContain('leftActions={manual ? [');
    expect(transactionViewSource).toContain('formatInstallmentLabel(');
    expect(transactionViewSource).not.toContain(
      '`${transaction.Parcela_Atual || 1}/${transaction.Total_Parcelas || 1}`'
    );
    expect(transactionViewSource).not.toMatch(/Parcela_Atual\s*\|\|\s*1/);
    expect(transactionViewSource).not.toMatch(/Total_Parcelas\s*\|\|\s*1/);
  });

  it('preserva a origem e as parcelas existentes durante a hidratação/salvamento', () => {
    expect(transactionModalSource).toContain('resolveInstallmentMetadataForSave(initialTransaction');
    expect(transactionModalSource).toContain('resolveTransactionSourceForSave(initialTransaction)');
    expect(transactionModalSource).toContain('resolveOriginalDescriptionForSave(');
  });

  it('aplica a mesma whitelist novamente na fronteira de persistência', () => {
    expect(appStoreSource).toContain(
      'sanitizeTransactionUpdate(oldTransaction, requestedFieldsToUpdate)'
    );
    expect(appStoreSource).toContain('if (Object.keys(fieldsToUpdate).length === 0) return;');
  });
});
