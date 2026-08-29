import type { AtomicCardCompetenceEvidenceCycle } from './atomicRebuildCompetenceForensics';
import {
  simulateAtomicCardSequentialDryRun,
  type AtomicCardSequentialDryRunReport,
} from './atomicRebuildSequentialDryRun';
import type { AtomicCardProvenanceReport } from './atomicRebuildProvenance';
import type {
  AtomicCardProjectionComparison,
  AtomicCardShadowProjection,
  PersistedAtomicCardEntry,
  PersistedAtomicCardProjection,
  PersistedAtomicCardStatement,
} from './atomicRebuildShadow';

export type AtomicCardStructuralEntryExecutionStatus =
  | 'not-needed'
  | 'contract-ready'
  | 'blocked';

export type AtomicCardStructuralEntryExecutionBlockerCode =
  | 'sequential-step-blocked'
  | 'identity-step-incomplete'
  | 'competence-step-incomplete'
  | 'invalid-persisted-revision'
  | 'invalid-shadow-checksum'
  | 'entry-row-identity-missing'
  | 'entry-row-set-changed'
  | 'statement-record-identity-missing'
  | 'statement-record-identity-ambiguous'
  | 'transaction-identity-invalid'
  | 'economic-content-changed'
  | 'source-provenance-changed'
  | 'identity-gap-remains'
  | 'physical-record-count-changed'
  | 'statement-or-payment-records-changed'
  | 'entry-update-count-mismatch';

/**
 * Payload privado. Ele nunca deve ser renderizado nem persistido em logs: as
 * identidades abaixo existem apenas para o banco repetir o plano sob lock.
 */
export interface AtomicCardStructuralEntryUpdate {
  rowId: string;
  expectedTransactionId: string;
  desiredTransactionId: string;
  expectedStatementRowId: string;
  desiredStatementRowId: string;
  expectedStatementKey: string;
  desiredStatementKey: string;
  expectedEntryType: string;
  desiredEntryType: string;
  expectedPostedDate: string | null;
  expectedAmountCents: number;
  expectedSourceFileName: string;
  expectedSourceRowHash: string;
  expectedSourceRowIndex: number;
  expectedImportLotId: string;
}

export interface AtomicCardStructuralEntryExecutionRequest {
  accountId: string;
  expectedRevision: string;
  shadowChecksum: string;
  entryUpdates: AtomicCardStructuralEntryUpdate[];
}

export interface AtomicCardStructuralEntryExecutionReport {
  version: 1;
  privacy: 'aggregated-no-identifiers';
  nonAuthoritative: true;
  executable: false;
  mutationPayloadIncluded: false;
  actualWriteOperationCount: 0;
  eligibleForWrite: false;
  status: AtomicCardStructuralEntryExecutionStatus;
  checksumBound: boolean;
  revisionBound: boolean;
  expectedEntryUpdateCount: number;
  expectedIdentityUpdateCount: number;
  expectedCompetenceUpdateCount: number;
  expectedTypeUpdateCount: number;
  expectedLogicalFieldUpdateCount: number;
  snapshotEntryCount: number;
  requiredDatabaseGuardCount: 18;
  preparedDatabaseGuardCount: number;
  preservesEntryRows: boolean;
  preservesTransactions: boolean;
  preservesEconomicContent: boolean;
  preservesSourceProvenance: boolean;
  preservesStatements: boolean;
  preservesPayments: boolean;
  protectedMetadataAffectedEntryCount: number;
  residualStatementDifferenceCount: number;
  residualPaymentDifferenceCount: number;
  rollbackRequiresAfterRevision: true;
  dedicatedFeatureFlagRequired: true;
  eligibleForStagingExecution: boolean;
  blockerCodes: AtomicCardStructuralEntryExecutionBlockerCode[];
}

export interface AtomicCardStructuralEntryExecutionPreparation {
  report: AtomicCardStructuralEntryExecutionReport;
  request: AtomicCardStructuralEntryExecutionRequest | null;
  sequentialReport: AtomicCardSequentialDryRunReport;
}

const isUuid = (value: string | null | undefined): value is string =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '')
  );

const economicSignature = (entry: PersistedAtomicCardEntry): string =>
  JSON.stringify([entry.postedDate ?? null, entry.amountCents]);

const sourceSignature = (entry: PersistedAtomicCardEntry): string =>
  JSON.stringify([
    entry.sourceFileName ?? null,
    entry.sourceRowHash ?? null,
    entry.sourceRowIndex ?? null,
    entry.importLotId ?? null,
    entry.createdAt ?? null,
  ]);

const statementRowsByKey = (
  statements: PersistedAtomicCardStatement[]
): Map<string, PersistedAtomicCardStatement[]> => {
  const rows = new Map<string, PersistedAtomicCardStatement[]>();
  statements.forEach((statement) => {
    const group = rows.get(statement.statementKey) || [];
    group.push(statement);
    rows.set(statement.statementKey, group);
  });
  return rows;
};

/**
 * Converte a simulação sequencial 2Q em um primeiro contrato executável e
 * estritamente limitado às linhas normalizadas de `credit_card_entries`.
 *
 * O contrato não altera `transactions`, datas, valores, proveniência, faturas
 * ou pagamentos. Ele só restaura a identidade imutável da origem, religa a
 * linha à fatura já existente e, quando comprovado pela própria sombra, ajusta
 * o tipo técnico da linha. Resíduos de fatura/pagamento continuam bloqueados
 * para uma etapa posterior e não entram neste payload.
 */
export function prepareAtomicCardStructuralEntryExecution(input: {
  shadow: AtomicCardShadowProjection;
  persisted: PersistedAtomicCardProjection;
  comparison: AtomicCardProjectionComparison;
  provenance: AtomicCardProvenanceReport;
  cycles: AtomicCardCompetenceEvidenceCycle[];
  closingDay?: number | null;
  persistedRevision: string | null | undefined;
}): AtomicCardStructuralEntryExecutionPreparation {
  const simulation = simulateAtomicCardSequentialDryRun(input);
  const sequentialReport = simulation.report;
  const desired = simulation.persisted;
  const blockers = new Set<AtomicCardStructuralEntryExecutionBlockerCode>();
  const revisionBound = /^[a-f0-9]{32}$/.test(String(input.persistedRevision || ''));
  const checksumBound = /^shadow-v1-[a-f0-9]{8}$/.test(input.shadow.checksum);

  if (sequentialReport.status === 'blocked' || sequentialReport.blockerProfiles.length > 0) {
    blockers.add('sequential-step-blocked');
  }
  if (!['ready', 'not-needed'].includes(sequentialReport.identityStepStatus)) {
    blockers.add('identity-step-incomplete');
  }
  if (!['ready', 'not-needed'].includes(sequentialReport.competenceStepStatus)) {
    blockers.add('competence-step-incomplete');
  }
  if (!revisionBound) blockers.add('invalid-persisted-revision');
  if (!checksumBound) blockers.add('invalid-shadow-checksum');

  const currentByRowId = new Map<string, PersistedAtomicCardEntry>();
  input.persisted.entries.forEach((entry) => {
    if (!isUuid(entry.rowId) || currentByRowId.has(entry.rowId)) {
      blockers.add('entry-row-identity-missing');
      return;
    }
    currentByRowId.set(entry.rowId, entry);
  });
  const desiredByRowId = new Map<string, PersistedAtomicCardEntry>();
  desired.entries.forEach((entry) => {
    if (!isUuid(entry.rowId) || desiredByRowId.has(entry.rowId)) {
      blockers.add('entry-row-identity-missing');
      return;
    }
    desiredByRowId.set(entry.rowId, entry);
  });
  if (
    input.persisted.entries.length !== desired.entries.length ||
    currentByRowId.size !== input.persisted.entries.length ||
    desiredByRowId.size !== desired.entries.length ||
    Array.from(currentByRowId.keys()).some((rowId) => !desiredByRowId.has(rowId))
  ) {
    blockers.add('entry-row-set-changed');
  }

  const statements = statementRowsByKey(input.persisted.statements);
  if (input.persisted.statements.some((statement) => !isUuid(statement.rowId))) {
    blockers.add('statement-record-identity-missing');
  }
  if (Array.from(statements.values()).some((rows) => rows.length !== 1)) {
    blockers.add('statement-record-identity-ambiguous');
  }

  let identityUpdateCount = 0;
  let competenceUpdateCount = 0;
  let typeUpdateCount = 0;
  let economicContentChanged = false;
  let sourceProvenanceChanged = false;
  const updates: AtomicCardStructuralEntryUpdate[] = [];

  input.persisted.entries.forEach((current) => {
    const rowId = String(current.rowId || '');
    const expected = desiredByRowId.get(rowId);
    if (!expected) return;
    if (economicSignature(current) !== economicSignature(expected)) {
      economicContentChanged = true;
    }
    if (sourceSignature(current) !== sourceSignature(expected)) {
      sourceProvenanceChanged = true;
    }

    const identityChanged = current.transactionId !== expected.transactionId;
    const competenceChanged = current.statementKey !== expected.statementKey;
    const typeChanged = current.entryType !== expected.entryType;
    identityUpdateCount += Number(identityChanged);
    competenceUpdateCount += Number(competenceChanged);
    typeUpdateCount += Number(typeChanged);
    if (!identityChanged && !competenceChanged && !typeChanged) return;

    const currentStatements = statements.get(current.statementKey) || [];
    const desiredStatements = statements.get(expected.statementKey) || [];
    if (currentStatements.length !== 1 || desiredStatements.length !== 1) {
      blockers.add('statement-record-identity-ambiguous');
      return;
    }
    const currentStatementRowId = currentStatements[0].rowId;
    const desiredStatementRowId = desiredStatements[0].rowId;
    if (
      !isUuid(current.statementRowId) ||
      current.statementRowId !== currentStatementRowId ||
      !isUuid(currentStatementRowId) ||
      !isUuid(desiredStatementRowId)
    ) {
      blockers.add('statement-record-identity-missing');
      return;
    }
    if (!isUuid(current.transactionId) || !isUuid(expected.transactionId)) {
      blockers.add('transaction-identity-invalid');
      return;
    }
    if (
      !current.sourceFileName ||
      !current.sourceRowHash ||
      !Number.isInteger(current.sourceRowIndex) ||
      !isUuid(current.importLotId)
    ) {
      blockers.add('source-provenance-changed');
      return;
    }

    updates.push({
      rowId,
      expectedTransactionId: current.transactionId,
      desiredTransactionId: expected.transactionId,
      expectedStatementRowId: currentStatementRowId,
      desiredStatementRowId,
      expectedStatementKey: current.statementKey,
      desiredStatementKey: expected.statementKey,
      expectedEntryType: current.entryType,
      desiredEntryType: expected.entryType,
      expectedPostedDate: current.postedDate,
      expectedAmountCents: current.amountCents,
      expectedSourceFileName: current.sourceFileName,
      expectedSourceRowHash: current.sourceRowHash,
      expectedSourceRowIndex: Number(current.sourceRowIndex),
      expectedImportLotId: current.importLotId,
    });
  });

  if (economicContentChanged) blockers.add('economic-content-changed');
  if (sourceProvenanceChanged) blockers.add('source-provenance-changed');
  if (
    sequentialReport.afterSequential.missingIdentityCount > 0 ||
    sequentialReport.afterSequential.duplicateIdentityGroupCount > 0 ||
    sequentialReport.afterSequential.orphanIdentityCount > 0 ||
    sequentialReport.afterSequential.changedTransactionCount > 0
  ) {
    blockers.add('identity-gap-remains');
  }
  if (
    sequentialReport.rowCountBefore !== sequentialReport.rowCountAfter ||
    sequentialReport.rowCountBefore !== input.persisted.entries.length
  ) {
    blockers.add('physical-record-count-changed');
  }
  if (!sequentialReport.statementRecordsPreserved || !sequentialReport.paymentRecordsPreserved) {
    blockers.add('statement-or-payment-records-changed');
  }
  if (
    identityUpdateCount !== sequentialReport.identityMutationCount ||
    competenceUpdateCount !== sequentialReport.competenceMutationCount ||
    typeUpdateCount !== sequentialReport.typeMutationCount ||
    updates.length !== new Set(updates.map((update) => update.rowId)).size
  ) {
    blockers.add('entry-update-count-mismatch');
  }

  const noChangeNeeded =
    sequentialReport.status === 'not-needed' &&
    identityUpdateCount + competenceUpdateCount + typeUpdateCount === 0;
  const eligibleForStagingExecution =
    blockers.size === 0 &&
    updates.length > 0 &&
    sequentialReport.rowCountBefore === sequentialReport.rowCountAfter &&
    sequentialReport.dateMutationCount === 0 &&
    sequentialReport.amountMutationCount === 0 &&
    sequentialReport.sourceMutationCount === 0 &&
    sequentialReport.statementRecordsPreserved &&
    sequentialReport.paymentRecordsPreserved;
  const status: AtomicCardStructuralEntryExecutionStatus = noChangeNeeded
    ? 'not-needed'
    : eligibleForStagingExecution
      ? 'contract-ready'
      : 'blocked';
  const executableEntryUpdateCount = eligibleForStagingExecution
    ? updates.length
    : 0;
  const executableIdentityUpdateCount = eligibleForStagingExecution
    ? identityUpdateCount
    : 0;
  const executableCompetenceUpdateCount = eligibleForStagingExecution
    ? competenceUpdateCount
    : 0;
  const executableTypeUpdateCount = eligibleForStagingExecution
    ? typeUpdateCount
    : 0;

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
      expectedEntryUpdateCount: executableEntryUpdateCount,
      expectedIdentityUpdateCount: executableIdentityUpdateCount,
      expectedCompetenceUpdateCount: executableCompetenceUpdateCount,
      expectedTypeUpdateCount: executableTypeUpdateCount,
      expectedLogicalFieldUpdateCount:
        executableIdentityUpdateCount +
        executableCompetenceUpdateCount +
        executableTypeUpdateCount,
      snapshotEntryCount: executableEntryUpdateCount,
      requiredDatabaseGuardCount: 18,
      preparedDatabaseGuardCount: eligibleForStagingExecution ? 18 : 0,
      preservesEntryRows:
        sequentialReport.rowCountBefore === sequentialReport.rowCountAfter,
      preservesTransactions: true,
      preservesEconomicContent:
        sequentialReport.dateMutationCount === 0 &&
        sequentialReport.amountMutationCount === 0 &&
        !economicContentChanged,
      preservesSourceProvenance:
        sequentialReport.sourceMutationCount === 0 && !sourceProvenanceChanged,
      preservesStatements: sequentialReport.statementRecordsPreserved,
      preservesPayments: sequentialReport.paymentRecordsPreserved,
      protectedMetadataAffectedEntryCount:
        sequentialReport.protectedMetadataTouchCount,
      residualStatementDifferenceCount:
        sequentialReport.afterSequential.changedStatementCount,
      residualPaymentDifferenceCount:
        sequentialReport.afterSequential.changedPaymentCount,
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
          entryUpdates: updates.sort((left, right) => left.rowId.localeCompare(right.rowId)),
        }
      : null,
    sequentialReport,
  };
}
