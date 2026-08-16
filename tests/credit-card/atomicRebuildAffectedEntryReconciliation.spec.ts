import { describe, expect, it } from 'vitest';
import {
  buildAtomicCardAffectedEntryReconciliationReport,
} from '../../src/domain/credit-card/atomicRebuildAffectedEntryReconciliation';
import { buildAtomicCardStatementConflictForensicReport } from '../../src/domain/credit-card/atomicRebuildStatementConflictForensics';
import type { AtomicCardCompetenceExceptionForensicReport } from '../../src/domain/credit-card/atomicRebuildCompetenceExceptionForensics';
import type {
  AtomicCardProjectionComparison,
  AtomicCardShadowEntry,
  AtomicCardShadowProjection,
  PersistedAtomicCardEntry,
  PersistedAtomicCardProjection,
} from '../../src/domain/credit-card/atomicRebuildShadow';

const privateKey = 'private-duplicate-competence';

const persistedEntry = (statementKey: string, index: number): PersistedAtomicCardEntry => ({
  rowId: `private-row-${index}`,
  transactionId: `private-transaction-${index}`,
  statementKey,
  postedDate: '2026-01-10',
  amountCents: -100,
  entryType: 'purchase',
});

const shadowEntry = (statementKey: string, index: number): AtomicCardShadowEntry => ({
  transactionId: `private-transaction-${index}`,
  sourceFileName: 'private.csv',
  sourceRowHash: `private-hash-${index}`,
  statementKey,
  postedDate: '2026-01-10',
  amountCents: -100,
  entryType: 'purchase',
});

const persisted = (entries: PersistedAtomicCardEntry[]): PersistedAtomicCardProjection => ({
  source: 'engine',
  statements: [
    {
      statementKey: privateKey,
      dueDate: '2026-02-10',
      entryCount: 0,
      statementTotalCents: 100_000,
      totalPaymentsCents: 50_000,
      openBalanceCents: 50_000,
      hasProtectedMetadata: true,
      manualTotalsPresent: true,
    },
    {
      statementKey: privateKey,
      dueDate: '2026-02-11',
      entryCount: 0,
      statementTotalCents: 100_000,
      totalPaymentsCents: 49_000,
      openBalanceCents: 51_000,
      hasProtectedMetadata: false,
      manualTotalsPresent: false,
    },
  ],
  entries,
  payments: [],
});

const shadow = (entries: AtomicCardShadowEntry[]): AtomicCardShadowProjection => ({
  version: 1,
  accountId: 'private-account',
  sourceCycleCount: 1,
  sourceTransactionCount: entries.length,
  projectedEntryCount: entries.length,
  projectedPaymentCount: 0,
  statements: [
    {
      statementKey: privateKey,
      purchaseReferenceMonth: '2026-01',
      dueDate: '2026-02-10',
      dueYear: 2026,
      dueMonth: 2,
      status: 'open',
      sourceFiles: ['private.csv'],
      entryCount: entries.length,
      totalPurchasesCents: 100_000,
      totalFeesCents: 0,
      totalInterestCents: 0,
      totalRefundsCents: 0,
      statementTotalCents: 100_000,
      totalPaymentsCents: 50_000,
      openBalanceCents: 50_000,
    },
  ],
  entries,
  payments: [],
  issues: [],
  blockers: [],
  warnings: [],
  safeToStage: false,
  checksum: 'shadow-v1-private-checksum',
});

const comparison = (): AtomicCardProjectionComparison => ({
  status: 'different',
  safeToActivate: false,
  duplicatePersistedTransactionIds: [],
  repairablePersistedEntryRowIds: [],
  conflictingDuplicatePersistedTransactionIds: [],
  duplicatePersistedStatementKeys: [privateKey],
  duplicatePersistedPaymentTransactionIds: [],
  suspiciousPersistedPaymentEventKeys: [],
  repairablePersistedPaymentRowIds: [],
  protectedMetadataStatementKeys: [privateKey],
  missingTransactionIds: [],
  orphanTransactionIds: [],
  changedTransactionIds: [],
  missingStatementKeys: [],
  orphanStatementKeys: [],
  changedStatementKeys: [],
  missingPaymentKeys: [],
  orphanPaymentKeys: [],
  changedPaymentTransactionIds: [],
  structuralDifferenceCount: 1,
  activationChangeCount: 0,
  differenceCount: 2,
});

const competenceExceptions = (
  affectedEntryCount: number,
  duplicateGroupCount = 1
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
    status: 'review-needed',
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

describe('buildAtomicCardAffectedEntryReconciliationReport', () => {
  it('explica o caso real em que as linhas estão fora da fatura atual, mas apontam para ela na sombra', () => {
    const current = persisted([]);
    const projected = shadow(
      Array.from({ length: 87 }, (_, index) => shadowEntry(privateKey, index))
    );
    const upstream = competenceExceptions(87);
    const report = buildAtomicCardAffectedEntryReconciliationReport({
      shadow: projected,
      persisted: current,
      comparison: comparison(),
      competenceExceptions: upstream,
    });

    expect(report).toMatchObject({
      status: 'explained-by-projected-target',
      currentAttachedEntryCount: 0,
      projectedTargetEntryCount: 87,
      upstreamAffectedEntryCount: 87,
      reconciledAffectedEntryCount: 87,
      unexplainedCountDelta: 0,
      eligibleForConflictForensics: true,
      eligibleForWrite: false,
      actualWriteOperationCount: 0,
    });

    const conflict = buildAtomicCardStatementConflictForensicReport({
      shadow: projected,
      persisted: current,
      comparison: comparison(),
      competenceExceptions: upstream,
    });
    expect(conflict.status).not.toBe('blocked');
    expect(conflict.affectedEntryCount).toBe(87);
    expect(conflict.eligibleForWrite).toBe(false);
    expect(conflict.actualWriteOperationCount).toBe(0);
  });

  it('explica a contagem quando as linhas ainda estão vinculadas à fatura duplicada atual', () => {
    const current = persisted(
      Array.from({ length: 5 }, (_, index) => persistedEntry(privateKey, index))
    );
    const report = buildAtomicCardAffectedEntryReconciliationReport({
      shadow: shadow([]),
      persisted: current,
      comparison: comparison(),
      competenceExceptions: competenceExceptions(5),
    });

    expect(report.status).toBe('explained-by-current-attachment');
    expect(report.currentAttachedEntryCount).toBe(5);
    expect(report.projectedTargetEntryCount).toBe(0);
    expect(report.unexplainedCountDelta).toBe(0);
    expect(report.eligibleForConflictForensics).toBe(true);
  });

  it('bloqueia quando nenhuma das duas proveniências explica a contagem upstream', () => {
    const report = buildAtomicCardAffectedEntryReconciliationReport({
      shadow: shadow(Array.from({ length: 3 }, (_, index) => shadowEntry(privateKey, index))),
      persisted: persisted(Array.from({ length: 2 }, (_, index) => persistedEntry(privateKey, index))),
      comparison: comparison(),
      competenceExceptions: competenceExceptions(7),
    });

    expect(report.status).toBe('blocked');
    expect(report.unexplainedCountDelta).toBe(4);
    expect(report.eligibleForConflictForensics).toBe(false);
    expect(report.recommendationCodes).toContain('investigate-count-provenance');
  });

  it('não expõe competência, identidade, origem ou valor e não altera as entradas', () => {
    const current = persisted([persistedEntry(privateKey, 1)]);
    const projected = shadow([shadowEntry(privateKey, 1)]);
    const currentComparison = comparison();
    const upstream = competenceExceptions(1);
    const before = JSON.stringify({ current, projected, currentComparison, upstream });

    const first = buildAtomicCardAffectedEntryReconciliationReport({
      shadow: projected,
      persisted: current,
      comparison: currentComparison,
      competenceExceptions: upstream,
    });
    const second = buildAtomicCardAffectedEntryReconciliationReport({
      shadow: projected,
      persisted: current,
      comparison: currentComparison,
      competenceExceptions: upstream,
    });

    expect(second).toEqual(first);
    expect(JSON.stringify({ current, projected, currentComparison, upstream })).toBe(before);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain(privateKey);
    expect(serialized).not.toContain('private-transaction');
    expect(serialized).not.toContain('private.csv');
    expect(serialized).not.toContain('100000');
  });
});
