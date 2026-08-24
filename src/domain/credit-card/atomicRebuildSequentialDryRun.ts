import type { AtomicCardCompetenceEvidenceCycle } from './atomicRebuildCompetenceForensics';
import {
  buildAtomicCardCompetenceForensicReport,
} from './atomicRebuildCompetenceForensics';
import { simulateAtomicCardCompetenceDryRun } from './atomicRebuildCompetenceDryRun';
import { simulateAtomicCardIdentityDryRun } from './atomicRebuildIdentityDryRun';
import type { AtomicCardProvenanceReport } from './atomicRebuildProvenance';
import {
  compareAtomicCardProjections,
  type AtomicCardProjectionComparison,
  type AtomicCardShadowProjection,
  type PersistedAtomicCardEntry,
  type PersistedAtomicCardProjection,
} from './atomicRebuildShadow';

export type AtomicCardSequentialDryRunStatus =
  | 'not-needed'
  | 'complete'
  | 'partial'
  | 'blocked';

export type AtomicCardSequentialDryRunBlockerCode =
  | 'identity-step-blocked'
  | 'competence-step-blocked'
  | 'row-count-not-conserved'
  | 'physical-row-identity-not-conserved'
  | 'identity-gap-remains'
  | 'economic-content-mutated'
  | 'source-provenance-mutated'
  | 'statement-records-mutated'
  | 'payment-records-mutated';

export type AtomicCardSequentialDryRunRecommendationCode =
  | 'no-sequential-change-needed'
  | 'review-sequential-simulation'
  | 'preserve-all-physical-rows'
  | 'preserve-confirmed-identity-anchors'
  | 'preserve-economic-content-and-provenance'
  | 'review-residual-statement-and-payment-differences'
  | 'resolve-sequential-blockers'
  | 'keep-writes-disabled';

export interface AtomicCardSequentialDryRunComparisonSummary {
  missingIdentityCount: number;
  duplicateIdentityGroupCount: number;
  orphanIdentityCount: number;
  changedTransactionCount: number;
  changedStatementCount: number;
  changedPaymentCount: number;
  structuralDifferenceCount: number;
  differenceCount: number;
}

export interface AtomicCardSequentialDryRunBlockerProfile {
  code: AtomicCardSequentialDryRunBlockerCode;
  count: number;
}

export interface AtomicCardSequentialDryRunReport {
  version: 1;
  privacy: 'aggregated-no-identifiers';
  nonAuthoritative: true;
  executable: false;
  mutationPayloadIncluded: false;
  actualWriteOperationCount: 0;
  eligibleForWrite: false;
  checksum: string;
  status: AtomicCardSequentialDryRunStatus;
  identityStepStatus: 'not-needed' | 'ready' | 'blocked';
  competenceStepStatus: 'not-needed' | 'ready' | 'partial' | 'blocked';
  rowCountBefore: number;
  rowCountAfter: number;
  rowCountDelta: number;
  hypotheticalIdentityUpdateCount: number;
  hypotheticalCompetenceUpdateCount: number;
  confirmedAnchorCount: number;
  identityMutationCount: number;
  competenceMutationCount: number;
  typeMutationCount: number;
  dateMutationCount: number;
  amountMutationCount: number;
  sourceMutationCount: number;
  statementRecordsPreserved: boolean;
  paymentRecordsPreserved: boolean;
  protectedMetadataTouchCount: number;
  before: AtomicCardSequentialDryRunComparisonSummary;
  afterIdentity: AtomicCardSequentialDryRunComparisonSummary;
  afterSequential: AtomicCardSequentialDryRunComparisonSummary;
  residualDifferenceCount: number;
  blockerProfiles: AtomicCardSequentialDryRunBlockerProfile[];
  recommendationCodes: AtomicCardSequentialDryRunRecommendationCode[];
}

const BLOCKER_ORDER: AtomicCardSequentialDryRunBlockerCode[] = [
  'identity-step-blocked',
  'competence-step-blocked',
  'row-count-not-conserved',
  'physical-row-identity-not-conserved',
  'identity-gap-remains',
  'economic-content-mutated',
  'source-provenance-mutated',
  'statement-records-mutated',
  'payment-records-mutated',
];

const summaryFromComparison = (
  comparison: AtomicCardProjectionComparison
): AtomicCardSequentialDryRunComparisonSummary => ({
  missingIdentityCount: comparison.missingTransactionIds.length,
  duplicateIdentityGroupCount: comparison.duplicatePersistedTransactionIds.length,
  orphanIdentityCount: comparison.orphanTransactionIds.length,
  changedTransactionCount: comparison.changedTransactionIds.length,
  changedStatementCount: comparison.changedStatementKeys.length,
  changedPaymentCount: comparison.changedPaymentTransactionIds.length,
  structuralDifferenceCount: comparison.structuralDifferenceCount,
  differenceCount: comparison.differenceCount,
});

const sourceSignature = (entry: PersistedAtomicCardEntry): string =>
  JSON.stringify([
    entry.sourceFileName ?? null,
    entry.sourceRowIndex ?? null,
    entry.sourceRowHash ?? null,
    entry.importLotId ?? null,
  ]);

const addCount = (
  counts: Map<AtomicCardSequentialDryRunBlockerCode, number>,
  code: AtomicCardSequentialDryRunBlockerCode,
  count = 1
): void => {
  counts.set(code, (counts.get(code) || 0) + count);
};

/**
 * Composes the proven identity reconstruction with the competence-only dry run.
 *
 * Both steps operate on clones. The public report is aggregate-only and never
 * contains row IDs, transaction IDs, hashes, source names or a mutation payload.
 */
export function buildAtomicCardSequentialDryRunReport(input: {
  shadow: AtomicCardShadowProjection;
  persisted: PersistedAtomicCardProjection;
  comparison: AtomicCardProjectionComparison;
  provenance: AtomicCardProvenanceReport;
  cycles: AtomicCardCompetenceEvidenceCycle[];
  closingDay?: number | null;
}): AtomicCardSequentialDryRunReport {
  const blockers = new Map<AtomicCardSequentialDryRunBlockerCode, number>();
  const identity = simulateAtomicCardIdentityDryRun(
    input.shadow,
    input.persisted,
    input.comparison,
    input.provenance
  );
  const afterIdentityComparison = compareAtomicCardProjections(
    input.shadow,
    identity.persisted
  );
  const competenceForensics = buildAtomicCardCompetenceForensicReport({
    shadow: input.shadow,
    persisted: identity.persisted,
    cycles: input.cycles,
    closingDay: input.closingDay,
  });
  const competence = simulateAtomicCardCompetenceDryRun({
    shadow: input.shadow,
    persisted: identity.persisted,
    comparison: afterIdentityComparison,
    forensics: competenceForensics,
    cycles: input.cycles,
    closingDay: input.closingDay,
  });
  const competenceWasSkipped = identity.report.status === 'blocked';
  const finalPersisted = competenceWasSkipped
    ? identity.persisted
    : competence.persisted;
  const competenceStepStatus = competenceWasSkipped
    ? 'blocked'
    : competence.report.status;
  const finalComparison = compareAtomicCardProjections(
    input.shadow,
    finalPersisted
  );

  if (identity.report.status === 'blocked') addCount(blockers, 'identity-step-blocked');
  if (!competenceWasSkipped && competence.report.status === 'blocked') {
    addCount(blockers, 'competence-step-blocked');
  }
  if (input.persisted.entries.length !== finalPersisted.entries.length) {
    addCount(
      blockers,
      'row-count-not-conserved',
      Math.abs(input.persisted.entries.length - finalPersisted.entries.length) || 1
    );
  }

  const originalByRowId = new Map<string, PersistedAtomicCardEntry>();
  let missingPhysicalIdentityCount = 0;
  input.persisted.entries.forEach((entry) => {
    const rowId = String(entry.rowId || '');
    if (!rowId || originalByRowId.has(rowId)) {
      missingPhysicalIdentityCount += 1;
      return;
    }
    originalByRowId.set(rowId, entry);
  });

  let identityMutationCount = 0;
  let competenceMutationCount = 0;
  let typeMutationCount = 0;
  let dateMutationCount = 0;
  let amountMutationCount = 0;
  let sourceMutationCount = 0;
  const finalRowIds = new Set<string>();
  finalPersisted.entries.forEach((entry) => {
    const rowId = String(entry.rowId || '');
    const original = rowId ? originalByRowId.get(rowId) : undefined;
    if (!rowId || !original || finalRowIds.has(rowId)) {
      missingPhysicalIdentityCount += 1;
      return;
    }
    finalRowIds.add(rowId);
    if (entry.transactionId !== original.transactionId) identityMutationCount += 1;
    if (entry.statementKey !== original.statementKey) competenceMutationCount += 1;
    if (entry.entryType !== original.entryType) typeMutationCount += 1;
    if ((entry.postedDate || '') !== (original.postedDate || '')) dateMutationCount += 1;
    if (entry.amountCents !== original.amountCents) amountMutationCount += 1;
    if (sourceSignature(entry) !== sourceSignature(original)) sourceMutationCount += 1;
  });
  if (finalRowIds.size !== originalByRowId.size) {
    missingPhysicalIdentityCount += Math.abs(finalRowIds.size - originalByRowId.size);
  }
  if (missingPhysicalIdentityCount > 0) {
    addCount(blockers, 'physical-row-identity-not-conserved', missingPhysicalIdentityCount);
  }
  const remainingIdentityGap =
    finalComparison.missingTransactionIds.length +
    finalComparison.duplicatePersistedTransactionIds.length +
    finalComparison.orphanTransactionIds.length;
  if (remainingIdentityGap > 0) addCount(blockers, 'identity-gap-remains', remainingIdentityGap);
  if (dateMutationCount + amountMutationCount > 0) {
    addCount(blockers, 'economic-content-mutated', dateMutationCount + amountMutationCount);
  }
  if (sourceMutationCount > 0) {
    addCount(blockers, 'source-provenance-mutated', sourceMutationCount);
  }

  const statementRecordsPreserved =
    JSON.stringify(input.persisted.statements) === JSON.stringify(finalPersisted.statements);
  const paymentRecordsPreserved =
    JSON.stringify(input.persisted.payments) === JSON.stringify(finalPersisted.payments);
  if (!statementRecordsPreserved) addCount(blockers, 'statement-records-mutated');
  if (!paymentRecordsPreserved) addCount(blockers, 'payment-records-mutated');

  const noStepNeeded =
    identity.report.status === 'not-needed' && competence.report.status === 'not-needed';
  const status: AtomicCardSequentialDryRunStatus =
    blockers.size > 0
      ? 'blocked'
      : noStepNeeded
        ? 'not-needed'
        : finalComparison.structuralDifferenceCount > 0
          ? 'partial'
          : 'complete';

  const recommendationCodes: AtomicCardSequentialDryRunRecommendationCode[] = [];
  if (status === 'not-needed') {
    recommendationCodes.push('no-sequential-change-needed');
  } else if (status === 'blocked') {
    recommendationCodes.push('resolve-sequential-blockers');
  } else {
    recommendationCodes.push('review-sequential-simulation');
  }
  recommendationCodes.push(
    'preserve-all-physical-rows',
    'preserve-confirmed-identity-anchors',
    'preserve-economic-content-and-provenance'
  );
  if (finalComparison.structuralDifferenceCount > 0) {
    recommendationCodes.push('review-residual-statement-and-payment-differences');
  }
  recommendationCodes.push('keep-writes-disabled');

  return {
    version: 1,
    privacy: 'aggregated-no-identifiers',
    nonAuthoritative: true,
    executable: false,
    mutationPayloadIncluded: false,
    actualWriteOperationCount: 0,
    eligibleForWrite: false,
    checksum: input.shadow.checksum,
    status,
    identityStepStatus: identity.report.status,
    competenceStepStatus,
    rowCountBefore: input.persisted.entries.length,
    rowCountAfter: finalPersisted.entries.length,
    rowCountDelta: finalPersisted.entries.length - input.persisted.entries.length,
    hypotheticalIdentityUpdateCount: identity.report.hypotheticalUpdateCount,
    hypotheticalCompetenceUpdateCount: competenceWasSkipped
      ? 0
      : competence.report.hypotheticalUpdateCount,
    confirmedAnchorCount: identity.report.confirmedAnchorCount,
    identityMutationCount,
    competenceMutationCount,
    typeMutationCount,
    dateMutationCount,
    amountMutationCount,
    sourceMutationCount,
    statementRecordsPreserved,
    paymentRecordsPreserved,
    protectedMetadataTouchCount: competenceWasSkipped
      ? 0
      : competence.report.protectedMetadataTouchCount,
    before: summaryFromComparison(input.comparison),
    afterIdentity: summaryFromComparison(afterIdentityComparison),
    afterSequential: summaryFromComparison(finalComparison),
    residualDifferenceCount: finalComparison.differenceCount,
    blockerProfiles: BLOCKER_ORDER
      .map((code) => ({ code, count: blockers.get(code) || 0 }))
      .filter((profile) => profile.count > 0),
    recommendationCodes,
  };
}
