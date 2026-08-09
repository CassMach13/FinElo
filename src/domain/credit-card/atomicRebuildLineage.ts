import type {
  AtomicCardProjectionComparison,
  AtomicCardShadowEntry,
  AtomicCardShadowProjection,
  PersistedAtomicCardEntry,
  PersistedAtomicCardProjection,
} from './atomicRebuildShadow';

export type AtomicCardLineageStatus =
  | 'clean'
  | 'explained-no-safe-repair'
  | 'partially-explained'
  | 'unresolved';

export type AtomicCardLineageMatchCode =
  | 'exact-content-unique'
  | 'exact-content-ambiguous'
  | 'competence-shift-unique'
  | 'competence-shift-ambiguous'
  | 'type-shift-unique'
  | 'type-shift-ambiguous'
  | 'date-amount-only'
  | 'unmatched';

export type AtomicCardLineageRecommendationCode =
  | 'row-count-conserved-not-deleted'
  | 'identity-surplus-balances-missing'
  | 'content-signatures-explain-missing'
  | 'restore-source-provenance-before-repair'
  | 'review-competence-before-identity-repair'
  | 'do-not-reimport'
  | 'keep-activation-blocked'
  | 'deterministic-repair-path-available'
  | 'unexplained-row-gap';

export interface AtomicCardLineageMatchProfile {
  code: AtomicCardLineageMatchCode;
  count: number;
}

export interface AtomicCardLineageSourceCohort {
  /** Rótulo opaco; o nome real do arquivo não integra o relatório. */
  cohort: string;
  statementKeys: string[];
  projectedEntryCount: number;
  missingIdentityCount: number;
  duplicateIdentityGroupCount: number;
  duplicateExcessRowCount: number;
  distinctSourceRowSignatureCount: number;
  repeatedSourceRowSignatureCount: number;
}

export interface AtomicCardLineageConservation {
  projectedRowCount: number;
  persistedRowCount: number;
  projectedUniqueIdentityCount: number;
  persistedUniqueIdentityCount: number;
  rowCountDelta: number;
  duplicateIdentityGroupCount: number;
  duplicateExcessRowCount: number;
  missingIdentityCount: number;
  orphanIdentityCount: number;
  rowCountConserved: boolean;
  missingBalancedByDuplicateSurplus: boolean;
}

export interface AtomicCardLineageReport {
  version: 1;
  /** Agregado por competência e coorte opaca; nunca contém IDs, hashes ou nomes de arquivos. */
  privacy: 'aggregated-no-identifiers';
  /** O pareamento serve para explicação e não autoriza remoção ou atualização. */
  nonAuthoritative: true;
  checksum: string;
  status: AtomicCardLineageStatus;
  conservation: AtomicCardLineageConservation;
  matchProfiles: AtomicCardLineageMatchProfile[];
  matchedIdentityCount: number;
  unexplainedMissingIdentityCount: number;
  unexplainedSurplusRowCount: number;
  sourceCohortCount: number;
  sourceCohorts: AtomicCardLineageSourceCohort[];
  deterministicRepairRowCount: number;
  recommendationCodes: AtomicCardLineageRecommendationCode[];
}

interface SurplusEntry {
  entry: PersistedAtomicCardEntry;
  ownerSourceFileName: string | null;
}

interface MutableMatchState {
  missing: AtomicCardShadowEntry[];
  surplus: SurplusEntry[];
  counts: Map<AtomicCardLineageMatchCode, number>;
}

const fullSignature = (
  entry: AtomicCardShadowEntry | PersistedAtomicCardEntry
): string =>
  [entry.statementKey, entry.postedDate || '', entry.amountCents, entry.entryType].join('|');

const economicSignature = (
  entry: AtomicCardShadowEntry | PersistedAtomicCardEntry
): string => [entry.postedDate || '', entry.amountCents, entry.entryType].join('|');

const dateAmountStatementSignature = (
  entry: AtomicCardShadowEntry | PersistedAtomicCardEntry
): string => [entry.statementKey, entry.postedDate || '', entry.amountCents].join('|');

const dateAmountSignature = (
  entry: AtomicCardShadowEntry | PersistedAtomicCardEntry
): string => [entry.postedDate || '', entry.amountCents].join('|');

const persistedSortKey = (entry: PersistedAtomicCardEntry): string =>
  [fullSignature(entry), entry.rowId || ''].join('|');

const shadowSortKey = (entry: AtomicCardShadowEntry): string =>
  [fullSignature(entry), entry.sourceRowHash, entry.transactionId].join('|');

const differenceScore = (
  current: PersistedAtomicCardEntry,
  expected: AtomicCardShadowEntry | undefined
): number => {
  if (!expected) return 100;
  let score = 0;
  if ((current.postedDate || '') !== expected.postedDate) score += 16;
  if (current.amountCents !== expected.amountCents) score += 16;
  if (current.entryType !== expected.entryType) score += 8;
  if (current.statementKey !== expected.statementKey) score += 1;
  return score;
};

const addCount = <TKey extends string>(
  counts: Map<TKey, number>,
  key: TKey,
  amount = 1
): void => {
  counts.set(key, (counts.get(key) || 0) + amount);
};

const groupIndexes = <T>(
  items: T[],
  keyOf: (item: T) => string
): Map<string, number[]> => {
  const groups = new Map<string, number[]>();
  items.forEach((item, index) => {
    const key = keyOf(item);
    const indexes = groups.get(key) || [];
    indexes.push(index);
    groups.set(key, indexes);
  });
  return groups;
};

const consumeMatchStage = (
  state: MutableMatchState,
  missingKey: (entry: AtomicCardShadowEntry) => string,
  surplusKey: (entry: PersistedAtomicCardEntry) => string,
  uniqueCode: AtomicCardLineageMatchCode,
  ambiguousCode: AtomicCardLineageMatchCode
): void => {
  const missingGroups = groupIndexes(state.missing, missingKey);
  const surplusGroups = groupIndexes(state.surplus, (candidate) => surplusKey(candidate.entry));
  const consumedMissing = new Set<number>();
  const consumedSurplus = new Set<number>();

  Array.from(missingGroups.keys())
    .filter((key) => surplusGroups.has(key))
    .sort()
    .forEach((key) => {
      const missingIndexes = missingGroups.get(key) || [];
      const surplusIndexes = surplusGroups.get(key) || [];
      const matchCount = Math.min(missingIndexes.length, surplusIndexes.length);
      if (matchCount === 0) return;
      const code =
        missingIndexes.length === 1 && surplusIndexes.length === 1
          ? uniqueCode
          : ambiguousCode;
      addCount(state.counts, code, matchCount);
      missingIndexes.slice(0, matchCount).forEach((index) => consumedMissing.add(index));
      surplusIndexes.slice(0, matchCount).forEach((index) => consumedSurplus.add(index));
    });

  state.missing = state.missing.filter((_, index) => !consumedMissing.has(index));
  state.surplus = state.surplus.filter((_, index) => !consumedSurplus.has(index));
};

const MATCH_ORDER: AtomicCardLineageMatchCode[] = [
  'exact-content-unique',
  'exact-content-ambiguous',
  'competence-shift-unique',
  'competence-shift-ambiguous',
  'type-shift-unique',
  'type-shift-ambiguous',
  'date-amount-only',
  'unmatched',
];

/**
 * Reconstrói uma explicação agregada para déficits de identidade sem tocar no banco.
 *
 * Uma linha excedente de um ID duplicado não é automaticamente removível. O algoritmo
 * reserva a linha mais próxima da identidade atual e usa apenas o excedente para medir
 * sobreposição de conteúdo com identidades ausentes. O resultado é diagnóstico, nunca
 * um plano de reparo.
 */
export function buildAtomicCardLineageReport(
  shadow: AtomicCardShadowProjection,
  persisted: PersistedAtomicCardProjection,
  comparison: AtomicCardProjectionComparison
): AtomicCardLineageReport {
  const shadowByIdentity = new Map(
    shadow.entries.map((entry) => [entry.transactionId, entry])
  );
  const persistedByIdentity = new Map<string, PersistedAtomicCardEntry[]>();
  persisted.entries.forEach((entry) => {
    const rows = persistedByIdentity.get(entry.transactionId) || [];
    rows.push(entry);
    persistedByIdentity.set(entry.transactionId, rows);
  });

  const duplicateGroups = Array.from(persistedByIdentity.entries())
    .filter(([, rows]) => rows.length > 1)
    .sort(([left], [right]) => left.localeCompare(right));
  const surplus: SurplusEntry[] = [];
  duplicateGroups.forEach(([transactionId, rows]) => {
    const expected = shadowByIdentity.get(transactionId);
    const ordered = [...rows].sort((left, right) => {
      const byScore = differenceScore(left, expected) - differenceScore(right, expected);
      if (byScore !== 0) return byScore;
      return persistedSortKey(left).localeCompare(persistedSortKey(right));
    });
    ordered.slice(1).forEach((entry) => {
      surplus.push({
        entry,
        ownerSourceFileName: expected?.sourceFileName || null,
      });
    });
  });
  surplus.sort((left, right) => persistedSortKey(left.entry).localeCompare(persistedSortKey(right.entry)));

  const missing = comparison.missingTransactionIds
    .map((transactionId) => shadowByIdentity.get(transactionId))
    .filter((entry): entry is AtomicCardShadowEntry => Boolean(entry))
    .sort((left, right) => shadowSortKey(left).localeCompare(shadowSortKey(right)));

  const matchState: MutableMatchState = {
    missing: [...missing],
    surplus: [...surplus],
    counts: new Map(),
  };
  consumeMatchStage(
    matchState,
    fullSignature,
    fullSignature,
    'exact-content-unique',
    'exact-content-ambiguous'
  );
  consumeMatchStage(
    matchState,
    economicSignature,
    economicSignature,
    'competence-shift-unique',
    'competence-shift-ambiguous'
  );
  consumeMatchStage(
    matchState,
    dateAmountStatementSignature,
    dateAmountStatementSignature,
    'type-shift-unique',
    'type-shift-ambiguous'
  );
  consumeMatchStage(
    matchState,
    dateAmountSignature,
    dateAmountSignature,
    'date-amount-only',
    'date-amount-only'
  );
  if (matchState.missing.length > 0) {
    addCount(matchState.counts, 'unmatched', matchState.missing.length);
  }

  const projectedUniqueIdentityCount = new Set(
    shadow.entries.map((entry) => entry.transactionId)
  ).size;
  const persistedUniqueIdentityCount = persistedByIdentity.size;
  const duplicateExcessRowCount = duplicateGroups.reduce(
    (sum, [, rows]) => sum + Math.max(0, rows.length - 1),
    0
  );
  const rowCountDelta = persisted.entries.length - shadow.entries.length;
  const missingIdentityCount = comparison.missingTransactionIds.length;
  const orphanIdentityCount = comparison.orphanTransactionIds.length;
  const rowCountConserved = rowCountDelta === 0;
  const missingBalancedByDuplicateSurplus =
    rowCountConserved &&
    orphanIdentityCount === 0 &&
    projectedUniqueIdentityCount === shadow.entries.length &&
    missingIdentityCount === duplicateExcessRowCount;

  const affectedSourceFiles = new Set<string>();
  missing.forEach((entry) => affectedSourceFiles.add(entry.sourceFileName));
  duplicateGroups.forEach(([transactionId]) => {
    const expected = shadowByIdentity.get(transactionId);
    if (expected) affectedSourceFiles.add(expected.sourceFileName);
  });
  const sourceNames = Array.from(affectedSourceFiles).sort();
  const sourceCohorts = sourceNames.map((sourceFileName, index) => {
    const projectedEntries = shadow.entries.filter(
      (entry) => entry.sourceFileName === sourceFileName
    );
    const missingEntries = missing.filter(
      (entry) => entry.sourceFileName === sourceFileName
    );
    const sourceDuplicateGroups = duplicateGroups.filter(([transactionId]) =>
      shadowByIdentity.get(transactionId)?.sourceFileName === sourceFileName
    );
    const rowHashCounts = new Map<string, number>();
    projectedEntries.forEach((entry) => addCount(rowHashCounts, entry.sourceRowHash));
    const repeatedSourceRowSignatureCount = Array.from(rowHashCounts.values()).reduce(
      (sum, count) => sum + Math.max(0, count - 1),
      0
    );
    return {
      cohort: `origem-${String(index + 1).padStart(2, '0')}`,
      statementKeys: Array.from(
        new Set(projectedEntries.map((entry) => entry.statementKey))
      ).sort(),
      projectedEntryCount: projectedEntries.length,
      missingIdentityCount: missingEntries.length,
      duplicateIdentityGroupCount: sourceDuplicateGroups.length,
      duplicateExcessRowCount: sourceDuplicateGroups.reduce(
        (sum, [, rows]) => sum + Math.max(0, rows.length - 1),
        0
      ),
      distinctSourceRowSignatureCount: rowHashCounts.size,
      repeatedSourceRowSignatureCount,
    } satisfies AtomicCardLineageSourceCohort;
  });

  const matchProfiles = MATCH_ORDER
    .map((code) => ({ code, count: matchState.counts.get(code) || 0 }))
    .filter((profile) => profile.count > 0);
  const unmatchedCount = matchState.counts.get('unmatched') || 0;
  const matchedIdentityCount = missingIdentityCount - unmatchedCount;

  let status: AtomicCardLineageStatus = 'unresolved';
  if (
    missingIdentityCount === 0 &&
    duplicateExcessRowCount === 0 &&
    orphanIdentityCount === 0
  ) {
    status = 'clean';
  } else if (
    missingBalancedByDuplicateSurplus &&
    unmatchedCount === 0 &&
    comparison.repairablePersistedEntryRowIds.length === 0
  ) {
    status = 'explained-no-safe-repair';
  } else if (matchedIdentityCount > 0 || missingBalancedByDuplicateSurplus) {
    status = 'partially-explained';
  }

  const recommendationCodes: AtomicCardLineageRecommendationCode[] = [];
  if (rowCountConserved) {
    recommendationCodes.push('row-count-conserved-not-deleted');
  }
  if (missingIdentityCount > 0 && missingBalancedByDuplicateSurplus) {
    recommendationCodes.push('identity-surplus-balances-missing');
  }
  if (missingIdentityCount > 0 && unmatchedCount === 0) {
    recommendationCodes.push('content-signatures-explain-missing');
  }
  if (comparison.conflictingDuplicatePersistedTransactionIds.length > 0) {
    recommendationCodes.push('restore-source-provenance-before-repair');
  }
  if (comparison.changedTransactionIds.length > 0) {
    recommendationCodes.push('review-competence-before-identity-repair');
  }
  if (duplicateExcessRowCount > 0 || missingIdentityCount > 0) {
    recommendationCodes.push('do-not-reimport');
    recommendationCodes.push('keep-activation-blocked');
  }
  if (comparison.repairablePersistedEntryRowIds.length > 0) {
    recommendationCodes.push('deterministic-repair-path-available');
  }
  if (!rowCountConserved || unmatchedCount > 0 || matchState.surplus.length > 0) {
    recommendationCodes.push('unexplained-row-gap');
  }

  return {
    version: 1,
    privacy: 'aggregated-no-identifiers',
    nonAuthoritative: true,
    checksum: shadow.checksum,
    status,
    conservation: {
      projectedRowCount: shadow.entries.length,
      persistedRowCount: persisted.entries.length,
      projectedUniqueIdentityCount,
      persistedUniqueIdentityCount,
      rowCountDelta,
      duplicateIdentityGroupCount: duplicateGroups.length,
      duplicateExcessRowCount,
      missingIdentityCount,
      orphanIdentityCount,
      rowCountConserved,
      missingBalancedByDuplicateSurplus,
    },
    matchProfiles,
    matchedIdentityCount,
    unexplainedMissingIdentityCount: unmatchedCount,
    unexplainedSurplusRowCount: matchState.surplus.length,
    sourceCohortCount: sourceCohorts.length,
    sourceCohorts,
    deterministicRepairRowCount: comparison.repairablePersistedEntryRowIds.length,
    recommendationCodes,
  };
}
