import { comparableImportOriginKey } from '../../utils/importOriginKey';
import {
  buildAtomicCardCompetenceForensicReport,
  type AtomicCardCompetenceEvidenceCycle,
  type AtomicCardCompetenceEvidenceSource,
  type AtomicCardCompetenceForensicReport,
} from './atomicRebuildCompetenceForensics';
import {
  compareAtomicCardProjections,
  type AtomicCardProjectionComparison,
  type AtomicCardShadowEntry,
  type AtomicCardShadowProjection,
  type PersistedAtomicCardEntry,
  type PersistedAtomicCardProjection,
} from './atomicRebuildShadow';

export type AtomicCardCompetenceDryRunStatus =
  | 'not-needed'
  | 'ready'
  | 'partial'
  | 'blocked';

export type AtomicCardCompetenceDryRunBlockerCode =
  | 'persisted-source-not-engine'
  | 'forensic-report-not-eligible'
  | 'row-count-not-conserved'
  | 'unmatched-row'
  | 'ambiguous-row'
  | 'economic-content-mismatch'
  | 'no-safe-candidates';

export type AtomicCardCompetenceDryRunExclusionCode =
  | 'missing-row-identity'
  | 'identity-mismatch'
  | 'duplicate-current-identity'
  | 'type-mismatch'
  | 'duplicate-statement-key'
  | 'unconfirmed-competence-evidence';

export type AtomicCardCompetenceDryRunRecommendationCode =
  | 'no-competence-change-needed'
  | 'review-competence-only-simulation'
  | 'preserve-identity-date-value-and-type'
  | 'resolve-excluded-structural-anomalies'
  | 'preserve-protected-statement-metadata'
  | 'investigate-dry-run-blockers'
  | 'future-execution-requires-snapshot'
  | 'keep-writes-disabled';

export interface AtomicCardCompetenceDryRunComparisonSummary {
  changedTransactionCount: number;
  changedStatementCount: number;
  changedPaymentCount: number;
  structuralDifferenceCount: number;
  differenceCount: number;
}

export interface AtomicCardCompetenceDryRunChangeProfile {
  fromStatementKey: string;
  toStatementKey: string;
  evidenceSource: AtomicCardCompetenceEvidenceSource;
  count: number;
}

export interface AtomicCardCompetenceDryRunExclusionProfile {
  code: AtomicCardCompetenceDryRunExclusionCode;
  count: number;
}

export interface AtomicCardCompetenceDryRunBlockerProfile {
  code: AtomicCardCompetenceDryRunBlockerCode;
  count: number;
}

export interface AtomicCardCompetenceDryRunReport {
  version: 1;
  privacy: 'aggregated-no-identifiers';
  nonAuthoritative: true;
  executable: false;
  mutationPayloadIncluded: false;
  actualWriteOperationCount: 0;
  checksum: string;
  status: AtomicCardCompetenceDryRunStatus;
  rowCountBefore: number;
  rowCountAfter: number;
  rowCountDelta: number;
  competenceMismatchBefore: number;
  competenceMismatchAfter: number;
  alreadyAlignedCount: number;
  candidateCount: number;
  hypotheticalUpdateCount: number;
  excludedRowCount: number;
  protectedMetadataTouchCount: number;
  identityMutationCount: number;
  dateMutationCount: number;
  amountMutationCount: number;
  typeMutationCount: number;
  sourceMutationCount: number;
  statementRecordMutationCount: 0;
  paymentRecordMutationCount: 0;
  before: AtomicCardCompetenceDryRunComparisonSummary;
  after: AtomicCardCompetenceDryRunComparisonSummary;
  residualStructuralDifferenceCount: number;
  eligibleForFutureScopedExecution: boolean;
  changeProfiles: AtomicCardCompetenceDryRunChangeProfile[];
  exclusionProfiles: AtomicCardCompetenceDryRunExclusionProfile[];
  blockerProfiles: AtomicCardCompetenceDryRunBlockerProfile[];
  recommendationCodes: AtomicCardCompetenceDryRunRecommendationCode[];
}

export interface AtomicCardCompetenceDryRunSimulation {
  /** Internal clone used only to compose later in-memory diagnostics. */
  persisted: PersistedAtomicCardProjection;
  report: AtomicCardCompetenceDryRunReport;
}

type MatchResult =
  | { status: 'matched'; current: PersistedAtomicCardEntry }
  | { status: 'ambiguous' }
  | { status: 'missing' };

interface InternalCandidate {
  current: PersistedAtomicCardEntry;
  expected: AtomicCardShadowEntry;
  evidenceSource: AtomicCardCompetenceEvidenceSource;
}

const CONFIRMED_EVIDENCE = new Set<AtomicCardCompetenceEvidenceSource>([
  'confirmed-import-history',
  'session-confirmed',
  'persisted-import-history',
  'manual-transaction-rule',
]);

const EXCLUSION_ORDER: AtomicCardCompetenceDryRunExclusionCode[] = [
  'missing-row-identity',
  'identity-mismatch',
  'duplicate-current-identity',
  'type-mismatch',
  'duplicate-statement-key',
  'unconfirmed-competence-evidence',
];

const BLOCKER_ORDER: AtomicCardCompetenceDryRunBlockerCode[] = [
  'persisted-source-not-engine',
  'forensic-report-not-eligible',
  'row-count-not-conserved',
  'unmatched-row',
  'ambiguous-row',
  'economic-content-mismatch',
  'no-safe-candidates',
];

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

const economicContentMatches = (
  expected: AtomicCardShadowEntry,
  current: PersistedAtomicCardEntry
): boolean =>
  (current.postedDate || '') === expected.postedDate &&
  current.amountCents === expected.amountCents;

const chooseMatch = (
  expected: AtomicCardShadowEntry,
  persistedBySource: Map<string, PersistedAtomicCardEntry[]>,
  persistedByIdentity: Map<string, PersistedAtomicCardEntry[]>
): MatchResult => {
  const provenanceKey = sourceIdentityKey(expected);
  const bySource = provenanceKey ? persistedBySource.get(provenanceKey) || [] : [];
  if (bySource.length === 1) return { status: 'matched', current: bySource[0] };
  if (bySource.length > 1) return { status: 'ambiguous' };

  const byIdentity = persistedByIdentity.get(expected.transactionId) || [];
  if (byIdentity.length === 1) return { status: 'matched', current: byIdentity[0] };
  if (byIdentity.length > 1) {
    const economicMatches = byIdentity.filter((current) =>
      economicContentMatches(expected, current)
    );
    if (economicMatches.length === 1) return { status: 'matched', current: economicMatches[0] };
    return { status: 'ambiguous' };
  }
  return { status: 'missing' };
};

const addCount = <TKey extends string>(
  counts: Map<TKey, number>,
  key: TKey,
  amount = 1
): void => {
  counts.set(key, (counts.get(key) || 0) + amount);
};

const evidenceSourceFor = (
  expected: AtomicCardShadowEntry,
  cyclesByOrigin: Map<string, AtomicCardCompetenceEvidenceCycle>
): AtomicCardCompetenceEvidenceSource => {
  if (expected.sourceFileName.startsWith('manual:')) return 'manual-transaction-rule';
  return cyclesByOrigin.get(comparableImportOriginKey(expected.sourceFileName))?.source || 'unknown';
};

const comparisonSummary = (
  comparison: AtomicCardProjectionComparison
): AtomicCardCompetenceDryRunComparisonSummary => ({
  changedTransactionCount: comparison.changedTransactionIds.length,
  changedStatementCount: comparison.changedStatementKeys.length,
  changedPaymentCount: comparison.changedPaymentTransactionIds.length,
  structuralDifferenceCount: comparison.structuralDifferenceCount,
  differenceCount: comparison.differenceCount,
});

/**
 * Simula somente a troca de competÃªncia de linhas individualmente comprovadas.
 *
 * A projeÃ§Ã£o persistida Ã© clonada em memÃ³ria e apenas `statementKey` pode mudar.
 * Identidade, data, valor, tipo, proveniÃªncia, faturas e pagamentos permanecem
 * intocados. O relatÃ³rio pÃºblico Ã© agregado e nÃ£o carrega payload executÃ¡vel.
 */
export function simulateAtomicCardCompetenceDryRun(input: {
  shadow: AtomicCardShadowProjection;
  persisted: PersistedAtomicCardProjection;
  comparison: AtomicCardProjectionComparison;
  forensics: AtomicCardCompetenceForensicReport;
  cycles: AtomicCardCompetenceEvidenceCycle[];
  closingDay?: number | null;
}): AtomicCardCompetenceDryRunSimulation {
  const { shadow, persisted, comparison, forensics, cycles } = input;
  const blockers = new Map<AtomicCardCompetenceDryRunBlockerCode, number>();
  const exclusions = new Map<AtomicCardCompetenceDryRunExclusionCode, number>();
  const persistedBySource = groupBy(persisted.entries, (entry) => sourceIdentityKey(entry));
  const persistedByIdentity = groupBy(persisted.entries, (entry) => entry.transactionId);
  const cyclesByOrigin = new Map(
    cycles.map((cycle) => [comparableImportOriginKey(cycle.sourceFileName), cycle])
  );
  const duplicateIdentities = new Set(comparison.duplicatePersistedTransactionIds);
  const duplicateStatementKeys = new Set(comparison.duplicatePersistedStatementKeys);
  const protectedStatementKeys = new Set(comparison.protectedMetadataStatementKeys);
  const candidates: InternalCandidate[] = [];
  let alreadyAlignedCount = 0;
  let excludedRowCount = 0;
  let protectedMetadataTouchCount = 0;

  if (persisted.source !== 'engine') addCount(blockers, 'persisted-source-not-engine');
  if (
    forensics.status !== 'aligned' &&
    !forensics.eligibleForFutureCompetenceDryRun
  ) {
    addCount(blockers, 'forensic-report-not-eligible');
  }
  if (persisted.entries.length !== shadow.entries.length) {
    addCount(
      blockers,
      'row-count-not-conserved',
      Math.abs(persisted.entries.length - shadow.entries.length) || 1
    );
  }

  shadow.entries.forEach((expected) => {
    const match = chooseMatch(expected, persistedBySource, persistedByIdentity);
    if (match.status === 'missing') {
      addCount(blockers, 'unmatched-row');
      return;
    }
    if (match.status === 'ambiguous') {
      addCount(blockers, 'ambiguous-row');
      return;
    }
    const current = match.current;
    if (!economicContentMatches(expected, current)) {
      addCount(blockers, 'economic-content-mismatch');
      return;
    }
    if (current.statementKey === expected.statementKey) {
      alreadyAlignedCount += 1;
      return;
    }

    const evidenceSource = evidenceSourceFor(expected, cyclesByOrigin);
    let exclusion: AtomicCardCompetenceDryRunExclusionCode | null = null;
    if (!current.rowId) exclusion = 'missing-row-identity';
    else if (current.transactionId !== expected.transactionId) exclusion = 'identity-mismatch';
    else if (duplicateIdentities.has(current.transactionId)) exclusion = 'duplicate-current-identity';
    else if (current.entryType !== expected.entryType) exclusion = 'type-mismatch';
    else if (
      duplicateStatementKeys.has(current.statementKey) ||
      duplicateStatementKeys.has(expected.statementKey)
    ) {
      exclusion = 'duplicate-statement-key';
    } else if (!CONFIRMED_EVIDENCE.has(evidenceSource)) {
      exclusion = 'unconfirmed-competence-evidence';
    }

    if (exclusion) {
      excludedRowCount += 1;
      addCount(exclusions, exclusion);
      return;
    }

    if (
      protectedStatementKeys.has(current.statementKey) ||
      protectedStatementKeys.has(expected.statementKey)
    ) {
      protectedMetadataTouchCount += 1;
    }
    candidates.push({ current, expected, evidenceSource });
  });

  if (
    forensics.competenceMismatchCount > 0 &&
    candidates.length === 0 &&
    blockers.size === 0
  ) {
    addCount(blockers, 'no-safe-candidates');
  }

  const canSimulate =
    forensics.competenceMismatchCount > 0 &&
    blockers.size === 0 &&
    candidates.length > 0;
  const candidateByRowId = new Map(
    candidates.map((candidate) => [String(candidate.current.rowId), candidate])
  );
  const simulatedPersisted: PersistedAtomicCardProjection = {
    ...persisted,
    statements: persisted.statements.map((statement) => ({ ...statement })),
    payments: persisted.payments.map((payment) => ({ ...payment })),
    entries: persisted.entries.map((entry) => {
      const candidate = canSimulate && entry.rowId
        ? candidateByRowId.get(entry.rowId)
        : undefined;
      return candidate
        ? { ...entry, statementKey: candidate.expected.statementKey }
        : { ...entry };
    }),
  };

  let identityMutationCount = 0;
  let dateMutationCount = 0;
  let amountMutationCount = 0;
  let typeMutationCount = 0;
  let sourceMutationCount = 0;
  if (canSimulate) {
    const simulatedByRowId = new Map(
      simulatedPersisted.entries
        .filter((entry) => entry.rowId)
        .map((entry) => [String(entry.rowId), entry])
    );
    candidates.forEach(({ current }) => {
      const simulated = simulatedByRowId.get(String(current.rowId));
      if (!simulated) return;
      if (simulated.transactionId !== current.transactionId) identityMutationCount += 1;
      if (simulated.postedDate !== current.postedDate) dateMutationCount += 1;
      if (simulated.amountCents !== current.amountCents) amountMutationCount += 1;
      if (simulated.entryType !== current.entryType) typeMutationCount += 1;
      if (
        simulated.sourceFileName !== current.sourceFileName ||
        simulated.sourceRowHash !== current.sourceRowHash ||
        simulated.sourceRowIndex !== current.sourceRowIndex ||
        simulated.importLotId !== current.importLotId
      ) {
        sourceMutationCount += 1;
      }
    });
  }

  const simulatedComparison = compareAtomicCardProjections(shadow, simulatedPersisted);
  const simulatedForensics = buildAtomicCardCompetenceForensicReport({
    shadow,
    persisted: simulatedPersisted,
    cycles,
    closingDay: input.closingDay,
  });
  const status: AtomicCardCompetenceDryRunStatus =
    blockers.size > 0
      ? 'blocked'
      : forensics.competenceMismatchCount === 0
        ? 'not-needed'
        : excludedRowCount > 0
          ? 'partial'
          : 'ready';

  const changeProfilesByKey = new Map<string, AtomicCardCompetenceDryRunChangeProfile>();
  candidates.forEach((candidate) => {
    const profile: AtomicCardCompetenceDryRunChangeProfile = {
      fromStatementKey: candidate.current.statementKey,
      toStatementKey: candidate.expected.statementKey,
      evidenceSource: candidate.evidenceSource,
      count: 1,
    };
    const key = [profile.fromStatementKey, profile.toStatementKey, profile.evidenceSource].join('|');
    const current = changeProfilesByKey.get(key);
    if (current) current.count += 1;
    else changeProfilesByKey.set(key, profile);
  });

  const invariantMutationCount =
    identityMutationCount +
    dateMutationCount +
    amountMutationCount +
    typeMutationCount +
    sourceMutationCount;
  const eligibleForFutureScopedExecution =
    status === 'ready' &&
    simulatedForensics.competenceMismatchCount === 0 &&
    invariantMutationCount === 0 &&
    simulatedComparison.structuralDifferenceCount === 0 &&
    protectedMetadataTouchCount === 0;

  const recommendationCodes: AtomicCardCompetenceDryRunRecommendationCode[] = [];
  if (status === 'not-needed') {
    recommendationCodes.push('no-competence-change-needed');
  } else {
    if (status === 'blocked') recommendationCodes.push('investigate-dry-run-blockers');
    else recommendationCodes.push('review-competence-only-simulation');
    recommendationCodes.push('preserve-identity-date-value-and-type');
    if (excludedRowCount > 0) {
      recommendationCodes.push('resolve-excluded-structural-anomalies');
    }
    if (protectedMetadataTouchCount > 0) {
      recommendationCodes.push('preserve-protected-statement-metadata');
    }
    if (eligibleForFutureScopedExecution) {
      recommendationCodes.push('future-execution-requires-snapshot');
    }
    recommendationCodes.push('keep-writes-disabled');
  }

  const report: AtomicCardCompetenceDryRunReport = {
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
    competenceMismatchBefore: forensics.competenceMismatchCount,
    competenceMismatchAfter: simulatedForensics.competenceMismatchCount,
    alreadyAlignedCount,
    candidateCount: candidates.length,
    hypotheticalUpdateCount: canSimulate ? candidates.length : 0,
    excludedRowCount,
    protectedMetadataTouchCount,
    identityMutationCount,
    dateMutationCount,
    amountMutationCount,
    typeMutationCount,
    sourceMutationCount,
    statementRecordMutationCount: 0,
    paymentRecordMutationCount: 0,
    before: comparisonSummary(comparison),
    after: comparisonSummary(simulatedComparison),
    residualStructuralDifferenceCount: simulatedComparison.structuralDifferenceCount,
    eligibleForFutureScopedExecution,
    changeProfiles: Array.from(changeProfilesByKey.values()).sort((left, right) =>
      [left.fromStatementKey, left.toStatementKey, left.evidenceSource]
        .join('|')
        .localeCompare([right.fromStatementKey, right.toStatementKey, right.evidenceSource].join('|'))
    ),
    exclusionProfiles: EXCLUSION_ORDER
      .map((code) => ({ code, count: exclusions.get(code) || 0 }))
      .filter((profile) => profile.count > 0),
    blockerProfiles: BLOCKER_ORDER
      .map((code) => ({ code, count: blockers.get(code) || 0 }))
      .filter((profile) => profile.count > 0),
    recommendationCodes,
  };

  return { persisted: simulatedPersisted, report };
}

export function buildAtomicCardCompetenceDryRunReport(input: {
  shadow: AtomicCardShadowProjection;
  persisted: PersistedAtomicCardProjection;
  comparison: AtomicCardProjectionComparison;
  forensics: AtomicCardCompetenceForensicReport;
  cycles: AtomicCardCompetenceEvidenceCycle[];
  closingDay?: number | null;
}): AtomicCardCompetenceDryRunReport {
  return simulateAtomicCardCompetenceDryRun(input).report;
}
