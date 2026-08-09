import { describe, expect, it } from 'vitest';
import {
  compareAtomicCardProjections,
  type AtomicCardShadowEntry,
  type AtomicCardShadowProjection,
  type PersistedAtomicCardEntry,
  type PersistedAtomicCardProjection,
} from '../../src/domain/credit-card/atomicRebuildShadow';
import { buildAtomicCardProvenanceReport } from '../../src/domain/credit-card/atomicRebuildProvenance';

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
  checksum: 'shadow-v1-provenance',
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
  return buildAtomicCardProvenanceReport(
    shadow,
    persisted,
    compareAtomicCardProjections(shadow, persisted)
  );
};

describe('buildAtomicCardProvenanceReport', () => {
  it('permanece limpo quando nenhuma identidade precisa ser reconstruída', () => {
    const projected = [
      shadowEntry('tx-owner', 'fatura.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
    ];
    const current = [
      persistedEntry('row-owner', 'tx-owner', 'fatura.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
    ];

    const report = buildReport(projected, current);

    expect(report.status).toBe('clean');
    expect(report.missingIdentityCount).toBe(0);
    expect(report.eligibleForFutureDryRunPlan).toBe(false);
    expect(report.recommendationCodes).toEqual(['no-identity-reconstruction-needed']);
  });

  it('rastreia troca de identidade por proveniência e preserva a âncora do proprietário atual', () => {
    const projected = [
      shadowEntry('tx-owner', 'fatura.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
      shadowEntry('tx-missing', 'fatura.csv', 'hash-missing', '2026-07', '2026-07-02', -2000),
    ];
    const current = [
      persistedEntry('row-owner', 'tx-owner', 'fatura.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
      persistedEntry('row-stolen', 'tx-owner', 'fatura.csv', 'hash-missing', '2026-08', '2026-07-02', -2000),
    ];

    const report = buildReport(projected, current);

    expect(report).toMatchObject({
      status: 'fully-traceable',
      missingIdentityCount: 1,
      exactProvenanceMatchCount: 1,
      ownerAnchorConfirmedCount: 1,
      recoveryCandidateCount: 1,
      unresolvedCount: 0,
      eligibleForFutureDryRunPlan: true,
    });
    expect(report.evidenceProfiles).toEqual([
      { code: 'exact-provenance-competence-shift', count: 1 },
    ]);
    expect(report.recommendationCodes).toContain('preserve-owner-anchor');
    expect(report.recommendationCodes).toContain('review-competence-before-any-repair');
  });

  it('bloqueia colisão de origem normalizada em vez de escolher uma linha', () => {
    const projected = [
      shadowEntry('tx-owner', 'owner.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
      shadowEntry('tx-missing', 'fatura-a.csv', 'hash-missing', '2026-07', '2026-07-02', -2000),
    ];
    const current = [
      persistedEntry('row-owner', 'tx-owner', 'owner.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
      persistedEntry('row-a', 'tx-owner', 'fatura-a.csv', 'hash-missing', '2026-07', '2026-07-02', -2000),
      persistedEntry('row-b', 'tx-owner', 'fatura a.csv', 'hash-missing', '2026-07', '2026-07-02', -2000),
    ];

    const report = buildReport(projected, current);

    expect(report.status).toBe('ambiguous');
    expect(report.coverage.persistedSourceCollisionGroupCount).toBe(1);
    expect(report.recoveryCandidateCount).toBe(0);
    expect(report.evidenceProfiles).toContainEqual({ code: 'ambiguous-provenance', count: 1 });
    expect(report.recommendationCodes).toContain('investigate-provenance-collisions');
  });

  it('mantém como insuficiente uma linha histórica sem origem e hash', () => {
    const projected = [
      shadowEntry('tx-owner', 'owner.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
      shadowEntry('tx-missing', 'missing.csv', 'hash-missing', '2026-07', '2026-07-02', -2000),
    ];
    const current = [
      persistedEntry('row-owner', 'tx-owner', 'owner.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
      persistedEntry('row-unknown', 'tx-owner', null, null, '2026-07', '2026-07-02', -2000),
    ];

    const report = buildReport(projected, current);

    expect(report.status).toBe('insufficient-evidence');
    expect(report.coverage.persistedRowsWithoutSourceIdentity).toBe(1);
    expect(report.evidenceProfiles).toContainEqual({ code: 'missing-provenance', count: 1 });
    expect(report.recommendationCodes).toContain('investigate-unavailable-provenance');
  });

  it('exige uma âncora inequívoca para a identidade atualmente duplicada', () => {
    const projected = [
      shadowEntry('tx-owner', 'owner.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
      shadowEntry('tx-missing', 'missing.csv', 'hash-missing', '2026-07', '2026-07-02', -2000),
    ];
    const current = [
      persistedEntry('row-other', 'tx-owner', 'other.csv', 'hash-other', '2026-07', '2026-07-01', -1000),
      persistedEntry('row-stolen', 'tx-owner', 'missing.csv', 'hash-missing', '2026-07', '2026-07-02', -2000),
    ];

    const report = buildReport(projected, current);

    expect(report.status).toBe('insufficient-evidence');
    expect(report.ownerAnchorMissingCount).toBe(1);
    expect(report.evidenceProfiles).toContainEqual({ code: 'owner-anchor-missing', count: 1 });
    expect(report.eligibleForFutureDryRunPlan).toBe(false);
  });

  it('não considera recuperável uma origem exata com valor econômico divergente', () => {
    const projected = [
      shadowEntry('tx-owner', 'owner.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
      shadowEntry('tx-missing', 'missing.csv', 'hash-missing', '2026-07', '2026-07-02', -2000),
    ];
    const current = [
      persistedEntry('row-owner', 'tx-owner', 'owner.csv', 'hash-owner', '2026-07', '2026-07-01', -1000),
      persistedEntry('row-stolen', 'tx-owner', 'missing.csv', 'hash-missing', '2026-07', '2026-07-02', -2500),
    ];

    const report = buildReport(projected, current);

    expect(report.ownerAnchorConfirmedCount).toBe(1);
    expect(report.recoveryCandidateCount).toBe(0);
    expect(report.evidenceProfiles).toContainEqual({ code: 'exact-provenance-content-mismatch', count: 1 });
  });

  it('não expõe identificadores e é determinístico sem alterar as entradas', () => {
    const projected = [
      shadowEntry('private-owner-id', 'cliente-secreto.csv', 'private-owner-hash', '2026-07', '2026-07-01', -1000),
      shadowEntry('private-missing-id', 'cliente-secreto.csv', 'private-missing-hash', '2026-07', '2026-07-02', -2000),
    ];
    const current = [
      persistedEntry('private-row-owner', 'private-owner-id', 'cliente-secreto.csv', 'private-owner-hash', '2026-07', '2026-07-01', -1000),
      persistedEntry('private-row-stolen', 'private-owner-id', 'cliente-secreto.csv', 'private-missing-hash', '2026-08', '2026-07-02', -2000),
    ];
    const beforeProjected = structuredClone(projected);
    const beforeCurrent = structuredClone(current);

    const first = buildReport(projected, current);
    const second = buildReport([...projected].reverse(), [...current].reverse());
    const serialized = JSON.stringify(first);

    expect(second).toEqual(first);
    expect(projected).toEqual(beforeProjected);
    expect(current).toEqual(beforeCurrent);
    expect(serialized).not.toContain('private-owner-id');
    expect(serialized).not.toContain('private-missing-id');
    expect(serialized).not.toContain('private-row-owner');
    expect(serialized).not.toContain('cliente-secreto');
    expect(serialized).not.toContain('private-owner-hash');
    expect(serialized).not.toContain('private-missing-hash');
  });
});
