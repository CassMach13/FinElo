import { buildAtomicCardAffectedEntryReconciliationReport } from './atomicRebuildAffectedEntryReconciliation';
import type { AtomicCardCompetenceExceptionForensicReport } from './atomicRebuildCompetenceExceptionForensics';
import type {
  AtomicCardProjectionComparison,
  AtomicCardShadowProjection,
  AtomicCardShadowStatement,
  PersistedAtomicCardProjection,
  PersistedAtomicCardStatement,
} from './atomicRebuildShadow';

export type AtomicCardStatementConflictForensicStatus =
  | 'no-duplicates'
  | 'conflict-isolated'
  | 'review-needed'
  | 'blocked';

export type AtomicCardStatementConflictFieldCode =
  | 'due-date'
  | 'entry-count'
  | 'statement-total'
  | 'payment-total'
  | 'open-balance'
  | 'protected-metadata-presence'
  | 'manual-totals-presence'
  | 'file-statement-total'
  | 'file-payment-total';

export type AtomicCardStatementShadowMatchCode =
  | 'unique-shadow-compatible-record'
  | 'multiple-shadow-compatible-records'
  | 'no-shadow-compatible-record'
  | 'missing-shadow-statement';

export type AtomicCardStatementConflictRecommendationCode =
  | 'preserve-all-current-statement-records'
  | 'preserve-manual-payload-verbatim'
  | 'preserve-official-file-totals'
  | 'review-conflicting-protected-values'
  | 'use-shadow-only-for-derived-field-comparison'
  | 'simulate-metadata-conservation-before-any-merge'
  | 'investigate-unclassified-statement-groups'
  | 'keep-writes-disabled';

export interface AtomicCardStatementConflictFieldProfile {
  code: AtomicCardStatementConflictFieldCode;
  conflictingGroupCount: number;
}

export interface AtomicCardStatementShadowMatchProfile {
  code: AtomicCardStatementShadowMatchCode;
  groupCount: number;
}

export interface AtomicCardStatementProtectedMetadataSummary {
  protectedGroupCount: number;
  manualPayloadRecordCount: number;
  singleManualPayloadGroupCount: number;
  multipleManualPayloadGroupCount: number;
  officialStatementTotalGroupCount: number;
  conflictingOfficialStatementTotalGroupCount: number;
  officialPaymentTotalGroupCount: number;
  conflictingOfficialPaymentTotalGroupCount: number;
  unknownProtectedMetadataRecordCount: number;
  unambiguousConservationGroupCount: number;
  ambiguousConservationGroupCount: number;
}

export interface AtomicCardStatementConflictForensicReport {
  version: 1;
  privacy: 'aggregated-no-identifiers';
  nonAuthoritative: true;
  executable: false;
  mutationPayloadIncluded: false;
  actualWriteOperationCount: 0;
  checksum: string;
  status: AtomicCardStatementConflictForensicStatus;
  duplicateGroupCount: number;
  locatedGroupCount: number;
  unclassifiedGroupCount: number;
  duplicateRecordCount: number;
  affectedEntryCount: number;
  conflictingGroupCount: number;
  protectedMetadata: AtomicCardStatementProtectedMetadataSummary;
  fieldProfiles: AtomicCardStatementConflictFieldProfile[];
  shadowMatchProfiles: AtomicCardStatementShadowMatchProfile[];
  eligibleForFutureConservationDryRun: boolean;
  eligibleForWrite: false;
  recommendationCodes: AtomicCardStatementConflictRecommendationCode[];
}

const FIELD_ORDER: AtomicCardStatementConflictFieldCode[] = [
  'due-date',
  'entry-count',
  'statement-total',
  'payment-total',
  'open-balance',
  'protected-metadata-presence',
  'manual-totals-presence',
  'file-statement-total',
  'file-payment-total',
];

const SHADOW_MATCH_ORDER: AtomicCardStatementShadowMatchCode[] = [
  'unique-shadow-compatible-record',
  'multiple-shadow-compatible-records',
  'no-shadow-compatible-record',
  'missing-shadow-statement',
];

const distinctCount = <T>(values: T[]): number => new Set(values).size;

const normalizedOptionalCents = (value: number | null | undefined): number | null => value ?? null;

const coreStatementSignature = (
  statement: PersistedAtomicCardStatement | AtomicCardShadowStatement
): string =>
  JSON.stringify([
    statement.dueDate || null,
    statement.entryCount,
    statement.statementTotalCents,
    statement.totalPaymentsCents,
    statement.openBalanceCents,
  ]);

const groupConflictFields = (
  group: PersistedAtomicCardStatement[]
): AtomicCardStatementConflictFieldCode[] => {
  const candidates: Array<[AtomicCardStatementConflictFieldCode, unknown[]]> = [
    ['due-date', group.map((statement) => statement.dueDate || null)],
    ['entry-count', group.map((statement) => statement.entryCount)],
    ['statement-total', group.map((statement) => statement.statementTotalCents)],
    ['payment-total', group.map((statement) => statement.totalPaymentsCents)],
    ['open-balance', group.map((statement) => statement.openBalanceCents)],
    [
      'protected-metadata-presence',
      group.map((statement) => Boolean(statement.hasProtectedMetadata)),
    ],
    ['manual-totals-presence', group.map((statement) => Boolean(statement.manualTotalsPresent))],
    [
      'file-statement-total',
      group.map((statement) => normalizedOptionalCents(statement.statementTotalFromFileCents)),
    ],
    [
      'file-payment-total',
      group.map((statement) => normalizedOptionalCents(statement.totalPaymentsFromFileCents)),
    ],
  ];

  return candidates
    .filter(([, values]) => distinctCount(values) > 1)
    .map(([code]) => code);
};

const nonNullDistinctCount = (values: Array<number | null | undefined>): number =>
  new Set(values.filter((value): value is number => value !== null && value !== undefined)).size;

/**
 * Compares duplicate statement records exclusively in memory.
 *
 * The report intentionally contains only aggregate counters and classification
 * codes. It never returns statement keys, row identities, money values, source
 * files, protected payloads or an executable merge plan.
 */
export function buildAtomicCardStatementConflictForensicReport(input: {
  shadow: AtomicCardShadowProjection;
  persisted: PersistedAtomicCardProjection;
  comparison: AtomicCardProjectionComparison;
  competenceExceptions: AtomicCardCompetenceExceptionForensicReport;
}): AtomicCardStatementConflictForensicReport {
  const { shadow, persisted, comparison, competenceExceptions } = input;
  const affectedEntryReconciliation = buildAtomicCardAffectedEntryReconciliationReport(input);
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
  const duplicateGroupCount = duplicateKeys.size;
  const locatedGroupCount = locatedGroups.length;
  const unclassifiedGroupCount = Math.max(0, duplicateGroupCount - locatedGroupCount);
  const duplicateRecordCount = locatedGroups.reduce((total, [, group]) => total + group.length, 0);
  const affectedEntryCount = affectedEntryReconciliation.reconciledAffectedEntryCount;

  const fieldCounts = new Map<AtomicCardStatementConflictFieldCode, number>();
  const shadowMatchCounts = new Map<AtomicCardStatementShadowMatchCode, number>();
  const shadowByKey = new Map(shadow.statements.map((statement) => [statement.statementKey, statement]));

  let conflictingGroupCount = 0;
  let protectedGroupCount = 0;
  let manualPayloadRecordCount = 0;
  let singleManualPayloadGroupCount = 0;
  let multipleManualPayloadGroupCount = 0;
  let officialStatementTotalGroupCount = 0;
  let conflictingOfficialStatementTotalGroupCount = 0;
  let officialPaymentTotalGroupCount = 0;
  let conflictingOfficialPaymentTotalGroupCount = 0;
  let unknownProtectedMetadataRecordCount = 0;
  let unambiguousConservationGroupCount = 0;
  let ambiguousConservationGroupCount = 0;

  locatedGroups.forEach(([statementKey, group]) => {
    const conflictFields = groupConflictFields(group);
    if (conflictFields.length > 0) conflictingGroupCount += 1;
    conflictFields.forEach((code) => fieldCounts.set(code, (fieldCounts.get(code) || 0) + 1));

    const expected = shadowByKey.get(statementKey);
    let shadowMatchCode: AtomicCardStatementShadowMatchCode;
    if (!expected) {
      shadowMatchCode = 'missing-shadow-statement';
    } else {
      const expectedSignature = coreStatementSignature(expected);
      const compatibleRecordCount = group.filter(
        (statement) => coreStatementSignature(statement) === expectedSignature
      ).length;
      shadowMatchCode = compatibleRecordCount === 1
        ? 'unique-shadow-compatible-record'
        : compatibleRecordCount > 1
          ? 'multiple-shadow-compatible-records'
          : 'no-shadow-compatible-record';
    }
    shadowMatchCounts.set(shadowMatchCode, (shadowMatchCounts.get(shadowMatchCode) || 0) + 1);

    const manualPayloadCount = group.filter((statement) => statement.manualTotalsPresent).length;
    const officialStatementTotalValues = group.map(
      (statement) => statement.statementTotalFromFileCents
    );
    const officialPaymentTotalValues = group.map(
      (statement) => statement.totalPaymentsFromFileCents
    );
    const officialStatementTotalValueCount = nonNullDistinctCount(officialStatementTotalValues);
    const officialPaymentTotalValueCount = nonNullDistinctCount(officialPaymentTotalValues);
    const groupHasOfficialStatementTotal = officialStatementTotalValues.some(
      (value) => value !== null && value !== undefined
    );
    const groupHasOfficialPaymentTotal = officialPaymentTotalValues.some(
      (value) => value !== null && value !== undefined
    );
    const groupUnknownProtectedCount = group.filter(
      (statement) =>
        Boolean(statement.hasProtectedMetadata) &&
        !statement.manualTotalsPresent &&
        statement.statementTotalFromFileCents == null &&
        statement.totalPaymentsFromFileCents == null
    ).length;
    const groupProtected =
      protectedKeys.has(statementKey) || group.some((statement) => statement.hasProtectedMetadata);
    const groupMetadataAmbiguous =
      manualPayloadCount > 1 ||
      officialStatementTotalValueCount > 1 ||
      officialPaymentTotalValueCount > 1 ||
      groupUnknownProtectedCount > 0;

    manualPayloadRecordCount += manualPayloadCount;
    if (manualPayloadCount === 1) singleManualPayloadGroupCount += 1;
    if (manualPayloadCount > 1) multipleManualPayloadGroupCount += 1;
    if (groupHasOfficialStatementTotal) officialStatementTotalGroupCount += 1;
    if (officialStatementTotalValueCount > 1) conflictingOfficialStatementTotalGroupCount += 1;
    if (groupHasOfficialPaymentTotal) officialPaymentTotalGroupCount += 1;
    if (officialPaymentTotalValueCount > 1) conflictingOfficialPaymentTotalGroupCount += 1;
    unknownProtectedMetadataRecordCount += groupUnknownProtectedCount;
    if (groupProtected) {
      protectedGroupCount += 1;
      if (groupMetadataAmbiguous) ambiguousConservationGroupCount += 1;
      else unambiguousConservationGroupCount += 1;
    }
  });

  const fieldProfiles = FIELD_ORDER
    .map((code) => ({ code, conflictingGroupCount: fieldCounts.get(code) || 0 }))
    .filter((profile) => profile.conflictingGroupCount > 0);
  const shadowMatchProfiles = SHADOW_MATCH_ORDER
    .map((code) => ({ code, groupCount: shadowMatchCounts.get(code) || 0 }))
    .filter((profile) => profile.groupCount > 0);
  const upstream = competenceExceptions.statementPrerequisite;
  const upstreamCountsAgree =
    upstream.duplicateGroupCount === duplicateGroupCount &&
    affectedEntryReconciliation.duplicateGroupCount === duplicateGroupCount &&
    affectedEntryReconciliation.upstreamAffectedEntryCount === upstream.affectedEntryCount &&
    affectedEntryReconciliation.eligibleForConflictForensics;
  const eligibleForFutureConservationDryRun =
    duplicateGroupCount > 0 &&
    locatedGroupCount === duplicateGroupCount &&
    unclassifiedGroupCount === 0 &&
    upstreamCountsAgree &&
    ambiguousConservationGroupCount === 0 &&
    (shadowMatchCounts.get('unique-shadow-compatible-record') || 0) === duplicateGroupCount;

  let status: AtomicCardStatementConflictForensicStatus;
  if (duplicateGroupCount === 0 && upstream.affectedEntryCount === 0) {
    status = 'no-duplicates';
  } else if (!upstreamCountsAgree || unclassifiedGroupCount > 0) {
    status = 'blocked';
  } else if (
    ambiguousConservationGroupCount > 0 ||
    (shadowMatchCounts.get('missing-shadow-statement') || 0) > 0
  ) {
    status = 'review-needed';
  } else {
    status = 'conflict-isolated';
  }

  const recommendationCodes: AtomicCardStatementConflictRecommendationCode[] = [];
  if (duplicateGroupCount > 0) recommendationCodes.push('preserve-all-current-statement-records');
  if (manualPayloadRecordCount > 0) recommendationCodes.push('preserve-manual-payload-verbatim');
  if (officialStatementTotalGroupCount > 0 || officialPaymentTotalGroupCount > 0) {
    recommendationCodes.push('preserve-official-file-totals');
  }
  if (ambiguousConservationGroupCount > 0) {
    recommendationCodes.push('review-conflicting-protected-values');
  }
  if (duplicateGroupCount > 0) recommendationCodes.push('use-shadow-only-for-derived-field-comparison');
  if (eligibleForFutureConservationDryRun) {
    recommendationCodes.push('simulate-metadata-conservation-before-any-merge');
  }
  if (unclassifiedGroupCount > 0 || !upstreamCountsAgree) {
    recommendationCodes.push('investigate-unclassified-statement-groups');
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
    locatedGroupCount,
    unclassifiedGroupCount,
    duplicateRecordCount,
    affectedEntryCount,
    conflictingGroupCount,
    protectedMetadata: {
      protectedGroupCount,
      manualPayloadRecordCount,
      singleManualPayloadGroupCount,
      multipleManualPayloadGroupCount,
      officialStatementTotalGroupCount,
      conflictingOfficialStatementTotalGroupCount,
      officialPaymentTotalGroupCount,
      conflictingOfficialPaymentTotalGroupCount,
      unknownProtectedMetadataRecordCount,
      unambiguousConservationGroupCount,
      ambiguousConservationGroupCount,
    },
    fieldProfiles,
    shadowMatchProfiles,
    eligibleForFutureConservationDryRun,
    eligibleForWrite: false,
    recommendationCodes,
  };
}
