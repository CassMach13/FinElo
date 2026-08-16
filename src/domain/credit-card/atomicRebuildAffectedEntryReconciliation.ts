import type { AtomicCardCompetenceExceptionForensicReport } from './atomicRebuildCompetenceExceptionForensics';
import type {
  AtomicCardProjectionComparison,
  AtomicCardShadowProjection,
  PersistedAtomicCardProjection,
} from './atomicRebuildShadow';

export type AtomicCardAffectedEntryReconciliationStatus =
  | 'no-duplicates'
  | 'no-pending-competence-shift'
  | 'explained-by-current-attachment'
  | 'explained-by-projected-target'
  | 'explained-on-both-sides'
  | 'blocked';

export type AtomicCardAffectedEntryReconciliationRecommendationCode =
  | 'treat-upstream-count-as-competence-exceptions'
  | 'distinguish-current-attachment-from-projected-target'
  | 'preserve-all-statement-records'
  | 'investigate-count-provenance'
  | 'keep-writes-disabled';

export interface AtomicCardAffectedEntryReconciliationReport {
  version: 1;
  privacy: 'aggregated-no-identifiers';
  nonAuthoritative: true;
  executable: false;
  mutationPayloadIncluded: false;
  actualWriteOperationCount: 0;
  checksum: string;
  status: AtomicCardAffectedEntryReconciliationStatus;
  duplicateGroupCount: number;
  upstreamDuplicateGroupCount: number;
  currentAttachedEntryCount: number;
  projectedTargetEntryCount: number;
  upstreamAffectedEntryCount: number;
  reconciledAffectedEntryCount: number;
  unexplainedCountDelta: number;
  eligibleForConflictForensics: boolean;
  eligibleForWrite: false;
  recommendationCodes: AtomicCardAffectedEntryReconciliationRecommendationCode[];
}

/**
 * Reconciles three counts that answer deliberately different questions:
 *
 * - current attachment: rows physically linked to a duplicated statement key;
 * - projected target: shadow rows whose intended statement key is duplicated;
 * - upstream affected: competence changes excluded because either side touches
 *   that duplicated key.
 *
 * Only aggregate counters and classification codes leave this function. No
 * statement key, transaction identity, source or financial value is returned.
 */
export function buildAtomicCardAffectedEntryReconciliationReport(input: {
  shadow: AtomicCardShadowProjection;
  persisted: PersistedAtomicCardProjection;
  comparison: AtomicCardProjectionComparison;
  competenceExceptions: AtomicCardCompetenceExceptionForensicReport;
}): AtomicCardAffectedEntryReconciliationReport {
  const { shadow, persisted, comparison, competenceExceptions } = input;
  const duplicateKeys = new Set(comparison.duplicatePersistedStatementKeys);
  const duplicateGroupCount = duplicateKeys.size;
  const upstream = competenceExceptions.statementPrerequisite;
  const upstreamDuplicateGroupCount = upstream.duplicateGroupCount;
  const currentAttachedEntryCount = persisted.entries.filter((entry) =>
    duplicateKeys.has(entry.statementKey)
  ).length;
  const projectedTargetEntryCount = shadow.entries.filter((entry) =>
    duplicateKeys.has(entry.statementKey)
  ).length;
  const upstreamAffectedEntryCount = upstream.affectedEntryCount;
  const groupCountsAgree = upstreamDuplicateGroupCount === duplicateGroupCount;

  let status: AtomicCardAffectedEntryReconciliationStatus;
  if (
    duplicateGroupCount === 0 &&
    upstreamDuplicateGroupCount === 0 &&
    upstreamAffectedEntryCount === 0
  ) {
    status = 'no-duplicates';
  } else if (!groupCountsAgree) {
    status = 'blocked';
  } else if (upstreamAffectedEntryCount === 0) {
    status = 'no-pending-competence-shift';
  } else if (
    upstreamAffectedEntryCount === currentAttachedEntryCount &&
    upstreamAffectedEntryCount === projectedTargetEntryCount
  ) {
    status = 'explained-on-both-sides';
  } else if (upstreamAffectedEntryCount === currentAttachedEntryCount) {
    status = 'explained-by-current-attachment';
  } else if (upstreamAffectedEntryCount === projectedTargetEntryCount) {
    status = 'explained-by-projected-target';
  } else {
    status = 'blocked';
  }

  const eligibleForConflictForensics = status !== 'blocked';
  const unexplainedCountDelta = eligibleForConflictForensics
    ? 0
    : Math.min(
        Math.abs(upstreamAffectedEntryCount - currentAttachedEntryCount),
        Math.abs(upstreamAffectedEntryCount - projectedTargetEntryCount)
      );
  const recommendationCodes: AtomicCardAffectedEntryReconciliationRecommendationCode[] = [];

  if (duplicateGroupCount > 0) {
    recommendationCodes.push('preserve-all-statement-records');
  }
  if (upstreamAffectedEntryCount > 0) {
    recommendationCodes.push('treat-upstream-count-as-competence-exceptions');
  }
  if (currentAttachedEntryCount !== projectedTargetEntryCount) {
    recommendationCodes.push('distinguish-current-attachment-from-projected-target');
  }
  if (!eligibleForConflictForensics) {
    recommendationCodes.push('investigate-count-provenance');
  }
  recommendationCodes.push('keep-writes-disabled');

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
    upstreamDuplicateGroupCount,
    currentAttachedEntryCount,
    projectedTargetEntryCount,
    upstreamAffectedEntryCount,
    reconciledAffectedEntryCount: upstreamAffectedEntryCount,
    unexplainedCountDelta,
    eligibleForConflictForensics,
    eligibleForWrite: false,
    recommendationCodes,
  };
}
