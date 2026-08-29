import { describe, expect, it } from 'vitest';
import { prepareAtomicCardStructuralEntryExecution } from '../../src/domain/credit-card/atomicRebuildStructuralEntryExecution';
import { buildAtomicCardProvenanceReport } from '../../src/domain/credit-card/atomicRebuildProvenance';
import {
  compareAtomicCardProjections,
  type AtomicCardShadowProjection,
  type PersistedAtomicCardProjection,
} from '../../src/domain/credit-card/atomicRebuildShadow';

const accountId = '10000000-0000-4000-8000-000000000001';
const cardId = '10000000-0000-4000-8000-000000000002';
const transactionA = '10000000-0000-4000-8000-000000000003';
const transactionB = '10000000-0000-4000-8000-000000000004';
const rowA = '10000000-0000-4000-8000-000000000005';
const rowB = '10000000-0000-4000-8000-000000000006';
const statementJuly = '10000000-0000-4000-8000-000000000007';
const statementAugust = '10000000-0000-4000-8000-000000000008';
const statementSeptember = '10000000-0000-4000-8000-000000000009';
const lotA = '10000000-0000-4000-8000-000000000010';
const lotB = '10000000-0000-4000-8000-000000000011';

const statement = (rowId: string, statementKey: string) => ({
  rowId,
  cardId,
  referenceLabel: statementKey,
  statementKey,
  dueDate: `${statementKey}-28`,
  entryCount: 0,
  statementTotalCents: 0,
  totalPaymentsCents: 0,
  openBalanceCents: 0,
  openAmountCents: 0,
  status: 'paid' as const,
  hasProtectedMetadata: false,
});

const shadow = (): AtomicCardShadowProjection => ({
  version: 1,
  accountId,
  sourceCycleCount: 2,
  sourceTransactionCount: 2,
  projectedEntryCount: 2,
  projectedPaymentCount: 0,
  statements: [
    {
      statementKey: '2026-07',
      purchaseReferenceMonth: '2026-07',
      dueDate: '2026-07-28',
      dueYear: 2026,
      dueMonth: 7,
      status: 'open',
      sourceFiles: ['july.csv'],
      entryCount: 1,
      totalPurchasesCents: 1000,
      totalFeesCents: 0,
      totalInterestCents: 0,
      totalRefundsCents: 0,
      statementTotalCents: 1000,
      totalPaymentsCents: 0,
      openBalanceCents: 1000,
    },
    {
      statementKey: '2026-08',
      purchaseReferenceMonth: '2026-08',
      dueDate: '2026-08-28',
      dueYear: 2026,
      dueMonth: 8,
      status: 'open',
      sourceFiles: ['august.csv'],
      entryCount: 1,
      totalPurchasesCents: 2000,
      totalFeesCents: 0,
      totalInterestCents: 0,
      totalRefundsCents: 0,
      statementTotalCents: 2000,
      totalPaymentsCents: 0,
      openBalanceCents: 2000,
    },
  ],
  entries: [
    {
      transactionId: transactionA,
      sourceFileName: 'july.csv',
      sourceRowHash: 'hash-a',
      statementKey: '2026-07',
      postedDate: '2026-07-02',
      amountCents: -1000,
      entryType: 'purchase',
    },
    {
      transactionId: transactionB,
      sourceFileName: 'august.csv',
      sourceRowHash: 'hash-b',
      statementKey: '2026-08',
      postedDate: '2026-08-03',
      amountCents: -2000,
      entryType: 'purchase',
    },
  ],
  payments: [],
  issues: [],
  blockers: [],
  warnings: [],
  safeToStage: true,
  checksum: 'shadow-v1-12345678',
});

const persisted = (): PersistedAtomicCardProjection => ({
  source: 'engine',
  statements: [
    statement(statementJuly, '2026-07'),
    statement(statementAugust, '2026-08'),
    statement(statementSeptember, '2026-09'),
  ],
  entries: [
    {
      rowId: rowA,
      statementRowId: statementAugust,
      sourceFileName: 'july.csv',
      sourceRowIndex: 1,
      sourceRowHash: 'hash-a',
      importLotId: lotA,
      createdAt: '2026-08-01T00:00:00Z',
      transactionId: transactionA,
      statementKey: '2026-08',
      postedDate: '2026-07-02',
      amountCents: -1000,
      entryType: 'purchase',
    },
    {
      rowId: rowB,
      statementRowId: statementSeptember,
      sourceFileName: 'august.csv',
      sourceRowIndex: 2,
      sourceRowHash: 'hash-b',
      importLotId: lotB,
      createdAt: '2026-09-01T00:00:00Z',
      transactionId: transactionA,
      statementKey: '2026-09',
      postedDate: '2026-08-03',
      amountCents: -2000,
      entryType: 'installment_purchase',
    },
  ],
  payments: [],
});

const prepare = (current = persisted(), revision = 'a'.repeat(32)) => {
  const expected = shadow();
  const comparison = compareAtomicCardProjections(expected, current);
  const provenance = buildAtomicCardProvenanceReport(expected, current, comparison);
  return prepareAtomicCardStructuralEntryExecution({
    shadow: expected,
    persisted: current,
    comparison,
    provenance,
    cycles: [
      {
        sourceFileName: 'july.csv',
        referenceMonth: '2026-07',
        dueDate: '2026-07-28',
        source: 'confirmed-import-history',
      },
      {
        sourceFileName: 'august.csv',
        referenceMonth: '2026-08',
        dueDate: '2026-08-28',
        source: 'confirmed-import-history',
      },
    ],
    persistedRevision: revision,
  });
};

describe('prepareAtomicCardStructuralEntryExecution', () => {
  it('prepara somente identidade, vínculo de competência e tipo comprovados', () => {
    const preparation = prepare();

    expect(preparation.report).toMatchObject({
      status: 'contract-ready',
      expectedEntryUpdateCount: 2,
      expectedIdentityUpdateCount: 1,
      expectedCompetenceUpdateCount: 2,
      expectedTypeUpdateCount: 1,
      expectedLogicalFieldUpdateCount: 4,
      snapshotEntryCount: 2,
      preparedDatabaseGuardCount: 18,
      preservesEntryRows: true,
      preservesTransactions: true,
      preservesEconomicContent: true,
      preservesSourceProvenance: true,
      preservesStatements: true,
      preservesPayments: true,
      eligibleForStagingExecution: true,
      eligibleForWrite: false,
      actualWriteOperationCount: 0,
    });
    expect(preparation.report.blockerCodes).toEqual([]);
    expect(preparation.request?.entryUpdates).toHaveLength(2);
    expect(preparation.request?.entryUpdates[0]).toMatchObject({
      rowId: rowA,
      expectedTransactionId: transactionA,
      desiredTransactionId: transactionA,
      expectedStatementRowId: statementAugust,
      desiredStatementRowId: statementJuly,
      expectedEntryType: 'purchase',
      desiredEntryType: 'purchase',
    });
    expect(preparation.request?.entryUpdates[1]).toMatchObject({
      rowId: rowB,
      expectedTransactionId: transactionA,
      desiredTransactionId: transactionB,
      expectedStatementRowId: statementSeptember,
      desiredStatementRowId: statementAugust,
      expectedEntryType: 'installment_purchase',
      desiredEntryType: 'purchase',
    });
  });

  it('bloqueia linha sem vínculo físico inequívoco de fatura', () => {
    const current = persisted();
    current.entries[0].statementRowId = null;
    const preparation = prepare(current);

    expect(preparation.report.status).toBe('blocked');
    expect(preparation.report.blockerCodes).toContain(
      'statement-record-identity-missing'
    );
    expect(preparation.report.expectedEntryUpdateCount).toBe(0);
    expect(preparation.report.expectedLogicalFieldUpdateCount).toBe(0);
    expect(preparation.request).toBeNull();
  });

  it('bloqueia revisão inválida sem expor identidades no relatório', () => {
    const preparation = prepare(persisted(), 'invalid');
    const serialized = JSON.stringify(preparation.report);

    expect(preparation.report.status).toBe('blocked');
    expect(preparation.report.blockerCodes).toContain('invalid-persisted-revision');
    expect(preparation.report.expectedEntryUpdateCount).toBe(0);
    expect(preparation.report.expectedLogicalFieldUpdateCount).toBe(0);
    expect(preparation.request).toBeNull();
    expect(serialized).not.toContain(rowA);
    expect(serialized).not.toContain(transactionB);
    expect(serialized).not.toContain('2026-07');
  });
});
