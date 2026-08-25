import type { AtomicCardCompetenceEvidenceCycle } from './atomicRebuildCompetenceForensics';
import {
  simulateAtomicCardEndToEndDryRun,
  type AtomicCardEndToEndDryRunReport,
} from './atomicRebuildEndToEndDryRun';
import type { AtomicCardProvenanceReport } from './atomicRebuildProvenance';
import type {
  AtomicCardProjectionComparison,
  AtomicCardShadowProjection,
  PersistedAtomicCardProjection,
  PersistedAtomicCardStatement,
} from './atomicRebuildShadow';

export type AtomicCardDerivedSettlementExecutionStatus =
  | 'not-needed'
  | 'contract-ready'
  | 'blocked';

export type AtomicCardDerivedSettlementExecutionBlockerCode =
  | 'end-to-end-plan-not-ready'
  | 'invalid-persisted-revision'
  | 'invalid-shadow-checksum'
  | 'identity-or-competence-write-required'
  | 'statement-record-identity-missing'
  | 'statement-set-changed'
  | 'unsupported-statement-field-change'
  | 'protected-metadata-changed'
  | 'derived-balance-invalid'
  | 'statement-update-count-mismatch';

export interface AtomicCardDerivedSettlementStatementUpdate {
  rowId: string;
  statementKey: string;
  expectedTotalPaymentsCents: number;
  expectedOpenBalanceCents: number;
  expectedOpenAmountCents: number;
  expectedStatus: string;
  desiredTotalPaymentsCents: number;
  desiredOpenBalanceCents: number;
  desiredOpenAmountCents: number;
  desiredStatus: string;
}

/**
 * Payload privado. Não deve ser renderizado ou registrado: contém identidades
 * mínimas necessárias para o banco repetir o contrato sob lock transacional.
 */
export interface AtomicCardDerivedSettlementExecutionRequest {
  accountId: string;
  expectedRevision: string;
  shadowChecksum: string;
  statementUpdates: AtomicCardDerivedSettlementStatementUpdate[];
}

export interface AtomicCardDerivedSettlementExecutionReport {
  version: 1;
  privacy: 'aggregated-no-identifiers';
  nonAuthoritative: true;
  executable: false;
  mutationPayloadIncluded: false;
  actualWriteOperationCount: 0;
  eligibleForWrite: false;
  status: AtomicCardDerivedSettlementExecutionStatus;
  checksumBound: boolean;
  revisionBound: boolean;
  expectedStatementUpdateCount: number;
  expectedLogicalFieldUpdateCount: number;
  expectedPhysicalColumnUpdateCount: number;
  snapshotStatementCount: number;
  requiredDatabaseGuardCount: 14;
  preparedDatabaseGuardCount: number;
  updatesOnlyDerivedSettlementFields: boolean;
  preservesEntries: boolean;
  preservesPayments: boolean;
  preservesProtectedMetadata: boolean;
  rollbackRequiresAfterRevision: true;
  dedicatedFeatureFlagRequired: true;
  eligibleForStagingExecution: boolean;
  blockerCodes: AtomicCardDerivedSettlementExecutionBlockerCode[];
}

export interface AtomicCardDerivedSettlementExecutionPreparation {
  report: AtomicCardDerivedSettlementExecutionReport;
  request: AtomicCardDerivedSettlementExecutionRequest | null;
  endToEndReport: AtomicCardEndToEndDryRunReport;
}

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

const immutableStatementSignature = (statement: PersistedAtomicCardStatement): string =>
  JSON.stringify([
    statement.rowId ?? null,
    statement.cardId ?? null,
    statement.referenceLabel ?? null,
    statement.statementKey,
    statement.dueDate ?? null,
    statement.entryCount,
    statement.statementTotalCents,
  ]);

const isUuid = (value: string | null | undefined): value is string =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '')
  );

/**
 * Converte a certificação 2S em um contrato estreito para o piloto atual.
 *
 * Esta primeira via executável aceita somente a correção dos campos derivados
 * de quitação das faturas existentes. Mudanças de identidade ou competência
 * continuam bloqueadas e exigem um contrato próprio, evitando que um único RPC
 * receba uma superfície de escrita maior que a comprovada pelo piloto.
 */
export function prepareAtomicCardDerivedSettlementExecution(input: {
  shadow: AtomicCardShadowProjection;
  persisted: PersistedAtomicCardProjection;
  comparison: AtomicCardProjectionComparison;
  provenance: AtomicCardProvenanceReport;
  cycles: AtomicCardCompetenceEvidenceCycle[];
  closingDay?: number | null;
  persistedRevision: string | null | undefined;
}): AtomicCardDerivedSettlementExecutionPreparation {
  const simulation = simulateAtomicCardEndToEndDryRun(input);
  const endToEndReport = simulation.report;
  const desired = simulation.persisted;
  const blockers = new Set<AtomicCardDerivedSettlementExecutionBlockerCode>();
  const revisionBound = /^[a-f0-9]{32}$/.test(String(input.persistedRevision || ''));
  const checksumBound = /^shadow-v1-[a-f0-9]{8}$/.test(input.shadow.checksum);

  if (
    !endToEndReport.readyForReversibleExecutionPlanning ||
    endToEndReport.status === 'blocked' ||
    endToEndReport.structuralDifferenceCountAfter !== 0
  ) {
    blockers.add('end-to-end-plan-not-ready');
  }
  if (!revisionBound) blockers.add('invalid-persisted-revision');
  if (!checksumBound) blockers.add('invalid-shadow-checksum');
  if (
    endToEndReport.hypotheticalIdentityUpdateCount > 0 ||
    endToEndReport.hypotheticalCompetenceUpdateCount > 0 ||
    input.comparison.missingTransactionIds.length > 0 ||
    input.comparison.duplicatePersistedTransactionIds.length > 0 ||
    input.comparison.orphanTransactionIds.length > 0 ||
    input.comparison.changedTransactionIds.length > 0
  ) {
    blockers.add('identity-or-competence-write-required');
  }

  const desiredByRowId = new Map(
    desired.statements
      .filter((statement) => isUuid(statement.rowId))
      .map((statement) => [String(statement.rowId), statement])
  );
  if (
    input.persisted.statements.some((statement) => !isUuid(statement.rowId)) ||
    desired.statements.some((statement) => !isUuid(statement.rowId))
  ) {
    blockers.add('statement-record-identity-missing');
  }
  if (
    desired.statements.length !== input.persisted.statements.length ||
    desiredByRowId.size !== desired.statements.length
  ) {
    blockers.add('statement-set-changed');
  }

  let protectedMetadataChanged = false;
  let unsupportedStatementChange = false;
  let invalidBalanceCount = 0;
  let logicalFieldUpdateCount = 0;
  const updates: AtomicCardDerivedSettlementStatementUpdate[] = [];

  input.persisted.statements.forEach((current) => {
    const rowId = String(current.rowId || '');
    const expected = desiredByRowId.get(rowId);
    if (!expected) {
      blockers.add('statement-set-changed');
      return;
    }
    if (immutableStatementSignature(current) !== immutableStatementSignature(expected)) {
      unsupportedStatementChange = true;
    }
    if (protectedMetadataSignature(current) !== protectedMetadataSignature(expected)) {
      protectedMetadataChanged = true;
    }

    const totalPaymentsChanged =
      current.totalPaymentsCents !== expected.totalPaymentsCents;
    const openBalanceChanged = current.openBalanceCents !== expected.openBalanceCents;
    const currentOpenAmount = current.openAmountCents ?? current.openBalanceCents;
    const openAmountChanged = currentOpenAmount !== expected.openBalanceCents;
    const currentStatus =
      current.status ??
      (current.openBalanceCents <= 0
        ? 'paid'
        : current.totalPaymentsCents > 0
          ? 'partial'
          : 'open');
    const statusChanged = currentStatus !== expected.status;
    logicalFieldUpdateCount +=
      Number(totalPaymentsChanged) +
      Number(openBalanceChanged) +
      Number(openAmountChanged) +
      Number(statusChanged);
    if (
      !totalPaymentsChanged &&
      !openBalanceChanged &&
      !openAmountChanged &&
      !statusChanged
    ) return;

    const derivedOpenBalance = Math.max(
      expected.statementTotalCents - expected.totalPaymentsCents,
      0
    );
    if (derivedOpenBalance !== expected.openBalanceCents) invalidBalanceCount += 1;

    updates.push({
      rowId,
      statementKey: expected.statementKey,
      expectedTotalPaymentsCents: current.totalPaymentsCents,
      expectedOpenBalanceCents: current.openBalanceCents,
      expectedOpenAmountCents: currentOpenAmount,
      expectedStatus: currentStatus,
      desiredTotalPaymentsCents: expected.totalPaymentsCents,
      desiredOpenBalanceCents: expected.openBalanceCents,
      desiredOpenAmountCents: expected.openBalanceCents,
      desiredStatus: expected.status,
    });
  });

  if (unsupportedStatementChange) blockers.add('unsupported-statement-field-change');
  if (protectedMetadataChanged) blockers.add('protected-metadata-changed');
  if (invalidBalanceCount > 0) blockers.add('derived-balance-invalid');
  if (logicalFieldUpdateCount !== endToEndReport.hypotheticalStatementFieldUpdateCount) {
    blockers.add('statement-update-count-mismatch');
  }

  const noChangeNeeded =
    endToEndReport.status === 'not-needed' && logicalFieldUpdateCount === 0;
  const eligibleForStagingExecution =
    blockers.size === 0 &&
    updates.length > 0 &&
    logicalFieldUpdateCount > 0 &&
    endToEndReport.physicalRecordCountsPreserved &&
    endToEndReport.protectedMetadataPreserved &&
    endToEndReport.protectedMetadataCoverageComplete;
  const status: AtomicCardDerivedSettlementExecutionStatus = noChangeNeeded
    ? 'not-needed'
    : eligibleForStagingExecution
      ? 'contract-ready'
      : 'blocked';
  const preparedDatabaseGuardCount = eligibleForStagingExecution ? 14 : 0;

  return {
    report: {
      version: 1,
      privacy: 'aggregated-no-identifiers',
      nonAuthoritative: true,
      executable: false,
      mutationPayloadIncluded: false,
      actualWriteOperationCount: 0,
      eligibleForWrite: false,
      status,
      checksumBound,
      revisionBound,
      expectedStatementUpdateCount: updates.length,
      expectedLogicalFieldUpdateCount: logicalFieldUpdateCount,
      expectedPhysicalColumnUpdateCount: logicalFieldUpdateCount,
      snapshotStatementCount: updates.length,
      requiredDatabaseGuardCount: 14,
      preparedDatabaseGuardCount,
      updatesOnlyDerivedSettlementFields: !unsupportedStatementChange,
      preservesEntries: endToEndReport.entryRecordsPreservedByResidualStep,
      preservesPayments: endToEndReport.paymentRecordsPreservedByResidualStep,
      preservesProtectedMetadata:
        endToEndReport.protectedMetadataPreserved && !protectedMetadataChanged,
      rollbackRequiresAfterRevision: true,
      dedicatedFeatureFlagRequired: true,
      eligibleForStagingExecution,
      blockerCodes: Array.from(blockers).sort(),
    },
    request: eligibleForStagingExecution
      ? {
          accountId: input.shadow.accountId,
          expectedRevision: String(input.persistedRevision),
          shadowChecksum: input.shadow.checksum,
          statementUpdates: updates.sort((left, right) =>
            left.statementKey.localeCompare(right.statementKey)
          ),
        }
      : null,
    endToEndReport,
  };
}
