import { describe, it, expect } from 'vitest';
import {
  shouldReprocessCreditCardLedgerAfterTransactionUpdate,
  getCosmeticOnlyPatchKeys,
} from '../../src/utils/creditCardLedgerSyncPolicy';
import type { Transaction } from '../../src/types';

const baseTx = (): Transaction => ({
  ID_Transacao: 'tx-1',
  ID_Conta: 'card-1',
  Data: new Date('2026-04-15'),
  Descricao_Original: 'LOJA XYZ',
  Nome_Fantasia: 'Loja XYZ',
  Valor: -120.5,
  Tipo: 'Despesa',
  Categoria: 'Sem categoria',
  Origem: 'Fatura_XP_Abr_2026.csv',
  Fonte: 'import',
});

describe('creditCardLedgerSyncPolicy', () => {
  it('não reprocessa quando só a Categoria muda', () => {
    const prev = baseTx();
    expect(
      shouldReprocessCreditCardLedgerAfterTransactionUpdate(prev, {
        Categoria: 'Alimentação',
      })
    ).toBe(false);
  });

  it('não reprocessa quando descrição, tipo, parcelas ou apelido mudam', () => {
    const prev = baseTx();
    expect(
      shouldReprocessCreditCardLedgerAfterTransactionUpdate(prev, {
        Descricao_Original: 'OUTRA DESC',
        Tipo: 'Renda',
        Portador: 'Titular',
        Parcela_Atual: 2,
        Total_Parcelas: 6,
        Nome_Fantasia: 'Apelido novo',
        Categoria: 'Viagem',
      })
    ).toBe(false);
  });

  it('reprocessa quando Valor muda', () => {
    const prev = baseTx();
    expect(
      shouldReprocessCreditCardLedgerAfterTransactionUpdate(prev, { Valor: -121 })
    ).toBe(true);
  });

  it('reprocessa quando Data muda', () => {
    const prev = baseTx();
    expect(
      shouldReprocessCreditCardLedgerAfterTransactionUpdate(prev, {
        Data: new Date('2026-04-16'),
      })
    ).toBe(true);
  });

  it('reprocessa quando conta ou origem mudam', () => {
    const prev = baseTx();
    expect(
      shouldReprocessCreditCardLedgerAfterTransactionUpdate(prev, { ID_Conta: 'outro-cartao' })
    ).toBe(true);
    expect(
      shouldReprocessCreditCardLedgerAfterTransactionUpdate(prev, {
        Origem: 'outro_arquivo.csv',
      })
    ).toBe(true);
  });

  it('reprocessa se Categoria mudar junto com Valor (patch misto)', () => {
    const prev = baseTx();
    expect(
      shouldReprocessCreditCardLedgerAfterTransactionUpdate(prev, {
        Categoria: 'Alimentação',
        Valor: -99,
      })
    ).toBe(true);
  });

  it('não reprocessa quando valor do motor é igual ao anterior (no-op)', () => {
    const prev = baseTx();
    expect(
      shouldReprocessCreditCardLedgerAfterTransactionUpdate(prev, {
        Categoria: 'Nova',
        Valor: prev.Valor,
      })
    ).toBe(false);
  });

  it('lista chaves cosméticas do patch', () => {
    const keys = getCosmeticOnlyPatchKeys({
      Categoria: 'X',
      Valor: 1,
      Descricao_Original: 'y',
    });
    expect(keys).toContain('Categoria');
    expect(keys).toContain('Descricao_Original');
    expect(keys).not.toContain('Valor');
  });
});
