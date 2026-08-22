import { describe, expect, it } from 'vitest';
import {
  prepareAtomicCardStatementConservationExecution,
} from '../../src/domain/credit-card/atomicRebuildStatementConservationExecution';
import type { AtomicCardStatementConservationPlanReport } from '../../src/domain/credit-card/atomicRebuildStatementConservationPlan';
import type {
  AtomicCardProjectionComparison,
  AtomicCardShadowProjection,
  PersistedAtomicCardProjection,
} from '../../src/domain/credit-card/atomicRebuildShadow';

const statementKey = '2026-08';
const checksum = 'shadow-v1-05712d54';
const revision = 'a'.repeat(32);

const shadow = (): AtomicCardShadowProjection => ({
  version: 1,
  accountId: 'private-account',
  sourceCycleCount: 1,
  sourceTransactionCount: 3,
  projectedEntryCount: 2,
  projectedPaymentCount: 1,
  statements: [{
    statementKey,
    purchaseReferenceMonth: statementKey,
    dueDate: '2026-08-28',
    dueYear: 2026,
    dueMonth: 8,
    status: 'paid',
    sourceFiles: ['private.csv'],
    entryCount: 2,
    totalPurchasesCents: 44_990,
    totalFeesCents: 0,
    totalInterestCents: 0,
    totalRefundsCents: 0,
    statementTotalCents: 44_990,
    totalPaymentsCents: 39_990,
    openBalanceCents: 5_000,
  }],
  entries: [0, 1].map((index) => ({
    transactionId: `private-transaction-${index}`,
    sourceFileName: 'private.csv',
    sourceRowHash: `private-hash-${index}`,
    statementKey,
    postedDate: '2026-08-10',
    amountCents: -22_495,
    entryType: 'purchase',
  })),
  payments: [{
    transactionId: 'private-payment',
    sourceFileName: 'private.csv',
    sourceRowHash: 'private-payment-hash',
    statementKey,
    paymentDate: '2026-08-20',
    amountCents: 39_990,
    source: 'imported_statement',
  }],
  issues: [],
  blockers: [],
  warnings: [],
  safeToStage: false,
  checksum,
});

const persisted = (): PersistedAtomicCardProjection => ({
  source: 'engine',
  statements: [
    {
      rowId: 'private-statement-a',
      cardId: 'private-card',
      referenceLabel: 'legacy-a',
      statementKey,
      dueDate: '2026-08-28',
      entryCount: 2,
      statementTotalCents: 44_990,
      totalPaymentsCents: 39_990,
      openBalanceCents: 5_000,
      hasProtectedMetadata: true,
      manualTotalsPresent: true,
      manualTotalsJson: { use_manual: true, statement_total: 449.9 },
      statementTotalFromFileCents: 44_990,
      totalPaymentsFromFileCents: 39_990,
      linesComputedTotalCents: 44_990,
    },
    {
      rowId: 'private-statement-b',
      cardId: 'private-card',
      referenceLabel: 'legacy-b',
      statementKey,
      dueDate: '2026-08-28',
      entryCount: 0,
      statementTotalCents: 44_990,
      totalPaymentsCents: 0,
      openBalanceCents: 44_990,
    },
  ],
  entries: [0, 1].map((index) => ({
    rowId: `private-entry-${index}`,
    transactionId: `private-transaction-${index}`,
    statementKey,
    postedDate: '2026-08-10',
    amountCents: -22_495,
    entryType: 'purchase',
  })),
  payments: [{
    rowId: 'private-payment-row',
    transactionId: 'private-payment',
    statementKey,
    paymentDate: '2026-08-20',
    amountCents: 39_990,
    source: 'imported_statement',
  }],
});

const comparison = (
  overrides: Partial<AtomicCardProjectionComparison> = {}
): AtomicCardProjectionComparison => ({
  status: 'different',
  safeToActivate: false,
  duplicatePersistedTransactionIds: [],
  repairablePersistedEntryRowIds: [],
  conflictingDuplicatePersistedTransactionIds: [],
  duplicatePersistedStatementKeys: [statementKey],
  duplicatePersistedPaymentTransactionIds: [],
  suspiciousPersistedPaymentEventKeys: [],
  repairablePersistedPaymentRowIds: [],
  protectedMetadataStatementKeys: [statementKey],
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

const plan = (
  overrides: Partial<AtomicCardStatementConservationPlanReport> = {}
): AtomicCardStatementConservationPlanReport => ({
  version: 1,
  privacy: 'aggregated-no-identifiers',
  nonAuthoritative: true,
  executable: false,
  mutationPayloadIncluded: false,
  actualWriteOperationCount: 0,
  checksum,
  status: 'plan-ready',
  duplicateGroupCount: 1,
  locatedGroupCount: 1,
  sourceStatementRecordCount: 2,
  plannedCompositeStatementCount: 1,
  plannedStatementReplacementCount: 2,
  plannedDuplicateExcessResolutionCount: 1,
  expectedStatementRecordCountAfter: 1,
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
  blockerProfiles: [],
  recommendationCodes: ['implement-transactional-rpc-in-later-sprint', 'keep-writes-disabled'],
  ...overrides,
});

const prepare = (overrides: {
  projected?: AtomicCardShadowProjection;
  current?: PersistedAtomicCardProjection;
  currentComparison?: AtomicCardProjectionComparison;
  currentPlan?: AtomicCardStatementConservationPlanReport;
  currentRevision?: string | null;
} = {}) => prepareAtomicCardStatementConservationExecution({
  shadow: overrides.projected || shadow(),
  persisted: overrides.current || persisted(),
  comparison: overrides.currentComparison || comparison(),
  conservationPlan: overrides.currentPlan || plan(),
  persistedRevision:
    overrides.currentRevision === undefined ? revision : overrides.currentRevision,
});

describe('prepareAtomicCardStatementConservationExecution', () => {
  it('prepara um único contrato privado e mantém o relatório público agregado', () => {
    const preparation = prepare();

    expect(preparation.report).toMatchObject({
      status: 'contract-ready',
      preparedGroupCount: 1,
      sourceStatementCount: 2,
      expectedEntryLinkCount: 2,
      expectedPaymentLinkCount: 1,
      preparedDatabaseGuardCount: 10,
      snapshotIncludesLegacyItemLinks: true,
      rollbackRequiresAfterRevision: true,
      dedicatedFeatureFlagRequired: true,
      eligibleForStagingMigrationValidation: true,
      eligibleForWrite: false,
      actualWriteOperationCount: 0,
    });
    expect(preparation.request).toEqual({
      accountId: 'private-account',
      expectedRevision: revision,
      shadowChecksum: checksum,
      statementKey,
      sourceStatementIds: ['private-statement-a', 'private-statement-b'],
      expectedEntryLinkCount: 2,
      expectedPaymentLinkCount: 1,
      composite: expect.objectContaining({
        statementKey,
        dueDate: '2026-08-28',
        statementTotalCents: 44_990,
        totalPaymentsCents: 39_990,
        manualTotalsJson: { use_manual: true, statement_total: 449.9 },
        statementTotalFromFileCents: 44_990,
        totalPaymentsFromFileCents: 39_990,
        linesComputedTotalCents: 44_990,
      }),
    });

    const serializedReport = JSON.stringify(preparation.report);
    expect(serializedReport).not.toContain('private-');
    expect(serializedReport).not.toContain(statementKey);
    expect(serializedReport).not.toContain('44990');
  });

  it('falha fechado quando revisão ou checksum não têm o formato esperado', () => {
    const preparation = prepare({
      projected: { ...shadow(), checksum: 'invalid-checksum' },
      currentPlan: plan({ checksum: 'invalid-checksum' }),
      currentRevision: 'stale',
    });

    expect(preparation.request).toBeNull();
    expect(preparation.report.status).toBe('blocked');
    expect(preparation.report.blockerCodes).toContain('invalid-persisted-revision');
    expect(preparation.report.blockerCodes).toContain('invalid-shadow-checksum');
  });

  it('não escolhe uma linha vencedora quando falta identidade física', () => {
    const current = persisted();
    current.statements[1] = { ...current.statements[1], rowId: undefined };

    const preparation = prepare({ current });

    expect(preparation.request).toBeNull();
    expect(preparation.report.blockerCodes).toContain('missing-source-identities');
  });

  it('bloqueia metadados oficiais conflitantes sem alterar a entrada', () => {
    const current = persisted();
    current.statements[1] = {
      ...current.statements[1],
      statementTotalFromFileCents: 45_000,
    };
    const before = JSON.stringify(current);

    const preparation = prepare({ current });

    expect(preparation.request).toBeNull();
    expect(preparation.report.blockerCodes).toContain(
      'conflicting-official-statement-totals'
    );
    expect(JSON.stringify(current)).toBe(before);
  });

  it('exige auditorias separadas quando há mais de uma competência duplicada', () => {
    const secondKey = '2026-09';
    const current = persisted();
    current.statements.push(
      { ...current.statements[0], rowId: 'private-statement-c', statementKey: secondKey },
      { ...current.statements[1], rowId: 'private-statement-d', statementKey: secondKey }
    );
    const projected = shadow();
    projected.statements.push({
      ...projected.statements[0],
      statementKey: secondKey,
      purchaseReferenceMonth: secondKey,
      dueDate: '2026-09-28',
      dueMonth: 9,
    });

    const preparation = prepare({
      projected,
      current,
      currentComparison: comparison({
        duplicatePersistedStatementKeys: [statementKey, secondKey],
      }),
      currentPlan: plan({
        checksum: projected.checksum,
        duplicateGroupCount: 2,
        locatedGroupCount: 2,
        sourceStatementRecordCount: 4,
      }),
    });

    expect(preparation.request).toBeNull();
    expect(preparation.report.blockerCodes).toContain(
      'multiple-groups-require-separate-audits'
    );
  });

  it('encerra sem payload quando não existem duplicidades', () => {
    const preparation = prepare({
      projected: { ...shadow(), statements: [], entries: [], payments: [] },
      current: { source: 'engine', statements: [], entries: [], payments: [] },
      currentComparison: comparison({ duplicatePersistedStatementKeys: [] }),
      currentPlan: plan({
        status: 'no-duplicates',
        duplicateGroupCount: 0,
        locatedGroupCount: 0,
        sourceStatementRecordCount: 0,
        eligibleForFutureTransactionalImplementation: false,
      }),
    });

    expect(preparation.report.status).toBe('no-duplicates');
    expect(preparation.request).toBeNull();
    expect(preparation.report.eligibleForWrite).toBe(false);
  });
});
