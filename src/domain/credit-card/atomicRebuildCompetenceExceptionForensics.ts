import type {
  AtomicCardCompetenceDryRunExclusionCode,
  AtomicCardCompetenceDryRunReport,
} from './atomicRebuildCompetenceDryRun';
import type { AtomicCardIdentityDryRunReport } from './atomicRebuildIdentityDryRun';
import type {
  AtomicCardProjectionComparison,
  PersistedAtomicCardProjection,
  PersistedAtomicCardStatement,
} from './atomicRebuildShadow';

export type AtomicCardCompetenceExceptionForensicStatus =
  | 'no-exceptions'
  | 'dependencies-isolated'
  | 'review-needed'
  | 'blocked';

export type AtomicCardCompetenceExceptionLaneCode =
  | 'identity-reconstruction-prerequisite'
  | 'duplicate-identity-anchor-prerequisite'
  | 'statement-structure-prerequisite'
  | 'entry-type-review'
  | 'persisted-row-identity-review'
  | 'competence-evidence-review';

export type AtomicCardCompetenceExceptionRecommendationCode =
  | 'preserve-all-current-rows'
  | 'run-identity-dry-run-before-competence'
  | 'preserve-confirmed-identity-anchors'
  | 'reconcile-statement-records-before-competence'
  | 'protect-statement-metadata'
  | 'review-type-coupled-exceptions'
  | 'restore-persisted-row-identity'
  | 'confirm-competence-evidence'
  | 'rerun-competence-dry-run-after-prerequisites'
  | 'investigate-unclassified-exceptions'
  | 'keep-writes-disabled';

export interface AtomicCardCompetenceExceptionLaneProfile {
  code: AtomicCardCompetenceExceptionLaneCode;
  order: number;
  count: number;
}

export interface AtomicCardCompetenceIdentityPrerequisiteSummary {
  status: 'not-needed' | 'covered-by-ready-dry-run' | 'partial' | 'blocked';
  exceptionCount: number;
  identityMismatchCount: number;
  duplicateIdentityAnchorCount: number;
  hypotheticalIdentityChangeCount: number;
  confirmedAnchorCount: number;
  unresolvedIdentityCount: number;
}

export interface AtomicCardCompetenceStatementPrerequisiteSummary {
  status: 'not-needed' | 'isolated' | 'review-needed' | 'blocked';
  affectedEntryCount: number;
  duplicateGroupCount: number;
  identicalGroupCount: number;
  conflictingGroupCount: number;
  protectedGroupCount: number;
}

export interface AtomicCardCompetenceExceptionForensicReport {
  version: 1;
  privacy: 'aggregated-no-identifiers';
  nonAuthoritative: true;
  executable: false;
  mutationPayloadIncluded: false;
  actualWriteOperationCount: 0;
  checksum: string;
  status: AtomicCardCompetenceExceptionForensicStatus;
  totalExceptionCount: number;
  classifiedExceptionCount: number;
  unclassifiedExceptionCount: number;
  classificationCountDelta: number;
  identityPrerequisite: AtomicCardCompetenceIdentityPrerequisiteSummary;
  statementPrerequisite: AtomicCardCompetenceStatementPrerequisiteSummary;
  otherReviewCount: number;
  protectedMetadataGroupCount: number;
  eligibleForFutureSequencedDryRun: boolean;
  eligibleForWrite: false;
  laneProfiles: AtomicCardCompetenceExceptionLaneProfile[];
  recommendationCodes: AtomicCardCompetenceExceptionRecommendationCode[];
}

const LANE_ORDER: AtomicCardCompetenceExceptionLaneCode[] = [
  'identity-reconstruction-prerequisite',
  'duplicate-identity-anchor-prerequisite',
  'statement-structure-prerequisite',
  'entry-type-review',
  'persisted-row-identity-review',
  'competence-evidence-review',
];

const EXCLUSION_TO_LANE: Record<
  AtomicCardCompetenceDryRunExclusionCode,
  AtomicCardCompetenceExceptionLaneCode
> = {
  'identity-mismatch': 'identity-reconstruction-prerequisite',
  'duplicate-current-identity': 'duplicate-identity-anchor-prerequisite',
  'duplicate-statement-key': 'statement-structure-prerequisite',
  'type-mismatch': 'entry-type-review',
  'missing-row-identity': 'persisted-row-identity-review',
  'unconfirmed-competence-evidence': 'competence-evidence-review',
};

const statementContentSignature = (statement: PersistedAtomicCardStatement): string =>
  JSON.stringify([
    statement.dueDate,
    statement.entryCount,
    statement.statementTotalCents,
    statement.totalPaymentsCents,
    statement.openBalanceCents,
    Boolean(statement.hasProtectedMetadata),
    Boolean(statement.manualTotalsPresent),
    statement.statementTotalFromFileCents ?? null,
    statement.totalPaymentsFromFileCents ?? null,
  ]);

const exclusionCount = (
  report: AtomicCardCompetenceDryRunReport,
  code: AtomicCardCompetenceDryRunExclusionCode
): number => report.exclusionProfiles.find((profile) => profile.code === code)?.count || 0;

const classifyIdentityPrerequisite = (
  dryRun: AtomicCardCompetenceDryRunReport,
  identityDryRun: AtomicCardIdentityDryRunReport
): AtomicCardCompetenceIdentityPrerequisiteSummary => {
  const identityMismatchCount = exclusionCount(dryRun, 'identity-mismatch');
  const duplicateIdentityAnchorCount = exclusionCount(dryRun, 'duplicate-current-identity');
  const exceptionCount = identityMismatchCount + duplicateIdentityAnchorCount;
  let status: AtomicCardCompetenceIdentityPrerequisiteSummary['status'];

  if (exceptionCount === 0) {
    status = 'not-needed';
  } else if (
    identityDryRun.status === 'ready' &&
    identityDryRun.hypotheticalUpdateCount === identityMismatchCount &&
    identityDryRun.before.duplicateIdentityGroupCount === duplicateIdentityAnchorCount &&
    identityDryRun.unresolvedCount === 0
  ) {
    status = 'covered-by-ready-dry-run';
  } else if (identityDryRun.status === 'blocked') {
    status = 'blocked';
  } else {
    status = 'partial';
  }

  return {
    status,
    exceptionCount,
    identityMismatchCount,
    duplicateIdentityAnchorCount,
    hypotheticalIdentityChangeCount: identityDryRun.hypotheticalUpdateCount,
    confirmedAnchorCount: identityDryRun.confirmedAnchorCount,
    unresolvedIdentityCount: identityDryRun.unresolvedCount,
  };
};

const classifyStatementPrerequisite = (
  dryRun: AtomicCardCompetenceDryRunReport,
  persisted: PersistedAtomicCardProjection,
  comparison: AtomicCardProjectionComparison
): AtomicCardCompetenceStatementPrerequisiteSummary => {
  const affectedEntryCount = exclusionCount(dryRun, 'duplicate-statement-key');
  const duplicateKeys = new Set(comparison.duplicatePersistedStatementKeys);
  const protectedKeys = new Set(comparison.protectedMetadataStatementKeys);
  const groups = new Map<string, PersistedAtomicCardStatement[]>();

  persisted.statements.forEach((statement) => {
    if (!duplicateKeys.has(statement.statementKey)) return;
    const group = groups.get(statement.statementKey) || [];
    group.push(statement);
    groups.set(statement.statementKey, group);
  });

  let identicalGroupCount = 0;
  let conflictingGroupCount = 0;
  let protectedGroupCount = 0;
  groups.forEach((group, statementKey) => {
    const signatures = new Set(group.map(statementContentSignature));
    if (signatures.size === 1) identicalGroupCount += 1;
    else conflictingGroupCount += 1;
    if (protectedKeys.has(statementKey) || group.some((statement) => statement.hasProtectedMetadata)) {
      protectedGroupCount += 1;
    }
  });

  const duplicateGroupCount = duplicateKeys.size;
  let status: AtomicCardCompetenceStatementPrerequisiteSummary['status'];
  if (affectedEntryCount === 0) {
    status = 'not-needed';
  } else if (duplicateGroupCount === 0 || groups.size !== duplicateGroupCount) {
    status = 'blocked';
  } else if (conflictingGroupCount > 0 || protectedGroupCount > 0) {
    status = 'review-needed';
  } else {
    status = 'isolated';
  }

  return {
    status,
    affectedEntryCount,
    duplicateGroupCount,
    identicalGroupCount,
    conflictingGroupCount,
    protectedGroupCount,
  };
};

/**
 * Classifies the rows excluded by Sprint 2I without exposing or mutating them.
 *
 * The result is deliberately aggregate-only. It identifies prerequisite order,
 * but contains no row identity, source name, statement key, mutation payload or
 * executable instruction.
 */
export function buildAtomicCardCompetenceExceptionForensicReport(input: {
  persisted: PersistedAtomicCardProjection;
  comparison: AtomicCardProjectionComparison;
  identityDryRun: AtomicCardIdentityDryRunReport;
  competenceDryRun: AtomicCardCompetenceDryRunReport;
}): AtomicCardCompetenceExceptionForensicReport {
  const { persisted, comparison, identityDryRun, competenceDryRun } = input;
  const laneCounts = new Map<AtomicCardCompetenceExceptionLaneCode, number>();
  competenceDryRun.exclusionProfiles.forEach((profile) => {
    const lane = EXCLUSION_TO_LANE[profile.code];
    laneCounts.set(lane, (laneCounts.get(lane) || 0) + profile.count);
  });
  const laneProfiles = LANE_ORDER
    .map((code, index) => ({ code, order: index + 1, count: laneCounts.get(code) || 0 }))
    .filter((profile) => profile.count > 0);
  const classifiedExceptionCount = laneProfiles.reduce((sum, profile) => sum + profile.count, 0);
  const classificationCountDelta = classifiedExceptionCount - competenceDryRun.excludedRowCount;
  const unclassifiedExceptionCount = Math.max(
    0,
    competenceDryRun.excludedRowCount - classifiedExceptionCount
  );
  const identityPrerequisite = classifyIdentityPrerequisite(competenceDryRun, identityDryRun);
  const statementPrerequisite = classifyStatementPrerequisite(
    competenceDryRun,
    persisted,
    comparison
  );
  const otherReviewCount =
    exclusionCount(competenceDryRun, 'type-mismatch') +
    exclusionCount(competenceDryRun, 'missing-row-identity') +
    exclusionCount(competenceDryRun, 'unconfirmed-competence-evidence');

  let status: AtomicCardCompetenceExceptionForensicStatus;
  if (competenceDryRun.status === 'blocked' || classificationCountDelta !== 0) {
    status = 'blocked';
  } else if (competenceDryRun.excludedRowCount === 0) {
    status = 'no-exceptions';
  } else if (
    unclassifiedExceptionCount === 0 &&
    identityPrerequisite.status !== 'blocked' &&
    statementPrerequisite.status !== 'blocked'
  ) {
    status = 'dependencies-isolated';
  } else {
    status = 'review-needed';
  }

  const eligibleForFutureSequencedDryRun =
    status === 'dependencies-isolated' &&
    (identityPrerequisite.status === 'not-needed' ||
      identityPrerequisite.status === 'covered-by-ready-dry-run') &&
    (statementPrerequisite.status === 'not-needed' ||
      statementPrerequisite.status === 'isolated') &&
    otherReviewCount === 0 &&
    statementPrerequisite.protectedGroupCount === 0;

  const recommendationCodes: AtomicCardCompetenceExceptionRecommendationCode[] = [
    'preserve-all-current-rows',
  ];
  if (identityPrerequisite.exceptionCount > 0) {
    recommendationCodes.push(
      'run-identity-dry-run-before-competence',
      'preserve-confirmed-identity-anchors'
    );
  }
  if (statementPrerequisite.affectedEntryCount > 0) {
    recommendationCodes.push('reconcile-statement-records-before-competence');
  }
  if (statementPrerequisite.protectedGroupCount > 0) {
    recommendationCodes.push('protect-statement-metadata');
  }
  if (exclusionCount(competenceDryRun, 'type-mismatch') > 0) {
    recommendationCodes.push('review-type-coupled-exceptions');
  }
  if (exclusionCount(competenceDryRun, 'missing-row-identity') > 0) {
    recommendationCodes.push('restore-persisted-row-identity');
  }
  if (exclusionCount(competenceDryRun, 'unconfirmed-competence-evidence') > 0) {
    recommendationCodes.push('confirm-competence-evidence');
  }
  if (unclassifiedExceptionCount > 0 || classificationCountDelta !== 0) {
    recommendationCodes.push('investigate-unclassified-exceptions');
  }
  if (competenceDryRun.excludedRowCount > 0) {
    recommendationCodes.push('rerun-competence-dry-run-after-prerequisites');
  }
  recommendationCodes.push('keep-writes-disabled');

  return {
    version: 1,
    privacy: 'aggregated-no-identifiers',
    nonAuthoritative: true,
    executable: false,
    mutationPayloadIncluded: false,
    actualWriteOperationCount: 0,
    checksum: competenceDryRun.checksum,
    status,
    totalExceptionCount: competenceDryRun.excludedRowCount,
    classifiedExceptionCount,
    unclassifiedExceptionCount,
    classificationCountDelta,
    identityPrerequisite,
    statementPrerequisite,
    otherReviewCount,
    protectedMetadataGroupCount: statementPrerequisite.protectedGroupCount,
    eligibleForFutureSequencedDryRun,
    eligibleForWrite: false,
    laneProfiles,
    recommendationCodes,
  };
}
