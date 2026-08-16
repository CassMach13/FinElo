import { describe, expect, it } from 'vitest';
import { buildAtomicCardAffectedEntryReconciliationReport } from '../../src/domain/credit-card/atomicRebuildAffectedEntryReconciliation';
import type { AtomicCardCompetenceExceptionForensicReport } from '../../src/domain/credit-card/atomicRebuildCompetenceExceptionForensics';
import {
  buildAtomicCardStatementConservationDryRunReport,
  isAtomicCardActivationBlockedByStatementConservation,
} from '../../src/domain/credit-card/atomicRebuildStatementConservationDryRun';
import { buildAtomicCardStatementConflictForensicReport } from '../../src/domain/credit-card/atomicRebuildStatementConflictForensics';
import type {
  AtomicCardProjectionComparison,
  AtomicCardShadowEntry,
  AtomicCardShadowProjection,
  AtomicCardShadowStatement,
  PersistedAtomicCardProjection,
  PersistedAtomicCardStatement,
} from '../../src/domain/credit-card/atomicRebuildShadow';

const privateKey = 'private-duplicate-competence';
const privateChecksum = 'shadow-v1-private-checksum';

const statement = (
  overrides: Partial<PersistedAtomicCardStatement> = {}
): PersistedAtomicCardStatement => ({
  statementKey: privateKey,
  dueDate: '2026-02-10',
  entryCount: 0,
  statementTotalCents: 44_990,
  totalPaymentsCents: 39_990,
  openBalanceCents: 5_000,
  hasProtectedMetadata: false,
  manualTotalsPresent: false,
  statementTotalFromFileCents: null,
  totalPaymentsFromFileCents: null,
  ...overrides,
});

const projectedStatement = (
  overrides: Partial<AtomicCardShadowStatement> = {}
): AtomicCardShadowStatement => ({
  statementKey: privateKey,
  purchaseReferenceMonth: '2026-01',
  dueDate: '2026-02-10',
  dueYear: 2026,
  dueMonth: 2,
  status: 'open',
  sourceFiles: ['private-source.csv'],
  entryCount: 87,
  totalPurchasesCents: 44_990,
  totalFeesCents: 0,
  totalInterestCents: 0,
  totalRefundsCents: 0,
  statementTotalCents: 44_990,
  totalPaymentsCents: 0,
  openBalanceCents: 44_990,
  ...overrides,
});

const projectedEntry = (index: number): AtomicCardShadowEntry => ({
  transactionId: `private-transaction-${index}`,
  sourceFileName: 'private-source.csv',
  sourceRowHash: `private-hash-${index}`,
  statementKey: privateKey,
  postedDate: '2026-01-10',
  amountCents: -100,
  entryType: 'purchase',
});

const shadow = (
  statements: AtomicCardShadowStatement[] = [projectedStatement()],
  entryCount = 87
): AtomicCardShadowProjection => ({
  version: 1,
  accountId: 'private-account',
  sourceCycleCount: 1,
  sourceTransactionCount: entryCount,
  projectedEntryCount: entryCount,
  projectedPaymentCount: 0,
  statements,
  entries: Array.from({ length: entryCount }, (_, index) => projectedEntry(index)),
  payments: [],
  issues: [],
  blockers: [],
  warnings: [],
  safeToStage: false,
  checksum: privateChecksum,
});

const persisted = (
  statements: PersistedAtomicCardStatement[]
): PersistedAtomicCardProjection => ({
  source: 'engine',
  statements,
  entries: [],
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
  differenceCount: 1,
  ...overrides,
});

const competenceExceptions = (
  duplicateGroupCount = 1,
  affectedEntryCount = 87
): AtomicCardCompetenceExceptionForensicReport => ({
  version: 1,
  privacy: 'aggregated-no-identifiers',
  nonAuthoritative: true,
  executable: false,
  mutationPayloadIncluded: false,
  actualWriteOperationCount: 0,
  checksum: privateChecksum,
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

const productionLikeStatements = (): PersistedAtomicCardStatement[] => [
  statement({
    dueDate: '2026-01-10',
    statementTotalCents: 39_990,
    totalPaymentsCents: 40_000,
    openBalanceCents: 0,
    hasProtectedMetadata: true,
    manualTotalsPresent: true,
  }),
  statement(),
];

const buildReport = (input: {
  current?: PersistedAtomicCardProjection;
  projected?: AtomicCardShadowProjection;
  currentComparison?: AtomicCardProjectionComparison;
  upstream?: AtomicCardCompetenceExceptionForensicReport;
} = {}) => {
  const current = input.current || persisted(productionLikeStatements());
  const projected = input.projected || shadow();
  const currentComparison = input.currentComparison || comparison();
  const upstream = input.upstream || competenceExceptions();
  const affectedEntryReconciliation = buildAtomicCardAffectedEntryReconciliationReport({
    shadow: projected,
    persisted: current,
    comparison: currentComparison,
    competenceExceptions: upstream,
  });
  const conflictForensics = buildAtomicCardStatementConflictForensicReport({
    shadow: projected,
    persisted: current,
    comparison: currentComparison,
    competenceExceptions: upstream,
  });
  return buildAtomicCardStatementConservationDryRunReport({
    shadow: projected,
    persisted: current,
    comparison: currentComparison,
    conflictForensics,
    affectedEntryReconciliation,
  });
};

describe('buildAtomicCardStatementConservationDryRunReport', () => {
  it('simula o caso piloto sem escolher, excluir ou mesclar registros', () => {
    const report = buildReport();

    expect(report).toMatchObject({
      status: 'simulation-complete',
      privacy: 'aggregated-no-identifiers',
      nonAuthoritative: true,
      executable: false,
      mutationPayloadIncluded: false,
      actualWriteOperationCount: 0,
      duplicateGroupCount: 1,
      locatedGroupCount: 1,
      simulatedGroupCount: 1,
      reviewGroupCount: 0,
      simulatedCandidateCount: 1,
      duplicateRecordCountBefore: 2,
      duplicateRecordCountAfter: 2,
      protectedMetadataRecordCountBefore: 1,
      protectedMetadataRecordCountAfter: 1,
      manualPayloadRecordCountBefore: 1,
      manualPayloadRecordCountAfter: 1,
      officialMetadataValueCountBefore: 0,
      officialMetadataValueCountAfter: 0,
      simulatedDerivedMismatchCountBefore: 8,
      simulatedDerivedMismatchCountAfter: 0,
      protectedMetadataLossCount: 0,
      selectedRecordCount: 0,
      recordDeletionCount: 0,
      recordMergeCount: 0,
      eligibleForFutureConservationPlan: true,
      eligibleForWrite: false,
    });
    expect(report.blockerProfiles).toEqual([]);
    expect(report.recommendationCodes).toContain('design-reversible-conservation-plan-next');
  });

  it('mantém a revisão obrigatória quando há mais de um payload manual', () => {
    const report = buildReport({
      current: persisted([
        statement({ hasProtectedMetadata: true, manualTotalsPresent: true }),
        statement({ hasProtectedMetadata: true, manualTotalsPresent: true }),
      ]),
    });

    expect(report.status).toBe('review-needed');
    expect(report.simulatedGroupCount).toBe(0);
    expect(report.reviewGroupCount).toBe(1);
    expect(report.blockerProfiles).toContainEqual({
      code: 'multiple-manual-payloads',
      groupCount: 1,
    });
    expect(report.eligibleForFutureConservationPlan).toBe(false);
  });

  it('não combina totais oficiais conflitantes', () => {
    const report = buildReport({
      current: persisted([
        statement({
          hasProtectedMetadata: true,
          statementTotalFromFileCents: 10_000,
          totalPaymentsFromFileCents: 1_000,
        }),
        statement({
          hasProtectedMetadata: true,
          statementTotalFromFileCents: 20_000,
          totalPaymentsFromFileCents: 2_000,
        }),
      ]),
    });

    expect(report.status).toBe('review-needed');
    expect(report.simulatedCandidateCount).toBe(0);
    expect(report.blockerProfiles).toContainEqual({
      code: 'conflicting-official-statement-totals',
      groupCount: 1,
    });
    expect(report.blockerProfiles).toContainEqual({
      code: 'conflicting-official-payment-totals',
      groupCount: 1,
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('10000');
    expect(serialized).not.toContain('20000');
  });

  it('não simula uma fatura ausente da sombra', () => {
    const report = buildReport({ projected: shadow([], 87) });

    expect(report.status).toBe('review-needed');
    expect(report.reviewGroupCount).toBe(1);
    expect(report.blockerProfiles).toContainEqual({
      code: 'missing-shadow-statement',
      groupCount: 1,
    });
  });

  it('bloqueia quando os relatórios upstream não pertencem à mesma sombra', () => {
    const current = persisted(productionLikeStatements());
    const projected = shadow();
    const currentComparison = comparison();
    const upstream = competenceExceptions();
    const affectedEntryReconciliation = buildAtomicCardAffectedEntryReconciliationReport({
      shadow: projected,
      persisted: current,
      comparison: currentComparison,
      competenceExceptions: upstream,
    });
    const conflictForensics = buildAtomicCardStatementConflictForensicReport({
      shadow: projected,
      persisted: current,
      comparison: currentComparison,
      competenceExceptions: upstream,
    });
    const report = buildAtomicCardStatementConservationDryRunReport({
      shadow: projected,
      persisted: current,
      comparison: currentComparison,
      conflictForensics: { ...conflictForensics, checksum: 'different-private-checksum' },
      affectedEntryReconciliation,
    });

    expect(report.status).toBe('blocked');
    expect(report.blockerProfiles).toContainEqual({
      code: 'upstream-report-mismatch',
      groupCount: 1,
    });
    expect(report.eligibleForFutureConservationPlan).toBe(false);
  });

  it('encerra sem duplicidades quando os relatórios upstream também estão vazios', () => {
    const report = buildReport({
      current: persisted([]),
      projected: shadow([], 0),
      currentComparison: comparison({
        duplicatePersistedStatementKeys: [],
        protectedMetadataStatementKeys: [],
      }),
      upstream: competenceExceptions(0, 0),
    });

    expect(report.status).toBe('no-duplicates');
    expect(report.duplicateRecordCountBefore).toBe(0);
    expect(report.actualWriteOperationCount).toBe(0);
    expect(report.recommendationCodes).toEqual(['keep-writes-disabled']);
  });

  it('é determinístico, não altera entradas e não expõe identificadores, origens ou valores', () => {
    const current = persisted(productionLikeStatements());
    const projected = shadow();
    const currentComparison = comparison();
    const upstream = competenceExceptions();
    const before = JSON.stringify({ current, projected, currentComparison, upstream });

    const first = buildReport({ current, projected, currentComparison, upstream });
    const second = buildReport({ current, projected, currentComparison, upstream });

    expect(second).toEqual(first);
    expect(JSON.stringify({ current, projected, currentComparison, upstream })).toBe(before);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain(privateKey);
    expect(serialized).not.toContain('private-source.csv');
    expect(serialized).not.toContain('private-transaction');
    expect(serialized).not.toContain('44990');
    expect(serialized).not.toContain('39990');
  });
});

describe('isAtomicCardActivationBlockedByStatementConservation', () => {
  it('bloqueia a ativação quando o relatório atual declara escrita não elegível', () => {
    expect(
      isAtomicCardActivationBlockedByStatementConservation(buildReport())
    ).toBe(true);
  });

  it('falha fechado enquanto o relatório ainda não existe', () => {
    expect(isAtomicCardActivationBlockedByStatementConservation(null)).toBe(true);
    expect(isAtomicCardActivationBlockedByStatementConservation(undefined)).toBe(true);
  });

  it('só libera uma futura versão que autorize escrita explicitamente', () => {
    expect(
      isAtomicCardActivationBlockedByStatementConservation({ eligibleForWrite: true })
    ).toBe(false);
  });
});
