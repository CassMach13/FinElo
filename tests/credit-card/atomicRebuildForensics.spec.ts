import { describe, expect, it } from 'vitest';
import {
  compareAtomicCardProjections,
  type AtomicCardShadowProjection,
  type PersistedAtomicCardProjection,
} from '../../src/domain/credit-card/atomicRebuildShadow';
import { buildAtomicCardForensicReport } from '../../src/domain/credit-card/atomicRebuildForensics';

const shadowBase = (): AtomicCardShadowProjection => ({
  version: 1,
  accountId: 'account-1',
  sourceCycleCount: 1,
  sourceTransactionCount: 0,
  projectedEntryCount: 0,
  projectedPaymentCount: 0,
  statements: [],
  entries: [],
  payments: [],
  issues: [],
  blockers: [],
  warnings: [],
  safeToStage: true,
  checksum: 'shadow-v1-forensic',
});

const persistedBase = (): PersistedAtomicCardProjection => ({
  source: 'engine',
  statements: [],
  entries: [],
  payments: [],
});

describe('buildAtomicCardForensicReport', () => {
  it('separa causas por campo e não inclui identificadores ou descrições', () => {
    const shadow: AtomicCardShadowProjection = {
      ...shadowBase(),
      sourceTransactionCount: 3,
      projectedEntryCount: 3,
      projectedPaymentCount: 1,
      entries: [
        {
          transactionId: 'tx-private-a',
          sourceFileName: 'fatura-cliente-privado.csv',
          sourceRowHash: 'hash-a',
          statementKey: '2026-07',
          postedDate: '2026-07-02',
          amountCents: -1000,
          entryType: 'purchase',
        },
        {
          transactionId: 'tx-private-missing',
          sourceFileName: 'fatura-cliente-privado.csv',
          sourceRowHash: 'hash-b',
          statementKey: '2026-07',
          postedDate: '2026-07-03',
          amountCents: -2000,
          entryType: 'purchase',
        },
        {
          transactionId: 'tx-private-duplicate',
          sourceFileName: 'fatura-cliente-privado.csv',
          sourceRowHash: 'hash-c',
          statementKey: '2026-07',
          postedDate: '2026-07-04',
          amountCents: -3000,
          entryType: 'purchase',
        },
      ],
      statements: [
        {
          statementKey: '2026-07',
          purchaseReferenceMonth: '2026-07',
          dueDate: '2026-08-10',
          dueYear: 2026,
          dueMonth: 7,
          status: 'open',
          sourceFiles: ['fatura-cliente-privado.csv'],
          entryCount: 3,
          totalPurchasesCents: 6000,
          totalFeesCents: 0,
          totalInterestCents: 0,
          totalRefundsCents: 0,
          statementTotalCents: 6000,
          totalPaymentsCents: 1000,
          openBalanceCents: 5000,
        },
      ],
      payments: [
        {
          transactionId: 'tx-private-payment',
          sourceFileName: 'fatura-cliente-privado.csv',
          sourceRowHash: 'hash-payment',
          statementKey: '2026-07',
          paymentDate: '2026-08-10',
          amountCents: 1000,
          source: 'imported_statement',
        },
      ],
    };
    const persisted: PersistedAtomicCardProjection = {
      ...persistedBase(),
      entries: [
        {
          rowId: 'row-a',
          transactionId: 'tx-private-a',
          statementKey: '2026-08',
          postedDate: '2026-07-02',
          amountCents: -1000,
          entryType: 'purchase',
        },
        {
          rowId: 'row-duplicate-1',
          transactionId: 'tx-private-duplicate',
          statementKey: '2026-08',
          postedDate: '2026-07-04',
          amountCents: -3000,
          entryType: 'purchase',
        },
        {
          rowId: 'row-duplicate-2',
          transactionId: 'tx-private-duplicate',
          statementKey: '2026-09',
          postedDate: '2026-07-04',
          amountCents: -3000,
          entryType: 'purchase',
        },
      ],
      statements: [
        {
          statementKey: '2026-07',
          dueDate: '2026-07-10',
          entryCount: 2,
          statementTotalCents: 4000,
          totalPaymentsCents: 0,
          openBalanceCents: 4000,
          hasProtectedMetadata: true,
        },
      ],
      payments: [
        {
          rowId: 'payment-current',
          transactionId: 'tx-private-payment',
          statementKey: '2026-08',
          paymentDate: '2026-08-10',
          amountCents: 1000,
          source: 'imported_statement',
        },
        {
          rowId: 'payment-orphan-private',
          transactionId: null,
          statementKey: '2026-06',
          paymentDate: '2026-07-10',
          amountCents: 500,
          source: 'manual',
        },
      ],
    };

    const comparison = compareAtomicCardProjections(shadow, persisted);
    const report = buildAtomicCardForensicReport(shadow, persisted, comparison);

    expect(report.recommendedAction).toBe('investigate');
    expect(report.entryChangeProfiles).toContainEqual({
      key: 'statementKey',
      fields: ['statementKey'],
      count: 2,
    });
    expect(report.paymentChangeProfiles).toContainEqual({
      key: 'statementKey',
      fields: ['statementKey'],
      count: 1,
    });
    expect(report.duplicateTransactionCohorts).toEqual([
      { code: 'no-canonical-match', count: 1 },
    ]);
    expect(report.missingTransactionsByStatement).toEqual([
      { statementKey: '2026-07', count: 1 },
    ]);
    expect(report.orphanPaymentsWithoutIdentity).toBe(1);
    expect(report.protectedStatementCount).toBe(1);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('tx-private');
    expect(serialized).not.toContain('fatura-cliente');
    expect(serialized).not.toContain('payment-orphan-private');
  });

  it('identifica pagamento duplicado como reparo estreito quando a proveniência é inequívoca', () => {
    const shadow: AtomicCardShadowProjection = {
      ...shadowBase(),
      projectedPaymentCount: 1,
      payments: [
        {
          transactionId: 'payment-transaction',
          sourceFileName: 'invoice.csv',
          sourceRowHash: 'hash-payment',
          statementKey: '2026-07',
          paymentDate: '2026-08-10',
          amountCents: 1000,
          source: 'imported_statement',
        },
      ],
    };
    const persisted: PersistedAtomicCardProjection = {
      ...persistedBase(),
      payments: [
        {
          rowId: 'canonical-row',
          transactionId: 'payment-transaction',
          statementKey: '2026-07',
          paymentDate: '2026-08-10',
          amountCents: 1000,
          source: 'imported_statement',
          notes: 'h-new · invoice.csv · linha 4 · Pagamento',
        },
        {
          rowId: 'obsolete-row',
          transactionId: null,
          statementKey: '2026-07',
          paymentDate: '2026-08-10',
          amountCents: 1000,
          source: 'imported_statement',
          notes: 'h-old · invoice.csv · linha 4 · Pagamento',
        },
      ],
    };

    const comparison = compareAtomicCardProjections(shadow, persisted);
    const report = buildAtomicCardForensicReport(shadow, persisted, comparison);

    expect(comparison.repairablePersistedPaymentRowIds).toEqual(['obsolete-row']);
    expect(report.recommendedAction).toBe('repair-narrow');
    expect(report.repairablePaymentRows).toBe(1);
    expect(report.recommendationCodes).toContain('repair-payment-duplicates-with-snapshot');
  });

  it('recomenda ativação apenas quando a comparação já é apta', () => {
    const shadow: AtomicCardShadowProjection = {
      ...shadowBase(),
      sourceTransactionCount: 1,
      projectedEntryCount: 1,
      entries: [
        {
          transactionId: 'transaction-1',
          sourceFileName: 'invoice.csv',
          sourceRowHash: 'hash-1',
          statementKey: '2026-07',
          postedDate: '2026-07-02',
          amountCents: -1000,
          entryType: 'purchase',
        },
      ],
    };
    const persisted: PersistedAtomicCardProjection = {
      ...persistedBase(),
      entries: [
        {
          rowId: 'row-1',
          transactionId: 'transaction-1',
          statementKey: '2026-08',
          postedDate: '2026-07-02',
          amountCents: -1000,
          entryType: 'purchase',
        },
      ],
    };

    const comparison = compareAtomicCardProjections(shadow, persisted);
    const report = buildAtomicCardForensicReport(shadow, persisted, comparison);

    expect(comparison.safeToActivate).toBe(true);
    expect(report.recommendedAction).toBe('activate');
    expect(report.recommendationCodes).toContain('activate-only-with-snapshot');
  });

  it('não modifica projeções nem listas de comparação recebidas', () => {
    const shadow = shadowBase();
    const persisted = persistedBase();
    const comparison = compareAtomicCardProjections(shadow, persisted);
    const before = JSON.stringify({ shadow, persisted, comparison });

    buildAtomicCardForensicReport(shadow, persisted, comparison);

    expect(JSON.stringify({ shadow, persisted, comparison })).toBe(before);
  });
});
