import { comparableImportOriginKey } from '../../utils/importOriginKey';
import type {
  AtomicCardProjectionComparison,
  AtomicCardShadowEntry,
  AtomicCardShadowProjection,
  PersistedAtomicCardEntry,
  PersistedAtomicCardProjection,
} from './atomicRebuildShadow';

export type AtomicCardProvenanceStatus =
  | 'clean'
  | 'fully-traceable'
  | 'partially-traceable'
  | 'ambiguous'
  | 'insufficient-evidence';

export type AtomicCardProvenanceEvidenceCode =
  | 'exact-provenance-content'
  | 'exact-provenance-competence-shift'
  | 'exact-provenance-type-shift'
  | 'exact-provenance-competence-and-type-shift'
  | 'exact-provenance-content-mismatch'
  | 'ambiguous-provenance'
  | 'missing-provenance'
  | 'missing-row-identity'
  | 'owner-not-duplicated'
  | 'owner-anchor-missing'
  | 'owner-anchor-ambiguous';

export type AtomicCardProvenanceRecommendationCode =
  | 'no-identity-reconstruction-needed'
  | 'all-missing-identities-have-exact-provenance'
  | 'owner-anchors-confirmed'
  | 'future-dry-run-plan-available'
  | 'investigate-provenance-collisions'
  | 'investigate-unavailable-provenance'
  | 'review-competence-before-any-repair'
  | 'preserve-owner-anchor'
  | 'no-write-without-snapshot'
  | 'do-not-reimport'
  | 'keep-activation-blocked';

export interface AtomicCardProvenanceEvidenceProfile {
  code: AtomicCardProvenanceEvidenceCode;
  count: number;
}

export interface AtomicCardProvenanceCohort {
  /** Opaque label; the real file name never leaves the in-memory analysis. */
  cohort: string;
  statementKeys: string[];
  missingIdentityCount: number;
  exactProvenanceMatchCount: number;
  recoveryCandidateCount: number;
  unresolvedCount: number;
}

export interface AtomicCardProvenanceCoverage {
  persistedRowCount: number;
  persistedRowsWithSourceIdentity: number;
  persistedRowsWithoutSourceIdentity: number;
  persistedRowsWithLotIdentity: number;
  persistedRowsWithRowIndex: number;
  persistedSourceCollisionGroupCount: number;
  projectedSourceCollisionGroupCount: number;
}

export interface AtomicCardProvenanceReport {
  version: 1;
  privacy: 'aggregated-no-identifiers';
  /** Pure diagnostic: it contains neither row IDs nor UPDATE/DELETE payloads. */
  nonAuthoritative: true;
  checksum: string;
  status: AtomicCardProvenanceStatus;
  coverage: AtomicCardProvenanceCoverage;
  missingIdentityCount: number;
  exactProvenanceMatchCount: number;
  ownerAnchorConfirmedCount: number;
  ownerAnchorMissingCount: number;
  ownerAnchorAmbiguousCount: number;
  recoveryCandidateCount: number;
  unresolvedCount: number;
  eligibleForFutureDryRunPlan: boolean;
  evidenceProfiles: AtomicCardProvenanceEvidenceProfile[];
  sourceCohorts: AtomicCardProvenanceCohort[];
  recommendationCodes: AtomicCardProvenanceRecommendationCode[];
}

interface InternalOutcome {
  sourceFileName: string;
  statementKey: string;
  exactProvenanceMatch: boolean;
  ownerAnchor: 'confirmed' | 'missing' | 'ambiguous' | 'not-applicable';
  recoveryCandidate: boolean;
  evidenceCode: AtomicCardProvenanceEvidenceCode;
}

const EVIDENCE_ORDER: AtomicCardProvenanceEvidenceCode[] = [
  'exact-provenance-content',
  'exact-provenance-competence-shift',
  'exact-provenance-type-shift',
  'exact-provenance-competence-and-type-shift',
  'exact-provenance-content-mismatch',
  'ambiguous-provenance',
  'missing-provenance',
  'missing-row-identity',
  'owner-not-duplicated',
  'owner-anchor-missing',
  'owner-anchor-ambiguous',
];

const sourceIdentityKey = (
  entry: { sourceFileName?: string | null; sourceRowHash?: string | null }
): string | null => {
  const originKey = comparableImportOriginKey(entry.sourceFileName || '');
  const rowHash = String(entry.sourceRowHash || '').trim();
  return originKey && rowHash ? `${originKey}|${rowHash}` : null;
};

const groupBy = <T>(items: readonly T[], keyOf: (item: T) => string | null): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const key = keyOf(item);
    if (!key) return;
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  });
  return groups;
};

const addCount = <TKey extends string>(counts: Map<TKey, number>, key: TKey): void => {
  counts.set(key, (counts.get(key) || 0) + 1);
};

const contentEvidence = (
  expected: AtomicCardShadowEntry,
  current: PersistedAtomicCardEntry
): AtomicCardProvenanceEvidenceCode => {
  const sameDate = (current.postedDate || '') === expected.postedDate;
  const sameAmount = current.amountCents === expected.amountCents;
  if (!sameDate || !sameAmount) return 'exact-provenance-content-mismatch';

  const competenceChanged = current.statementKey !== expected.statementKey;
  const typeChanged = current.entryType !== expected.entryType;
  if (competenceChanged && typeChanged) return 'exact-provenance-competence-and-type-shift';
  if (competenceChanged) return 'exact-provenance-competence-shift';
  if (typeChanged) return 'exact-provenance-type-shift';
  return 'exact-provenance-content';
};

const isRecoverableEvidence = (code: AtomicCardProvenanceEvidenceCode): boolean =>
  code === 'exact-provenance-content' ||
  code === 'exact-provenance-competence-shift' ||
  code === 'exact-provenance-type-shift' ||
  code === 'exact-provenance-competence-and-type-shift';

/**
 * Reconstructs the provenance trail for missing identities exclusively in memory.
 *
 * A candidate is traceable only when origin+hash identifies exactly one persisted row and
 * another provenance-confirmed row anchors the identity that is currently duplicated.
 * Even then, this function returns a diagnostic rather than a repair plan.
 */
export function buildAtomicCardProvenanceReport(
  shadow: AtomicCardShadowProjection,
  persisted: PersistedAtomicCardProjection,
  comparison: AtomicCardProjectionComparison
): AtomicCardProvenanceReport {
  const shadowByIdentity = new Map(shadow.entries.map((entry) => [entry.transactionId, entry]));
  const persistedByIdentity = groupBy(persisted.entries, (entry) => entry.transactionId);
  const shadowBySourceIdentity = groupBy(shadow.entries, (entry) => sourceIdentityKey(entry));
  const persistedBySourceIdentity = groupBy(persisted.entries, (entry) => sourceIdentityKey(entry));
  const missingEntries = comparison.missingTransactionIds
    .map((transactionId) => shadowByIdentity.get(transactionId))
    .filter((entry): entry is AtomicCardShadowEntry => Boolean(entry))
    .sort((left, right) => {
      const leftKey = `${comparableImportOriginKey(left.sourceFileName)}|${left.sourceRowHash}|${left.transactionId}`;
      const rightKey = `${comparableImportOriginKey(right.sourceFileName)}|${right.sourceRowHash}|${right.transactionId}`;
      return leftKey.localeCompare(rightKey);
    });

  const outcomes: InternalOutcome[] = [];
  const evidenceCounts = new Map<AtomicCardProvenanceEvidenceCode, number>();

  missingEntries.forEach((expected) => {
    const base = {
      sourceFileName: expected.sourceFileName,
      statementKey: expected.statementKey,
    };
    const provenanceKey = sourceIdentityKey(expected);
    const candidates = provenanceKey ? persistedBySourceIdentity.get(provenanceKey) || [] : [];

    if (!provenanceKey || candidates.length === 0) {
      addCount(evidenceCounts, 'missing-provenance');
      outcomes.push({ ...base, exactProvenanceMatch: false, ownerAnchor: 'not-applicable', recoveryCandidate: false, evidenceCode: 'missing-provenance' });
      return;
    }
    if (candidates.length !== 1 || (shadowBySourceIdentity.get(provenanceKey) || []).length !== 1) {
      addCount(evidenceCounts, 'ambiguous-provenance');
      outcomes.push({ ...base, exactProvenanceMatch: false, ownerAnchor: 'ambiguous', recoveryCandidate: false, evidenceCode: 'ambiguous-provenance' });
      return;
    }

    const candidate = candidates[0];
    if (!candidate.rowId) {
      addCount(evidenceCounts, 'missing-row-identity');
      outcomes.push({ ...base, exactProvenanceMatch: true, ownerAnchor: 'not-applicable', recoveryCandidate: false, evidenceCode: 'missing-row-identity' });
      return;
    }

    const ownerRows = persistedByIdentity.get(candidate.transactionId) || [];
    if (ownerRows.length < 2) {
      addCount(evidenceCounts, 'owner-not-duplicated');
      outcomes.push({ ...base, exactProvenanceMatch: true, ownerAnchor: 'missing', recoveryCandidate: false, evidenceCode: 'owner-not-duplicated' });
      return;
    }

    const ownerExpected = shadowByIdentity.get(candidate.transactionId);
    const ownerKey = ownerExpected ? sourceIdentityKey(ownerExpected) : null;
    const ownerAnchors = ownerKey
      ? ownerRows.filter((row) => row !== candidate && sourceIdentityKey(row) === ownerKey)
      : [];
    if (ownerAnchors.length === 0) {
      addCount(evidenceCounts, 'owner-anchor-missing');
      outcomes.push({ ...base, exactProvenanceMatch: true, ownerAnchor: 'missing', recoveryCandidate: false, evidenceCode: 'owner-anchor-missing' });
      return;
    }
    if (ownerAnchors.length !== 1 || !ownerAnchors[0].rowId) {
      addCount(evidenceCounts, 'owner-anchor-ambiguous');
      outcomes.push({ ...base, exactProvenanceMatch: true, ownerAnchor: 'ambiguous', recoveryCandidate: false, evidenceCode: 'owner-anchor-ambiguous' });
      return;
    }

    const evidenceCode = contentEvidence(expected, candidate);
    const recoveryCandidate = isRecoverableEvidence(evidenceCode);
    addCount(evidenceCounts, evidenceCode);
    outcomes.push({
      ...base,
      exactProvenanceMatch: true,
      ownerAnchor: 'confirmed',
      recoveryCandidate,
      evidenceCode,
    });
  });

  const persistedRowsWithSourceIdentity = persisted.entries.filter((entry) => Boolean(sourceIdentityKey(entry))).length;
  const persistedSourceCollisionGroupCount = Array.from(persistedBySourceIdentity.values()).filter((rows) => rows.length > 1).length;
  const projectedSourceCollisionGroupCount = Array.from(shadowBySourceIdentity.values()).filter((rows) => rows.length > 1).length;
  const exactProvenanceMatchCount = outcomes.filter((outcome) => outcome.exactProvenanceMatch).length;
  const ownerAnchorConfirmedCount = outcomes.filter((outcome) => outcome.ownerAnchor === 'confirmed').length;
  const ownerAnchorMissingCount = outcomes.filter((outcome) => outcome.ownerAnchor === 'missing').length;
  const ownerAnchorAmbiguousCount = outcomes.filter((outcome) => outcome.ownerAnchor === 'ambiguous').length;
  const recoveryCandidateCount = outcomes.filter((outcome) => outcome.recoveryCandidate).length;
  const unresolvedCount = missingEntries.length - recoveryCandidateCount;
  const hasAmbiguity =
    persistedSourceCollisionGroupCount > 0 ||
    projectedSourceCollisionGroupCount > 0 ||
    ownerAnchorAmbiguousCount > 0 ||
    (evidenceCounts.get('ambiguous-provenance') || 0) > 0;
  const eligibleForFutureDryRunPlan =
    missingEntries.length > 0 &&
    recoveryCandidateCount === missingEntries.length &&
    ownerAnchorConfirmedCount === missingEntries.length &&
    !hasAmbiguity;

  let status: AtomicCardProvenanceStatus = 'insufficient-evidence';
  if (missingEntries.length === 0) status = 'clean';
  else if (eligibleForFutureDryRunPlan) status = 'fully-traceable';
  else if (hasAmbiguity) status = 'ambiguous';
  else if (recoveryCandidateCount > 0) status = 'partially-traceable';

  const sourceKeys = Array.from(
    new Set(outcomes.map((outcome) => comparableImportOriginKey(outcome.sourceFileName)))
  ).sort();
  const sourceCohorts = sourceKeys.map((sourceKey, index) => {
    const cohortOutcomes = outcomes.filter(
      (outcome) => comparableImportOriginKey(outcome.sourceFileName) === sourceKey
    );
    const recoveryCount = cohortOutcomes.filter((outcome) => outcome.recoveryCandidate).length;
    return {
      cohort: `origem-${String(index + 1).padStart(2, '0')}`,
      statementKeys: Array.from(new Set(cohortOutcomes.map((outcome) => outcome.statementKey))).sort(),
      missingIdentityCount: cohortOutcomes.length,
      exactProvenanceMatchCount: cohortOutcomes.filter((outcome) => outcome.exactProvenanceMatch).length,
      recoveryCandidateCount: recoveryCount,
      unresolvedCount: cohortOutcomes.length - recoveryCount,
    } satisfies AtomicCardProvenanceCohort;
  });

  const recommendationCodes: AtomicCardProvenanceRecommendationCode[] = [];
  if (missingEntries.length === 0) {
    recommendationCodes.push('no-identity-reconstruction-needed');
  } else {
    if (exactProvenanceMatchCount === missingEntries.length) {
      recommendationCodes.push('all-missing-identities-have-exact-provenance');
    }
    if (ownerAnchorConfirmedCount === missingEntries.length) {
      recommendationCodes.push('owner-anchors-confirmed');
    }
    if (eligibleForFutureDryRunPlan) recommendationCodes.push('future-dry-run-plan-available');
    if (hasAmbiguity) recommendationCodes.push('investigate-provenance-collisions');
    if (unresolvedCount > 0 && !hasAmbiguity) recommendationCodes.push('investigate-unavailable-provenance');
    if (outcomes.some((outcome) => outcome.evidenceCode.includes('competence'))) {
      recommendationCodes.push('review-competence-before-any-repair');
    }
    if (ownerAnchorConfirmedCount > 0) recommendationCodes.push('preserve-owner-anchor');
    recommendationCodes.push('no-write-without-snapshot', 'do-not-reimport', 'keep-activation-blocked');
  }

  return {
    version: 1,
    privacy: 'aggregated-no-identifiers',
    nonAuthoritative: true,
    checksum: shadow.checksum,
    status,
    coverage: {
      persistedRowCount: persisted.entries.length,
      persistedRowsWithSourceIdentity,
      persistedRowsWithoutSourceIdentity: persisted.entries.length - persistedRowsWithSourceIdentity,
      persistedRowsWithLotIdentity: persisted.entries.filter((entry) => Boolean(entry.importLotId)).length,
      persistedRowsWithRowIndex: persisted.entries.filter((entry) => Number.isInteger(entry.sourceRowIndex)).length,
      persistedSourceCollisionGroupCount,
      projectedSourceCollisionGroupCount,
    },
    missingIdentityCount: missingEntries.length,
    exactProvenanceMatchCount,
    ownerAnchorConfirmedCount,
    ownerAnchorMissingCount,
    ownerAnchorAmbiguousCount,
    recoveryCandidateCount,
    unresolvedCount,
    eligibleForFutureDryRunPlan,
    evidenceProfiles: EVIDENCE_ORDER
      .map((code) => ({ code, count: evidenceCounts.get(code) || 0 }))
      .filter((profile) => profile.count > 0),
    sourceCohorts,
    recommendationCodes,
  };
}
