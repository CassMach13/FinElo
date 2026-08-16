import { describe, expect, it } from 'vitest';
import {
  buildAtomicCardStatementConservationPlanReport,
} from '../../src/domain/credit-card/atomicRebuildStatementConservationPlan';
import type { AtomicCardStatementConservationDryRunReport } from '../../src/domain/credit-card/atomicRebuildStatementConservationDryRun';
import type {
  AtomicCardProjectionComparison,
  AtomicCardShadowProjection,
  PersistedAtomicCardProjection,
} from '../../src/domain/credit-card/atomicRebuildShadow';

const privateStatementKey = 'private-statement-key';
const privateChecksum = 'shadow-v1-private-checksum';
const privateRevision = 'private-persisted-revision';

const shadow = (): AtomicCardShadowProjection => ({
  version: 1,
  accountId: 'private-account-id',
  sourceCycleCount: 1,
  sourceTransactionCount: 3,
  projectedEntryCount: 2,
  projectedPaymentCount: 1,
  statements: [
    {
      statementKey: privateStatementKey,
      purchaseReferenceMonth: '2026-01',
      dueDate: '2026-02-10',
      dueYear: 2026,
      dueMonth: 2,
      status: 'open',
      sourceFiles: ['private-source.csv'],
      entryCount: 2,
      totalPurchasesCents: 44_990,
      totalFeesCents: 0,
      totalInterestCents: 0,
      totalRefundsCents: 0,
      statementTotalCents: 44_990,
      totalPaymentsCents: 39_990,
      openBalanceCents: 5_000,
    },
  ],
  entries: [0, 1].map((index) => ({
    transactionId: `private-transaction-${index}`,
    sourceFileName: 'private-source.csv',
    sourceRowHash: `private-hash-${index}`,
    statementKey: privateStatementKey,
    postedDate: '2026-01-10',
    amountCents: -22_495,
    entryType: 'purchase',
  })),
  payments: [
    {
      transactionId: 'private-payment-transaction',
      sourceFileName: 'private-source.csv',
      sourceRowHash: 'private-payment-hash',
      statementKey: privateStatementKey,
      paymentDate: '2026-02-10',
      amountCents: 39_990,
      source: 'imported_statement',
    },
  ],
  issues: [],
  blockers: [],
  warnings: [],
  safeToStage: false,
  checksum: privateChecksum,
});

const persisted = (): PersistedAtomicCardProjection => ({
  source: 'engine',
  statements: [
    {
      statementKey: privateStatementKey,
      dueDate: '2026-02-10',
      entryCount: 2,
      statementTotalCents: 44_990,
      totalPaymentsCents: 39_990,
      openBalanceCents: 5_000,
      hasProtectedMetadata: true,
      manualTotalsPresent: true,
      statementTotalFromFileCents: 44_990,
      totalPaymentsFromFileCents: 39_990,
    },
    {
      statementKey: privateStatementKey,
      dueDate: '2026-02-10',
      entryCount: 0,
      statementTotalCents: 44_990,
      totalPaymentsCents: 0,
      openBalanceCents: 44_990,
    },
    {
      statementKey: 'unaffected-statement-key',
      dueDate: '2026-03-10',
      entryCount: 0,
      statementTotalCents: 0,
      totalPaymentsCents: 0,
      openBalanceCents: 0,
    },
  ],
  entries: [0, 1].map((index) => ({
    rowId: `private-entry-row-${index}`,
    transactionId: `private-transaction-${index}`,
    statementKey: privateStatementKey,
    postedDate: '2026-01-10',
    amountCents: -22_495,
    entryType: 'purchase',
  })),
  payments: [
    {
      rowId: 'private-payment-row',
      transactionId: 'private-payment-transaction',
      statementKey: privateStatementKey,
      paymentDate: '2026-02-10',
      amountCents: 39_990,
      source: 'imported_statement',
    },
  ],
});

const comparison = (
  overrides: Partial<AtomicCardProjectionComparison> = {}
): AtomicCardProjectionComparison => ({
  status: 'different',
  safeToActivate: false,
  duplicatePersistedTransactionIds: [],
  repairablePersistedEntryRowIds: [],
  conflictingDuplicatePersistedTransactionIds: [],
  duplicatePersistedStatementKeys: [privateStatementKey],
  duplicatePersistedPaymentTransactionIds: [],
  suspiciousPersistedPaymentEventKeys: [],
  repairablePersistedPaymentRowIds: [],
  protectedMetadataStatementKeys: [privateStatementKey],
  missingTransactionIds: [],
  orphanTransactionIds: [],
  changedTransactionIds: [],
  missingStatementKeys: [],
  orphanStatementKeys: [],
  changedStatementKeys: [],
  missingPaymentKeys: [],
  orphanPaymentKeys: [],
  changedPaymentTransactionIds: [],
  structuralDifferenceCount: 1,
  activationChangeCount: 0,
  differenceCount: 1,
  ...overrides,
});

const conservationDryRun = (
  overrides: Partial<AtomicCardStatementConservationDryRunReport> = {}
): AtomicCardStatementConservationDryRunReport => ({
  version: 1,
  privacy: 'aggregated-no-identifiers',
  nonAuthoritative: true,
  executable: false,
  mutationPayloadIncluded: false,
  actualWriteOperationCount: 0,
  checksum: privateChecksum,
  status: 'simulation-complete',
  duplicateGroupCount: 1,
  locatedGroupCount: 1,
  simulatedGroupCount: 1,
  reviewGroupCount: 0,
  simulatedCandidateCount: 1,
  duplicateRecordCountBefore: 2,
  duplicateRecordCountAfter: 2,
  protectedMetadataRecordCountBefore: 1,
  protectedMetadataRecordCountAfter: 1,
  manualPayloadRecordCountBefore: 1,
  manualPayloadRecordCountAfter: 1,
  officialMetadataValueCountBefore: 2,
  officialMetadataValueCountAfter: 2,
  simulatedDerivedMismatchCountBefore: 4,
  simulatedDerivedMismatchCountAfter: 0,
  protectedMetadataLossCount: 0,
  selectedRecordCount: 0,
  recordDeletionCount: 0,
  recordMergeCount: 0,
  eligibleForFutureConservationPlan: true,
  eligibleForWrite: false,
  blockerProfiles: [],
  recommendationCodes: ['design-reversible-conservation-plan-next', 'keep-writes-disabled'],
  ...overrides,
});

const buildReport = (input: {
  projected?: AtomicCardShadowProjection;
  current?: PersistedAtomicCardProjection;
  currentComparison?: AtomicCardProjectionComparison;
  dryRun?: AtomicCardStatementConservationDryRunReport;
  revision?: string | null;
} = {}) =>
  buildAtomicCardStatementConservationPlanReport({
    shadow: input.projected || shadow(),
    persisted: input.current || persisted(),
    comparison: input.currentComparison || comparison(),
    conservationDryRun: input.dryRun || conservationDryRun(),
    persistedRevision:
      input.revision === undefined ? privateRevision : input.revision,
  });

describe('buildAtomicCardStatementConservationPlanReport', () => {
  it('desenha a substituição reversível sem escolher uma linha vencedora', () => {
    const report = buildReport();

    expect(report).toMatchObject({
      status: 'plan-ready',
      privacy: 'aggregated-no-identifiers',
      nonAuthoritative: true,
      executable: false,
      mutationPayloadIncluded: false,
      actualWriteOperationCount: 0,
      duplicateGroupCount: 1,
      locatedGroupCount: 1,
      sourceStatementRecordCount: 2,
      plannedCompositeStatementCount: 1,
      plannedStatementReplacementCount: 2,
      plannedDuplicateExcessResolutionCount: 1,
      expectedStatementRecordCountAfter: 2,
      affectedEntryLinkCount: 2,
      affectedPaymentLinkCount: 1,
      snapshotStatementRecordCount: 2,
      snapshotEntryLinkCount: 2,
      snapshotPaymentLinkCount: 1,
      rollbackRemoveCompositeCount: 1,
      rollbackRestoreStatementRecordCount: 2,
      rollbackRestoreEntryLinkCount: 2,
      rollbackRestorePaymentLinkCount: 1,
      protectedMetadataGroupCount: 1,
      protectedMetadataLossCount: 0,
      plannedFinancialValueChangeCount: 0,
      plannedTransactionRecordChangeCount: 0,
      requiredGuardCount: 6,
      designedGuardCount: 6,
      executableGuardCount: 0,
      revisionGuardBound: true,
      rollbackCardinalityBalanced: true,
      eligibleForFutureTransactionalImplementation: true,
      eligibleForWrite: false,
    });
    expect(report.blockerProfiles).toEqual([]);
    expect(report.recommendationCodes).toContain(
      'create-new-composite-without-winner-selection'
    );
    expect(report.recommendationCodes).toContain('keep-writes-disabled');
  });

  it('falha fechado quando a revisão persistida não está vinculada', () => {
    const report = buildReport({ revision: null });

    expect(report.status).toBe('blocked');
    expect(report.revisionGuardBound).toBe(false);
    expect(report.plannedCompositeStatementCount).toBe(0);
    expect(report.snapshotStatementRecordCount).toBe(0);
    expect(report.blockerProfiles).toContainEqual({
      code: 'persisted-revision-missing',
      groupCount: 1,
    });
  });

  it('bloqueia quando o relatório 2M pertence a outra sombra', () => {
    const report = buildReport({
      dryRun: conservationDryRun({ checksum: 'different-private-checksum' }),
    });

    expect(report.status).toBe('blocked');
    expect(report.eligibleForFutureTransactionalImplementation).toBe(false);
    expect(report.blockerProfiles).toContainEqual({
      code: 'upstream-report-mismatch',
      groupCount: 1,
    });
  });

  it('mantém revisão obrigatória quando a simulação 2M não foi concluída', () => {
    const report = buildReport({
      dryRun: conservationDryRun({
        status: 'review-needed',
        eligibleForFutureConservationPlan: false,
        reviewGroupCount: 1,
        simulatedGroupCount: 0,
      }),
    });

    expect(report.status).toBe('review-needed');
    expect(report.designedGuardCount).toBe(0);
    expect(report.blockerProfiles).toContainEqual({
      code: 'conservation-simulation-not-complete',
      groupCount: 1,
    });
    expect(report.blockerProfiles).toContainEqual({
      code: 'conservation-plan-not-eligible',
      groupCount: 1,
    });
  });

  it('encerra sem plano quando não há faturas duplicadas', () => {
    const emptyShadow = { ...shadow(), statements: [], entries: [], payments: [] };
    const emptyPersisted: PersistedAtomicCardProjection = {
      source: 'engine',
      statements: [],
      entries: [],
      payments: [],
    };
    const report = buildReport({
      projected: emptyShadow,
      current: emptyPersisted,
      currentComparison: comparison({
        duplicatePersistedStatementKeys: [],
        protectedMetadataStatementKeys: [],
      }),
      dryRun: conservationDryRun({
        status: 'no-duplicates',
        duplicateGroupCount: 0,
        locatedGroupCount: 0,
        duplicateRecordCountBefore: 0,
        duplicateRecordCountAfter: 0,
        protectedMetadataRecordCountBefore: 0,
        protectedMetadataRecordCountAfter: 0,
        manualPayloadRecordCountBefore: 0,
        manualPayloadRecordCountAfter: 0,
        officialMetadataValueCountBefore: 0,
        officialMetadataValueCountAfter: 0,
        simulatedDerivedMismatchCountBefore: 0,
        eligibleForFutureConservationPlan: false,
      }),
      revision: null,
    });

    expect(report.status).toBe('no-duplicates');
    expect(report.blockerProfiles).toEqual([]);
    expect(report.recommendationCodes).toEqual(['keep-writes-disabled']);
    expect(report.eligibleForWrite).toBe(false);
  });

  it('é determinístico e não expõe chaves, revisões, origens, IDs ou valores', () => {
    const projected = shadow();
    const current = persisted();
    const currentComparison = comparison();
    const dryRun = conservationDryRun();
    const before = JSON.stringify({ projected, current, currentComparison, dryRun });

    const first = buildReport({ projected, current, currentComparison, dryRun });
    const second = buildReport({ projected, current, currentComparison, dryRun });

    expect(second).toEqual(first);
    expect(JSON.stringify({ projected, current, currentComparison, dryRun })).toBe(before);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain(privateStatementKey);
    expect(serialized).not.toContain(privateRevision);
    expect(serialized).not.toContain('private-source.csv');
    expect(serialized).not.toContain('private-transaction');
    expect(serialized).not.toContain('private-entry-row');
    expect(serialized).not.toContain('44990');
    expect(serialized).not.toContain('39990');
  });
});
