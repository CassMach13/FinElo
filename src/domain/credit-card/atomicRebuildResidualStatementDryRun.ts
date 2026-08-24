import type { AtomicCardCompetenceEvidenceCycle } from './atomicRebuildCompetenceForensics';
import type { AtomicCardProvenanceReport } from './atomicRebuildProvenance';
import { simulateAtomicCardSequentialDryRun } from './atomicRebuildSequentialDryRun';
import {
  compareAtomicCardProjections,
  type AtomicCardProjectionComparison,
  type AtomicCardShadowProjection,
  type AtomicCardShadowStatement,
  type PersistedAtomicCardProjection,
  type PersistedAtomicCardStatement,
} from './atomicRebuildShadow';

export type AtomicCardResidualStatementDryRunStatus =
  | 'not-needed'
  | 'explained'
  | 'partial'
  | 'blocked';

export type AtomicCardResidualStatementFieldCode =
  | 'totalPaymentsCents'
  | 'openBalanceCents';

export type AtomicCardResidualStatementDryRunBlockerCode =
  | 'sequential-step-blocked'
  | 'persisted-source-not-engine'
  | 'statement-pair-not-unique'
  | 'payment-ledger-not-aligned'
  | 'non-settlement-statement-difference'
  | 'shadow-payment-total-not-conserved'
  | 'statement-count-not-conserved'
  | 'protected-metadata-mutated'
  | 'entry-records-mutated'
  | 'payment-records-mutated'
  | 'settlement-difference-remains';

export type AtomicCardResidualStatementDryRunRecommendationCode =
  | 'no-residual-statement-rebase-needed'
  | 'separate-file-payment-from-applied-settlement'
  | 'use-payment-links-for-settlement'
  | 'preserve-protected-file-totals'
  | 'retain-outside-window-payment-as-context'
  | 'review-non-settlement-statement-fields'
  | 'resolve-payment-ledger-before-rebase'
  | 'keep-writes-disabled';

export interface AtomicCardResidualStatementFieldProfile {
  field: AtomicCardResidualStatementFieldCode;
  count: number;
}

export interface AtomicCardResidualStatementBlockerProfile {
  code: AtomicCardResidualStatementDryRunBlockerCode;
  count: number;
}

export interface AtomicCardResidualStatementDryRunReport {
  version: 1;
  privacy: 'aggregated-no-identifiers';
  nonAuthoritative: true;
  executable: false;
  mutationPayloadIncluded: false;
  actualWriteOperationCount: 0;
  eligibleForWrite: false;
  checksum: string;
  status: AtomicCardResidualStatementDryRunStatus;
  sequentialStatus: 'not-needed' | 'complete' | 'partial' | 'blocked';
  statementCountBefore: number;
  statementCountAfter: number;
  changedStatementCountBefore: number;
  changedStatementCountAfter: number;
  changedPaymentCountBefore: number;
  changedPaymentCountAfter: number;
  structuralDifferenceCountBefore: number;
  structuralDifferenceCountAfter: number;
  informationalDifferenceCountAfter: number;
  candidateStatementCount: number;
  hypotheticalStatementFieldUpdateCount: number;
  fieldProfiles: AtomicCardResidualStatementFieldProfile[];
  protectedStatementCount: number;
  protectedMetadataPreserved: boolean;
  protectedFilePaymentEvidenceCount: number;
  sameCycleFilePaymentMaterializationCount: number;
  settlementChainSupportedCount: number;
  outsideWindowPaymentWarningCount: number;
  entryRecordsPreserved: boolean;
  paymentRecordsPreserved: boolean;
  blockerProfiles: AtomicCardResidualStatementBlockerProfile[];
  recommendationCodes: AtomicCardResidualStatementDryRunRecommendationCode[];
}

export interface AtomicCardResidualStatementDryRunSimulation {
  /** Internal clone used only to compose later in-memory diagnostics. */
  persisted: PersistedAtomicCardProjection;
  report: AtomicCardResidualStatementDryRunReport;
}

type StatementField =
  | 'dueDate'
  | 'entryCount'
  | 'statementTotalCents'
  | 'totalPaymentsCents'
  | 'openBalanceCents';

interface Candidate {
  current: PersistedAtomicCardStatement;
  expected: AtomicCardShadowStatement;
  fields: AtomicCardResidualStatementFieldCode[];
}

const STATEMENT_FIELD_ORDER: StatementField[] = [
  'dueDate',
  'entryCount',
  'statementTotalCents',
  'totalPaymentsCents',
  'openBalanceCents',
];

const ALLOWED_FIELDS = new Set<AtomicCardResidualStatementFieldCode>([
  'totalPaymentsCents',
  'openBalanceCents',
]);

const BLOCKER_ORDER: AtomicCardResidualStatementDryRunBlockerCode[] = [
  'sequential-step-blocked',
  'persisted-source-not-engine',
  'statement-pair-not-unique',
  'payment-ledger-not-aligned',
  'non-settlement-statement-difference',
  'shadow-payment-total-not-conserved',
  'statement-count-not-conserved',
  'protected-metadata-mutated',
  'entry-records-mutated',
  'payment-records-mutated',
  'settlement-difference-remains',
];

const addCount = <TCode extends string>(
  counts: Map<TCode, number>,
  code: TCode,
  count = 1
): void => {
  counts.set(code, (counts.get(code) || 0) + count);
};

const statementFields = (
  current: PersistedAtomicCardStatement,
  expected: AtomicCardShadowStatement
): StatementField[] =>
  STATEMENT_FIELD_ORDER.filter((field) => {
    if (field === 'dueDate') return (current.dueDate || '') !== expected.dueDate;
    return current[field] !== expected[field];
  });

const groupStatements = <T extends { statementKey: string }>(
  statements: readonly T[]
): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  statements.forEach((statement) => {
    const group = groups.get(statement.statementKey) || [];
    group.push(statement);
    groups.set(statement.statementKey, group);
  });
  return groups;
};

const protectedMetadataSignature = (statement: PersistedAtomicCardStatement): string =>
  JSON.stringify([
    statement.rowId ?? null,
    statement.cardId ?? null,
    statement.referenceLabel ?? null,
    statement.hasProtectedMetadata ?? false,
    statement.manualTotalsPresent ?? false,
    statement.manualTotalsJson ?? null,
    statement.statementTotalFromFileCents ?? null,
    statement.totalPaymentsFromFileCents ?? null,
    statement.linesComputedTotalCents ?? null,
  ]);

const paymentDifferenceCount = (comparison: AtomicCardProjectionComparison): number =>
  comparison.duplicatePersistedPaymentTransactionIds.length +
  comparison.suspiciousPersistedPaymentEventKeys.length +
  comparison.missingPaymentKeys.length +
  comparison.orphanPaymentKeys.length +
  comparison.changedPaymentTransactionIds.length;

/**
 * Explains the residual statement differences left after identity and competence.
 *
 * Only the derived settlement fields are rebased in a clone. Protected totals from
 * the original file remain untouched as historical evidence, while materialized
 * payment links continue to represent which invoice was actually settled.
 */
export function simulateAtomicCardResidualStatementDryRun(input: {
  shadow: AtomicCardShadowProjection;
  persisted: PersistedAtomicCardProjection;
  comparison: AtomicCardProjectionComparison;
  provenance: AtomicCardProvenanceReport;
  cycles: AtomicCardCompetenceEvidenceCycle[];
  closingDay?: number | null;
}): AtomicCardResidualStatementDryRunSimulation {
  const blockers = new Map<AtomicCardResidualStatementDryRunBlockerCode, number>();
  const sequential = simulateAtomicCardSequentialDryRun(input);
  const sequentialPersisted = sequential.persisted;
  const before = compareAtomicCardProjections(input.shadow, sequentialPersisted);

  if (sequential.report.status === 'blocked') {
    addCount(blockers, 'sequential-step-blocked');
  }
  if (sequentialPersisted.source !== 'engine') {
    addCount(blockers, 'persisted-source-not-engine');
  }
  const beforePaymentDifferenceCount = paymentDifferenceCount(before);
  if (beforePaymentDifferenceCount > 0) {
    addCount(blockers, 'payment-ledger-not-aligned', beforePaymentDifferenceCount);
  }

  const currentGroups = groupStatements(sequentialPersisted.statements);
  const expectedGroups = groupStatements(input.shadow.statements);
  const candidates: Candidate[] = [];
  let unclassifiedFieldCount = 0;
  let invalidPairCount = 0;
  let paymentConservationFailureCount = 0;

  before.changedStatementKeys.forEach((statementKey) => {
    const currentGroup = currentGroups.get(statementKey) || [];
    const expectedGroup = expectedGroups.get(statementKey) || [];
    if (currentGroup.length !== 1 || expectedGroup.length !== 1) {
      invalidPairCount += 1;
      return;
    }
    const current = currentGroup[0];
    const expected = expectedGroup[0];
    const fields = statementFields(current, expected);
    const unsupported = fields.filter(
      (field) => !ALLOWED_FIELDS.has(field as AtomicCardResidualStatementFieldCode)
    );
    if (unsupported.length > 0) {
      unclassifiedFieldCount += unsupported.length;
      return;
    }

    const linkedPaymentTotal = input.shadow.payments
      .filter((payment) => payment.statementKey === statementKey)
      .reduce((total, payment) => total + payment.amountCents, 0);
    if (linkedPaymentTotal !== expected.totalPaymentsCents) {
      paymentConservationFailureCount += 1;
      return;
    }

    candidates.push({
      current,
      expected,
      fields: fields as AtomicCardResidualStatementFieldCode[],
    });
  });

  if (invalidPairCount > 0) {
    addCount(blockers, 'statement-pair-not-unique', invalidPairCount);
  }
  if (unclassifiedFieldCount > 0) {
    addCount(blockers, 'non-settlement-statement-difference', unclassifiedFieldCount);
  }
  if (paymentConservationFailureCount > 0) {
    addCount(blockers, 'shadow-payment-total-not-conserved', paymentConservationFailureCount);
  }

  const canSimulate =
    before.changedStatementKeys.length > 0 &&
    candidates.length === before.changedStatementKeys.length &&
    blockers.size === 0;
  const expectedByKey = new Map(
    candidates.map((candidate) => [candidate.expected.statementKey, candidate.expected])
  );
  const simulatedPersisted: PersistedAtomicCardProjection = {
    ...sequentialPersisted,
    entries: sequentialPersisted.entries.map((entry) => ({ ...entry })),
    payments: sequentialPersisted.payments.map((payment) => ({ ...payment })),
    statements: sequentialPersisted.statements.map((statement) => {
      const expected = canSimulate ? expectedByKey.get(statement.statementKey) : undefined;
      return expected
        ? {
            ...statement,
            totalPaymentsCents: expected.totalPaymentsCents,
            openBalanceCents: expected.openBalanceCents,
          }
        : { ...statement };
    }),
  };

  const after = compareAtomicCardProjections(input.shadow, simulatedPersisted);
  if (sequentialPersisted.statements.length !== simulatedPersisted.statements.length) {
    addCount(blockers, 'statement-count-not-conserved');
  }
  const protectedBefore = sequentialPersisted.statements
    .filter((statement) => statement.hasProtectedMetadata)
    .map(protectedMetadataSignature)
    .sort();
  const protectedAfter = simulatedPersisted.statements
    .filter((statement) => statement.hasProtectedMetadata)
    .map(protectedMetadataSignature)
    .sort();
  const protectedMetadataPreserved =
    JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter);
  if (!protectedMetadataPreserved) addCount(blockers, 'protected-metadata-mutated');

  const entryRecordsPreserved =
    JSON.stringify(sequentialPersisted.entries) === JSON.stringify(simulatedPersisted.entries);
  const paymentRecordsPreserved =
    JSON.stringify(sequentialPersisted.payments) === JSON.stringify(simulatedPersisted.payments);
  if (!entryRecordsPreserved) addCount(blockers, 'entry-records-mutated');
  if (!paymentRecordsPreserved) addCount(blockers, 'payment-records-mutated');
  if (canSimulate && after.changedStatementKeys.length > 0) {
    addCount(blockers, 'settlement-difference-remains', after.changedStatementKeys.length);
  }

  const fieldCounts = new Map<AtomicCardResidualStatementFieldCode, number>();
  candidates.forEach((candidate) => {
    candidate.fields.forEach((field) => addCount(fieldCounts, field));
  });
  const protectedFilePaymentEvidenceCount = sequentialPersisted.statements.filter(
    (statement) => statement.totalPaymentsFromFileCents != null
  ).length;
  const sameCycleFilePaymentMaterializationCount = candidates.filter(
    ({ current, expected }) =>
      current.totalPaymentsFromFileCents != null &&
      current.totalPaymentsCents === current.totalPaymentsFromFileCents &&
      current.totalPaymentsCents !== expected.totalPaymentsCents
  ).length;
  const persistedPaymentsByStatement = new Map<string, number>();
  sequentialPersisted.payments.forEach((payment) => {
    persistedPaymentsByStatement.set(
      payment.statementKey,
      (persistedPaymentsByStatement.get(payment.statementKey) || 0) + payment.amountCents
    );
  });
  const settlementChainSupportedCount = candidates.filter(
    ({ current, expected }) =>
      current.totalPaymentsCents !== expected.totalPaymentsCents &&
      (persistedPaymentsByStatement.get(expected.statementKey) || 0) ===
        expected.totalPaymentsCents
  ).length;
  const outsideWindowPaymentWarningCount = input.shadow.warnings.filter(
    (warning) => warning.code === 'payment-before-rebuild-window'
  ).length;

  const status: AtomicCardResidualStatementDryRunStatus =
    blockers.size > 0
      ? 'blocked'
      : before.changedStatementKeys.length === 0
        ? 'not-needed'
        : after.changedStatementKeys.length === 0
          ? 'explained'
          : 'partial';

  const recommendationCodes: AtomicCardResidualStatementDryRunRecommendationCode[] = [];
  if (status === 'not-needed') {
    recommendationCodes.push('no-residual-statement-rebase-needed');
  }
  if (sameCycleFilePaymentMaterializationCount > 0) {
    recommendationCodes.push('separate-file-payment-from-applied-settlement');
  }
  if (settlementChainSupportedCount > 0) {
    recommendationCodes.push('use-payment-links-for-settlement');
  }
  if (protectedFilePaymentEvidenceCount > 0) {
    recommendationCodes.push('preserve-protected-file-totals');
  }
  if (outsideWindowPaymentWarningCount > 0) {
    recommendationCodes.push('retain-outside-window-payment-as-context');
  }
  if (unclassifiedFieldCount > 0) {
    recommendationCodes.push('review-non-settlement-statement-fields');
  }
  if (beforePaymentDifferenceCount > 0) {
    recommendationCodes.push('resolve-payment-ledger-before-rebase');
  }
  recommendationCodes.push('keep-writes-disabled');

  const report: AtomicCardResidualStatementDryRunReport = {
    version: 1,
    privacy: 'aggregated-no-identifiers',
    nonAuthoritative: true,
    executable: false,
    mutationPayloadIncluded: false,
    actualWriteOperationCount: 0,
    eligibleForWrite: false,
    checksum: input.shadow.checksum,
    status,
    sequentialStatus: sequential.report.status,
    statementCountBefore: sequentialPersisted.statements.length,
    statementCountAfter: simulatedPersisted.statements.length,
    changedStatementCountBefore: before.changedStatementKeys.length,
    changedStatementCountAfter: after.changedStatementKeys.length,
    changedPaymentCountBefore: paymentDifferenceCount(before),
    changedPaymentCountAfter: paymentDifferenceCount(after),
    structuralDifferenceCountBefore: before.structuralDifferenceCount,
    structuralDifferenceCountAfter: after.structuralDifferenceCount,
    informationalDifferenceCountAfter:
      after.differenceCount - after.structuralDifferenceCount,
    candidateStatementCount: candidates.length,
    hypotheticalStatementFieldUpdateCount: Array.from(fieldCounts.values()).reduce(
      (total, count) => total + count,
      0
    ),
    fieldProfiles: Array.from(fieldCounts.entries())
      .map(([field, count]) => ({ field, count }))
      .sort((left, right) => right.count - left.count || left.field.localeCompare(right.field)),
    protectedStatementCount: protectedBefore.length,
    protectedMetadataPreserved,
    protectedFilePaymentEvidenceCount,
    sameCycleFilePaymentMaterializationCount,
    settlementChainSupportedCount,
    outsideWindowPaymentWarningCount,
    entryRecordsPreserved,
    paymentRecordsPreserved,
    blockerProfiles: BLOCKER_ORDER
      .map((code) => ({ code, count: blockers.get(code) || 0 }))
      .filter((profile) => profile.count > 0),
    recommendationCodes,
  };

  return { persisted: simulatedPersisted, report };
}

export function buildAtomicCardResidualStatementDryRunReport(input: {
  shadow: AtomicCardShadowProjection;
  persisted: PersistedAtomicCardProjection;
  comparison: AtomicCardProjectionComparison;
  provenance: AtomicCardProvenanceReport;
  cycles: AtomicCardCompetenceEvidenceCycle[];
  closingDay?: number | null;
}): AtomicCardResidualStatementDryRunReport {
  return simulateAtomicCardResidualStatementDryRun(input).report;
}
