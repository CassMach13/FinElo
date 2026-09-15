import { describe, expect, it } from 'vitest';
import {
  canEditTransactionField,
  formatInstallmentLabel,
  IMPORTED_TRANSACTION_EDITABLE_FIELDS,
  resolveInstallmentMetadataForSave,
  resolveOriginalDescriptionForSave,
  resolveTransactionSourceForSave,
  sanitizeTransactionUpdate,
} from '../../src/domain/transactions/transactionEditPolicy';
import type { Transaction } from '../../src/types';

const importedTransaction = (): Transaction => ({
  ID_Transacao: 'synthetic-imported-transaction',
  ID_Conta: 'synthetic-card-account',
  Data: new Date('2026-07-15T00:00:00Z'),
  Data_Pagamento: new Date('2026-08-10T00:00:00Z'),
  Descricao_Original: 'SYNTHETIC RAW DESCRIPTION',
  Nome_Fantasia: 'Descrição amigável',
  Parcela_Atual: 2,
  Total_Parcelas: 3,
  Valor: -25,
  Tipo: 'Despesa',
  Categoria: 'Outros',
  Origem: 'synthetic_xp_statement.csv',
  Fonte: 'Cartão de Crédito XP',
});

const manualTransaction = (): Transaction => ({
  ...importedTransaction(),
  ID_Transacao: 'synthetic-manual-transaction',
  Origem: 'manual',
  Fonte: 'Manual',
});

describe('política de edição de transações importadas', () => {
  it('expõe somente a whitelist cosmética aprovada', () => {
    expect(IMPORTED_TRANSACTION_EDITABLE_FIELDS).toEqual([
      'Nome_Fantasia',
      'Categoria',
      'linked_asset_id',
    ]);
  });

  it('permite edição cosmética e preserva metadata da parcela', () => {
    const previous = importedTransaction();
    const patch = sanitizeTransactionUpdate(previous, {
      Nome_Fantasia: 'Novo nome amigável',
      Categoria: 'Cursos',
      linked_asset_id: 'synthetic-asset',
      Parcela_Atual: undefined,
      Total_Parcelas: undefined,
      Fonte: 'Manual',
      Origem: 'manual',
      Descricao_Original: 'TEXTO SUBSTITUÍDO',
      Valor: -999,
      Data: new Date('2030-01-01T00:00:00Z'),
      Data_Pagamento: new Date('2030-02-01T00:00:00Z'),
      ID_Conta: 'other-account',
      Tipo: 'Renda',
    });

    expect(patch).toEqual({
      Nome_Fantasia: 'Novo nome amigável',
      Categoria: 'Cursos',
      linked_asset_id: 'synthetic-asset',
    });

    const persisted = { ...previous, ...patch };
    expect(persisted.Parcela_Atual).toBe(2);
    expect(persisted.Total_Parcelas).toBe(3);
    expect(persisted.Fonte).toBe('Cartão de Crédito XP');
    expect(persisted.Origem).toBe('synthetic_xp_statement.csv');
    expect(persisted.Descricao_Original).toBe('SYNTHETIC RAW DESCRIPTION');
    expect(persisted.Valor).toBe(-25);
    expect(persisted.ID_Conta).toBe('synthetic-card-account');
  });

  it('transforma um payload somente estrutural em no-op determinístico', () => {
    const patch = sanitizeTransactionUpdate(importedTransaction(), {
      Parcela_Atual: undefined,
      Total_Parcelas: undefined,
      Fonte: 'Manual',
      Origem: 'manual',
    });
    expect(patch).toEqual({});
  });

  it('trata origem ausente como desconhecida e falha fechado', () => {
    const unknownOrigin = { ...importedTransaction(), Origem: undefined as unknown as string };
    expect(sanitizeTransactionUpdate(unknownOrigin, { Valor: -999 })).toEqual({});
  });

  it('não permite que a UI edite campos estruturais de uma importada', () => {
    const imported = importedTransaction();
    expect(canEditTransactionField(imported, 'Nome_Fantasia')).toBe(true);
    expect(canEditTransactionField(imported, 'Categoria')).toBe(true);
    expect(canEditTransactionField(imported, 'linked_asset_id')).toBe(true);

    for (const field of [
      'Origem',
      'Fonte',
      'Descricao_Original',
      'Valor',
      'Data',
      'Data_Pagamento',
      'ID_Conta',
      'Parcela_Atual',
      'Total_Parcelas',
      'Tipo',
    ] as const) {
      expect(canEditTransactionField(imported, field)).toBe(false);
    }
  });

  it('preserva metadata e proveniência ao salvar um registro existente', () => {
    const imported = importedTransaction();
    expect(resolveInstallmentMetadataForSave(imported, { current: null, total: null })).toEqual({
      current: 2,
      total: 3,
    });
    expect(resolveTransactionSourceForSave(imported)).toBe('Cartão de Crédito XP');
    expect(resolveOriginalDescriptionForSave(imported, 'Nome cosmético')).toBe(
      'SYNTHETIC RAW DESCRIPTION'
    );
    expect(resolveTransactionSourceForSave({ Fonte: '' })).toBe('');
  });
});

describe('apresentação de parcelas', () => {
  it('mostra metadata ausente ou inválida como neutra', () => {
    expect(formatInstallmentLabel(null, null)).toBe('—');
    expect(formatInstallmentLabel(undefined, undefined)).toBe('—');
    expect(formatInstallmentLabel(0, 3)).toBe('—');
    expect(formatInstallmentLabel(4, 3)).toBe('—');
  });

  it('mostra 1/1 somente quando os dois valores existem de fato', () => {
    expect(formatInstallmentLabel(1, 1)).toBe('1/1');
  });
});

describe('parcelamento manual permanece compatível', () => {
  it('aceita a metadata gerada para uma nova compra manual parcelada', () => {
    expect(resolveInstallmentMetadataForSave(undefined, { current: 1, total: 6 })).toEqual({
      current: 1,
      total: 6,
    });
  });

  it('preserva a parcela ao editar uma compra manual existente', () => {
    const manual = manualTransaction();
    expect(resolveInstallmentMetadataForSave(manual, { current: null, total: null })).toEqual({
      current: 2,
      total: 3,
    });
    expect(resolveTransactionSourceForSave(manual)).toBe('Manual');
    expect(resolveOriginalDescriptionForSave(manual, 'Manual atualizado')).toBe(
      'Manual atualizado'
    );
  });

  it('não restringe o payload de uma transação genuinamente manual', () => {
    const patch = {
      Valor: -30,
      Parcela_Atual: 3,
      Total_Parcelas: 4,
      Nome_Fantasia: 'Manual atualizado',
    };
    expect(sanitizeTransactionUpdate(manualTransaction(), patch)).toEqual(patch);
  });
});
