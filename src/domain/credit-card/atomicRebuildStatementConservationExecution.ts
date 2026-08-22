import type { AtomicCardStatementConservationPlanReport } from './atomicRebuildStatementConservationPlan';
import type {
  AtomicCardProjectionComparison,
  AtomicCardShadowProjection,
  AtomicCardShadowStatement,
  PersistedAtomicCardProjection,
  PersistedAtomicCardStatement,
} from './atomicRebuildShadow';

export type AtomicCardStatementConservationExecutionStatus =
  | 'no-duplicates'
  | 'contract-ready'
  | 'blocked';

export type AtomicCardStatementConservationExecutionBlockerCode =
  | 'upstream-plan-not-ready'
  | 'invalid-persisted-revision'
  | 'invalid-shadow-checksum'
  | 'multiple-groups-require-separate-audits'
  | 'duplicate-group-cardinality-mismatch'
  | 'missing-source-identities'
  | 'mixed-card-group'
  | 'missing-shadow-statement'
  | 'ambiguous-shadow-statement'
  | 'multiple-manual-payloads'
  | 'missing-manual-payload'
  | 'conflicting-official-statement-totals'
  | 'conflicting-official-payment-totals'
  | 'conflicting-computed-line-totals'
  | 'unknown-protected-metadata'
  | 'upstream-link-count-mismatch';

export interface AtomicCardStatementConservationExecutionReport {
  version: 1;
  privacy: 'aggregated-no-identifiers';
  nonAuthoritative: true;
  executable: false;
  mutationPayloadIncluded: false;
  actualWriteOperationCount: 0;
  checksumBound: boolean;
  revisionBound: boolean;
  status: AtomicCardStatementConservationExecutionStatus;
  duplicateGroupCount: number;
  preparedGroupCount: number;
  sourceStatementCount: number;
  expectedEntryLinkCount: number;
  expectedPaymentLinkCount: number;
  protectedMetadataSourceCount: number;
  requiredDatabaseGuardCount: 10;
  preparedDatabaseGuardCount: number;
  snapshotIncludesLegacyItemLinks: true;
  rollbackRequiresAfterRevision: true;
  dedicatedFeatureFlagRequired: true;
  eligibleForStagingMigrationValidation: boolean;
  eligibleForWrite: false;
  blockerCodes: AtomicCardStatementConservationExecutionBlockerCode[];
}

export interface AtomicCardStatementConservationComposite {
  statementKey: string;
  purchaseReferenceMonth: string;
  dueDate: string;
  dueYear: number;
  dueMonth: number;
  status: AtomicCardShadowStatement['status'];
  entryCount: number;
  totalPurchasesCents: number;
  totalFeesCents: number;
  totalInterestCents: number;
  totalRefundsCents: number;
  statementTotalCents: number;
  totalPaymentsCents: number;
  openBalanceCents: number;
  manualTotalsJson: unknown | null;
  statementTotalFromFileCents: number | null;
  totalPaymentsFromFileCents: number | null;
  linesComputedTotalCents: number | null;
}

/**
 * Payload privado. Ele nunca deve ser renderizado, registrado ou persistido
 * pelo cliente: contém apenas as identidades mínimas que o RPC precisa repetir
 * e validar sob lock transacional.
 */
export interface AtomicCardStatementConservationExecutionRequest {
  accountId: string;
  expectedRevision: string;
  shadowChecksum: string;
  statementKey: string;
  sourceStatementIds: string[];
  expectedEntryLinkCount: number;
  expectedPaymentLinkCount: number;
  composite: AtomicCardStatementConservationComposite;
}

export interface AtomicCardStatementConservationExecutionPreparation {
  report: AtomicCardStatementConservationExecutionReport;
  request: AtomicCardStatementConservationExecutionRequest | null;
}

const distinctNonNullNumbers = (
  values: Array<number | null | undefined>
): number[] => Array.from(new Set(values.filter((value): value is number => value != null)));

const hasKnownProtectedMetadata = (statement: PersistedAtomicCardStatement): boolean =>
  Boolean(statement.manualTotalsPresent) ||
  statement.statementTotalFromFileCents != null ||
  statement.totalPaymentsFromFileCents != null ||
  statement.linesComputedTotalCents != null;

/**
 * Prepara o contrato mínimo da Sprint 2O sem executar qualquer escrita.
 *
 * O relatório público continua estritamente agregado. O payload privado só é
 * produzido quando uma única competência duplicada está integralmente
 * identificada e todos os metadados protegidos são conserváveis sem escolher
 * uma linha vencedora.
 */
export function prepareAtomicCardStatementConservationExecution(input: {
  shadow: AtomicCardShadowProjection;
  persisted: PersistedAtomicCardProjection;
  comparison: AtomicCardProjectionComparison;
  conservationPlan: AtomicCardStatementConservationPlanReport;
  persistedRevision: string | null | undefined;
}): AtomicCardStatementConservationExecutionPreparation {
  const { shadow, persisted, comparison, conservationPlan, persistedRevision } = input;
  const duplicateKeys = [...comparison.duplicatePersistedStatementKeys].sort();
  const blockers = new Set<AtomicCardStatementConservationExecutionBlockerCode>();
  const revisionBound = /^[a-f0-9]{32}$/.test(String(persistedRevision || ''));
  const checksumBound = /^shadow-v1-[a-f0-9]{8}$/.test(shadow.checksum);

  if (duplicateKeys.length === 0) {
    return {
      report: {
        version: 1,
        privacy: 'aggregated-no-identifiers',
        nonAuthoritative: true,
        executable: false,
        mutationPayloadIncluded: false,
        actualWriteOperationCount: 0,
        checksumBound,
        revisionBound,
        status: 'no-duplicates',
        duplicateGroupCount: 0,
        preparedGroupCount: 0,
        sourceStatementCount: 0,
        expectedEntryLinkCount: 0,
        expectedPaymentLinkCount: 0,
        protectedMetadataSourceCount: 0,
        requiredDatabaseGuardCount: 10,
        preparedDatabaseGuardCount: 0,
        snapshotIncludesLegacyItemLinks: true,
        rollbackRequiresAfterRevision: true,
        dedicatedFeatureFlagRequired: true,
        eligibleForStagingMigrationValidation: false,
        eligibleForWrite: false,
        blockerCodes: [],
      },
      request: null,
    };
  }

  if (
    conservationPlan.status !== 'plan-ready' ||
    !conservationPlan.eligibleForFutureTransactionalImplementation ||
    conservationPlan.checksum !== shadow.checksum ||
    conservationPlan.duplicateGroupCount !== duplicateKeys.length
  ) {
    blockers.add('upstream-plan-not-ready');
  }
  if (!revisionBound) blockers.add('invalid-persisted-revision');
  if (!checksumBound) blockers.add('invalid-shadow-checksum');
  if (duplicateKeys.length !== 1) blockers.add('multiple-groups-require-separate-audits');

  const statementKey = duplicateKeys[0] || '';
  const group = persisted.statements.filter(
    (statement) => statement.statementKey === statementKey
  );
  if (group.length < 2 || group.length !== conservationPlan.sourceStatementRecordCount) {
    blockers.add('duplicate-group-cardinality-mismatch');
  }

  const sourceStatementIds = group
    .map((statement) => statement.rowId || '')
    .filter(Boolean)
    .sort();
  if (
    sourceStatementIds.length !== group.length ||
    new Set(sourceStatementIds).size !== sourceStatementIds.length
  ) {
    blockers.add('missing-source-identities');
  }

  const cardIds = Array.from(
    new Set(group.map((statement) => statement.cardId || '').filter(Boolean))
  );
  if (cardIds.length !== 1 || group.some((statement) => !statement.cardId)) {
    blockers.add('mixed-card-group');
  }

  const matchingShadowStatements = shadow.statements.filter(
    (statement) => statement.statementKey === statementKey
  );
  if (matchingShadowStatements.length === 0) blockers.add('missing-shadow-statement');
  if (matchingShadowStatements.length > 1) blockers.add('ambiguous-shadow-statement');

  const manualSources = group.filter((statement) => statement.manualTotalsPresent);
  if (manualSources.length > 1) blockers.add('multiple-manual-payloads');
  if (
    manualSources.length === 1 &&
    (manualSources[0].manualTotalsJson === undefined || manualSources[0].manualTotalsJson === null)
  ) {
    blockers.add('missing-manual-payload');
  }

  const officialStatementTotals = distinctNonNullNumbers(
    group.map((statement) => statement.statementTotalFromFileCents)
  );
  const officialPaymentTotals = distinctNonNullNumbers(
    group.map((statement) => statement.totalPaymentsFromFileCents)
  );
  const computedLineTotals = distinctNonNullNumbers(
    group.map((statement) => statement.linesComputedTotalCents)
  );
  if (officialStatementTotals.length > 1) {
    blockers.add('conflicting-official-statement-totals');
  }
  if (officialPaymentTotals.length > 1) {
    blockers.add('conflicting-official-payment-totals');
  }
  if (computedLineTotals.length > 1) {
    blockers.add('conflicting-computed-line-totals');
  }
  if (
    group.some(
      (statement) => Boolean(statement.hasProtectedMetadata) && !hasKnownProtectedMetadata(statement)
    )
  ) {
    blockers.add('unknown-protected-metadata');
  }

  const expectedEntryLinkCount = persisted.entries.filter(
    (entry) => entry.statementKey === statementKey
  ).length;
  const expectedPaymentLinkCount = persisted.payments.filter(
    (payment) => payment.statementKey === statementKey
  ).length;
  if (
    expectedEntryLinkCount !== conservationPlan.affectedEntryLinkCount ||
    expectedPaymentLinkCount !== conservationPlan.affectedPaymentLinkCount
  ) {
    blockers.add('upstream-link-count-mismatch');
  }

  const shadowStatement = matchingShadowStatements[0];
  const prepared = blockers.size === 0 && Boolean(shadowStatement);
  const protectedMetadataSourceCount = group.filter(hasKnownProtectedMetadata).length;
  const report: AtomicCardStatementConservationExecutionReport = {
    version: 1,
    privacy: 'aggregated-no-identifiers',
    nonAuthoritative: true,
    executable: false,
    mutationPayloadIncluded: false,
    actualWriteOperationCount: 0,
    checksumBound,
    revisionBound,
    status: prepared ? 'contract-ready' : 'blocked',
    duplicateGroupCount: duplicateKeys.length,
    preparedGroupCount: prepared ? 1 : 0,
    sourceStatementCount: group.length,
    expectedEntryLinkCount,
    expectedPaymentLinkCount,
    protectedMetadataSourceCount,
    requiredDatabaseGuardCount: 10,
    preparedDatabaseGuardCount: prepared ? 10 : 0,
    snapshotIncludesLegacyItemLinks: true,
    rollbackRequiresAfterRevision: true,
    dedicatedFeatureFlagRequired: true,
    eligibleForStagingMigrationValidation: prepared,
    eligibleForWrite: false,
    blockerCodes: Array.from(blockers),
  };

  if (!prepared || !shadowStatement) return { report, request: null };

  return {
    report,
    request: {
      accountId: shadow.accountId,
      expectedRevision: String(persistedRevision),
      shadowChecksum: shadow.checksum,
      statementKey,
      sourceStatementIds,
      expectedEntryLinkCount,
      expectedPaymentLinkCount,
      composite: {
        statementKey: shadowStatement.statementKey,
        purchaseReferenceMonth: shadowStatement.purchaseReferenceMonth,
        dueDate: shadowStatement.dueDate,
        dueYear: shadowStatement.dueYear,
        dueMonth: shadowStatement.dueMonth,
        status: shadowStatement.status,
        entryCount: shadowStatement.entryCount,
        totalPurchasesCents: shadowStatement.totalPurchasesCents,
        totalFeesCents: shadowStatement.totalFeesCents,
        totalInterestCents: shadowStatement.totalInterestCents,
        totalRefundsCents: shadowStatement.totalRefundsCents,
        statementTotalCents: shadowStatement.statementTotalCents,
        totalPaymentsCents: shadowStatement.totalPaymentsCents,
        openBalanceCents: shadowStatement.openBalanceCents,
        manualTotalsJson: manualSources[0]?.manualTotalsJson ?? null,
        statementTotalFromFileCents: officialStatementTotals[0] ?? null,
        totalPaymentsFromFileCents: officialPaymentTotals[0] ?? null,
        linesComputedTotalCents: computedLineTotals[0] ?? null,
      },
    },
  };
}
