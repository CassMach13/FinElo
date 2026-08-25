import { describe, expect, it } from 'vitest';
import { buildAtomicCardProvenanceReport } from '../../src/domain/credit-card/atomicRebuildProvenance';
import { buildAtomicCardResidualStatementDryRunReport } from '../../src/domain/credit-card/atomicRebuildResidualStatementDryRun';
import {
  compareAtomicCardProjections,
  type AtomicCardShadowProjection,
  type PersistedAtomicCardProjection,
} from '../../src/domain/credit-card/atomicRebuildShadow';

const shadowProjection = (): AtomicCardShadowProjection => ({
  version: 1,
  accountId: 'private-account',
  sourceCycleCount: 2,
  sourceTransactionCount: 0,
  projectedEntryCount: 0,
  projectedPaymentCount: 1,
  statements: [
    {
      statementKey: '2026-07',
      purchaseReferenceMonth: '2026-07',
      dueDate: '2026-07-28',
      dueYear: 2026,
      dueMonth: 7,
      status: 'paid',
      sourceFiles: ['private-july.csv'],
      entryCount: 5,
      totalPurchasesCents: 44990,
      totalFeesCents: 0,
      totalInterestCents: 0,
      totalRefundsCents: 5000,
      statementTotalCents: 39990,
      totalPaymentsCents: 39990,
      openBalanceCents: 0,
    },
    {
      statementKey: '2026-08',
      purchaseReferenceMonth: '2026-08',
      dueDate: '2026-08-28',
      dueYear: 2026,
      dueMonth: 8,
      status: 'open',
      sourceFiles: ['private-august.csv'],
      entryCount: 4,
      totalPurchasesCents: 44990,
      totalFeesCents: 0,
      totalInterestCents: 0,
      totalRefundsCents: 0,
      statementTotalCents: 44990,
      totalPaymentsCents: 0,
      openBalanceCents: 44990,
    },
  ],
  entries: [],
  payments: [
    {
      transactionId: 'private-payment',
      sourceFileName: 'private-august.csv',
      sourceRowHash: 'private-payment-hash',
      statementKey: '2026-07',
      paymentDate: '2026-08-20',
      amountCents: 39990,
      source: 'imported_statement',
    },
  ],
  issues: [
    {
      code: 'payment-before-rebuild-window',
      severity: 'warning',
      message: 'private diagnostic',
      transactionId: 'private-before-window-payment',
      fileName: 'private-july.csv',
    },
  ],
  blockers: [],
  warnings: [
    {
      code: 'payment-before-rebuild-window',
      severity: 'warning',
      message: 'private diagnostic',
      transactionId: 'private-before-window-payment',
      fileName: 'private-july.csv',
    },
  ],
  safeToStage: true,
  checksum: 'shadow-v1-private-residual',
});

const persistedProjection = (): PersistedAtomicCardProjection => ({
  source: 'engine',
  statements: [
    {
      rowId: 'private-july-row',
      cardId: 'private-card',
      referenceLabel: '07/2026',
      statementKey: '2026-07',
      dueDate: '2026-07-28',
      entryCount: 5,
      statementTotalCents: 39990,
      totalPaymentsCents: 40000,
      openBalanceCents: 0,
      hasProtectedMetadata: true,
      manualTotalsPresent: false,
      manualTotalsJson: { privateMarker: 'private-july-metadata' },
      statementTotalFromFileCents: 39990,
      totalPaymentsFromFileCents: 40000,
      linesComputedTotalCents: 39990,
    },
    {
      rowId: 'private-august-row',
      cardId: 'private-card',
      referenceLabel: '08/2026',
      statementKey: '2026-08',
      dueDate: '2026-08-28',
      entryCount: 4,
      statementTotalCents: 44990,
      totalPaymentsCents: 39990,
      openBalanceCents: 5000,
      hasProtectedMetadata: true,
      manualTotalsPresent: false,
      manualTotalsJson: { privateMarker: 'private-august-metadata' },
      statementTotalFromFileCents: 44990,
      totalPaymentsFromFileCents: 39990,
      linesComputedTotalCents: 44990,
    },
  ],
  entries: [],
  payments: [
    {
      rowId: 'private-payment-row',
      transactionId: 'private-payment',
      statementKey: '2026-07',
      paymentDate: '2026-08-20',
      amountCents: 39990,
      source: 'imported_statement',
      notes: 'private-payment-note',
    },
  ],
});

const buildReport = (
  shadow = shadowProjection(),
  persisted = persistedProjection()
) => {
  const comparison = compareAtomicCardProjections(shadow, persisted);
  const provenance = buildAtomicCardProvenanceReport(shadow, persisted, comparison);
  return buildAtomicCardResidualStatementDryRunReport({
    shadow,
    persisted,
    comparison,
    provenance,
    cycles: [],
  });
};

describe('buildAtomicCardResidualStatementDryRunReport', () => {
  it('separa o pagamento informado pelo arquivo da quitação aplicada à fatura', () => {
    const report = buildReport();

    expect(report).toMatchObject({
      status: 'explained',
      privacy: 'aggregated-no-identifiers',
      nonAuthoritative: true,
      executable: false,
      mutationPayloadIncluded: false,
      actualWriteOperationCount: 0,
      eligibleForWrite: false,
      statementCountBefore: 2,
      statementCountAfter: 2,
      changedStatementCountBefore: 2,
      changedStatementCountAfter: 0,
      changedPaymentCountBefore: 0,
      changedPaymentCountAfter: 0,
      structuralDifferenceCountBefore: 2,
      structuralDifferenceCountAfter: 0,
      informationalDifferenceCountAfter: 2,
      candidateStatementCount: 2,
      hypotheticalStatementFieldUpdateCount: 5,
      protectedStatementCount: 2,
      protectedMetadataPreserved: true,
      protectedFilePaymentEvidenceCount: 2,
      sameCycleFilePaymentMaterializationCount: 2,
      settlementChainSupportedCount: 2,
      outsideWindowPaymentWarningCount: 1,
      entryRecordsPreserved: true,
      paymentRecordsPreserved: true,
    });
    expect(report.fieldProfiles).toEqual([
      { field: 'totalPaymentsCents', count: 2 },
      { field: 'openAmountCents', count: 1 },
      { field: 'openBalanceCents', count: 1 },
      { field: 'status', count: 1 },
    ]);
    expect(report.blockerProfiles).toEqual([]);
    expect(report.recommendationCodes).toEqual([
      'separate-file-payment-from-applied-settlement',
      'use-payment-links-for-settlement',
      'preserve-protected-file-totals',
      'retain-outside-window-payment-as-context',
      'keep-writes-disabled',
    ]);
  });

  it('bloqueia quando a divergência alcança campos que não são de liquidação', () => {
    const shadow = shadowProjection();
    const persisted = persistedProjection();
    persisted.statements[0].dueDate = '2026-07-29';

    const report = buildReport(shadow, persisted);

    expect(report.status).toBe('blocked');
    expect(report.blockerProfiles).toContainEqual({
      code: 'non-settlement-statement-difference',
      count: 1,
    });
    expect(report.changedStatementCountAfter).toBe(2);
    expect(report.actualWriteOperationCount).toBe(0);
    expect(report.eligibleForWrite).toBe(false);
  });

  it('bloqueia o rebase quando os vínculos físicos de pagamento não coincidem com a sombra', () => {
    const shadow = shadowProjection();
    const persisted = persistedProjection();
    persisted.payments[0].amountCents = 39989;

    const report = buildReport(shadow, persisted);

    expect(report.status).toBe('blocked');
    expect(report.blockerProfiles).toContainEqual({
      code: 'payment-ledger-not-aligned',
      count: 1,
    });
    expect(report.changedPaymentCountBefore).toBe(1);
    expect(report.recommendationCodes).toContain('resolve-payment-ledger-before-rebase');
  });

  it('é determinístico e não serializa chaves, origens ou metadados privados', () => {
    const first = buildReport();
    const shadow = shadowProjection();
    const persisted = persistedProjection();
    shadow.statements.reverse();
    persisted.statements.reverse();
    const second = buildReport(shadow, persisted);
    const serialized = JSON.stringify(first);

    expect(second).toEqual(first);
    expect(serialized).not.toContain('2026-07');
    expect(serialized).not.toContain('2026-08');
    expect(serialized).not.toContain('private-payment');
    expect(serialized).not.toContain('private-july');
    expect(serialized).not.toContain('private-august');
    expect(serialized).not.toContain('private-card');
    expect(serialized).not.toContain('privateMarker');
  });
});
