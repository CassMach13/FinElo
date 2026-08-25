import { describe, expect, it } from 'vitest';
import type { AtomicCardCompetenceEvidenceCycle } from '../../src/domain/credit-card/atomicRebuildCompetenceForensics';
import { buildAtomicCardEndToEndDryRunReport } from '../../src/domain/credit-card/atomicRebuildEndToEndDryRun';
import { buildAtomicCardProvenanceReport } from '../../src/domain/credit-card/atomicRebuildProvenance';
import {
  compareAtomicCardProjections,
  type AtomicCardShadowEntry,
  type AtomicCardShadowProjection,
  type PersistedAtomicCardEntry,
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
  checksum: 'shadow-v1-12345678',
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
      openAmountCents: 0,
      status: 'paid',
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
      openAmountCents: 0,
      status: 'partial',
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
  persisted = persistedProjection(),
  cycles: AtomicCardCompetenceEvidenceCycle[] = []
) => {
  const comparison = compareAtomicCardProjections(shadow, persisted);
  const provenance = buildAtomicCardProvenanceReport(shadow, persisted, comparison);
  return buildAtomicCardEndToEndDryRunReport({
    shadow,
    persisted,
    comparison,
    provenance,
    cycles,
  });
};

const shadowEntry = (
  transactionId: string,
  sourceFileName: string,
  sourceRowHash: string,
  statementKey: string,
  postedDate: string,
  amountCents: number
): AtomicCardShadowEntry => ({
  transactionId,
  sourceFileName,
  sourceRowHash,
  statementKey,
  postedDate,
  amountCents,
  entryType: 'purchase',
});

const persistedEntry = (
  rowId: string,
  transactionId: string,
  sourceFileName: string,
  sourceRowHash: string,
  statementKey: string,
  postedDate: string,
  amountCents: number
): PersistedAtomicCardEntry => ({
  rowId,
  transactionId,
  sourceFileName,
  sourceRowHash,
  sourceRowIndex: 1,
  importLotId: `lot-${rowId}`,
  createdAt: '2026-08-24T12:00:00.000Z',
  statementKey,
  postedDate,
  amountCents,
  entryType: 'purchase',
});

describe('buildAtomicCardEndToEndDryRunReport', () => {
  it('certifica a convergência estrutural ponta a ponta sem autorizar escrita', () => {
    const report = buildReport();

    expect(report).toMatchObject({
      status: 'converged',
      readyForReversibleExecutionPlanning: true,
      privacy: 'aggregated-no-identifiers',
      nonAuthoritative: true,
      executable: false,
      mutationPayloadIncluded: false,
      actualWriteOperationCount: 0,
      eligibleForWrite: false,
      sequentialStatus: 'not-needed',
      residualStatementStatus: 'explained',
      structuralDifferenceCountBefore: 2,
      structuralDifferenceCountAfter: 0,
      informationalDifferenceCountAfter: 2,
      changedTransactionCountAfter: 0,
      changedStatementCountAfter: 0,
      changedPaymentCountAfter: 0,
      entryCountBefore: 0,
      entryCountAfter: 0,
      statementCountBefore: 2,
      statementCountAfter: 2,
      paymentCountBefore: 1,
      paymentCountAfter: 1,
      hypotheticalIdentityUpdateCount: 0,
      hypotheticalCompetenceUpdateCount: 0,
      hypotheticalStatementFieldUpdateCount: 5,
      hypotheticalTotalUpdateCount: 5,
      intentionalTypeReviewCount: 0,
      dateMutationCount: 0,
      amountMutationCount: 0,
      sourceMutationCount: 0,
      protectedStatementCount: 2,
      protectedMetadataPreserved: true,
      protectedMetadataCoverageComplete: true,
      physicalRecordCountsPreserved: true,
      entryRecordsPreservedByResidualStep: true,
      paymentRecordsPreservedByResidualStep: true,
      outsideWindowPaymentWarningCount: 1,
    });
    expect(report.blockerProfiles).toEqual([]);
    expect(report.recommendationCodes).toEqual([
      'review-converged-projection',
      'preserve-all-physical-records',
      'preserve-economic-content-and-provenance',
      'preserve-protected-file-evidence',
      'treat-protected-metadata-as-informational',
      'design-reversible-execution-contract-next',
      'keep-writes-disabled',
    ]);
  });

  it('encadeia identidade, competência e liquidação na mesma projeção clonada', () => {
    const shadow = shadowProjection();
    shadow.entries = [
      shadowEntry('tx-owner', 'owner.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
      shadowEntry('tx-missing', 'missing.csv', 'hash-missing', '2026-08', '2026-08-02', -2000),
    ];
    shadow.sourceTransactionCount = 2;
    shadow.projectedEntryCount = 2;
    const persisted = persistedProjection();
    persisted.entries = [
      persistedEntry('row-anchor', 'tx-owner', 'owner.csv', 'hash-owner', '2026-08', '2026-07-01', -1000),
      persistedEntry('row-candidate', 'tx-owner', 'missing.csv', 'hash-missing', '2026-09', '2026-08-02', -2000),
    ];
    const cycles: AtomicCardCompetenceEvidenceCycle[] = [
      {
        sourceFileName: 'owner.csv',
        referenceMonth: '2026-07',
        dueDate: '2026-08-10',
        source: 'confirmed-import-history',
      },
      {
        sourceFileName: 'missing.csv',
        referenceMonth: '2026-08',
        dueDate: '2026-09-10',
        source: 'confirmed-import-history',
      },
    ];

    const report = buildReport(shadow, persisted, cycles);

    expect(report.status).toBe('converged');
    expect(report.readyForReversibleExecutionPlanning).toBe(true);
    expect(report.structuralDifferenceCountAfter).toBe(0);
    expect(report.changedTransactionCountAfter).toBe(0);
    expect(report.changedStatementCountAfter).toBe(0);
    expect(report.changedPaymentCountAfter).toBe(0);
    expect(report.entryCountBefore).toBe(2);
    expect(report.entryCountAfter).toBe(2);
    expect(report.hypotheticalIdentityUpdateCount).toBe(1);
    expect(report.hypotheticalCompetenceUpdateCount).toBe(1);
    expect(report.hypotheticalStatementFieldUpdateCount).toBe(5);
    expect(report.hypotheticalTotalUpdateCount).toBe(7);
    expect(report.dateMutationCount).toBe(0);
    expect(report.amountMutationCount).toBe(0);
    expect(report.sourceMutationCount).toBe(0);
    expect(report.blockerProfiles).toEqual([]);
  });

  it('bloqueia quando uma diferença não pertence à liquidação derivada', () => {
    const shadow = shadowProjection();
    const persisted = persistedProjection();
    persisted.statements[0].dueDate = '2026-07-29';

    const report = buildReport(shadow, persisted);

    expect(report.status).toBe('blocked');
    expect(report.readyForReversibleExecutionPlanning).toBe(false);
    expect(report.blockerProfiles).toContainEqual({
      code: 'residual-step-blocked',
      count: 1,
    });
    expect(report.blockerProfiles).toContainEqual({
      code: 'structural-difference-remains',
      count: 2,
    });
    expect(report.actualWriteOperationCount).toBe(0);
    expect(report.eligibleForWrite).toBe(false);
  });

  it('não aceita uma sombra que possua bloqueio de origem', () => {
    const shadow = shadowProjection();
    shadow.safeToStage = false;
    shadow.blockers = [
      {
        code: 'invalid-cycle',
        severity: 'blocker',
        message: 'private blocker',
      },
    ];

    const report = buildReport(shadow, persistedProjection());

    expect(report.status).toBe('blocked');
    expect(report.readyForReversibleExecutionPlanning).toBe(false);
    expect(report.blockerProfiles).toContainEqual({ code: 'shadow-not-safe', count: 1 });
  });

  it('é determinístico e não serializa identidades, arquivos ou metadados privados', () => {
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
