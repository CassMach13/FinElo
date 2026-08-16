import { describe, expect, it } from 'vitest';
import { buildAtomicCardCompetenceDryRunReport } from '../../src/domain/credit-card/atomicRebuildCompetenceDryRun';
import {
  buildAtomicCardCompetenceForensicReport,
  type AtomicCardCompetenceEvidenceCycle,
} from '../../src/domain/credit-card/atomicRebuildCompetenceForensics';
import {
  compareAtomicCardProjections,
  type AtomicCardShadowEntry,
  type AtomicCardShadowProjection,
  type PersistedAtomicCardEntry,
  type PersistedAtomicCardProjection,
  type PersistedAtomicCardStatement,
} from '../../src/domain/credit-card/atomicRebuildShadow';

const nextMonth = (referenceMonth: string): string => {
  const [year, month] = referenceMonth.split('-').map(Number);
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
};

const shadowEntry = (
  transactionId: string,
  sourceFileName: string,
  sourceRowHash: string,
  statementKey: string,
  postedDate: string,
  amountCents: number,
  entryType: AtomicCardShadowEntry['entryType'] = 'purchase'
): AtomicCardShadowEntry => ({
  transactionId,
  sourceFileName,
  sourceRowHash,
  statementKey,
  postedDate,
  amountCents,
  entryType,
});

const persistedEntry = (
  rowId: string | undefined,
  transactionId: string,
  sourceFileName: string,
  sourceRowHash: string,
  statementKey: string,
  postedDate: string,
  amountCents: number,
  entryType = 'purchase'
): PersistedAtomicCardEntry => ({
  rowId,
  transactionId,
  sourceFileName,
  sourceRowHash,
  sourceRowIndex: 1,
  importLotId: `lot-${sourceRowHash}`,
  createdAt: '2026-08-16T12:00:00.000Z',
  statementKey,
  postedDate,
  amountCents,
  entryType,
});

const shadowProjection = (entries: AtomicCardShadowEntry[]): AtomicCardShadowProjection => ({
  version: 1,
  accountId: 'private-account',
  sourceCycleCount: new Set(entries.map((entry) => entry.sourceFileName)).size,
  sourceTransactionCount: entries.length,
  projectedEntryCount: entries.length,
  projectedPaymentCount: 0,
  statements: [],
  entries,
  payments: [],
  issues: [],
  blockers: [],
  warnings: [],
  safeToStage: true,
  checksum: 'shadow-v1-competence-dry-run',
});

const persistedProjection = (
  entries: PersistedAtomicCardEntry[],
  statements: PersistedAtomicCardStatement[] = []
): PersistedAtomicCardProjection => ({
  source: 'engine',
  statements,
  entries,
  payments: [],
});

const cyclesFor = (entries: AtomicCardShadowEntry[]): AtomicCardCompetenceEvidenceCycle[] =>
  Array.from(new Map(entries.map((entry) => [entry.sourceFileName, entry])).values()).map(
    (entry) => ({
      sourceFileName: entry.sourceFileName,
      referenceMonth: entry.statementKey,
      dueDate: `${nextMonth(entry.statementKey)}-10`,
      source: 'confirmed-import-history',
    })
  );

const buildReport = (
  shadowEntries: AtomicCardShadowEntry[],
  persistedEntries: PersistedAtomicCardEntry[],
  statements: PersistedAtomicCardStatement[] = []
) => {
  const shadow = shadowProjection(shadowEntries);
  const persisted = persistedProjection(persistedEntries, statements);
  const comparison = compareAtomicCardProjections(shadow, persisted);
  const cycles = cyclesFor(shadowEntries);
  const forensics = buildAtomicCardCompetenceForensicReport({
    shadow,
    persisted,
    cycles,
  });
  return buildAtomicCardCompetenceDryRunReport({
    shadow,
    persisted,
    comparison,
    forensics,
    cycles,
  });
};

describe('buildAtomicCardCompetenceDryRunReport', () => {
  it('simula somente a competência e conserva todas as demais propriedades', () => {
    const projected = [
      shadowEntry('tx-1', 'cycle-1.csv', 'hash-1', '2026-06', '2026-06-15', -1000),
      shadowEntry('tx-2', 'cycle-2.csv', 'hash-2', '2026-07', '2026-07-18', -2000),
    ];
    const current = [
      persistedEntry('row-1', 'tx-1', 'cycle-1.csv', 'hash-1', '2026-07', '2026-06-15', -1000),
      persistedEntry('row-2', 'tx-2', 'cycle-2.csv', 'hash-2', '2026-08', '2026-07-18', -2000),
    ];

    const report = buildReport(projected, current);

    expect(report).toMatchObject({
      status: 'ready',
      privacy: 'aggregated-no-identifiers',
      nonAuthoritative: true,
      executable: false,
      mutationPayloadIncluded: false,
      actualWriteOperationCount: 0,
      rowCountBefore: 2,
      rowCountAfter: 2,
      rowCountDelta: 0,
      competenceMismatchBefore: 2,
      competenceMismatchAfter: 0,
      candidateCount: 2,
      hypotheticalUpdateCount: 2,
      excludedRowCount: 0,
      identityMutationCount: 0,
      dateMutationCount: 0,
      amountMutationCount: 0,
      typeMutationCount: 0,
      sourceMutationCount: 0,
      statementRecordMutationCount: 0,
      paymentRecordMutationCount: 0,
      eligibleForFutureScopedExecution: true,
    });
    expect(report.changeProfiles).toEqual([
      {
        fromStatementKey: '2026-07',
        toStatementKey: '2026-06',
        evidenceSource: 'confirmed-import-history',
        count: 1,
      },
      {
        fromStatementKey: '2026-08',
        toStatementKey: '2026-07',
        evidenceSource: 'confirmed-import-history',
        count: 1,
      },
    ]);
    expect(report.recommendationCodes).toContain('future-execution-requires-snapshot');
    expect(report.recommendationCodes.at(-1)).toBe('keep-writes-disabled');
  });

  it('isola identidade divergente e mudança de tipo sem contaminar as linhas seguras', () => {
    const projected = [
      shadowEntry('tx-safe', 'safe.csv', 'hash-safe', '2026-06', '2026-06-15', -1000),
      shadowEntry('tx-identity', 'identity.csv', 'hash-identity', '2026-06', '2026-06-16', -2000),
      shadowEntry('tx-type', 'type.csv', 'hash-type', '2026-06', '2026-06-17', -3000, 'refund'),
    ];
    const current = [
      persistedEntry('row-safe', 'tx-safe', 'safe.csv', 'hash-safe', '2026-07', '2026-06-15', -1000),
      persistedEntry('row-identity', 'tx-other', 'identity.csv', 'hash-identity', '2026-07', '2026-06-16', -2000),
      persistedEntry('row-type', 'tx-type', 'type.csv', 'hash-type', '2026-07', '2026-06-17', -3000, 'purchase'),
    ];

    const report = buildReport(projected, current);

    expect(report.status).toBe('partial');
    expect(report.competenceMismatchBefore).toBe(3);
    expect(report.competenceMismatchAfter).toBe(2);
    expect(report.candidateCount).toBe(1);
    expect(report.hypotheticalUpdateCount).toBe(1);
    expect(report.excludedRowCount).toBe(2);
    expect(report.exclusionProfiles).toEqual([
      { code: 'identity-mismatch', count: 1 },
      { code: 'type-mismatch', count: 1 },
    ]);
    expect(report.eligibleForFutureScopedExecution).toBe(false);
    expect(report.recommendationCodes).toContain('resolve-excluded-structural-anomalies');
  });

  it('preserva metadados protegidos e impede elegibilidade prematura', () => {
    const projected = [
      shadowEntry('tx-protected', 'protected.csv', 'hash-protected', '2026-06', '2026-06-15', -1000),
    ];
    const current = [
      persistedEntry('row-protected', 'tx-protected', 'protected.csv', 'hash-protected', '2026-07', '2026-06-15', -1000),
    ];
    const statements: PersistedAtomicCardStatement[] = [
      {
        statementKey: '2026-07',
        dueDate: '2026-07-10',
        entryCount: 1,
        statementTotalCents: 1000,
        totalPaymentsCents: 0,
        openBalanceCents: 1000,
        hasProtectedMetadata: true,
      },
    ];

    const report = buildReport(projected, current, statements);

    expect(report.status).toBe('ready');
    expect(report.protectedMetadataTouchCount).toBe(1);
    expect(report.statementRecordMutationCount).toBe(0);
    expect(report.eligibleForFutureScopedExecution).toBe(false);
    expect(report.recommendationCodes).toContain('preserve-protected-statement-metadata');
  });

  it('bloqueia quando a proveniência não escolhe uma linha única', () => {
    const projected = [
      shadowEntry('tx-ambiguous', 'ambiguous.csv', 'hash-ambiguous', '2026-06', '2026-06-15', -1000),
    ];
    const current = [
      persistedEntry('row-a', 'tx-a', 'ambiguous.csv', 'hash-ambiguous', '2026-07', '2026-06-15', -1000),
      persistedEntry('row-b', 'tx-b', 'ambiguous.csv', 'hash-ambiguous', '2026-07', '2026-06-15', -1000),
    ];

    const report = buildReport(projected, current);

    expect(report.status).toBe('blocked');
    expect(report.hypotheticalUpdateCount).toBe(0);
    expect(report.actualWriteOperationCount).toBe(0);
    expect(report.blockerProfiles).toContainEqual({
      code: 'forensic-report-not-eligible',
      count: 1,
    });
    expect(report.blockerProfiles).toContainEqual({
      code: 'row-count-not-conserved',
      count: 1,
    });
    expect(report.blockerProfiles).toContainEqual({ code: 'ambiguous-row', count: 1 });
  });

  it('reproduz a escala do piloto e isola identidades e tipos sem perder linhas', () => {
    const projected: AtomicCardShadowEntry[] = [];
    const current: PersistedAtomicCardEntry[] = [];

    for (let ownerIndex = 0; ownerIndex < 51; ownerIndex += 1) {
      const transactionId = `private-owner-${ownerIndex}`;
      const source = `owner-${ownerIndex}.csv`;
      const hash = `owner-hash-${ownerIndex}`;
      const date = `2026-01-${String((ownerIndex % 27) + 1).padStart(2, '0')}`;
      projected.push(shadowEntry(transactionId, source, hash, '2026-01', date, -(1000 + ownerIndex)));
      current.push(
        persistedEntry(
          `private-owner-row-${ownerIndex}`,
          transactionId,
          source,
          hash,
          '2026-02',
          date,
          -(1000 + ownerIndex)
        )
      );
    }

    for (let missingIndex = 0; missingIndex < 53; missingIndex += 1) {
      const ownerIndex = missingIndex < 51 ? missingIndex : missingIndex - 51;
      const source = `missing-${missingIndex}.csv`;
      const hash = `missing-hash-${missingIndex}`;
      const date = `2026-01-${String((missingIndex % 27) + 1).padStart(2, '0')}`;
      projected.push(
        shadowEntry(
          `private-missing-${missingIndex}`,
          source,
          hash,
          '2026-01',
          date,
          -(5000 + missingIndex)
        )
      );
      current.push(
        persistedEntry(
          `private-missing-row-${missingIndex}`,
          `private-owner-${ownerIndex}`,
          source,
          hash,
          '2026-02',
          date,
          -(5000 + missingIndex)
        )
      );
    }

    for (let regularIndex = 0; regularIndex < 1812; regularIndex += 1) {
      const mismatched = regularIndex < 1485;
      const typeMismatch = regularIndex < 4;
      const source = `regular-${regularIndex}.csv`;
      const hash = `regular-hash-${regularIndex}`;
      const date = `2026-01-${String((regularIndex % 27) + 1).padStart(2, '0')}`;
      projected.push(
        shadowEntry(
          `private-regular-${regularIndex}`,
          source,
          hash,
          '2026-01',
          date,
          -(10000 + regularIndex),
          typeMismatch ? 'refund' : 'purchase'
        )
      );
      current.push(
        persistedEntry(
          `private-regular-row-${regularIndex}`,
          `private-regular-${regularIndex}`,
          source,
          hash,
          mismatched ? '2026-02' : '2026-01',
          date,
          -(10000 + regularIndex),
          'purchase'
        )
      );
    }

    const report = buildReport(projected, current);

    expect(report.status).toBe('partial');
    expect(report.rowCountBefore).toBe(1916);
    expect(report.rowCountAfter).toBe(1916);
    expect(report.rowCountDelta).toBe(0);
    expect(report.competenceMismatchBefore).toBe(1589);
    expect(report.competenceMismatchAfter).toBe(108);
    expect(report.candidateCount).toBe(1481);
    expect(report.hypotheticalUpdateCount).toBe(1481);
    expect(report.excludedRowCount).toBe(108);
    expect(report.exclusionProfiles).toEqual([
      { code: 'identity-mismatch', count: 53 },
      { code: 'duplicate-current-identity', count: 51 },
      { code: 'type-mismatch', count: 4 },
    ]);
    expect(report.identityMutationCount).toBe(0);
    expect(report.dateMutationCount).toBe(0);
    expect(report.amountMutationCount).toBe(0);
    expect(report.typeMutationCount).toBe(0);
    expect(report.sourceMutationCount).toBe(0);
    expect(report.actualWriteOperationCount).toBe(0);
    expect(report.eligibleForFutureScopedExecution).toBe(false);
  });

  it('é determinístico, não altera entradas e não serializa dados privados', () => {
    const projected = [
      shadowEntry('secret-tx', 'cliente-secreto.csv', 'secret-hash', '2026-06', '2026-06-15', -1000),
    ];
    const current = [
      persistedEntry('secret-row', 'secret-tx', 'cliente-secreto.csv', 'secret-hash', '2026-07', '2026-06-15', -1000),
    ];
    const beforeProjected = structuredClone(projected);
    const beforeCurrent = structuredClone(current);

    const first = buildReport(projected, current);
    const second = buildReport([...projected].reverse(), [...current].reverse());
    const serialized = JSON.stringify(first);

    expect(second).toEqual(first);
    expect(projected).toEqual(beforeProjected);
    expect(current).toEqual(beforeCurrent);
    expect(serialized).not.toContain('secret-tx');
    expect(serialized).not.toContain('secret-row');
    expect(serialized).not.toContain('secret-hash');
    expect(serialized).not.toContain('cliente-secreto');
  });
});
