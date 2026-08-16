import { describe, expect, it } from 'vitest';
import {
  buildAtomicCardStatementConflictForensicReport,
} from '../../src/domain/credit-card/atomicRebuildStatementConflictForensics';
import type { AtomicCardCompetenceExceptionForensicReport } from '../../src/domain/credit-card/atomicRebuildCompetenceExceptionForensics';
import type {
  AtomicCardProjectionComparison,
  AtomicCardShadowProjection,
  AtomicCardShadowStatement,
  PersistedAtomicCardEntry,
  PersistedAtomicCardProjection,
  PersistedAtomicCardStatement,
} from '../../src/domain/credit-card/atomicRebuildShadow';

const statement = (
  statementKey: string,
  overrides: Partial<PersistedAtomicCardStatement> = {}
): PersistedAtomicCardStatement => ({
  statementKey,
  dueDate: '2026-02-10',
  entryCount: 87,
  statementTotalCents: 100_000,
  totalPaymentsCents: 50_000,
  openBalanceCents: 50_000,
  hasProtectedMetadata: false,
  manualTotalsPresent: false,
  statementTotalFromFileCents: null,
  totalPaymentsFromFileCents: null,
  ...overrides,
});

const shadowStatement = (
  statementKey: string,
  overrides: Partial<AtomicCardShadowStatement> = {}
): AtomicCardShadowStatement => ({
  statementKey,
  purchaseReferenceMonth: '2026-01',
  dueDate: '2026-02-10',
  dueYear: 2026,
  dueMonth: 2,
  status: 'open',
  sourceFiles: ['private.csv'],
  entryCount: 87,
  totalPurchasesCents: 100_000,
  totalFeesCents: 0,
  totalInterestCents: 0,
  totalRefundsCents: 0,
  statementTotalCents: 100_000,
  totalPaymentsCents: 50_000,
  openBalanceCents: 50_000,
  ...overrides,
});

const shadow = (statements: AtomicCardShadowStatement[]): AtomicCardShadowProjection => ({
  version: 1,
  accountId: 'private-account',
  sourceCycleCount: 1,
  sourceTransactionCount: 87,
  projectedEntryCount: 87,
  projectedPaymentCount: 0,
  statements,
  entries: [],
  payments: [],
  issues: [],
  blockers: [],
  warnings: [],
  safeToStage: false,
  checksum: 'shadow-v1-private-checksum',
});

const entry = (statementKey: string, index: number): PersistedAtomicCardEntry => ({
  transactionId: `private-transaction-${index}`,
  statementKey,
  postedDate: '2026-01-10',
  amountCents: -100,
  entryType: 'purchase',
});

const persisted = (
  statements: PersistedAtomicCardStatement[],
  entries: PersistedAtomicCardEntry[] = []
): PersistedAtomicCardProjection => ({
  source: 'engine',
  statements,
  entries,
  payments: [],
});

const comparison = (
  overrides: Partial<AtomicCardProjectionComparison> = {}
): AtomicCardProjectionComparison => ({
  status: 'different',
  safeToActivate: false,
  duplicatePersistedTransactionIds: [],
  repairablePersistedEntryRowIds: [],
  conflictingDuplicatePersistedTransactionIds: [],
  duplicatePersistedStatementKeys: [],
  duplicatePersistedPaymentTransactionIds: [],
  suspiciousPersistedPaymentEventKeys: [],
  repairablePersistedPaymentRowIds: [],
  protectedMetadataStatementKeys: [],
  missingTransactionIds: [],
  orphanTransactionIds: [],
  changedTransactionIds: [],
  missingStatementKeys: [],
  orphanStatementKeys: [],
  changedStatementKeys: [],
  missingPaymentKeys: [],
  orphanPaymentKeys: [],
  changedPaymentTransactionIds: [],
  structuralDifferenceCount: 0,
  activationChangeCount: 0,
  differenceCount: 0,
  ...overrides,
});

const competenceExceptions = (
  duplicateGroupCount: number,
  affectedEntryCount: number
): AtomicCardCompetenceExceptionForensicReport => ({
  version: 1,
  privacy: 'aggregated-no-identifiers',
  nonAuthoritative: true,
  executable: false,
  mutationPayloadIncluded: false,
  actualWriteOperationCount: 0,
  checksum: 'shadow-v1-private-checksum',
  status: 'dependencies-isolated',
  totalExceptionCount: affectedEntryCount,
  classifiedExceptionCount: affectedEntryCount,
  unclassifiedExceptionCount: 0,
  classificationCountDelta: 0,
  identityPrerequisite: {
    status: 'not-needed',
    exceptionCount: 0,
    identityMismatchCount: 0,
    duplicateIdentityAnchorCount: 0,
    hypotheticalIdentityChangeCount: 0,
    confirmedAnchorCount: 0,
    unresolvedIdentityCount: 0,
  },
  statementPrerequisite: {
    status: duplicateGroupCount > 0 ? 'review-needed' : 'not-needed',
    affectedEntryCount,
    duplicateGroupCount,
    identicalGroupCount: 0,
    conflictingGroupCount: duplicateGroupCount,
    protectedGroupCount: duplicateGroupCount,
  },
  otherReviewCount: 0,
  protectedMetadataGroupCount: duplicateGroupCount,
  eligibleForFutureSequencedDryRun: false,
  eligibleForWrite: false,
  laneProfiles: [],
  recommendationCodes: ['keep-writes-disabled'],
});

describe('buildAtomicCardStatementConflictForensicReport', () => {
  it('isola o conflito, a compatibilidade com a sombra e a conservação protegida sem escolher registro', () => {
    const privateKey = 'private-competence';
    const currentEntries = Array.from({ length: 87 }, (_, index) => entry(privateKey, index));
    const current = persisted(
      [
        statement(privateKey, {
          hasProtectedMetadata: true,
          manualTotalsPresent: true,
          statementTotalFromFileCents: 100_000,
          totalPaymentsFromFileCents: 50_000,
        }),
        statement(privateKey, {
          entryCount: 0,
          statementTotalCents: 99_000,
          totalPaymentsCents: 49_000,
          openBalanceCents: 50_000,
          hasProtectedMetadata: false,
        }),
      ],
      currentEntries
    );

    const report = buildAtomicCardStatementConflictForensicReport({
      shadow: shadow([shadowStatement(privateKey)]),
      persisted: current,
      comparison: comparison({
        duplicatePersistedStatementKeys: [privateKey],
        protectedMetadataStatementKeys: [privateKey],
      }),
      competenceExceptions: competenceExceptions(1, 87),
    });

    expect(report).toMatchObject({
      status: 'conflict-isolated',
      privacy: 'aggregated-no-identifiers',
      nonAuthoritative: true,
      executable: false,
      mutationPayloadIncluded: false,
      actualWriteOperationCount: 0,
      duplicateGroupCount: 1,
      locatedGroupCount: 1,
      unclassifiedGroupCount: 0,
      duplicateRecordCount: 2,
      affectedEntryCount: 87,
      conflictingGroupCount: 1,
      eligibleForFutureConservationDryRun: true,
      eligibleForWrite: false,
    });
    expect(report.protectedMetadata).toEqual({
      protectedGroupCount: 1,
      manualPayloadRecordCount: 1,
      singleManualPayloadGroupCount: 1,
      multipleManualPayloadGroupCount: 0,
      officialStatementTotalGroupCount: 1,
      conflictingOfficialStatementTotalGroupCount: 0,
      officialPaymentTotalGroupCount: 1,
      conflictingOfficialPaymentTotalGroupCount: 0,
      unknownProtectedMetadataRecordCount: 0,
      unambiguousConservationGroupCount: 1,
      ambiguousConservationGroupCount: 0,
    });
    expect(report.fieldProfiles).toEqual([
      { code: 'entry-count', conflictingGroupCount: 1 },
      { code: 'statement-total', conflictingGroupCount: 1 },
      { code: 'payment-total', conflictingGroupCount: 1 },
      { code: 'protected-metadata-presence', conflictingGroupCount: 1 },
      { code: 'manual-totals-presence', conflictingGroupCount: 1 },
      { code: 'file-statement-total', conflictingGroupCount: 1 },
      { code: 'file-payment-total', conflictingGroupCount: 1 },
    ]);
    expect(report.shadowMatchProfiles).toEqual([
      { code: 'unique-shadow-compatible-record', groupCount: 1 },
    ]);
    expect(report.recommendationCodes).toContain('preserve-manual-payload-verbatim');
    expect(report.recommendationCodes).toContain('preserve-official-file-totals');
  });

  it('mantém revisão obrigatória quando mais de um registro carrega payload manual', () => {
    const privateKey = 'private-competence';
    const report = buildAtomicCardStatementConflictForensicReport({
      shadow: shadow([shadowStatement(privateKey)]),
      persisted: persisted(
        [
          statement(privateKey, { hasProtectedMetadata: true, manualTotalsPresent: true }),
          statement(privateKey, { hasProtectedMetadata: true, manualTotalsPresent: true }),
        ],
        Array.from({ length: 87 }, (_, index) => entry(privateKey, index))
      ),
      comparison: comparison({
        duplicatePersistedStatementKeys: [privateKey],
        protectedMetadataStatementKeys: [privateKey],
      }),
      competenceExceptions: competenceExceptions(1, 87),
    });

    expect(report.status).toBe('review-needed');
    expect(report.protectedMetadata.multipleManualPayloadGroupCount).toBe(1);
    expect(report.protectedMetadata.ambiguousConservationGroupCount).toBe(1);
    expect(report.eligibleForFutureConservationDryRun).toBe(false);
    expect(report.recommendationCodes).toContain('review-conflicting-protected-values');
  });

  it('detecta totais oficiais conflitantes sem expor os valores', () => {
    const privateKey = 'private-competence';
    const report = buildAtomicCardStatementConflictForensicReport({
      shadow: shadow([shadowStatement(privateKey)]),
      persisted: persisted(
        [
          statement(privateKey, {
            hasProtectedMetadata: true,
            statementTotalFromFileCents: 123_456,
            totalPaymentsFromFileCents: 12_345,
          }),
          statement(privateKey, {
            hasProtectedMetadata: true,
            statementTotalFromFileCents: 654_321,
            totalPaymentsFromFileCents: 54_321,
          }),
        ],
        Array.from({ length: 87 }, (_, index) => entry(privateKey, index))
      ),
      comparison: comparison({
        duplicatePersistedStatementKeys: [privateKey],
        protectedMetadataStatementKeys: [privateKey],
      }),
      competenceExceptions: competenceExceptions(1, 87),
    });

    expect(report.status).toBe('review-needed');
    expect(report.protectedMetadata.conflictingOfficialStatementTotalGroupCount).toBe(1);
    expect(report.protectedMetadata.conflictingOfficialPaymentTotalGroupCount).toBe(1);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('123456');
    expect(serialized).not.toContain('654321');
    expect(serialized).not.toContain(privateKey);
  });

  it('bloqueia quando a quantidade upstream ou a localização dos grupos não fecha', () => {
    const privateKey = 'private-competence';
    const report = buildAtomicCardStatementConflictForensicReport({
      shadow: shadow([shadowStatement(privateKey)]),
      persisted: persisted([statement(privateKey)]),
      comparison: comparison({ duplicatePersistedStatementKeys: [privateKey] }),
      competenceExceptions: competenceExceptions(1, 87),
    });

    expect(report.status).toBe('blocked');
    expect(report.locatedGroupCount).toBe(0);
    expect(report.unclassifiedGroupCount).toBe(1);
    expect(report.eligibleForFutureConservationDryRun).toBe(false);
    expect(report.recommendationCodes).toContain('investigate-unclassified-statement-groups');
    expect(report.actualWriteOperationCount).toBe(0);
  });

  it('é determinístico, não altera entradas e não carrega identificadores no relatório', () => {
    const privateKey = 'private-competence';
    const current = persisted(
      [statement(privateKey), statement(privateKey)],
      Array.from({ length: 2 }, (_, index) => entry(privateKey, index))
    );
    const currentShadow = shadow([
      shadowStatement(privateKey, { entryCount: 2 }),
    ]);
    const currentComparison = comparison({ duplicatePersistedStatementKeys: [privateKey] });
    const upstream = competenceExceptions(1, 2);
    const before = JSON.stringify({ current, currentShadow, currentComparison, upstream });

    const first = buildAtomicCardStatementConflictForensicReport({
      shadow: currentShadow,
      persisted: current,
      comparison: currentComparison,
      competenceExceptions: upstream,
    });
    const second = buildAtomicCardStatementConflictForensicReport({
      shadow: currentShadow,
      persisted: current,
      comparison: currentComparison,
      competenceExceptions: upstream,
    });

    expect(second).toEqual(first);
    expect(JSON.stringify({ current, currentShadow, currentComparison, upstream })).toBe(before);
    expect(JSON.stringify(first)).not.toContain(privateKey);
    expect(JSON.stringify(first)).not.toContain('private-transaction');
    expect(first.actualWriteOperationCount).toBe(0);
    expect(first.eligibleForWrite).toBe(false);
  });

  it('encerra sem duplicidades quando o upstream também está vazio', () => {
    const report = buildAtomicCardStatementConflictForensicReport({
      shadow: shadow([]),
      persisted: persisted([]),
      comparison: comparison(),
      competenceExceptions: competenceExceptions(0, 0),
    });

    expect(report.status).toBe('no-duplicates');
    expect(report.duplicateGroupCount).toBe(0);
    expect(report.actualWriteOperationCount).toBe(0);
    expect(report.recommendationCodes).toEqual(['keep-writes-disabled']);
  });
});
