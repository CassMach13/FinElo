import { describe, expect, it } from 'vitest';
import { buildAtomicCardIdentityDryRunReport } from '../../src/domain/credit-card/atomicRebuildIdentityDryRun';
import { buildAtomicCardProvenanceReport } from '../../src/domain/credit-card/atomicRebuildProvenance';
import {
  compareAtomicCardProjections,
  type AtomicCardShadowEntry,
  type AtomicCardShadowProjection,
  type PersistedAtomicCardEntry,
  type PersistedAtomicCardProjection,
} from '../../src/domain/credit-card/atomicRebuildShadow';

const shadowEntry = (
  transactionId: string,
  sourceFileName: string,
  sourceRowHash: string,
  statementKey: string,
  postedDate: string,
  amountCents: number,
  entryType = 'purchase'
): AtomicCardShadowEntry => ({
  transactionId,
  sourceFileName,
  sourceRowHash,
  statementKey,
  postedDate,
  amountCents,
  entryType: entryType as AtomicCardShadowEntry['entryType'],
});

const persistedEntry = (
  rowId: string,
  transactionId: string,
  sourceFileName: string | null,
  sourceRowHash: string | null,
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
  createdAt: '2026-08-15T12:00:00.000Z',
  statementKey,
  postedDate,
  amountCents,
  entryType,
});

const shadowProjection = (entries: AtomicCardShadowEntry[]): AtomicCardShadowProjection => ({
  version: 1,
  accountId: 'account-private',
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
  checksum: 'shadow-v1-identity-dry-run',
});

const persistedProjection = (entries: PersistedAtomicCardEntry[]): PersistedAtomicCardProjection => ({
  source: 'engine',
  statements: [],
  entries,
  payments: [],
});

const buildReport = (
  shadowEntries: AtomicCardShadowEntry[],
  persistedEntries: PersistedAtomicCardEntry[]
) => {
  const shadow = shadowProjection(shadowEntries);
  const persisted = persistedProjection(persistedEntries);
  const comparison = compareAtomicCardProjections(shadow, persisted);
  const provenance = buildAtomicCardProvenanceReport(shadow, persisted, comparison);
  return buildAtomicCardIdentityDryRunReport(shadow, persisted, comparison, provenance);
};

describe('buildAtomicCardIdentityDryRunReport', () => {
  it('simula uma troca rastreável, preserva a âncora e fecha a lacuna sem mudar o volume', () => {
    const projected = [
      shadowEntry('tx-owner', 'owner.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
      shadowEntry('tx-missing', 'missing.csv', 'hash-missing', '2026-07', '2026-07-02', -2000),
    ];
    const current = [
      persistedEntry('row-anchor', 'tx-owner', 'owner.csv', 'hash-owner', '2026-06', '2026-07-01', -1000),
      persistedEntry('row-candidate', 'tx-owner', 'missing.csv', 'hash-missing', '2026-08', '2026-07-02', -2000),
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
      candidateCount: 1,
      hypotheticalUpdateCount: 1,
      confirmedAnchorCount: 1,
      unresolvedCount: 0,
    });
    expect(report.before).toMatchObject({
      missingIdentityCount: 1,
      duplicateIdentityGroupCount: 1,
    });
    expect(report.after).toMatchObject({
      missingIdentityCount: 0,
      duplicateIdentityGroupCount: 0,
      orphanIdentityCount: 0,
    });
    expect(report.changeProfiles).toEqual([
      {
        code: 'identity-and-competence',
        fromStatementKey: '2026-08',
        toStatementKey: '2026-07',
        fromEntryType: 'purchase',
        toEntryType: 'purchase',
        count: 1,
      },
    ]);
    expect(report.recommendationCodes).toContain('preserve-confirmed-anchors');
    expect(report.recommendationCodes).toContain('keep-writes-disabled');
  });

  it('fica bloqueado quando a linha de mesma origem diverge em data ou valor', () => {
    const projected = [
      shadowEntry('tx-owner', 'owner.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
      shadowEntry('tx-missing', 'missing.csv', 'hash-missing', '2026-07', '2026-07-02', -2000),
    ];
    const current = [
      persistedEntry('row-anchor', 'tx-owner', 'owner.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
      persistedEntry('row-candidate', 'tx-owner', 'missing.csv', 'hash-missing', '2026-07', '2026-07-02', -2500),
    ];

    const report = buildReport(projected, current);

    expect(report.status).toBe('blocked');
    expect(report.hypotheticalUpdateCount).toBe(0);
    expect(report.after).toEqual(report.before);
    expect(report.blockerProfiles).toContainEqual({
      code: 'economic-content-mismatch',
      count: 1,
    });
    expect(report.recommendationCodes).toEqual([
      'investigate-dry-run-blockers',
      'keep-writes-disabled',
    ]);
  });

  it('recusa colisão de proveniência sem escolher arbitrariamente uma linha', () => {
    const projected = [
      shadowEntry('tx-owner', 'owner.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
      shadowEntry('tx-missing', 'missing-a.csv', 'hash-missing', '2026-07', '2026-07-02', -2000),
    ];
    const current = [
      persistedEntry('row-anchor', 'tx-owner', 'owner.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
      persistedEntry('row-a', 'tx-owner', 'missing-a.csv', 'hash-missing', '2026-07', '2026-07-02', -2000),
      persistedEntry('row-b', 'tx-owner', 'missing a.csv', 'hash-missing', '2026-07', '2026-07-02', -2000),
    ];

    const report = buildReport(projected, current);

    expect(report.status).toBe('blocked');
    expect(report.actualWriteOperationCount).toBe(0);
    expect(report.hypotheticalUpdateCount).toBe(0);
    expect(report.blockerProfiles).toContainEqual({ code: 'ambiguous-provenance', count: 1 });
    expect(report.blockerProfiles).toContainEqual({ code: 'row-count-not-conserved', count: 1 });
  });

  it('permanece inerte quando nenhuma identidade precisa ser reconstruída', () => {
    const projected = [
      shadowEntry('tx-owner', 'owner.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
    ];
    const current = [
      persistedEntry('row-anchor', 'tx-owner', 'owner.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
    ];

    const report = buildReport(projected, current);

    expect(report.status).toBe('not-needed');
    expect(report.candidateCount).toBe(0);
    expect(report.hypotheticalUpdateCount).toBe(0);
    expect(report.before).toEqual(report.after);
    expect(report.recommendationCodes).toEqual(['no-identity-reconstruction-needed']);
  });

  it('reproduz a escala do piloto: 53 identidades, 51 âncoras lógicas e zero perda de linhas', () => {
    const projected: AtomicCardShadowEntry[] = [];
    const current: PersistedAtomicCardEntry[] = [];

    for (let ownerIndex = 0; ownerIndex < 51; ownerIndex += 1) {
      projected.push(
        shadowEntry(
          `private-owner-${ownerIndex}`,
          `owner-${ownerIndex}.csv`,
          `owner-hash-${ownerIndex}`,
          '2026-02',
          `2026-01-${String((ownerIndex % 27) + 1).padStart(2, '0')}`,
          -(1000 + ownerIndex)
        )
      );
      current.push(
        persistedEntry(
          `private-anchor-row-${ownerIndex}`,
          `private-owner-${ownerIndex}`,
          `owner-${ownerIndex}.csv`,
          `owner-hash-${ownerIndex}`,
          '2026-01',
          `2026-01-${String((ownerIndex % 27) + 1).padStart(2, '0')}`,
          -(1000 + ownerIndex)
        )
      );
    }

    for (let missingIndex = 0; missingIndex < 53; missingIndex += 1) {
      const ownerIndex = missingIndex < 51 ? missingIndex : missingIndex - 51;
      const targetStatement = missingIndex < 36 ? '2025-12' : missingIndex < 43 ? '2026-03' : '2026-04';
      const date = `2026-02-${String((missingIndex % 27) + 1).padStart(2, '0')}`;
      const amount = -(5000 + missingIndex);
      projected.push(
        shadowEntry(
          `private-missing-${missingIndex}`,
          `private-source-${missingIndex}.csv`,
          `private-hash-${missingIndex}`,
          targetStatement,
          date,
          amount,
          missingIndex === 52 ? 'refund' : 'purchase'
        )
      );
      current.push(
        persistedEntry(
          `private-candidate-row-${missingIndex}`,
          `private-owner-${ownerIndex}`,
          `private-source-${missingIndex}.csv`,
          `private-hash-${missingIndex}`,
          '2026-05',
          date,
          amount,
          'purchase'
        )
      );
    }

    const report = buildReport(projected, current);

    expect(report.status).toBe('ready');
    expect(report.rowCountBefore).toBe(104);
    expect(report.rowCountAfter).toBe(104);
    expect(report.rowCountDelta).toBe(0);
    expect(report.before.missingIdentityCount).toBe(53);
    expect(report.before.duplicateIdentityGroupCount).toBe(51);
    expect(report.candidateCount).toBe(53);
    expect(report.confirmedAnchorCount).toBe(53);
    expect(report.after.missingIdentityCount).toBe(0);
    expect(report.after.duplicateIdentityGroupCount).toBe(0);
    expect(report.after.orphanIdentityCount).toBe(0);
    expect(report.actualWriteOperationCount).toBe(0);
  });

  it('é determinístico, não altera as entradas e não serializa identificadores privados', () => {
    const projected = [
      shadowEntry('secret-owner-id', 'cliente-secreto.csv', 'owner-secret-hash', '2026-07', '2026-07-01', -1000),
      shadowEntry('secret-missing-id', 'cliente-secreto.csv', 'missing-secret-hash', '2026-07', '2026-07-02', -2000),
    ];
    const current = [
      persistedEntry('secret-anchor-row', 'secret-owner-id', 'cliente-secreto.csv', 'owner-secret-hash', '2026-07', '2026-07-01', -1000),
      persistedEntry('secret-candidate-row', 'secret-owner-id', 'cliente-secreto.csv', 'missing-secret-hash', '2026-08', '2026-07-02', -2000),
    ];
    const beforeProjected = structuredClone(projected);
    const beforeCurrent = structuredClone(current);

    const first = buildReport(projected, current);
    const second = buildReport([...projected].reverse(), [...current].reverse());
    const serialized = JSON.stringify(first);

    expect(second).toEqual(first);
    expect(projected).toEqual(beforeProjected);
    expect(current).toEqual(beforeCurrent);
    expect(serialized).not.toContain('secret-owner-id');
    expect(serialized).not.toContain('secret-missing-id');
    expect(serialized).not.toContain('secret-anchor-row');
    expect(serialized).not.toContain('secret-candidate-row');
    expect(serialized).not.toContain('cliente-secreto');
    expect(serialized).not.toContain('secret-hash');
  });
});
