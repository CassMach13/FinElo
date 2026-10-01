import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../src/types';
import {
  IMPORTED_TRANSACTION_EDITABLE_FIELDS,
  canEditImportedField,
  isManualTransaction,
  sanitizeTransactionUpdate,
} from '../../src/domain/transactions/transactionEditPolicy';

const imported = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    ID_Transacao: 'tx-1',
    ID_Conta: 'card-1',
    Data: new Date('2026-08-10T00:00:00.000Z'),
    Data_Pagamento: '2026-09-10T00:00:00+00:00' as unknown as Date,
    Descricao_Original: 'LOJA XYZ PARC 02/06',
    Nome_Fantasia: 'Loja XYZ',
    Parcela_Atual: 2,
    Total_Parcelas: 6,
    Valor: -150.5,
    Tipo: 'Despesa',
    Categoria: 'Compras',
    Origem: 'fatura-agosto.csv',
    Fonte: 'Importação',
    ...overrides,
  }) as Transaction;

describe('transactionEditPolicy', () => {
  it('a lista de campos editáveis em importadas é explícita e curta', () => {
    expect([...IMPORTED_TRANSACTION_EDITABLE_FIELDS]).toEqual([
      'Nome_Fantasia',
      'Categoria',
      'linked_asset_id',
      'Data_Pagamento',
    ]);
    for (const estrutural of [
      'Parcela_Atual', 'Total_Parcelas', 'Origem', 'Fonte', 'Descricao_Original', 'Valor', 'Data', 'ID_Conta', 'Tipo',
    ]) {
      expect(canEditImportedField(estrutural), estrutural).toBe(false);
    }
  });

  it('manual: sem Origem conta como manual, como no resto do app', () => {
    expect(isManualTransaction({ Origem: 'manual' })).toBe(true);
    expect(isManualTransaction({ Origem: ' Manual ' })).toBe(true);
    expect(isManualTransaction({ Origem: undefined as unknown as string })).toBe(true);
    expect(isManualTransaction({ Origem: 'fatura-agosto.csv' })).toBe(false);
    expect(isManualTransaction(null)).toBe(true);
  });

  it('manual: o payload passa inteiro, inclusive campos fora da tabela', () => {
    const manual = imported({ Origem: 'manual', Fonte: 'Manual' });
    const requested = { Valor: -10, Parcela_Atual: 1, Total_Parcelas: 3, Fonte: 'Manual', pluggy_transaction_id: 'p1' };
    expect(sanitizeTransactionUpdate(manual, requested as Partial<Transaction>)).toEqual(requested);
  });

  it('importada: só campos permitidos e que mudaram', () => {
    const tx = imported();
    const out = sanitizeTransactionUpdate(tx, {
      ...tx,
      Categoria: 'Lazer',
      Parcela_Atual: undefined,
      Total_Parcelas: null as unknown as undefined,
      Fonte: 'Manual',
      Valor: 0,
    });
    expect(out).toEqual({ Categoria: 'Lazer' });
  });

  it('importada: data de pagamento compara pelo dia civil, não pelo formato', () => {
    const tx = imported();
    expect(sanitizeTransactionUpdate(tx, { Data_Pagamento: new Date('2026-09-10T00:00:00.000Z') })).toEqual({});
    expect(sanitizeTransactionUpdate(tx, { Data_Pagamento: '2026-09-10' as unknown as Date })).toEqual({});
    const novo = new Date('2026-09-15T00:00:00.000Z');
    expect(sanitizeTransactionUpdate(tx, { Data_Pagamento: novo })).toEqual({ Data_Pagamento: novo });
  });

  it('importada: vazio, undefined e ausente são "não mexer", nunca "apagar"', () => {
    const tx = imported({ linked_asset_id: undefined });
    expect(sanitizeTransactionUpdate(tx, { linked_asset_id: '' })).toEqual({});
    expect(sanitizeTransactionUpdate(tx, { linked_asset_id: undefined, Nome_Fantasia: undefined })).toEqual({});
    expect(sanitizeTransactionUpdate(tx, { linked_asset_id: 'asset-9' })).toEqual({ linked_asset_id: 'asset-9' });
  });

  it('importada sem parcela: a política nunca introduz parcela', () => {
    const tx = imported();
    delete (tx as Partial<Transaction>).Parcela_Atual;
    delete (tx as Partial<Transaction>).Total_Parcelas;
    const out = sanitizeTransactionUpdate(tx, { Categoria: 'Lazer', Parcela_Atual: 1, Total_Parcelas: 1 });
    expect(out).toEqual({ Categoria: 'Lazer' });
  });
});

describe('contrato do modal de edição para importadas', () => {
  const modal = readFileSync(resolve('src/components/modals/NewTransactionModal.tsx'), 'utf8');
  const store = readFileSync(resolve('src/hooks/useAppStore.ts'), 'utf8');

  it('o modo importada nasce da mesma política do store', () => {
    expect(modal).toContain("from '../../domain/transactions/transactionEditPolicy'");
    expect(modal).toContain('const isImportedEdit = Boolean(initialTransaction) && !isManualTransaction(initialTransaction);');
  });

  it('o salvamento de importada sai ANTES do gerador manual e não monta parcela, fonte nem descrição', () => {
    const inicio = modal.indexOf('if (isImportedEdit) {');
    const validacao = modal.indexOf('if (!validate() || isSaving) return;');
    expect(inicio).toBeGreaterThan(0);
    expect(validacao).toBeGreaterThan(inicio);
    const ramo = modal.slice(inicio, validacao);
    for (const proibido of ['Parcela_Atual', 'Total_Parcelas', 'Fonte', 'Descricao_Original', 'Valor', 'ID_Conta']) {
      expect(ramo, proibido).not.toContain(proibido);
    }
  });

  it('os controles que descrevem a linha do banco ficam travados e o Salvar não depende do tipo no cartão', () => {
    expect(modal.split('disabled={isImportedEdit}').length - 1).toBeGreaterThanOrEqual(5);
    expect(modal).toContain('disabled={isImportedEdit || cardEntryKind ===');
    expect(modal).toContain('const mustPickCardEntryKind = !isImportedEdit && isCreditCardAccount && !cardEntryKind;');
  });

  it('o store filtra o payload pela política antes de persistir', () => {
    const filtro = store.indexOf('sanitizeTransactionUpdate(oldTransaction, requestedFieldsToUpdate)');
    const gravacao = store.indexOf(".update(payload)", filtro);
    expect(filtro).toBeGreaterThan(0);
    expect(gravacao).toBeGreaterThan(filtro);
  });
});
