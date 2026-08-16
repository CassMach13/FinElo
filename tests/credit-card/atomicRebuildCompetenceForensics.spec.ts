import { describe, expect, it } from 'vitest';
import {
  buildAtomicCardCompetenceForensicReport,
  type AtomicCardCompetenceEvidenceCycle,
} from '../../src/domain/credit-card/atomicRebuildCompetenceForensics';
import type {
  AtomicCardShadowEntry,
  AtomicCardShadowProjection,
  AtomicCardShadowStatement,
  PersistedAtomicCardEntry,
  PersistedAtomicCardProjection,
} from '../../src/domain/credit-card/atomicRebuildShadow';

const nextMonth = (referenceMonth: string): string => {
  const [year, month] = referenceMonth.split('-').map(Number);
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
};

const statement = (referenceMonth: string): AtomicCardShadowStatement => {
  const dueMonth = nextMonth(referenceMonth);
  return {
    statementKey: referenceMonth,
    purchaseReferenceMonth: referenceMonth,
    dueDate: `${dueMonth}-10`,
    dueYear: Number(referenceMonth.slice(0, 4)),
    dueMonth: Number(referenceMonth.slice(5, 7)),
    status: 'open',
    sourceFiles: [],
    entryCount: 0,
    totalPurchasesCents: 0,
    totalFeesCents: 0,
    totalInterestCents: 0,
    totalRefundsCents: 0,
    statementTotalCents: 0,
    totalPaymentsCents: 0,
    openBalanceCents: 0,
  };
};

const shadowProjection = (
  entries: AtomicCardShadowEntry[],
  statements: AtomicCardShadowStatement[]
): AtomicCardShadowProjection => ({
  version: 1,
  accountId: 'private-account',
  sourceCycleCount: statements.length,
  sourceTransactionCount: entries.length,
  projectedEntryCount: entries.length,
  projectedPaymentCount: 0,
  statements,
  entries,
  payments: [],
  issues: [],
  blockers: [],
  warnings: [],
  safeToStage: true,
  checksum: 'shadow-v1-competence-forensics',
});

const persistedProjection = (
  entries: PersistedAtomicCardEntry[]
): PersistedAtomicCardProjection => ({
  source: 'engine',
  statements: [],
  entries,
  payments: [],
});

describe('buildAtomicCardCompetenceForensicReport', () => {
  it('isola em escala o uso indevido do mês de vencimento sem perder linhas', () => {
    const referenceMonths = Array.from({ length: 20 }, (_, index) => {
      const absolute = 2025 * 12 + index;
      const year = Math.floor(absolute / 12);
      const month = (absolute % 12) + 1;
      return `${year}-${String(month).padStart(2, '0')}`;
    });
    const statements = referenceMonths.map(statement);
    const cycles: AtomicCardCompetenceEvidenceCycle[] = referenceMonths.map(
      (referenceMonth, index) => ({
        sourceFileName: `private-cycle-${index}.csv`,
        referenceMonth,
        dueDate: `${nextMonth(referenceMonth)}-10`,
        source: 'confirmed-import-history',
      })
    );
    const projected: AtomicCardShadowEntry[] = [];
    const current: PersistedAtomicCardEntry[] = [];

    for (let index = 0; index < 1916; index += 1) {
      const cycleIndex = index % cycles.length;
      const referenceMonth = cycles[cycleIndex].referenceMonth;
      const type = index < 3 ? 'installment_purchase' : 'purchase';
      projected.push({
        transactionId: `private-transaction-${index}`,
        sourceFileName: cycles[cycleIndex].sourceFileName,
        sourceRowHash: `private-hash-${index}`,
        statementKey: referenceMonth,
        postedDate: `${referenceMonth}-${String((index % 20) + 5).padStart(2, '0')}`,
        amountCents: -(1000 + index),
        entryType: type,
      });
      current.push({
        rowId: `private-row-${index}`,
        transactionId: `private-transaction-${index}`,
        sourceFileName: cycles[cycleIndex].sourceFileName,
        sourceRowHash: `private-hash-${index}`,
        statementKey: index < 1536 ? nextMonth(referenceMonth) : referenceMonth,
        postedDate: `${referenceMonth}-${String((index % 20) + 5).padStart(2, '0')}`,
        amountCents: -(1000 + index),
        entryType: index < 3 ? 'purchase' : type,
      });
    }

    const report = buildAtomicCardCompetenceForensicReport({
      shadow: shadowProjection(projected, statements),
      persisted: persistedProjection(current),
      cycles,
      closingDay: 3,
    });

    expect(report).toMatchObject({
      status: 'root-cause-isolated',
      confidence: 'high',
      dominantCause: 'current-keyed-by-due-month',
      privacy: 'aggregated-no-identifiers',
      nonAuthoritative: true,
      executable: false,
      mutationPayloadIncluded: false,
      actualWriteOperationCount: 0,
      rowCountProjected: 1916,
      rowCountPersisted: 1916,
      rowCountConserved: true,
      matchedRowCount: 1916,
      competenceMismatchCount: 1536,
      competenceOnlyMismatchCount: 1533,
      competenceAndTypeMismatchCount: 3,
      confirmedEvidenceMismatchCount: 1536,
      eligibleForFutureCompetenceDryRun: true,
    });
    expect(report.causeProfiles).toContainEqual({
      code: 'current-keyed-by-due-month',
      count: 1536,
    });
    expect(report.shiftProfiles).toContainEqual({
      monthsFromCurrentToExpected: -1,
      count: 1536,
    });
    expect(report.recommendationCodes).toContain(
      'separate-reference-competence-from-due-month'
    );
    expect(report.recommendationCodes.at(-1)).toBe('keep-writes-disabled');
  });

  it('reconhece a borda de fechamento sem promovê-la acima da competência confirmada', () => {
    const cycle: AtomicCardCompetenceEvidenceCycle = {
      sourceFileName: 'private-boundary.csv',
      referenceMonth: '2026-06',
      dueDate: '2026-07-10',
      source: 'confirmed-import-history',
    };
    const projected: AtomicCardShadowEntry = {
      transactionId: 'private-boundary-transaction',
      sourceFileName: cycle.sourceFileName,
      sourceRowHash: 'private-boundary-hash',
      statementKey: '2026-06',
      postedDate: '2026-07-02',
      amountCents: -3131,
      entryType: 'purchase',
    };
    const current: PersistedAtomicCardEntry = {
      rowId: 'private-boundary-row',
      transactionId: projected.transactionId,
      sourceFileName: cycle.sourceFileName,
      sourceRowHash: projected.sourceRowHash,
      statementKey: '2026-07',
      postedDate: projected.postedDate,
      amountCents: projected.amountCents,
      entryType: projected.entryType,
    };

    const report = buildAtomicCardCompetenceForensicReport({
      shadow: shadowProjection([projected], [statement('2026-06')]),
      persisted: persistedProjection([current]),
      cycles: [cycle],
      closingDay: 3,
    });

    expect(report.status).toBe('root-cause-isolated');
    expect(report.closingRuleSupportsExpectedCount).toBe(1);
    expect(report.closingRuleConflictsExpectedCount).toBe(0);
    expect(report.recommendationCodes).toContain('use-closing-day-only-as-fallback');
    expect(report.confirmedEvidenceMismatchCount).toBe(1);
  });

  it('bloqueia o diagnóstico quando a proveniência não escolhe uma linha única', () => {
    const cycle: AtomicCardCompetenceEvidenceCycle = {
      sourceFileName: 'private-ambiguous.csv',
      referenceMonth: '2026-06',
      dueDate: '2026-07-10',
      source: 'confirmed-import-history',
    };
    const projected: AtomicCardShadowEntry = {
      transactionId: 'private-ambiguous-transaction',
      sourceFileName: cycle.sourceFileName,
      sourceRowHash: 'private-ambiguous-hash',
      statementKey: '2026-06',
      postedDate: '2026-06-20',
      amountCents: -1000,
      entryType: 'purchase',
    };
    const duplicate = (rowId: string): PersistedAtomicCardEntry => ({
      rowId,
      transactionId: 'private-current-owner',
      sourceFileName: cycle.sourceFileName,
      sourceRowHash: projected.sourceRowHash,
      statementKey: '2026-07',
      postedDate: projected.postedDate,
      amountCents: projected.amountCents,
      entryType: projected.entryType,
    });

    const report = buildAtomicCardCompetenceForensicReport({
      shadow: shadowProjection([projected], [statement('2026-06')]),
      persisted: persistedProjection([duplicate('private-row-a'), duplicate('private-row-b')]),
      cycles: [cycle],
      closingDay: 3,
    });

    expect(report.status).toBe('blocked');
    expect(report.ambiguousMatchCount).toBe(1);
    expect(report.eligibleForFutureCompetenceDryRun).toBe(false);
    expect(report.actualWriteOperationCount).toBe(0);
  });

  it('é determinístico, não altera as entradas e não serializa dados privados', () => {
    const cycle: AtomicCardCompetenceEvidenceCycle = {
      sourceFileName: 'cliente-secreto.csv',
      referenceMonth: '2026-06',
      dueDate: '2026-07-10',
      source: 'confirmed-import-history',
    };
    const projected: AtomicCardShadowEntry = {
      transactionId: 'secret-transaction-id',
      sourceFileName: cycle.sourceFileName,
      sourceRowHash: 'secret-source-hash',
      statementKey: '2026-06',
      postedDate: '2026-06-20',
      amountCents: -1000,
      entryType: 'purchase',
    };
    const current: PersistedAtomicCardEntry = {
      rowId: 'secret-row-id',
      transactionId: projected.transactionId,
      sourceFileName: cycle.sourceFileName,
      sourceRowHash: projected.sourceRowHash,
      statementKey: '2026-07',
      postedDate: projected.postedDate,
      amountCents: projected.amountCents,
      entryType: projected.entryType,
    };
    const shadow = shadowProjection([projected], [statement('2026-06')]);
    const persisted = persistedProjection([current]);
    const beforeShadow = structuredClone(shadow);
    const beforePersisted = structuredClone(persisted);

    const first = buildAtomicCardCompetenceForensicReport({
      shadow,
      persisted,
      cycles: [cycle],
      closingDay: 3,
    });
    const second = buildAtomicCardCompetenceForensicReport({
      shadow: { ...shadow, entries: [...shadow.entries].reverse() },
      persisted: { ...persisted, entries: [...persisted.entries].reverse() },
      cycles: [...[cycle]].reverse(),
      closingDay: 3,
    });
    const serialized = JSON.stringify(first);

    expect(second).toEqual(first);
    expect(shadow).toEqual(beforeShadow);
    expect(persisted).toEqual(beforePersisted);
    expect(serialized).not.toContain('cliente-secreto');
    expect(serialized).not.toContain('secret-transaction-id');
    expect(serialized).not.toContain('secret-source-hash');
    expect(serialized).not.toContain('secret-row-id');
  });
});
