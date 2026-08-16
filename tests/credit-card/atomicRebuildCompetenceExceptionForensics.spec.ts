import { describe, expect, it } from 'vitest';
import {
  buildAtomicCardCompetenceExceptionForensicReport,
} from '../../src/domain/credit-card/atomicRebuildCompetenceExceptionForensics';
import type { AtomicCardCompetenceDryRunReport } from '../../src/domain/credit-card/atomicRebuildCompetenceDryRun';
import type { AtomicCardIdentityDryRunReport } from '../../src/domain/credit-card/atomicRebuildIdentityDryRun';
import type {
  AtomicCardProjectionComparison,
  PersistedAtomicCardProjection,
  PersistedAtomicCardStatement,
} from '../../src/domain/credit-card/atomicRebuildShadow';

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

const dryRun = (
  overrides: Partial<AtomicCardCompetenceDryRunReport> = {}
): AtomicCardCompetenceDryRunReport => ({
  version: 1,
  privacy: 'aggregated-no-identifiers',
  nonAuthoritative: true,
  executable: false,
  mutationPayloadIncluded: false,
  actualWriteOperationCount: 0,
  checksum: 'shadow-private-checksum',
  status: 'partial',
  rowCountBefore: 1916,
  rowCountAfter: 1916,
  rowCountDelta: 0,
  competenceMismatchBefore: 1589,
  competenceMismatchAfter: 191,
  alreadyAlignedCount: 327,
  candidateCount: 1398,
  hypotheticalUpdateCount: 1398,
  excludedRowCount: 191,
  protectedMetadataTouchCount: 1201,
  identityMutationCount: 0,
  dateMutationCount: 0,
  amountMutationCount: 0,
  typeMutationCount: 0,
  sourceMutationCount: 0,
  statementRecordMutationCount: 0,
  paymentRecordMutationCount: 0,
  before: {
    changedTransactionCount: 1536,
    changedStatementCount: 20,
    changedPaymentCount: 7,
    structuralDifferenceCount: 1671,
    differenceCount: 1684,
  },
  after: {
    changedTransactionCount: 138,
    changedStatementCount: 20,
    changedPaymentCount: 7,
    structuralDifferenceCount: 273,
    differenceCount: 286,
  },
  residualStructuralDifferenceCount: 273,
  eligibleForFutureScopedExecution: false,
  changeProfiles: [],
  exclusionProfiles: [
    { code: 'identity-mismatch', count: 53 },
    { code: 'duplicate-current-identity', count: 51 },
    { code: 'duplicate-statement-key', count: 87 },
  ],
  blockerProfiles: [],
  recommendationCodes: ['keep-writes-disabled'],
  ...overrides,
});

const identityDryRun = (
  overrides: Partial<AtomicCardIdentityDryRunReport> = {}
): AtomicCardIdentityDryRunReport => ({
  version: 1,
  privacy: 'aggregated-no-identifiers',
  nonAuthoritative: true,
  executable: false,
  mutationPayloadIncluded: false,
  actualWriteOperationCount: 0,
  checksum: 'shadow-private-checksum',
  status: 'ready',
  rowCountBefore: 1916,
  rowCountAfter: 1916,
  rowCountDelta: 0,
  candidateCount: 53,
  hypotheticalUpdateCount: 53,
  confirmedAnchorCount: 53,
  unresolvedCount: 0,
  before: {
    missingIdentityCount: 53,
    duplicateIdentityGroupCount: 51,
    orphanIdentityCount: 0,
    changedIdentityCount: 1536,
    structuralDifferenceCount: 1671,
    differenceCount: 1684,
  },
  after: {
    missingIdentityCount: 0,
    duplicateIdentityGroupCount: 0,
    orphanIdentityCount: 0,
    changedIdentityCount: 1483,
    structuralDifferenceCount: 1567,
    differenceCount: 1580,
  },
  residualDifferenceCount: 1580,
  changeProfiles: [],
  blockerProfiles: [],
  sourceCohorts: [],
  recommendationCodes: ['keep-writes-disabled'],
  ...overrides,
});

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

const persisted = (
  statements: PersistedAtomicCardStatement[]
): PersistedAtomicCardProjection => ({
  source: 'engine',
  statements,
  entries: [],
  payments: [],
});

describe('buildAtomicCardCompetenceExceptionForensicReport', () => {
  it('classifica as 191 exceções do piloto sem criar plano executável', () => {
    const current = persisted([
      statement('private-competence', { hasProtectedMetadata: true }),
      statement('private-competence', {
        hasProtectedMetadata: true,
        totalPaymentsCents: 49_000,
        openBalanceCents: 51_000,
      }),
    ]);
    const currentComparison = comparison({
      duplicatePersistedTransactionIds: Array.from({ length: 51 }, (_, index) => `private-${index}`),
      duplicatePersistedStatementKeys: ['private-competence'],
      protectedMetadataStatementKeys: ['private-competence'],
    });

    const report = buildAtomicCardCompetenceExceptionForensicReport({
      persisted: current,
      comparison: currentComparison,
      identityDryRun: identityDryRun(),
      competenceDryRun: dryRun(),
    });

    expect(report).toMatchObject({
      status: 'dependencies-isolated',
      privacy: 'aggregated-no-identifiers',
      nonAuthoritative: true,
      executable: false,
      mutationPayloadIncluded: false,
      actualWriteOperationCount: 0,
      totalExceptionCount: 191,
      classifiedExceptionCount: 191,
      unclassifiedExceptionCount: 0,
      classificationCountDelta: 0,
      otherReviewCount: 0,
      eligibleForFutureSequencedDryRun: false,
      eligibleForWrite: false,
    });
    expect(report.identityPrerequisite).toEqual({
      status: 'covered-by-ready-dry-run',
      exceptionCount: 104,
      identityMismatchCount: 53,
      duplicateIdentityAnchorCount: 51,
      hypotheticalIdentityChangeCount: 53,
      confirmedAnchorCount: 53,
      unresolvedIdentityCount: 0,
    });
    expect(report.statementPrerequisite).toEqual({
      status: 'review-needed',
      affectedEntryCount: 87,
      duplicateGroupCount: 1,
      identicalGroupCount: 0,
      conflictingGroupCount: 1,
      protectedGroupCount: 1,
    });
    expect(report.laneProfiles).toEqual([
      { code: 'identity-reconstruction-prerequisite', order: 1, count: 53 },
      { code: 'duplicate-identity-anchor-prerequisite', order: 2, count: 51 },
      { code: 'statement-structure-prerequisite', order: 3, count: 87 },
    ]);
  });

  it('autoriza apenas uma futura simulação sequencial quando a fatura duplicada é idêntica e desprotegida', () => {
    const duplicateA = statement('private-competence');
    const duplicateB = statement('private-competence');
    const report = buildAtomicCardCompetenceExceptionForensicReport({
      persisted: persisted([duplicateA, duplicateB]),
      comparison: comparison({ duplicatePersistedStatementKeys: ['private-competence'] }),
      identityDryRun: identityDryRun(),
      competenceDryRun: dryRun(),
    });

    expect(report.status).toBe('dependencies-isolated');
    expect(report.statementPrerequisite.status).toBe('isolated');
    expect(report.statementPrerequisite.identicalGroupCount).toBe(1);
    expect(report.eligibleForFutureSequencedDryRun).toBe(true);
    expect(report.eligibleForWrite).toBe(false);
  });

  it('bloqueia a classificação quando a contagem agregada não fecha', () => {
    const report = buildAtomicCardCompetenceExceptionForensicReport({
      persisted: persisted([]),
      comparison: comparison(),
      identityDryRun: identityDryRun({ status: 'blocked' }),
      competenceDryRun: dryRun({
        excludedRowCount: 2,
        exclusionProfiles: [{ code: 'identity-mismatch', count: 1 }],
      }),
    });

    expect(report.status).toBe('blocked');
    expect(report.classifiedExceptionCount).toBe(1);
    expect(report.unclassifiedExceptionCount).toBe(1);
    expect(report.classificationCountDelta).toBe(-1);
    expect(report.recommendationCodes).toContain('investigate-unclassified-exceptions');
    expect(report.actualWriteOperationCount).toBe(0);
  });

  it('fica inerte quando não há exceções', () => {
    const report = buildAtomicCardCompetenceExceptionForensicReport({
      persisted: persisted([]),
      comparison: comparison({ status: 'identical' }),
      identityDryRun: identityDryRun({ status: 'not-needed', hypotheticalUpdateCount: 0 }),
      competenceDryRun: dryRun({
        status: 'not-needed',
        excludedRowCount: 0,
        exclusionProfiles: [],
      }),
    });

    expect(report.status).toBe('no-exceptions');
    expect(report.totalExceptionCount).toBe(0);
    expect(report.laneProfiles).toEqual([]);
    expect(report.eligibleForWrite).toBe(false);
  });

  it('é determinístico, não altera entradas e não serializa dados privados', () => {
    const statements = [
      statement('secret-statement', { hasProtectedMetadata: true }),
      statement('secret-statement', { hasProtectedMetadata: true }),
    ];
    const current = persisted(statements);
    const currentComparison = comparison({
      duplicatePersistedStatementKeys: ['secret-statement'],
      protectedMetadataStatementKeys: ['secret-statement'],
      duplicatePersistedTransactionIds: ['secret-transaction'],
    });
    const beforeCurrent = structuredClone(current);
    const beforeComparison = structuredClone(currentComparison);

    const first = buildAtomicCardCompetenceExceptionForensicReport({
      persisted: current,
      comparison: currentComparison,
      identityDryRun: identityDryRun(),
      competenceDryRun: dryRun(),
    });
    const second = buildAtomicCardCompetenceExceptionForensicReport({
      persisted: { ...current, statements: [...current.statements].reverse() },
      comparison: currentComparison,
      identityDryRun: identityDryRun(),
      competenceDryRun: dryRun(),
    });
    const serialized = JSON.stringify(first);

    expect(second).toEqual(first);
    expect(current).toEqual(beforeCurrent);
    expect(currentComparison).toEqual(beforeComparison);
    expect(serialized).not.toContain('secret-statement');
    expect(serialized).not.toContain('secret-transaction');
    expect(serialized).not.toContain('rowId');
    expect(serialized).not.toContain('sourceFileName');
  });
});
