import type { AtomicCardAffectedEntryReconciliationReport } from './atomicRebuildAffectedEntryReconciliation';
import type { AtomicCardStatementConflictForensicReport } from './atomicRebuildStatementConflictForensics';
import type {
  AtomicCardProjectionComparison,
  AtomicCardShadowProjection,
  AtomicCardShadowStatement,
  PersistedAtomicCardProjection,
  PersistedAtomicCardStatement,
} from './atomicRebuildShadow';

export type AtomicCardStatementConservationDryRunStatus =
  | 'no-duplicates'
  | 'simulation-complete'
  | 'review-needed'
  | 'blocked';

export type AtomicCardStatementConservationBlockerCode =
  | 'upstream-report-mismatch'
  | 'count-reconciliation-blocked'
  | 'unclassified-duplicate-group'
  | 'missing-shadow-statement'
  | 'multiple-manual-payloads'
  | 'conflicting-official-statement-totals'
  | 'conflicting-official-payment-totals'
  | 'unknown-protected-metadata';

export type AtomicCardStatementConservationRecommendationCode =
  | 'derive-operational-fields-from-shadow'
  | 'preserve-protected-metadata-without-row-selection'
  | 'keep-all-duplicate-records-unchanged'
  | 'review-ambiguous-protected-metadata'
  | 'review-missing-shadow-statements'
  | 'investigate-upstream-prerequisites'
  | 'design-reversible-conservation-plan-next'
  | 'keep-writes-disabled';

export interface AtomicCardStatementConservationBlockerProfile {
  code: AtomicCardStatementConservationBlockerCode;
  groupCount: number;
}

export interface AtomicCardStatementConservationDryRunReport {
  version: 1;
  privacy: 'aggregated-no-identifiers';
  nonAuthoritative: true;
  executable: false;
  mutationPayloadIncluded: false;
  actualWriteOperationCount: 0;
  checksum: string;
  status: AtomicCardStatementConservationDryRunStatus;
  duplicateGroupCount: number;
  locatedGroupCount: number;
  simulatedGroupCount: number;
  reviewGroupCount: number;
  simulatedCandidateCount: number;
  duplicateRecordCountBefore: number;
  duplicateRecordCountAfter: number;
  protectedMetadataRecordCountBefore: number;
  protectedMetadataRecordCountAfter: number;
  manualPayloadRecordCountBefore: number;
  manualPayloadRecordCountAfter: number;
  officialMetadataValueCountBefore: number;
  officialMetadataValueCountAfter: number;
  simulatedDerivedMismatchCountBefore: number;
  simulatedDerivedMismatchCountAfter: number;
  protectedMetadataLossCount: 0;
  selectedRecordCount: 0;
  recordDeletionCount: 0;
  recordMergeCount: 0;
  eligibleForFutureConservationPlan: boolean;
  eligibleForWrite: false;
  blockerProfiles: AtomicCardStatementConservationBlockerProfile[];
  recommendationCodes: AtomicCardStatementConservationRecommendationCode[];
}

const BLOCKER_ORDER: AtomicCardStatementConservationBlockerCode[] = [
  'upstream-report-mismatch',
  'count-reconciliation-blocked',
  'unclassified-duplicate-group',
  'missing-shadow-statement',
  'multiple-manual-payloads',
  'conflicting-official-statement-totals',
  'conflicting-official-payment-totals',
  'unknown-protected-metadata',
];

const distinctNonNullValues = (
  values: Array<number | null | undefined>
): number[] => Array.from(new Set(values.filter((value): value is number => value != null)));

const hasProtectedMetadataEvidence = (
  statement: PersistedAtomicCardStatement
): boolean =>
  Boolean(statement.hasProtectedMetadata) ||
  Boolean(statement.manualTotalsPresent) ||
  statement.statementTotalFromFileCents != null ||
  statement.totalPaymentsFromFileCents != null;

const derivedMismatchCount = (
  statement: PersistedAtomicCardStatement,
  shadow: AtomicCardShadowStatement
): number => [
  statement.dueDate === shadow.dueDate,
  statement.entryCount === shadow.entryCount,
  statement.statementTotalCents === shadow.statementTotalCents,
  statement.totalPaymentsCents === shadow.totalPaymentsCents,
  statement.openBalanceCents === shadow.openBalanceCents,
].filter((matches) => !matches).length;

interface EphemeralStatementCandidate {
  dueDate: string;
  entryCount: number;
  statementTotalCents: number;
  totalPaymentsCents: number;
  openBalanceCents: number;
  hasProtectedMetadata: boolean;
  manualTotalsPresent: boolean;
  statementTotalFromFileCents: number | null;
  totalPaymentsFromFileCents: number | null;
}

/**
 * Simulates a composite statement exclusively in memory.
 *
 * Operational fields come from the shadow projection. Protected metadata is
 * accounted for from the complete duplicate group without selecting a source
 * row. The public result contains aggregate counters only; it never exposes
 * the candidate, statement keys, financial values or an executable mutation.
 */
export function buildAtomicCardStatementConservationDryRunReport(input: {
  shadow: AtomicCardShadowProjection;
  persisted: PersistedAtomicCardProjection;
  comparison: AtomicCardProjectionComparison;
  conflictForensics: AtomicCardStatementConflictForensicReport;
  affectedEntryReconciliation: AtomicCardAffectedEntryReconciliationReport;
}): AtomicCardStatementConservationDryRunReport {
  const {
    shadow,
    persisted,
    comparison,
    conflictForensics,
    affectedEntryReconciliation,
  } = input;
  const duplicateKeys = new Set(comparison.duplicatePersistedStatementKeys);
  const protectedKeys = new Set(comparison.protectedMetadataStatementKeys);
  const groups = new Map<string, PersistedAtomicCardStatement[]>();
  persisted.statements.forEach((statement) => {
    if (!duplicateKeys.has(statement.statementKey)) return;
    const group = groups.get(statement.statementKey) || [];
    group.push(statement);
    groups.set(statement.statementKey, group);
  });

  const locatedGroups = Array.from(groups.entries()).filter(([, group]) => group.length > 1);
  const shadowByKey = new Map(shadow.statements.map((statement) => [statement.statementKey, statement]));
  const blockerCounts = new Map<AtomicCardStatementConservationBlockerCode, number>();
  const addBlocker = (
    code: AtomicCardStatementConservationBlockerCode,
    count = 1
  ): void => {
    blockerCounts.set(code, (blockerCounts.get(code) || 0) + count);
  };

  const duplicateGroupCount = duplicateKeys.size;
  const locatedGroupCount = locatedGroups.length;
  const upstreamReportsMatch =
    conflictForensics.checksum === shadow.checksum &&
    affectedEntryReconciliation.checksum === shadow.checksum &&
    conflictForensics.duplicateGroupCount === duplicateGroupCount &&
    affectedEntryReconciliation.duplicateGroupCount === duplicateGroupCount &&
    conflictForensics.locatedGroupCount === locatedGroupCount;

  if (!upstreamReportsMatch) addBlocker('upstream-report-mismatch');
  if (!affectedEntryReconciliation.eligibleForConflictForensics) {
    addBlocker('count-reconciliation-blocked');
  }
  if (conflictForensics.unclassifiedGroupCount > 0) {
    addBlocker('unclassified-duplicate-group', conflictForensics.unclassifiedGroupCount);
  }
  const globalPrerequisitesBlocked =
    !upstreamReportsMatch ||
    !affectedEntryReconciliation.eligibleForConflictForensics ||
    conflictForensics.status === 'blocked' ||
    conflictForensics.unclassifiedGroupCount > 0;

  const duplicateRecords = locatedGroups.flatMap(([, group]) => group);
  const duplicateRecordCountBefore = duplicateRecords.length;
  const protectedMetadataRecordCountBefore = duplicateRecords.filter(
    hasProtectedMetadataEvidence
  ).length;
  const manualPayloadRecordCountBefore = duplicateRecords.filter(
    (statement) => Boolean(statement.manualTotalsPresent)
  ).length;
  const officialMetadataValueCountBefore = duplicateRecords.reduce(
    (count, statement) =>
      count +
      Number(statement.statementTotalFromFileCents != null) +
      Number(statement.totalPaymentsFromFileCents != null),
    0
  );

  let simulatedGroupCount = 0;
  let reviewGroupCount = 0;
  let simulatedDerivedMismatchCountBefore = 0;
  let simulatedDerivedMismatchCountAfter = 0;

  locatedGroups.forEach(([statementKey, group]) => {
    if (globalPrerequisitesBlocked) {
      reviewGroupCount += 1;
      return;
    }
    const expected = shadowByKey.get(statementKey);
    const manualPayloadCount = group.filter((statement) => statement.manualTotalsPresent).length;
    const officialStatementValues = distinctNonNullValues(
      group.map((statement) => statement.statementTotalFromFileCents)
    );
    const officialPaymentValues = distinctNonNullValues(
      group.map((statement) => statement.totalPaymentsFromFileCents)
    );
    const unknownProtectedMetadataCount = group.filter(
      (statement) =>
        Boolean(statement.hasProtectedMetadata) &&
        !statement.manualTotalsPresent &&
        statement.statementTotalFromFileCents == null &&
        statement.totalPaymentsFromFileCents == null
    ).length;
    const protectedMetadataSourceUnresolved =
      protectedKeys.has(statementKey) && !group.some(hasProtectedMetadataEvidence);
    let groupNeedsReview = false;

    if (!expected) {
      addBlocker('missing-shadow-statement');
      groupNeedsReview = true;
    }
    if (manualPayloadCount > 1) {
      addBlocker('multiple-manual-payloads');
      groupNeedsReview = true;
    }
    if (officialStatementValues.length > 1) {
      addBlocker('conflicting-official-statement-totals');
      groupNeedsReview = true;
    }
    if (officialPaymentValues.length > 1) {
      addBlocker('conflicting-official-payment-totals');
      groupNeedsReview = true;
    }
    if (unknownProtectedMetadataCount > 0 || protectedMetadataSourceUnresolved) {
      addBlocker('unknown-protected-metadata');
      groupNeedsReview = true;
    }

    if (groupNeedsReview || !expected) {
      reviewGroupCount += 1;
      return;
    }

    simulatedDerivedMismatchCountBefore += group.reduce(
      (count, statement) => count + derivedMismatchCount(statement, expected),
      0
    );

    const candidate: EphemeralStatementCandidate = {
      dueDate: expected.dueDate,
      entryCount: expected.entryCount,
      statementTotalCents: expected.statementTotalCents,
      totalPaymentsCents: expected.totalPaymentsCents,
      openBalanceCents: expected.openBalanceCents,
      hasProtectedMetadata: group.some(hasProtectedMetadataEvidence),
      manualTotalsPresent: manualPayloadCount === 1,
      statementTotalFromFileCents: officialStatementValues[0] ?? null,
      totalPaymentsFromFileCents: officialPaymentValues[0] ?? null,
    };

    simulatedDerivedMismatchCountAfter += [
      candidate.dueDate === expected.dueDate,
      candidate.entryCount === expected.entryCount,
      candidate.statementTotalCents === expected.statementTotalCents,
      candidate.totalPaymentsCents === expected.totalPaymentsCents,
      candidate.openBalanceCents === expected.openBalanceCents,
    ].filter((matches) => !matches).length;
    simulatedGroupCount += 1;
  });

  const allGroupsSimulated =
    duplicateGroupCount > 0 &&
    locatedGroupCount === duplicateGroupCount &&
    simulatedGroupCount === duplicateGroupCount &&
    reviewGroupCount === 0;

  let status: AtomicCardStatementConservationDryRunStatus;
  if (duplicateGroupCount === 0 && conflictForensics.status === 'no-duplicates') {
    status = 'no-duplicates';
  } else if (globalPrerequisitesBlocked) {
    status = 'blocked';
  } else if (!allGroupsSimulated) {
    status = 'review-needed';
  } else {
    status = 'simulation-complete';
  }

  const eligibleForFutureConservationPlan =
    status === 'simulation-complete' && simulatedDerivedMismatchCountAfter === 0;
  const recommendationCodes: AtomicCardStatementConservationRecommendationCode[] = [];
  if (duplicateGroupCount > 0) {
    recommendationCodes.push('derive-operational-fields-from-shadow');
    recommendationCodes.push('preserve-protected-metadata-without-row-selection');
    recommendationCodes.push('keep-all-duplicate-records-unchanged');
  }
  if (
    blockerCounts.has('multiple-manual-payloads') ||
    blockerCounts.has('conflicting-official-statement-totals') ||
    blockerCounts.has('conflicting-official-payment-totals') ||
    blockerCounts.has('unknown-protected-metadata')
  ) {
    recommendationCodes.push('review-ambiguous-protected-metadata');
  }
  if (blockerCounts.has('missing-shadow-statement')) {
    recommendationCodes.push('review-missing-shadow-statements');
  }
  if (globalPrerequisitesBlocked) {
    recommendationCodes.push('investigate-upstream-prerequisites');
  }
  if (eligibleForFutureConservationPlan) {
    recommendationCodes.push('design-reversible-conservation-plan-next');
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
    simulatedGroupCount,
    reviewGroupCount,
    simulatedCandidateCount: simulatedGroupCount,
    duplicateRecordCountBefore,
    duplicateRecordCountAfter: duplicateRecordCountBefore,
    protectedMetadataRecordCountBefore,
    protectedMetadataRecordCountAfter: protectedMetadataRecordCountBefore,
    manualPayloadRecordCountBefore,
    manualPayloadRecordCountAfter: manualPayloadRecordCountBefore,
    officialMetadataValueCountBefore,
    officialMetadataValueCountAfter: officialMetadataValueCountBefore,
    simulatedDerivedMismatchCountBefore,
    simulatedDerivedMismatchCountAfter,
    protectedMetadataLossCount: 0,
    selectedRecordCount: 0,
    recordDeletionCount: 0,
    recordMergeCount: 0,
    eligibleForFutureConservationPlan,
    eligibleForWrite: false,
    blockerProfiles,
    recommendationCodes,
  };
}
