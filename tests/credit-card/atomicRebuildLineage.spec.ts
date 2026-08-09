import { describe, expect, it } from 'vitest';
import {
  compareAtomicCardProjections,
  type AtomicCardShadowEntry,
  type AtomicCardShadowProjection,
  type PersistedAtomicCardEntry,
  type PersistedAtomicCardProjection,
} from '../../src/domain/credit-card/atomicRebuildShadow';
import { buildAtomicCardLineageReport } from '../../src/domain/credit-card/atomicRebuildLineage';

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
  checksum: 'shadow-v1-lineage',
});

const persistedProjection = (
  entries: PersistedAtomicCardEntry[]
): PersistedAtomicCardProjection => ({
  source: 'engine',
  statements: [],
  entries,
  payments: [],
});

describe('buildAtomicCardLineageReport', () => {
  it('explica identidades ausentes por excedente duplicado sem expor dados privados', () => {
    const shadow = shadowProjection([
      shadowEntry(
        'private-owner-id',
        'fatura-cliente-a.csv',
        'private-hash-owner',
        '2026-01',
        '2026-01-01',
        -1000
      ),
      shadowEntry(
        'private-missing-b',
        'fatura-cliente-a.csv',
        'private-hash-b',
        '2026-01',
        '2026-01-02',
        -2000
      ),
      shadowEntry(
        'private-missing-c',
        'fatura-cliente-b.csv',
        'private-hash-c',
        '2026-02',
        '2026-02-01',
        -3000
      ),
    ]);
    const persisted = persistedProjection([
      {
        rowId: 'private-row-owner',
        transactionId: 'private-owner-id',
        statementKey: '2026-02',
        postedDate: '2026-01-01',
        amountCents: -1000,
        entryType: 'purchase',
      },
      {
        rowId: 'private-row-b',
        transactionId: 'private-owner-id',
        statementKey: '2026-01',
        postedDate: '2026-01-02',
        amountCents: -2000,
        entryType: 'purchase',
      },
      {
        rowId: 'private-row-c',
        transactionId: 'private-owner-id',
        statementKey: '2026-02',
        postedDate: '2026-02-01',
        amountCents: -3000,
        entryType: 'purchase',
      },
    ]);
    const comparison = compareAtomicCardProjections(shadow, persisted);

    const report = buildAtomicCardLineageReport(shadow, persisted, comparison);

    expect(report.status).toBe('explained-no-safe-repair');
    expect(report.conservation).toMatchObject({
      projectedRowCount: 3,
      persistedRowCount: 3,
      duplicateIdentityGroupCount: 1,
      duplicateExcessRowCount: 2,
      missingIdentityCount: 2,
      orphanIdentityCount: 0,
      rowCountConserved: true,
      missingBalancedByDuplicateSurplus: true,
    });
    expect(report.matchProfiles).toContainEqual({
      code: 'exact-content-unique',
      count: 2,
    });
    expect(report.matchedIdentityCount).toBe(2);
    expect(report.unexplainedMissingIdentityCount).toBe(0);
    expect(report.sourceCohortCount).toBe(2);
    expect(report.deterministicRepairRowCount).toBe(0);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('private-');
    expect(serialized).not.toContain('fatura-cliente');
    expect(serialized).not.toContain('hash-owner');
    expect(serialized).toContain('origem-01');
  });

  it('separa deslocamento de competência de uma coincidência integral', () => {
    const shadow = shadowProjection([
      shadowEntry('owner', 'invoice.csv', 'hash-owner', '2026-01', '2026-01-01', -1000),
      shadowEntry('missing', 'invoice.csv', 'hash-missing', '2026-01', '2026-01-02', -2000),
    ]);
    const persisted = persistedProjection([
      {
        rowId: 'row-owner',
        transactionId: 'owner',
        statementKey: '2026-02',
        postedDate: '2026-01-01',
        amountCents: -1000,
        entryType: 'purchase',
      },
      {
        rowId: 'row-surplus',
        transactionId: 'owner',
        statementKey: '2026-02',
        postedDate: '2026-01-02',
        amountCents: -2000,
        entryType: 'purchase',
      },
    ]);
    const comparison = compareAtomicCardProjections(shadow, persisted);

    const report = buildAtomicCardLineageReport(shadow, persisted, comparison);

    expect(report.matchProfiles).toEqual([
      { code: 'competence-shift-unique', count: 1 },
    ]);
    expect(report.recommendationCodes).toContain(
      'review-competence-before-identity-repair'
    );
  });

  it('marca conteúdo repetido como explicação ambígua, nunca como reparo seguro', () => {
    const shadow = shadowProjection([
      shadowEntry('owner', 'invoice.csv', 'hash-owner', '2026-01', '2026-01-01', -1000),
      shadowEntry('missing-a', 'invoice.csv', 'hash-a', '2026-01', '2026-01-02', -2000),
      shadowEntry('missing-b', 'invoice.csv', 'hash-b', '2026-01', '2026-01-02', -2000),
    ]);
    const persisted = persistedProjection([
      {
        rowId: 'row-owner',
        transactionId: 'owner',
        statementKey: '2026-02',
        postedDate: '2026-01-01',
        amountCents: -1000,
        entryType: 'purchase',
      },
      {
        rowId: 'row-surplus-a',
        transactionId: 'owner',
        statementKey: '2026-01',
        postedDate: '2026-01-02',
        amountCents: -2000,
        entryType: 'purchase',
      },
      {
        rowId: 'row-surplus-b',
        transactionId: 'owner',
        statementKey: '2026-01',
        postedDate: '2026-01-02',
        amountCents: -2000,
        entryType: 'purchase',
      },
    ]);
    const comparison = compareAtomicCardProjections(shadow, persisted);

    const report = buildAtomicCardLineageReport(shadow, persisted, comparison);

    expect(report.matchProfiles).toEqual([
      { code: 'exact-content-ambiguous', count: 2 },
    ]);
    expect(report.status).toBe('explained-no-safe-repair');
    expect(report.deterministicRepairRowCount).toBe(0);
    expect(report.nonAuthoritative).toBe(true);
  });

  it('mantém lacunas reais como não explicadas e não modifica as entradas', () => {
    const shadow = shadowProjection([
      shadowEntry('owner', 'invoice.csv', 'hash-owner', '2026-01', '2026-01-01', -1000),
      shadowEntry('missing', 'invoice.csv', 'hash-missing', '2026-01', '2026-01-02', -2000),
    ]);
    const persisted = persistedProjection([
      {
        rowId: 'row-owner',
        transactionId: 'owner',
        statementKey: '2026-01',
        postedDate: '2026-01-01',
        amountCents: -1000,
        entryType: 'purchase',
      },
    ]);
    const comparison = compareAtomicCardProjections(shadow, persisted);
    const before = JSON.stringify({ shadow, persisted, comparison });

    const report = buildAtomicCardLineageReport(shadow, persisted, comparison);

    expect(report.status).toBe('unresolved');
    expect(report.matchProfiles).toEqual([{ code: 'unmatched', count: 1 }]);
    expect(report.unexplainedMissingIdentityCount).toBe(1);
    expect(report.recommendationCodes).toContain('unexplained-row-gap');
    expect(JSON.stringify({ shadow, persisted, comparison })).toBe(before);
  });

  it('é determinístico mesmo quando as linhas chegam em outra ordem', () => {
    const shadowEntries = [
      shadowEntry('owner', 'b.csv', 'hash-owner', '2026-01', '2026-01-01', -1000),
      shadowEntry('missing', 'a.csv', 'hash-missing', '2026-01', '2026-01-02', -2000),
    ];
    const persistedEntries: PersistedAtomicCardEntry[] = [
      {
        rowId: 'row-z',
        transactionId: 'owner',
        statementKey: '2026-02',
        postedDate: '2026-01-02',
        amountCents: -2000,
        entryType: 'purchase',
      },
      {
        rowId: 'row-a',
        transactionId: 'owner',
        statementKey: '2026-02',
        postedDate: '2026-01-01',
        amountCents: -1000,
        entryType: 'purchase',
      },
    ];
    const firstShadow = shadowProjection(shadowEntries);
    const firstPersisted = persistedProjection(persistedEntries);
    const secondShadow = shadowProjection([...shadowEntries].reverse());
    const secondPersisted = persistedProjection([...persistedEntries].reverse());

    const first = buildAtomicCardLineageReport(
      firstShadow,
      firstPersisted,
      compareAtomicCardProjections(firstShadow, firstPersisted)
    );
    const second = buildAtomicCardLineageReport(
      secondShadow,
      secondPersisted,
      compareAtomicCardProjections(secondShadow, secondPersisted)
    );

    expect(second).toEqual(first);
  });
});
