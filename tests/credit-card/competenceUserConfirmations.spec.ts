import { describe, expect, it } from 'vitest';
import type { CompetenceHistoryCard } from '../../src/services/creditCardRebuildFromImportHistoryService';
import { applyCompetenceUserPaymentConfirmations } from '../../src/services/competenceInvoiceUserConfirmations';

function baseCard(overrides: Partial<CompetenceHistoryCard>): CompetenceHistoryCard {
  return {
    referenceMonth: '2025-03',
    competenceBR: '03/2025',
    dueDate: '2025-04-10',
    vencimentoBR: '10/04/2025',
    dueYear: 2025,
    dueMonth: 4,
    files: [{ fileName: 'a.csv', transactionCount: 1, statementTotal: 100, totalPayments: 0 }],
    statementTotal: 100,
    totalPayments: 99,
    openBalanceBeforeCarry: 1,
    priorCreditApplied: 0,
    openBalance: 1,
    creditCarriedForward: 0,
    ...overrides,
  };
}

describe('applyCompetenceUserPaymentConfirmations', () => {
  it('zera saldo em aberto e marca competência como confirmada', () => {
    const cards = applyCompetenceUserPaymentConfirmations(
      [baseCard({})],
      [
        {
          userId: 'u1',
          accountId: 'acc',
          referenceMonth: '2025-03',
          settledAmount: 1,
          confirmedAt: '2025-05-01T12:00:00.000Z',
        },
      ]
    );

    expect(cards[0].userConfirmedPaid).toBe(true);
    expect(cards[0].totalPayments).toBe(100);
    expect(cards[0].openBalance).toBe(0);
  });
});
