import { describe, expect, it } from 'vitest';
import { computeImportLedgerTotals } from '../../src/domain/credit-card/importLedgerTotals';

describe('computeImportLedgerTotals', () => {
  it('soma débitos e subtrai estornos no total da fatura', () => {
    const totals = computeImportLedgerTotals([
      { postedDate: '2025-12-01', description: 'LOJA TESTE', amount: -100 },
      { postedDate: '2025-12-02', description: 'ESTORNO LOJA', amount: 20 },
    ]);
    expect(totals.totalDebits).toBe(100);
    expect(totals.totalRefunds).toBe(20);
    expect(totals.statementTotal).toBe(80);
    expect(totals.totalPayments).toBe(0);
  });

  it('classifica pagamentos válidos normais como pagamento de fatura na mesma competência', () => {
    const totals = computeImportLedgerTotals([
      { postedDate: '2025-12-10', description: 'COMPRA A', amount: -500 },
      { postedDate: '2025-12-11', description: 'Pagamentos Validos Normais', amount: 5935.31 },
    ]);
    expect(totals.statementTotal).toBe(500);
    expect(totals.totalPayments).toBe(5935.31);
    expect(totals.totalInvoicePayments).toBe(5935.31);
    expect(totals.openBalance).toBe(0);
  });

  it('não mistura pagamento com débito no statementTotal', () => {
    const totals = computeImportLedgerTotals([
      { postedDate: '2026-04-01', description: 'ITEM', amount: -1200 },
      { postedDate: '2026-04-05', description: 'pagamento de fatura', amount: 800 },
    ]);
    expect(totals.statementTotal).toBe(1200);
    expect(totals.totalPayments).toBe(800);
    expect(totals.openBalance).toBe(400);
  });
});
