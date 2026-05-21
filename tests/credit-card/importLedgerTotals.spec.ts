import { describe, expect, it } from 'vitest';
import { classifyEntryType } from '../../src/domain/credit-card/classifiers';
import { computeImportLedgerTotals } from '../../src/domain/credit-card/importLedgerTotals';

describe('classifyEntryType — evita falso estorno por "credito"', () => {
  it('não classifica compra com "credito" na descrição como estorno', () => {
    const result = classifyEntryType({
      amount: -150,
      descriptionNormalized: 'compra parcelada cartao credito visa',
      sourceRowHash: 'x',
    });
    expect(result.entryType).not.toBe('refund');
    expect(result.entryType).not.toBe('adjustment');
  });
});

describe('computeImportLedgerTotals — Tipo Finelo', () => {
  it('Despesa conta como compra mesmo com palavra credito na descrição', () => {
    const totals = computeImportLedgerTotals([
      {
        postedDate: '2026-01-10',
        description: 'LOJA CREDITO ROTATIVO',
        amount: -500,
        fineloTipo: 'Despesa',
      },
    ]);
    expect(totals.totalDebits).toBe(500);
    expect(totals.totalRefunds).toBe(0);
    expect(totals.statementTotal).toBe(500);
  });

  it('Renda sem keyword de pagamento abate como estorno/crédito', () => {
    const totals = computeImportLedgerTotals([
      {
        postedDate: '2026-01-10',
        description: 'AJUSTE LOJA X',
        amount: 39.99,
        fineloTipo: 'Renda',
      },
    ]);
    expect(totals.totalRefunds).toBe(39.99);
    expect(totals.statementTotal).toBe(0);
  });
});
