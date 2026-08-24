import { comparableImportOriginKey } from '../../utils/importOriginKey';
import type { AtomicCardProvenanceReport } from './atomicRebuildProvenance';
import {
  compareAtomicCardProjections,
  type AtomicCardProjectionComparison,
  type AtomicCardShadowEntry,
  type AtomicCardShadowProjection,
  type PersistedAtomicCardEntry,
  type PersistedAtomicCardProjection,
} from './atomicRebuildShadow';

export type AtomicCardIdentityDryRunStatus = 'not-needed' | 'ready' | 'blocked';

export type AtomicCardIdentityDryRunChangeCode =
  | 'identity-only'
  | 'identity-and-competence'
  | 'identity-and-type'
  | 'identity-competence-and-type';

export type AtomicCardIdentityDryRunBlockerCode =
  | 'persisted-source-not-engine'
  | 'provenance-report-not-eligible'
  | 'row-count-not-conserved'
  | 'orphan-identity-present'
  | 'repairable-deletion-path-present'
  | 'missing-provenance'
  | 'ambiguous-provenance'
  | 'missing-row-identity'
  | 'owner-not-duplicated'
  | 'owner-anchor-missing'
  | 'owner-anchor-ambiguous'
  | 'economic-content-mismatch'
  | 'candidate-reused'
  | 'unrelated-duplicate-group'
  | 'simulation-did-not-close-identity-gap';

export type AtomicCardIdentityDryRunRecommendationCode =
  | 'no-identity-reconstruction-needed'
  | 'review-individual-dry-run'
  | 'preserve-confirmed-anchors'
  | 'review-competence-changes'
  | 'review-type-changes'
  | 'residual-structural-differences-remain'
  | 'snapshot-before-future-execution'
  | 'keep-writes-disabled'
  | 'investigate-dry-run-blockers';

export interface AtomicCardIdentityDryRunComparisonSummary {
  missingIdentityCount: number;
  duplicateIdentityGroupCount: number;
  orphanIdentityCount: number;
  changedIdentityCount: number;
  structuralDifferenceCount: number;
  differenceCount: number;
}

export interface AtomicCardIdentityDryRunChangeProfile {
  code: AtomicCardIdentityDryRunChangeCode;
  fromStatementKey: string;
  toStatementKey: string;
  fromEntryType: string;
  toEntryType: string;
  count: number;
}

export interface AtomicCardIdentityDryRunBlockerProfile {
  code: AtomicCardIdentityDryRunBlockerCode;
  count: number;
}

export interface AtomicCardIdentityDryRunSourceCohort {
  /** Opaque label; source names and row identities remain private. */
  cohort: string;
  fromStatementKeys: string[];
  toStatementKeys: string[];
  candidateCount: number;
  competenceChangeCount: number;
  typeChangeCount: number;
  confirmedAnchorCount: number;
}

export interface AtomicCardIdentityDryRunReport {
  version: 1;
  privacy: 'aggregated-no-identifiers';
  /** The report can never be executed and contains no database mutation payload. */
  nonAuthoritative: true;
  executable: false;
  mutationPayloadIncluded: false;
  actualWriteOperationCount: 0;
  checksum: string;
  status: AtomicCardIdentityDryRunStatus;
  rowCountBefore: number;
  rowCountAfter: number;
  rowCountDelta: number;
  candidateCount: number;
  hypotheticalUpdateCount: number;
  confirmedAnchorCount: number;
  unresolvedCount: number;
  before: AtomicCardIdentityDryRunComparisonSummary;
  after: AtomicCardIdentityDryRunComparisonSummary;
  residualDifferenceCount: number;
  changeProfiles: AtomicCardIdentityDryRunChangeProfile[];
  blockerProfiles: AtomicCardIdentityDryRunBlockerProfile[];
  sourceCohorts: AtomicCardIdentityDryRunSourceCohort[];
  recommendationCodes: AtomicCardIdentityDryRunRecommendationCode[];
}

export interface AtomicCardIdentityDryRunSimulation {
  /** Internal clone used only to compose later in-memory diagnostics. */
  persisted: PersistedAtomicCardProjection;
  report: AtomicCardIdentityDryRunReport;
}

interface InternalCandidate {
  sourceFileName: string;
  current: PersistedAtomicCardEntry;
  expected: AtomicCardShadowEntry;
  anchor: PersistedAtomicCardEntry;
  changeCode: AtomicCardIdentityDryRunChangeCode;
}

const sourceIdentityKey = (
  entry: { sourceFileName?: string | null; sourceRowHash?: string | null }
): string | null => {
  const source = comparableImportOriginKey(entry.sourceFileName || '');
  const hash = String(entry.sourceRowHash || '').trim();
  return source && hash ? `${source}|${hash}` : null;
};

const groupBy = <T>(
  items: readonly T[],
  keyOf: (item: T) => string | null
): Map<string, T[]> => {
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

const addCount = <TKey extends string>(
  counts: Map<TKey, number>,
  key: TKey,
  amount = 1
): void => {
  counts.set(key, (counts.get(key) || 0) + amount);
};

const summaryFromComparison = (
  comparison: AtomicCardProjectionComparison
): AtomicCardIdentityDryRunComparisonSummary => ({
  missingIdentityCount: comparison.missingTransactionIds.length,
  duplicateIdentityGroupCount: comparison.duplicatePersistedTransactionIds.length,
  orphanIdentityCount: comparison.orphanTransactionIds.length,
  changedIdentityCount: comparison.changedTransactionIds.length,
  structuralDifferenceCount: comparison.structuralDifferenceCount,
  differenceCount: comparison.differenceCount,
});

const changeCodeFor = (
  current: PersistedAtomicCardEntry,
  expected: AtomicCardShadowEntry
): AtomicCardIdentityDryRunChangeCode => {
  const competenceChanged = current.statementKey !== expected.statementKey;
  const typeChanged = current.entryType !== expected.entryType;
  if (competenceChanged && typeChanged) return 'identity-competence-and-type';
  if (competenceChanged) return 'identity-and-competence';
  if (typeChanged) return 'identity-and-type';
  return 'identity-only';
};

const candidateSortKey = (candidate: InternalCandidate): string =>
  [
    comparableImportOriginKey(candidate.sourceFileName),
    candidate.expected.statementKey,
    candidate.current.statementKey,
    candidate.expected.entryType,
    candidate.current.entryType,
    candidate.expected.sourceRowHash,
  ].join('|');

const BLOCKER_ORDER: AtomicCardIdentityDryRunBlockerCode[] = [
  'persisted-source-not-engine',
  'provenance-report-not-eligible',
  'row-count-not-conserved',
  'orphan-identity-present',
  'repairable-deletion-path-present',
  'missing-provenance',
  'ambiguous-provenance',
  'missing-row-identity',
  'owner-not-duplicated',
  'owner-anchor-missing',
  'owner-anchor-ambiguous',
  'economic-content-mismatch',
  'candidate-reused',
  'unrelated-duplicate-group',
  'simulation-did-not-close-identity-gap',
];

/**
 * Simulates a provenance-backed identity reconstruction exclusively in memory.
 *
 * The public result deliberately excludes transaction IDs, row IDs, hashes, source names
 * and mutation payloads. It can explain a future change, but cannot execute one.
 */
export function simulateAtomicCardIdentityDryRun(
  shadow: AtomicCardShadowProjection,
  persisted: PersistedAtomicCardProjection,
  comparison: AtomicCardProjectionComparison,
  provenance: AtomicCardProvenanceReport
): AtomicCardIdentityDryRunSimulation {
  const blockers = new Map<AtomicCardIdentityDryRunBlockerCode, number>();
  const shadowByIdentity = new Map(shadow.entries.map((entry) => [entry.transactionId, entry]));
  const persistedByIdentity = groupBy(persisted.entries, (entry) => entry.transactionId);
  const shadowBySource = groupBy(shadow.entries, (entry) => sourceIdentityKey(entry));
  const persistedBySource = groupBy(persisted.entries, (entry) => sourceIdentityKey(entry));
  const missingEntries = comparison.missingTransactionIds
    .map((identity) => shadowByIdentity.get(identity))
    .filter((entry): entry is AtomicCardShadowEntry => Boolean(entry))
    .sort((left, right) =>
      [comparableImportOriginKey(left.sourceFileName), left.sourceRowHash, left.transactionId]
        .join('|')
        .localeCompare(
          [comparableImportOriginKey(right.sourceFileName), right.sourceRowHash, right.transactionId]
            .join('|')
        )
    );

  if (persisted.source !== 'engine') addCount(blockers, 'persisted-source-not-engine');
  if (missingEntries.length > 0 && !provenance.eligibleForFutureDryRunPlan) {
    addCount(blockers, 'provenance-report-not-eligible');
  }
  if (persisted.entries.length !== shadow.entries.length) {
    addCount(blockers, 'row-count-not-conserved', Math.abs(persisted.entries.length - shadow.entries.length) || 1);
  }
  if (comparison.orphanTransactionIds.length > 0) {
    addCount(blockers, 'orphan-identity-present', comparison.orphanTransactionIds.length);
  }
  if (comparison.repairablePersistedEntryRowIds.length > 0) {
    addCount(blockers, 'repairable-deletion-path-present', comparison.repairablePersistedEntryRowIds.length);
  }

  const candidates: InternalCandidate[] = [];
  const usedCandidateRows = new Set<string>();
  const addressedOwnerIdentities = new Set<string>();

  missingEntries.forEach((expected) => {
    const provenanceKey = sourceIdentityKey(expected);
    if (!provenanceKey) {
      addCount(blockers, 'missing-provenance');
      return;
    }
    const currentRows = persistedBySource.get(provenanceKey) || [];
    const expectedRows = shadowBySource.get(provenanceKey) || [];
    if (currentRows.length === 0) {
      addCount(blockers, 'missing-provenance');
      return;
    }
    if (currentRows.length !== 1 || expectedRows.length !== 1) {
      addCount(blockers, 'ambiguous-provenance');
      return;
    }

    const current = currentRows[0];
    if (!current.rowId) {
      addCount(blockers, 'missing-row-identity');
      return;
    }
    if (usedCandidateRows.has(current.rowId)) {
      addCount(blockers, 'candidate-reused');
      return;
    }

    const ownerRows = persistedByIdentity.get(current.transactionId) || [];
    if (ownerRows.length < 2) {
      addCount(blockers, 'owner-not-duplicated');
      return;
    }
    const ownerExpected = shadowByIdentity.get(current.transactionId);
    const ownerKey = ownerExpected ? sourceIdentityKey(ownerExpected) : null;
    const anchors = ownerKey
      ? ownerRows.filter((row) => row !== current && sourceIdentityKey(row) === ownerKey)
      : [];
    if (anchors.length === 0) {
      addCount(blockers, 'owner-anchor-missing');
      return;
    }
    if (anchors.length !== 1 || !anchors[0].rowId) {
      addCount(blockers, 'owner-anchor-ambiguous');
      return;
    }
    if (
      (current.postedDate || '') !== expected.postedDate ||
      current.amountCents !== expected.amountCents
    ) {
      addCount(blockers, 'economic-content-mismatch');
      return;
    }

    usedCandidateRows.add(current.rowId);
    addressedOwnerIdentities.add(current.transactionId);
    candidates.push({
      sourceFileName: expected.sourceFileName,
      current,
      expected,
      anchor: anchors[0],
      changeCode: changeCodeFor(current, expected),
    });
  });

  const unrelatedDuplicateCount = comparison.duplicatePersistedTransactionIds.filter(
    (identity) => !addressedOwnerIdentities.has(identity)
  ).length;
  if (unrelatedDuplicateCount > 0) {
    addCount(blockers, 'unrelated-duplicate-group', unrelatedDuplicateCount);
  }

  candidates.sort((left, right) => candidateSortKey(left).localeCompare(candidateSortKey(right)));
  const canSimulate = missingEntries.length > 0 && blockers.size === 0 && candidates.length === missingEntries.length;
  const candidateByRowId = new Map(
    candidates.map((candidate) => [String(candidate.current.rowId), candidate])
  );
  const simulatedPersisted: PersistedAtomicCardProjection = canSimulate
    ? {
        ...persisted,
        entries: persisted.entries.map((entry) => {
          const candidate = entry.rowId ? candidateByRowId.get(entry.rowId) : undefined;
          if (!candidate) return { ...entry };
          return {
            ...entry,
            transactionId: candidate.expected.transactionId,
            statementKey: candidate.expected.statementKey,
            postedDate: candidate.expected.postedDate,
            amountCents: candidate.expected.amountCents,
            entryType: candidate.expected.entryType,
          };
        }),
      }
    : {
        ...persisted,
        entries: persisted.entries.map((entry) => ({ ...entry })),
      };
  const simulatedComparison = compareAtomicCardProjections(shadow, simulatedPersisted);
  if (
    canSimulate &&
    (simulatedComparison.missingTransactionIds.length > 0 ||
      simulatedComparison.duplicatePersistedTransactionIds.length > 0 ||
      simulatedComparison.orphanTransactionIds.length > 0)
  ) {
    addCount(
      blockers,
      'simulation-did-not-close-identity-gap',
      simulatedComparison.missingTransactionIds.length +
        simulatedComparison.duplicatePersistedTransactionIds.length +
        simulatedComparison.orphanTransactionIds.length
    );
  }

  const ready = canSimulate && blockers.size === 0;
  const status: AtomicCardIdentityDryRunStatus =
    missingEntries.length === 0 ? 'not-needed' : ready ? 'ready' : 'blocked';
  const effectiveComparison = ready ? simulatedComparison : comparison;

  const changeProfileCounts = new Map<string, AtomicCardIdentityDryRunChangeProfile>();
  candidates.forEach((candidate) => {
    const profile: AtomicCardIdentityDryRunChangeProfile = {
      code: candidate.changeCode,
      fromStatementKey: candidate.current.statementKey,
      toStatementKey: candidate.expected.statementKey,
      fromEntryType: candidate.current.entryType,
      toEntryType: candidate.expected.entryType,
      count: 1,
    };
    const key = [
      profile.code,
      profile.fromStatementKey,
      profile.toStatementKey,
      profile.fromEntryType,
      profile.toEntryType,
    ].join('|');
    const existing = changeProfileCounts.get(key);
    if (existing) existing.count += 1;
    else changeProfileCounts.set(key, profile);
  });
  const changeProfiles = Array.from(changeProfileCounts.values()).sort((left, right) =>
    [left.fromStatementKey, left.toStatementKey, left.code, left.fromEntryType, left.toEntryType]
      .join('|')
      .localeCompare(
        [right.fromStatementKey, right.toStatementKey, right.code, right.fromEntryType, right.toEntryType]
          .join('|')
      )
  );

  const sourceKeys = Array.from(
    new Set(candidates.map((candidate) => comparableImportOriginKey(candidate.sourceFileName)))
  ).sort();
  const sourceCohorts = sourceKeys.map((sourceKey, index) => {
    const cohortCandidates = candidates.filter(
      (candidate) => comparableImportOriginKey(candidate.sourceFileName) === sourceKey
    );
    return {
      cohort: `origem-${String(index + 1).padStart(2, '0')}`,
      fromStatementKeys: Array.from(
        new Set(cohortCandidates.map((candidate) => candidate.current.statementKey))
      ).sort(),
      toStatementKeys: Array.from(
        new Set(cohortCandidates.map((candidate) => candidate.expected.statementKey))
      ).sort(),
      candidateCount: cohortCandidates.length,
      competenceChangeCount: cohortCandidates.filter(
        (candidate) => candidate.current.statementKey !== candidate.expected.statementKey
      ).length,
      typeChangeCount: cohortCandidates.filter(
        (candidate) => candidate.current.entryType !== candidate.expected.entryType
      ).length,
      confirmedAnchorCount: cohortCandidates.length,
    } satisfies AtomicCardIdentityDryRunSourceCohort;
  });

  const recommendationCodes: AtomicCardIdentityDryRunRecommendationCode[] = [];
  if (status === 'not-needed') {
    recommendationCodes.push('no-identity-reconstruction-needed');
  } else if (status === 'ready') {
    recommendationCodes.push('review-individual-dry-run', 'preserve-confirmed-anchors');
    if (candidates.some((candidate) => candidate.current.statementKey !== candidate.expected.statementKey)) {
      recommendationCodes.push('review-competence-changes');
    }
    if (candidates.some((candidate) => candidate.current.entryType !== candidate.expected.entryType)) {
      recommendationCodes.push('review-type-changes');
    }
    if (simulatedComparison.structuralDifferenceCount > 0) {
      recommendationCodes.push('residual-structural-differences-remain');
    }
    recommendationCodes.push('snapshot-before-future-execution', 'keep-writes-disabled');
  } else {
    recommendationCodes.push('investigate-dry-run-blockers', 'keep-writes-disabled');
  }

  const report: AtomicCardIdentityDryRunReport = {
    version: 1,
    privacy: 'aggregated-no-identifiers',
    nonAuthoritative: true,
    executable: false,
    mutationPayloadIncluded: false,
    actualWriteOperationCount: 0,
    checksum: shadow.checksum,
    status,
    rowCountBefore: persisted.entries.length,
    rowCountAfter: simulatedPersisted.entries.length,
    rowCountDelta: simulatedPersisted.entries.length - persisted.entries.length,
    candidateCount: candidates.length,
    hypotheticalUpdateCount: ready ? candidates.length : 0,
    confirmedAnchorCount: candidates.length,
    unresolvedCount: Math.max(0, missingEntries.length - candidates.length),
    before: summaryFromComparison(comparison),
    after: summaryFromComparison(effectiveComparison),
    residualDifferenceCount: effectiveComparison.differenceCount,
    changeProfiles,
    blockerProfiles: BLOCKER_ORDER
      .map((code) => ({ code, count: blockers.get(code) || 0 }))
      .filter((profile) => profile.count > 0),
    sourceCohorts,
    recommendationCodes,
  };

  return { persisted: simulatedPersisted, report };
}

export function buildAtomicCardIdentityDryRunReport(
  shadow: AtomicCardShadowProjection,
  persisted: PersistedAtomicCardProjection,
  comparison: AtomicCardProjectionComparison,
  provenance: AtomicCardProvenanceReport
): AtomicCardIdentityDryRunReport {
  return simulateAtomicCardIdentityDryRun(
    shadow,
    persisted,
    comparison,
    provenance
  ).report;
}
