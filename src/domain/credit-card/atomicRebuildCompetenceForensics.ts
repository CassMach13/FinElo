import { comparableImportOriginKey } from '../../utils/importOriginKey';
import type {
  AtomicCardShadowEntry,
  AtomicCardShadowProjection,
  PersistedAtomicCardEntry,
  PersistedAtomicCardProjection,
} from './atomicRebuildShadow';

export type AtomicCardCompetenceEvidenceSource =
  | 'confirmed-import-history'
  | 'session-confirmed'
  | 'persisted-import-history'
  | 'suggested-automatic'
  | 'manual-transaction-rule'
  | 'unknown';

export interface AtomicCardCompetenceEvidenceCycle {
  sourceFileName: string;
  referenceMonth: string;
  dueDate: string;
  source: AtomicCardCompetenceEvidenceSource;
}

export type AtomicCardCompetenceCauseCode =
  | 'current-keyed-by-due-month'
  | 'current-keyed-by-posted-month'
  | 'current-keyed-by-other-month'
  | 'type-only'
  | 'already-aligned';

export type AtomicCardCompetenceForensicStatus =
  | 'aligned'
  | 'root-cause-isolated'
  | 'review-needed'
  | 'blocked';

export type AtomicCardCompetenceRecommendationCode =
  | 'honor-confirmed-import-competence'
  | 'separate-reference-competence-from-due-month'
  | 'use-closing-day-only-as-fallback'
  | 'preserve-explicit-manual-competence'
  | 'review-type-coupled-exceptions'
  | 'develop-read-only-competence-dry-run'
  | 'investigate-unmatched-rows'
  | 'keep-writes-disabled';

export interface AtomicCardCompetenceCauseProfile {
  code: AtomicCardCompetenceCauseCode;
  count: number;
}

export interface AtomicCardCompetenceEvidenceProfile {
  source: AtomicCardCompetenceEvidenceSource;
  count: number;
}

export interface AtomicCardCompetenceShiftProfile {
  /** DiferenÃ§a em meses de `atual` para `sombra`; -1 = sombra um mÃªs antes. */
  monthsFromCurrentToExpected: number | null;
  count: number;
}

export interface AtomicCardCompetenceForensicReport {
  version: 1;
  privacy: 'aggregated-no-identifiers';
  nonAuthoritative: true;
  executable: false;
  mutationPayloadIncluded: false;
  actualWriteOperationCount: 0;
  checksum: string;
  status: AtomicCardCompetenceForensicStatus;
  confidence: 'high' | 'medium' | 'low' | 'not-applicable';
  dominantCause: AtomicCardCompetenceCauseCode | null;
  persistedSource: PersistedAtomicCardProjection['source'];
  rowCountProjected: number;
  rowCountPersisted: number;
  rowCountConserved: boolean;
  matchedRowCount: number;
  unmatchedProjectedRowCount: number;
  ambiguousMatchCount: number;
  economicMismatchCount: number;
  competenceMismatchCount: number;
  competenceOnlyMismatchCount: number;
  competenceAndTypeMismatchCount: number;
  typeOnlyMismatchCount: number;
  confirmedEvidenceMismatchCount: number;
  closingDayConfigured: boolean;
  closingRuleSupportsExpectedCount: number;
  closingRuleConflictsExpectedCount: number;
  eligibleForFutureCompetenceDryRun: boolean;
  causeProfiles: AtomicCardCompetenceCauseProfile[];
  evidenceProfiles: AtomicCardCompetenceEvidenceProfile[];
  shiftProfiles: AtomicCardCompetenceShiftProfile[];
  recommendationCodes: AtomicCardCompetenceRecommendationCode[];
}

type MatchResult =
  | { status: 'matched'; current: PersistedAtomicCardEntry }
  | { status: 'ambiguous' }
  | { status: 'missing' };

const SOURCE_ORDER: AtomicCardCompetenceEvidenceSource[] = [
  'confirmed-import-history',
  'session-confirmed',
  'persisted-import-history',
  'manual-transaction-rule',
  'suggested-automatic',
  'unknown',
];

const CAUSE_ORDER: AtomicCardCompetenceCauseCode[] = [
  'current-keyed-by-due-month',
  'current-keyed-by-posted-month',
  'current-keyed-by-other-month',
  'type-only',
  'already-aligned',
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

const monthIndex = (value: string): number | null => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 12 + Number(match[2]) - 1;
};

const previousMonth = (value: string): string | null => {
  const index = monthIndex(value);
  if (index == null) return null;
  const previous = index - 1;
  const year = Math.floor(previous / 12);
  const month = (previous % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
};

const competenceFromClosingRule = (postedDate: string, closingDay: number): string | null => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(\d{2})$/.exec(postedDate.trim());
  if (!match) return null;
  const postedMonth = `${match[1]}-${match[2]}`;
  return Number(match[3]) <= closingDay ? previousMonth(postedMonth) : postedMonth;
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
    if (economicMatches.length === 1) {
      return { status: 'matched', current: economicMatches[0] };
    }
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

/**
 * Explica divergÃªncias de competÃªncia exclusivamente em memÃ³ria.
 *
 * O relatÃ³rio pÃºblico Ã© agregado e nÃ£o carrega nomes de arquivo, IDs, hashes,
 * linhas ou qualquer payload que possa ser executado contra o banco.
 */
export function buildAtomicCardCompetenceForensicReport(input: {
  shadow: AtomicCardShadowProjection;
  persisted: PersistedAtomicCardProjection;
  cycles: AtomicCardCompetenceEvidenceCycle[];
  closingDay?: number | null;
}): AtomicCardCompetenceForensicReport {
  const { shadow, persisted, cycles } = input;
  const closingDay = Number(input.closingDay);
  const validClosingDay = Number.isInteger(closingDay) && closingDay >= 1 && closingDay <= 31;
  const persistedBySource = groupBy(persisted.entries, (entry) => sourceIdentityKey(entry));
  const persistedByIdentity = groupBy(persisted.entries, (entry) => entry.transactionId);
  const evidenceByOrigin = new Map(
    cycles.map((cycle) => [
      comparableImportOriginKey(cycle.sourceFileName),
      cycle,
    ])
  );
  const dueMonthByStatement = new Map(
    shadow.statements.map((statement) => [statement.statementKey, statement.dueDate.slice(0, 7)])
  );
  const causes = new Map<AtomicCardCompetenceCauseCode, number>();
  const evidence = new Map<AtomicCardCompetenceEvidenceSource, number>();
  const shifts = new Map<string, { monthsFromCurrentToExpected: number | null; count: number }>();

  let matchedRowCount = 0;
  let unmatchedProjectedRowCount = 0;
  let ambiguousMatchCount = 0;
  let economicMismatchCount = 0;
  let competenceMismatchCount = 0;
  let competenceOnlyMismatchCount = 0;
  let competenceAndTypeMismatchCount = 0;
  let typeOnlyMismatchCount = 0;
  let confirmedEvidenceMismatchCount = 0;
  let closingRuleSupportsExpectedCount = 0;
  let closingRuleConflictsExpectedCount = 0;

  shadow.entries.forEach((expected) => {
    const match = chooseMatch(expected, persistedBySource, persistedByIdentity);
    if (match.status === 'missing') {
      unmatchedProjectedRowCount += 1;
      return;
    }
    if (match.status === 'ambiguous') {
      ambiguousMatchCount += 1;
      return;
    }

    matchedRowCount += 1;
    const current = match.current;
    if (!economicContentMatches(expected, current)) {
      economicMismatchCount += 1;
      return;
    }

    const competenceChanged = current.statementKey !== expected.statementKey;
    const typeChanged = current.entryType !== expected.entryType;
    if (!competenceChanged) {
      if (typeChanged) {
        typeOnlyMismatchCount += 1;
        addCount(causes, 'type-only');
      } else {
        addCount(causes, 'already-aligned');
      }
      return;
    }

    competenceMismatchCount += 1;
    if (typeChanged) competenceAndTypeMismatchCount += 1;
    else competenceOnlyMismatchCount += 1;

    const cycle = evidenceByOrigin.get(comparableImportOriginKey(expected.sourceFileName));
    const evidenceSource: AtomicCardCompetenceEvidenceSource = expected.sourceFileName.startsWith('manual:')
      ? 'manual-transaction-rule'
      : cycle?.source || 'unknown';
    addCount(evidence, evidenceSource);
    if (
      evidenceSource === 'confirmed-import-history' ||
      evidenceSource === 'session-confirmed' ||
      evidenceSource === 'persisted-import-history'
    ) {
      confirmedEvidenceMismatchCount += 1;
    }

    const dueMonth = dueMonthByStatement.get(expected.statementKey) || cycle?.dueDate.slice(0, 7);
    const postedMonth = expected.postedDate.slice(0, 7);
    if (dueMonth && current.statementKey === dueMonth) {
      addCount(causes, 'current-keyed-by-due-month');
    } else if (current.statementKey === postedMonth) {
      addCount(causes, 'current-keyed-by-posted-month');
    } else {
      addCount(causes, 'current-keyed-by-other-month');
    }

    const currentIndex = monthIndex(current.statementKey);
    const expectedIndex = monthIndex(expected.statementKey);
    const offset = currentIndex == null || expectedIndex == null ? null : expectedIndex - currentIndex;
    const shiftKey = offset == null ? 'unknown' : String(offset);
    const shift = shifts.get(shiftKey);
    if (shift) shift.count += 1;
    else shifts.set(shiftKey, { monthsFromCurrentToExpected: offset, count: 1 });

    if (validClosingDay) {
      const fromClosing = competenceFromClosingRule(expected.postedDate, closingDay);
      if (fromClosing === expected.statementKey) closingRuleSupportsExpectedCount += 1;
      else closingRuleConflictsExpectedCount += 1;
    }
  });

  const causeProfiles = CAUSE_ORDER
    .map((code) => ({ code, count: causes.get(code) || 0 }))
    .filter((profile) => profile.count > 0);
  const mismatchCauses = causeProfiles.filter(
    (profile) => profile.code !== 'already-aligned' && profile.code !== 'type-only'
  );
  const dominant = [...mismatchCauses].sort(
    (left, right) => right.count - left.count || left.code.localeCompare(right.code)
  )[0] || null;
  const dominantRatio = competenceMismatchCount > 0
    ? (dominant?.count || 0) / competenceMismatchCount
    : 0;
  const confirmedRatio = competenceMismatchCount > 0
    ? confirmedEvidenceMismatchCount / competenceMismatchCount
    : 0;
  const rowCountConserved = shadow.entries.length === persisted.entries.length;
  const hasMatchingBlocker =
    unmatchedProjectedRowCount > 0 ||
    ambiguousMatchCount > 0 ||
    economicMismatchCount > 0;

  let status: AtomicCardCompetenceForensicStatus;
  let confidence: AtomicCardCompetenceForensicReport['confidence'];
  if (hasMatchingBlocker || persisted.source !== 'engine') {
    status = 'blocked';
    confidence = 'low';
  } else if (competenceMismatchCount === 0) {
    status = 'aligned';
    confidence = 'not-applicable';
  } else if (dominantRatio >= 0.9 && confirmedRatio >= 0.9) {
    status = 'root-cause-isolated';
    confidence = 'high';
  } else {
    status = 'review-needed';
    confidence = dominantRatio >= 0.75 ? 'medium' : 'low';
  }

  const eligibleForFutureCompetenceDryRun =
    status === 'root-cause-isolated' &&
    rowCountConserved &&
    matchedRowCount === shadow.entries.length;
  const recommendationCodes: AtomicCardCompetenceRecommendationCode[] = [];
  if (confirmedEvidenceMismatchCount > 0) {
    recommendationCodes.push('honor-confirmed-import-competence');
  }
  if ((causes.get('current-keyed-by-due-month') || 0) > 0) {
    recommendationCodes.push('separate-reference-competence-from-due-month');
  }
  if (validClosingDay) recommendationCodes.push('use-closing-day-only-as-fallback');
  if ((evidence.get('manual-transaction-rule') || 0) > 0) {
    recommendationCodes.push('preserve-explicit-manual-competence');
  }
  if (competenceAndTypeMismatchCount > 0 || typeOnlyMismatchCount > 0) {
    recommendationCodes.push('review-type-coupled-exceptions');
  }
  if (eligibleForFutureCompetenceDryRun) {
    recommendationCodes.push('develop-read-only-competence-dry-run');
  }
  if (hasMatchingBlocker) recommendationCodes.push('investigate-unmatched-rows');
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
    confidence,
    dominantCause: dominant?.code || null,
    persistedSource: persisted.source,
    rowCountProjected: shadow.entries.length,
    rowCountPersisted: persisted.entries.length,
    rowCountConserved,
    matchedRowCount,
    unmatchedProjectedRowCount,
    ambiguousMatchCount,
    economicMismatchCount,
    competenceMismatchCount,
    competenceOnlyMismatchCount,
    competenceAndTypeMismatchCount,
    typeOnlyMismatchCount,
    confirmedEvidenceMismatchCount,
    closingDayConfigured: validClosingDay,
    closingRuleSupportsExpectedCount,
    closingRuleConflictsExpectedCount,
    eligibleForFutureCompetenceDryRun,
    causeProfiles,
    evidenceProfiles: SOURCE_ORDER
      .map((source) => ({ source, count: evidence.get(source) || 0 }))
      .filter((profile) => profile.count > 0),
    shiftProfiles: Array.from(shifts.values()).sort((left, right) => {
      if (left.monthsFromCurrentToExpected == null) return 1;
      if (right.monthsFromCurrentToExpected == null) return -1;
      return left.monthsFromCurrentToExpected - right.monthsFromCurrentToExpected;
    }),
    recommendationCodes,
  };
}
