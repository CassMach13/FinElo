import type { AtomicCardStatementConservationDryRunReport } from './atomicRebuildStatementConservationDryRun';
import type {
  AtomicCardProjectionComparison,
  AtomicCardShadowProjection,
  PersistedAtomicCardProjection,
  PersistedAtomicCardStatement,
} from './atomicRebuildShadow';

export type AtomicCardStatementConservationPlanStatus =
  | 'no-duplicates'
  | 'plan-ready'
  | 'review-needed'
  | 'blocked';

export type AtomicCardStatementConservationPlanBlockerCode =
  | 'upstream-report-mismatch'
  | 'conservation-simulation-not-complete'
  | 'conservation-plan-not-eligible'
  | 'persisted-revision-missing'
  | 'duplicate-group-cardinality-mismatch'
  | 'missing-shadow-statement'
  | 'protected-metadata-conservation-failed'
  | 'derived-mismatch-remains'
  | 'invalid-replacement-cardinality';

export type AtomicCardStatementConservationPlanRecommendationCode =
  | 'snapshot-complete-duplicate-groups'
  | 'create-new-composite-without-winner-selection'
  | 'relink-entries-and-payments-atomically'
  | 'verify-projection-revision-and-checksum'
  | 'verify-counts-and-metadata-before-commit'
  | 'rollback-only-if-after-revision-matches'
  | 'review-upstream-conservation-evidence'
  | 'implement-transactional-rpc-in-later-sprint'
  | 'keep-writes-disabled';

export interface AtomicCardStatementConservationPlanBlockerProfile {
  code: AtomicCardStatementConservationPlanBlockerCode;
  groupCount: number;
}

export interface AtomicCardStatementConservationPlanReport {
  version: 1;
  privacy: 'aggregated-no-identifiers';
  nonAuthoritative: true;
  executable: false;
  mutationPayloadIncluded: false;
  actualWriteOperationCount: 0;
  checksum: string;
  status: AtomicCardStatementConservationPlanStatus;
  duplicateGroupCount: number;
  locatedGroupCount: number;
  sourceStatementRecordCount: number;
  plannedCompositeStatementCount: number;
  plannedStatementReplacementCount: number;
  plannedDuplicateExcessResolutionCount: number;
  expectedStatementRecordCountAfter: number;
  affectedEntryLinkCount: number;
  affectedPaymentLinkCount: number;
  snapshotStatementRecordCount: number;
  snapshotEntryLinkCount: number;
  snapshotPaymentLinkCount: number;
  rollbackRemoveCompositeCount: number;
  rollbackRestoreStatementRecordCount: number;
  rollbackRestoreEntryLinkCount: number;
  rollbackRestorePaymentLinkCount: number;
  protectedMetadataGroupCount: number;
  protectedMetadataLossCount: number;
  plannedFinancialValueChangeCount: 0;
  plannedTransactionRecordChangeCount: 0;
  requiredGuardCount: 6;
  designedGuardCount: number;
  executableGuardCount: 0;
  revisionGuardBound: boolean;
  rollbackCardinalityBalanced: boolean;
  eligibleForFutureTransactionalImplementation: boolean;
  eligibleForWrite: false;
  blockerProfiles: AtomicCardStatementConservationPlanBlockerProfile[];
  recommendationCodes: AtomicCardStatementConservationPlanRecommendationCode[];
}

const BLOCKER_ORDER: AtomicCardStatementConservationPlanBlockerCode[] = [
  'upstream-report-mismatch',
  'conservation-simulation-not-complete',
  'conservation-plan-not-eligible',
  'persisted-revision-missing',
  'duplicate-group-cardinality-mismatch',
  'missing-shadow-statement',
  'protected-metadata-conservation-failed',
  'derived-mismatch-remains',
  'invalid-replacement-cardinality',
];

const hasProtectedMetadataEvidence = (
  statement: PersistedAtomicCardStatement
): boolean =>
  Boolean(statement.hasProtectedMetadata) ||
  Boolean(statement.manualTotalsPresent) ||
  statement.statementTotalFromFileCents != null ||
  statement.totalPaymentsFromFileCents != null;

/**
 * Designs a reversible statement-conservation operation without producing an
 * executable payload.
 *
 * The future operation is deliberately modelled as replacement by a new
 * composite statement. This avoids electing an arbitrary persisted row as a
 * winner. Every original statement and every affected link must be included
 * in the snapshot before a later transactional implementation may write.
 *
 * Only aggregate counters and classification codes leave this function. Row
 * identities, statement keys, revision contents and financial values remain
 * private inputs.
 */
export function buildAtomicCardStatementConservationPlanReport(input: {
  shadow: AtomicCardShadowProjection;
  persisted: PersistedAtomicCardProjection;
  comparison: AtomicCardProjectionComparison;
  conservationDryRun: AtomicCardStatementConservationDryRunReport;
  persistedRevision: string | null | undefined;
}): AtomicCardStatementConservationPlanReport {
  const { shadow, persisted, comparison, conservationDryRun, persistedRevision } = input;
  const duplicateKeys = new Set(comparison.duplicatePersistedStatementKeys);
  const protectedKeys = new Set(comparison.protectedMetadataStatementKeys);
  const statementGroups = new Map<string, PersistedAtomicCardStatement[]>();

  persisted.statements.forEach((statement) => {
    if (!duplicateKeys.has(statement.statementKey)) return;
    const group = statementGroups.get(statement.statementKey) || [];
    group.push(statement);
    statementGroups.set(statement.statementKey, group);
  });

  const locatedGroups = Array.from(statementGroups.entries()).filter(
    ([, group]) => group.length > 1
  );
  const sourceStatements = locatedGroups.flatMap(([, group]) => group);
  const shadowKeys = new Set(shadow.statements.map((statement) => statement.statementKey));
  const blockerCounts = new Map<AtomicCardStatementConservationPlanBlockerCode, number>();
  const addBlocker = (
    code: AtomicCardStatementConservationPlanBlockerCode,
    count = 1
  ): void => {
    blockerCounts.set(code, (blockerCounts.get(code) || 0) + count);
  };

  const duplicateGroupCount = duplicateKeys.size;
  const locatedGroupCount = locatedGroups.length;
  const sourceStatementRecordCount = sourceStatements.length;
  const revisionGuardBound = Boolean(persistedRevision?.trim());
  const upstreamReportsMatch =
    conservationDryRun.checksum === shadow.checksum &&
    conservationDryRun.duplicateGroupCount === duplicateGroupCount &&
    conservationDryRun.locatedGroupCount === locatedGroupCount &&
    conservationDryRun.duplicateRecordCountBefore === sourceStatementRecordCount;

  if (!upstreamReportsMatch) addBlocker('upstream-report-mismatch');
  if (duplicateGroupCount > 0 && conservationDryRun.status !== 'simulation-complete') {
    addBlocker('conservation-simulation-not-complete');
  }
  if (duplicateGroupCount > 0 && !conservationDryRun.eligibleForFutureConservationPlan) {
    addBlocker('conservation-plan-not-eligible');
  }
  if (duplicateGroupCount > 0 && !revisionGuardBound) {
    addBlocker('persisted-revision-missing');
  }
  if (locatedGroupCount !== duplicateGroupCount) {
    addBlocker(
      'duplicate-group-cardinality-mismatch',
      Math.max(1, Math.abs(duplicateGroupCount - locatedGroupCount))
    );
  }

  const missingShadowStatementCount = locatedGroups.filter(
    ([statementKey]) => !shadowKeys.has(statementKey)
  ).length;
  if (missingShadowStatementCount > 0) {
    addBlocker('missing-shadow-statement', missingShadowStatementCount);
  }

  const protectedMetadataConserved =
    conservationDryRun.protectedMetadataLossCount === 0 &&
    conservationDryRun.protectedMetadataRecordCountBefore ===
      conservationDryRun.protectedMetadataRecordCountAfter &&
    conservationDryRun.officialMetadataValueCountBefore ===
      conservationDryRun.officialMetadataValueCountAfter;
  if (duplicateGroupCount > 0 && !protectedMetadataConserved) {
    addBlocker('protected-metadata-conservation-failed');
  }
  if (conservationDryRun.simulatedDerivedMismatchCountAfter !== 0) {
    addBlocker('derived-mismatch-remains');
  }

  const plannedCompositeStatementCount = locatedGroupCount;
  const plannedDuplicateExcessResolutionCount = Math.max(
    0,
    sourceStatementRecordCount - plannedCompositeStatementCount
  );
  if (
    duplicateGroupCount > 0 &&
    (sourceStatementRecordCount <= plannedCompositeStatementCount ||
      plannedDuplicateExcessResolutionCount === 0)
  ) {
    addBlocker('invalid-replacement-cardinality');
  }

  const affectedEntryLinkCount = persisted.entries.filter((entry) =>
    duplicateKeys.has(entry.statementKey)
  ).length;
  const affectedPaymentLinkCount = persisted.payments.filter((payment) =>
    duplicateKeys.has(payment.statementKey)
  ).length;
  const protectedMetadataGroupCount = locatedGroups.filter(([statementKey, group]) =>
    protectedKeys.has(statementKey) || group.some(hasProtectedMetadataEvidence)
  ).length;

  let status: AtomicCardStatementConservationPlanStatus;
  if (duplicateGroupCount === 0 && conservationDryRun.status === 'no-duplicates') {
    status = 'no-duplicates';
  } else if (
    blockerCounts.has('upstream-report-mismatch') ||
    blockerCounts.has('persisted-revision-missing') ||
    blockerCounts.has('duplicate-group-cardinality-mismatch')
  ) {
    status = 'blocked';
  } else if (blockerCounts.size > 0) {
    status = 'review-needed';
  } else {
    status = 'plan-ready';
  }

  const eligibleForFutureTransactionalImplementation = status === 'plan-ready';
  const designedGuardCount = eligibleForFutureTransactionalImplementation ? 6 : 0;
  const expectedStatementRecordCountAfter = eligibleForFutureTransactionalImplementation
    ? persisted.statements.length - sourceStatementRecordCount + plannedCompositeStatementCount
    : persisted.statements.length;
  const rollbackCardinalityBalanced =
    !eligibleForFutureTransactionalImplementation ||
    expectedStatementRecordCountAfter - plannedCompositeStatementCount +
      sourceStatementRecordCount ===
      persisted.statements.length;

  const recommendationCodes: AtomicCardStatementConservationPlanRecommendationCode[] = [];
  if (duplicateGroupCount > 0) {
    recommendationCodes.push(
      'snapshot-complete-duplicate-groups',
      'create-new-composite-without-winner-selection',
      'relink-entries-and-payments-atomically',
      'verify-projection-revision-and-checksum',
      'verify-counts-and-metadata-before-commit',
      'rollback-only-if-after-revision-matches'
    );
  }
  if (!eligibleForFutureTransactionalImplementation && duplicateGroupCount > 0) {
    recommendationCodes.push('review-upstream-conservation-evidence');
  }
  if (eligibleForFutureTransactionalImplementation) {
    recommendationCodes.push('implement-transactional-rpc-in-later-sprint');
  }
  recommendationCodes.push('keep-writes-disabled');

  const blockerProfiles = BLOCKER_ORDER
    .map((code) => ({ code, groupCount: blockerCounts.get(code) || 0 }))
    .filter((profile) => profile.groupCount > 0);

  return {
    version: 1,
    privacy: 'aggregated-no-identifiers',
    nonAuthoritative: true,
    executable: false,
    mutationPayloadIncluded: false,
    actualWriteOperationCount: 0,
    checksum: shadow.checksum,
    status,
    duplicateGroupCount,
    locatedGroupCount,
    sourceStatementRecordCount,
    plannedCompositeStatementCount: eligibleForFutureTransactionalImplementation
      ? plannedCompositeStatementCount
      : 0,
    plannedStatementReplacementCount: eligibleForFutureTransactionalImplementation
      ? sourceStatementRecordCount
      : 0,
    plannedDuplicateExcessResolutionCount: eligibleForFutureTransactionalImplementation
      ? plannedDuplicateExcessResolutionCount
      : 0,
    expectedStatementRecordCountAfter,
    affectedEntryLinkCount,
    affectedPaymentLinkCount,
    snapshotStatementRecordCount: eligibleForFutureTransactionalImplementation
      ? sourceStatementRecordCount
      : 0,
    snapshotEntryLinkCount: eligibleForFutureTransactionalImplementation
      ? affectedEntryLinkCount
      : 0,
    snapshotPaymentLinkCount: eligibleForFutureTransactionalImplementation
      ? affectedPaymentLinkCount
      : 0,
    rollbackRemoveCompositeCount: eligibleForFutureTransactionalImplementation
      ? plannedCompositeStatementCount
      : 0,
    rollbackRestoreStatementRecordCount: eligibleForFutureTransactionalImplementation
      ? sourceStatementRecordCount
      : 0,
    rollbackRestoreEntryLinkCount: eligibleForFutureTransactionalImplementation
      ? affectedEntryLinkCount
      : 0,
    rollbackRestorePaymentLinkCount: eligibleForFutureTransactionalImplementation
      ? affectedPaymentLinkCount
      : 0,
    protectedMetadataGroupCount,
    protectedMetadataLossCount: conservationDryRun.protectedMetadataLossCount,
    plannedFinancialValueChangeCount: 0,
    plannedTransactionRecordChangeCount: 0,
    requiredGuardCount: 6,
    designedGuardCount,
    executableGuardCount: 0,
    revisionGuardBound,
    rollbackCardinalityBalanced,
    eligibleForFutureTransactionalImplementation,
    eligibleForWrite: false,
    blockerProfiles,
    recommendationCodes,
  };
}
