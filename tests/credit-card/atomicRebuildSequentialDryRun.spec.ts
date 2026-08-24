import { describe, expect, it } from 'vitest';
import { buildAtomicCardProvenanceReport } from '../../src/domain/credit-card/atomicRebuildProvenance';
import { buildAtomicCardSequentialDryRunReport } from '../../src/domain/credit-card/atomicRebuildSequentialDryRun';
import {
  compareAtomicCardProjections,
  type AtomicCardShadowEntry,
  type AtomicCardShadowProjection,
  type PersistedAtomicCardEntry,
  type PersistedAtomicCardProjection,
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
  rowId: string,
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
  importLotId: `lot-${rowId}`,
  createdAt: '2026-08-24T12:00:00.000Z',
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
  checksum: 'shadow-v1-sequential-dry-run',
});

const persistedProjection = (entries: PersistedAtomicCardEntry[]): PersistedAtomicCardProjection => ({
  source: 'engine',
  statements: [],
  entries,
  payments: [],
});

const buildReport = (
  projected: AtomicCardShadowEntry[],
  current: PersistedAtomicCardEntry[]
) => {
  const shadow = shadowProjection(projected);
  const persisted = persistedProjection(current);
  const comparison = compareAtomicCardProjections(shadow, persisted);
  const provenance = buildAtomicCardProvenanceReport(shadow, persisted, comparison);
  const cycles = Array.from(
    new Map(projected.map((entry) => [entry.sourceFileName, entry])).values()
  ).map((entry) => ({
    sourceFileName: entry.sourceFileName,
    referenceMonth: entry.statementKey,
    dueDate: `${nextMonth(entry.statementKey)}-10`,
    source: 'confirmed-import-history' as const,
  }));
  return buildAtomicCardSequentialDryRunReport({
    shadow,
    persisted,
    comparison,
    provenance,
    cycles,
  });
};

describe('buildAtomicCardSequentialDryRunReport', () => {
  it('reconstrói identidade antes da competência e fecha a projeção sem perder linhas', () => {
    const projected = [
      shadowEntry('tx-owner', 'owner.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
      shadowEntry('tx-missing', 'missing.csv', 'hash-missing', '2026-08', '2026-08-02', -2000),
    ];
    const current = [
      persistedEntry('row-anchor', 'tx-owner', 'owner.csv', 'hash-owner', '2026-08', '2026-07-01', -1000),
      persistedEntry('row-candidate', 'tx-owner', 'missing.csv', 'hash-missing', '2026-09', '2026-08-02', -2000),
    ];

    const report = buildReport(projected, current);

    expect(report).toMatchObject({
      status: 'complete',
      privacy: 'aggregated-no-identifiers',
      nonAuthoritative: true,
      executable: false,
      mutationPayloadIncluded: false,
      actualWriteOperationCount: 0,
      eligibleForWrite: false,
      identityStepStatus: 'ready',
      competenceStepStatus: 'ready',
      rowCountBefore: 2,
      rowCountAfter: 2,
      rowCountDelta: 0,
      hypotheticalIdentityUpdateCount: 1,
      hypotheticalCompetenceUpdateCount: 1,
      confirmedAnchorCount: 1,
      identityMutationCount: 1,
      competenceMutationCount: 2,
      typeMutationCount: 0,
      dateMutationCount: 0,
      amountMutationCount: 0,
      sourceMutationCount: 0,
      statementRecordsPreserved: true,
      paymentRecordsPreserved: true,
    });
    expect(report.before).toMatchObject({
      missingIdentityCount: 1,
      duplicateIdentityGroupCount: 1,
    });
    expect(report.afterIdentity).toMatchObject({
      missingIdentityCount: 0,
      duplicateIdentityGroupCount: 0,
      changedTransactionCount: 1,
    });
    expect(report.afterSequential).toMatchObject({
      missingIdentityCount: 0,
      duplicateIdentityGroupCount: 0,
      changedTransactionCount: 0,
      structuralDifferenceCount: 0,
      differenceCount: 0,
    });
    expect(report.blockerProfiles).toEqual([]);
    expect(report.recommendationCodes.at(-1)).toBe('keep-writes-disabled');
  });

  it('bloqueia sem alterar entradas quando a identidade não é comprovada', () => {
    const projected = [
      shadowEntry('tx-owner', 'owner.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
      shadowEntry('tx-missing', 'missing.csv', 'hash-missing', '2026-08', '2026-08-02', -2000),
    ];
    const current = [
      persistedEntry('row-anchor', 'tx-owner', 'owner.csv', 'hash-owner', '2026-08', '2026-07-01', -1000),
      persistedEntry('row-candidate', 'tx-owner', 'missing.csv', 'hash-missing', '2026-09', '2026-08-02', -2500),
    ];
    const before = structuredClone(current);

    const report = buildReport(projected, current);

    expect(report.status).toBe('blocked');
    expect(report.identityStepStatus).toBe('blocked');
    expect(report.hypotheticalCompetenceUpdateCount).toBe(0);
    expect(report.blockerProfiles).toContainEqual({ code: 'identity-step-blocked', count: 1 });
    expect(report.blockerProfiles).toContainEqual({ code: 'identity-gap-remains', count: 2 });
    expect(report.actualWriteOperationCount).toBe(0);
    expect(report.eligibleForWrite).toBe(false);
    expect(current).toEqual(before);
  });

  it('reproduz a escala do piloto e reduz as exceções à divergência real de tipo', () => {
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
        shadowEntry(`private-missing-${missingIndex}`, source, hash, '2026-01', date, -(5000 + missingIndex))
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
    expect(report.hypotheticalIdentityUpdateCount).toBe(53);
    expect(report.hypotheticalCompetenceUpdateCount).toBe(1532);
    expect(report.confirmedAnchorCount).toBe(53);
    expect(report.identityMutationCount).toBe(53);
    expect(report.competenceMutationCount).toBe(1585);
    expect(report.typeMutationCount).toBe(0);
    expect(report.dateMutationCount).toBe(0);
    expect(report.amountMutationCount).toBe(0);
    expect(report.sourceMutationCount).toBe(0);
    expect(report.afterSequential).toMatchObject({
      missingIdentityCount: 0,
      duplicateIdentityGroupCount: 0,
      orphanIdentityCount: 0,
      changedTransactionCount: 4,
      structuralDifferenceCount: 4,
    });
    expect(report.blockerProfiles).toEqual([]);
    expect(report.actualWriteOperationCount).toBe(0);
    expect(report.eligibleForWrite).toBe(false);
  });

  it('é determinístico e não serializa identificadores privados', () => {
    const projected = [
      shadowEntry('secret-owner', 'cliente-secreto.csv', 'owner-secret-hash', '2026-07', '2026-07-01', -1000),
      shadowEntry('secret-missing', 'cliente-secreto.csv', 'missing-secret-hash', '2026-08', '2026-08-02', -2000),
    ];
    const current = [
      persistedEntry('secret-anchor-row', 'secret-owner', 'cliente-secreto.csv', 'owner-secret-hash', '2026-08', '2026-07-01', -1000),
      persistedEntry('secret-candidate-row', 'secret-owner', 'cliente-secreto.csv', 'missing-secret-hash', '2026-09', '2026-08-02', -2000),
    ];

    const first = buildReport(projected, current);
    const second = buildReport([...projected].reverse(), [...current].reverse());
    const serialized = JSON.stringify(first);

    expect(second).toEqual(first);
    expect(serialized).not.toContain('secret-owner');
    expect(serialized).not.toContain('secret-missing');
    expect(serialized).not.toContain('secret-anchor-row');
    expect(serialized).not.toContain('secret-candidate-row');
    expect(serialized).not.toContain('cliente-secreto');
    expect(serialized).not.toContain('secret-hash');
  });
});
