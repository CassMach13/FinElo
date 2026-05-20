import { describe, expect, it } from 'vitest';
import { resolveStatementDisplayTotals } from '../../src/utils/creditCardStatementDisplay';
import type { CreditCardStatementV2 } from '../../src/types';

const baseRow = (over: Partial<CreditCardStatementV2> = {}): CreditCardStatementV2 => ({
  id: 's1',
  user_id: 'u',
  card_id: 'c',
  account_id: 'a',
  purchase_reference_label: '2026-04',
  due_year: 2026,
  due_month: 4,
  due_date: '2026-04-10',
  status: 'open',
  total_purchases: 0,
  total_fees: 0,
  total_interest: 0,
  total_refunds: 0,
  statement_total: 10854.95,
  total_payments: 10854.95,
  open_balance: 0,
  ...over,
});

describe('resolveStatementDisplayTotals', () => {
  it('prioriza totais do extrato gravados no banco', () => {
    const d = resolveStatementDisplayTotals(
      baseRow({
        statement_total_from_file: 5301.51,
        total_payments_from_file: 5553.44,
      })
    );
    expect(d.statementTotal).toBe(5301.51);
    expect(d.totalPayments).toBe(5553.44);
    expect(d.source).toBe('file');
  });

  it('usa soma do ledger quando não há totais do arquivo', () => {
    const d = resolveStatementDisplayTotals(baseRow(), {
      statementTotal: 5301.51,
      totalPayments: 5553.44,
    });
    expect(d.statementTotal).toBe(5301.51);
    expect(d.totalPayments).toBe(5553.44);
    expect(d.source).toBe('ledger');
  });
});
