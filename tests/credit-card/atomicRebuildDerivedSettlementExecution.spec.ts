import { describe, expect, it } from 'vitest';
import { prepareAtomicCardDerivedSettlementExecution } from '../../src/domain/credit-card/atomicRebuildDerivedSettlementExecution';
import { buildAtomicCardProvenanceReport } from '../../src/domain/credit-card/atomicRebuildProvenance';
import {
  compareAtomicCardProjections,
  type AtomicCardShadowProjection,
  type PersistedAtomicCardProjection,
} from '../../src/domain/credit-card/atomicRebuildShadow';

const julyRowId = '11111111-1111-4111-8111-111111111111';
const augustRowId = '22222222-2222-4222-8222-222222222222';

const shadow = (): AtomicCardShadowProjection => ({
  version: 1,
  accountId: '33333333-3333-4333-8333-333333333333',
  sourceCycleCount: 2,
  sourceTransactionCount: 0,
  projectedEntryCount: 0,
  projectedPaymentCount: 1,
  statements: [
    {
      statementKey: '2026-07',
      purchaseReferenceMonth: '2026-07',
      dueDate: '2026-07-28',
      dueYear: 2026,
      dueMonth: 7,
      status: 'paid',
      sourceFiles: ['july.csv'],
      entryCount: 5,
      totalPurchasesCents: 44990,
      totalFeesCents: 0,
      totalInterestCents: 0,
      totalRefundsCents: 5000,
      statementTotalCents: 39990,
      totalPaymentsCents: 39990,
      openBalanceCents: 0,
    },
    {
      statementKey: '2026-08',
      purchaseReferenceMonth: '2026-08',
      dueDate: '2026-08-28',
      dueYear: 2026,
      dueMonth: 8,
      status: 'open',
      sourceFiles: ['august.csv'],
      entryCount: 4,
      totalPurchasesCents: 44990,
      totalFeesCents: 0,
      totalInterestCents: 0,
      totalRefundsCents: 0,
      statementTotalCents: 44990,
      totalPaymentsCents: 0,
      openBalanceCents: 44990,
    },
  ],
  entries: [],
  payments: [
    {
      transactionId: '44444444-4444-4444-8444-444444444444',
      sourceFileName: 'august.csv',
      sourceRowHash: 'payment-hash',
      statementKey: '2026-07',
      paymentDate: '2026-08-20',
      amountCents: 39990,
      source: 'imported_statement',
    },
  ],
  issues: [],
  blockers: [],
  warnings: [],
  safeToStage: true,
  checksum: 'shadow-v1-12345678',
});

const persisted = (): PersistedAtomicCardProjection => ({
  source: 'engine',
  statements: [
    {
      rowId: julyRowId,
      cardId: '55555555-5555-4555-8555-555555555555',
      referenceLabel: '2026-07',
      statementKey: '2026-07',
      dueDate: '2026-07-28',
      entryCount: 5,
      statementTotalCents: 39990,
      totalPaymentsCents: 40000,
      openBalanceCents: 0,
      openAmountCents: 0,
      status: 'paid',
      hasProtectedMetadata: true,
      manualTotalsPresent: false,
      manualTotalsJson: { protected: 'july' },
      statementTotalFromFileCents: 39990,
      totalPaymentsFromFileCents: 40000,
      linesComputedTotalCents: 39990,
    },
    {
      rowId: augustRowId,
      cardId: '55555555-5555-4555-8555-555555555555',
      referenceLabel: '2026-08',
      statementKey: '2026-08',
      dueDate: '2026-08-28',
      entryCount: 4,
      statementTotalCents: 44990,
      totalPaymentsCents: 39990,
      openBalanceCents: 5000,
      openAmountCents: 0,
      status: 'partial',
      hasProtectedMetadata: true,
      manualTotalsPresent: false,
      manualTotalsJson: { protected: 'august' },
      statementTotalFromFileCents: 44990,
      totalPaymentsFromFileCents: 39990,
      linesComputedTotalCents: 44990,
    },
  ],
  entries: [],
  payments: [
    {
      rowId: '66666666-6666-4666-8666-666666666666',
      transactionId: '44444444-4444-4444-8444-444444444444',
      statementKey: '2026-07',
      paymentDate: '2026-08-20',
      amountCents: 39990,
      source: 'imported_statement',
    },
  ],
});

const prepare = (
  current = persisted(),
  revision = 'a'.repeat(32)
) => {
  const expected = shadow();
  const comparison = compareAtomicCardProjections(expected, current);
  const provenance = buildAtomicCardProvenanceReport(expected, current, comparison);
  return prepareAtomicCardDerivedSettlementExecution({
    shadow: expected,
    persisted: current,
    comparison,
    provenance,
    cycles: [],
    persistedRevision: revision,
  });
};

describe('prepareAtomicCardDerivedSettlementExecution', () => {
  it('produz contrato privado apenas para os campos derivados de quitação do piloto', () => {
    const preparation = prepare();

    expect(preparation.report).toMatchObject({
      status: 'contract-ready',
      checksumBound: true,
      revisionBound: true,
      expectedStatementUpdateCount: 2,
      expectedLogicalFieldUpdateCount: 5,
      expectedPhysicalColumnUpdateCount: 5,
      snapshotStatementCount: 2,
      requiredDatabaseGuardCount: 14,
      preparedDatabaseGuardCount: 14,
      updatesOnlyDerivedSettlementFields: true,
      preservesEntries: true,
      preservesPayments: true,
      preservesProtectedMetadata: true,
      rollbackRequiresAfterRevision: true,
      dedicatedFeatureFlagRequired: true,
      eligibleForStagingExecution: true,
      eligibleForWrite: false,
      actualWriteOperationCount: 0,
    });
    expect(preparation.report.blockerCodes).toEqual([]);
    expect(preparation.request).toEqual({
      accountId: '33333333-3333-4333-8333-333333333333',
      expectedRevision: 'a'.repeat(32),
      shadowChecksum: 'shadow-v1-12345678',
      statementUpdates: [
        {
          rowId: julyRowId,
          statementKey: '2026-07',
          expectedTotalPaymentsCents: 40000,
          expectedOpenBalanceCents: 0,
          expectedOpenAmountCents: 0,
          expectedStatus: 'paid',
          desiredTotalPaymentsCents: 39990,
          desiredOpenBalanceCents: 0,
          desiredOpenAmountCents: 0,
          desiredStatus: 'paid',
        },
        {
          rowId: augustRowId,
          statementKey: '2026-08',
          expectedTotalPaymentsCents: 39990,
          expectedOpenBalanceCents: 5000,
          expectedOpenAmountCents: 0,
          expectedStatus: 'partial',
          desiredTotalPaymentsCents: 0,
          desiredOpenBalanceCents: 44990,
          desiredOpenAmountCents: 44990,
          desiredStatus: 'open',
        },
      ],
    });
  });

  it('bloqueia um contrato que também exigiria reconstrução de identidade', () => {
    const current = persisted();
    current.entries = [
      {
        rowId: '77777777-7777-4777-8777-777777777777',
        transactionId: '88888888-8888-4888-8888-888888888888',
        statementKey: '2026-07',
        postedDate: '2026-07-01',
        amountCents: -1000,
        entryType: 'purchase',
        sourceFileName: 'source.csv',
        sourceRowHash: 'source-hash',
        sourceRowIndex: 1,
        importLotId: '99999999-9999-4999-8999-999999999999',
      },
    ];
    const expected = shadow();
    expected.entries = [
      {
        transactionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sourceFileName: 'source.csv',
        sourceRowHash: 'source-hash',
        statementKey: '2026-07',
        postedDate: '2026-07-01',
        amountCents: -1000,
        entryType: 'purchase',
      },
    ];
    expected.sourceTransactionCount = 1;
    expected.projectedEntryCount = 1;
    const comparison = compareAtomicCardProjections(expected, current);
    const provenance = buildAtomicCardProvenanceReport(expected, current, comparison);
    const preparation = prepareAtomicCardDerivedSettlementExecution({
      shadow: expected,
      persisted: current,
      comparison,
      provenance,
      cycles: [],
      persistedRevision: 'a'.repeat(32),
    });

    expect(preparation.report.status).toBe('blocked');
    expect(preparation.report.blockerCodes).toContain(
      'identity-or-competence-write-required'
    );
    expect(preparation.report.expectedStatementUpdateCount).toBe(0);
    expect(preparation.report.expectedLogicalFieldUpdateCount).toBe(0);
    expect(preparation.report.snapshotStatementCount).toBe(0);
    expect(preparation.request).toBeNull();
  });

  it('bloqueia revisão inválida e não expõe identidades no relatório público', () => {
    const preparation = prepare(persisted(), 'invalid');
    const serialized = JSON.stringify(preparation.report);

    expect(preparation.report.status).toBe('blocked');
    expect(preparation.report.blockerCodes).toContain('invalid-persisted-revision');
    expect(preparation.report.expectedStatementUpdateCount).toBe(0);
    expect(preparation.report.expectedLogicalFieldUpdateCount).toBe(0);
    expect(preparation.request).toBeNull();
    expect(serialized).not.toContain(julyRowId);
    expect(serialized).not.toContain(augustRowId);
    expect(serialized).not.toContain('2026-07');
    expect(serialized).not.toContain('2026-08');
  });
});
