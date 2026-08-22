import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, Transaction } from '../../src/types';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../../src/supabaseClient', () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));

import {
  creditCardAtomicRebuildService,
  prepareAtomicCardShadowSource,
  type AtomicCardRebuildAuditResult,
} from '../../src/services/creditCardAtomicRebuildService';
import type { AtomicCardStatementConservationPlanReport } from '../../src/domain/credit-card/atomicRebuildStatementConservationPlan';

const account: Account = {
  id: 'account-card',
  user_id: 'user-1',
  Nome_Conta: 'Cartão QA',
  Tipo_Conta: 'Cartão de Crédito',
  Saldo_Inicial: 0,
  Data_Saldo_Inicial: new Date(2026, 0, 1),
  dia_vencimento: 28,
};

const transaction: Transaction = {
  ID_Transacao: 'tx-shadow',
  user_id: account.user_id,
  ID_Conta: account.id,
  Data: '2026-07-10' as unknown as Date,
  Descricao_Original: 'COMPRA TESTE',
  Nome_Fantasia: 'COMPRA TESTE',
  Valor: -10,
  Tipo: 'Despesa',
  Categoria: 'Teste',
  Origem: 'fatura-julho.csv',
  Fonte: 'Teste',
};

const statementConservationAudit = (
  overrides: Partial<AtomicCardRebuildAuditResult> = {}
): AtomicCardRebuildAuditResult => ({
  shadow: {
    version: 1,
    accountId: account.id,
    sourceCycleCount: 1,
    sourceTransactionCount: 2,
    projectedEntryCount: 1,
    projectedPaymentCount: 1,
    statements: [{
      statementKey: '2026-08',
      purchaseReferenceMonth: '2026-08',
      dueDate: '2026-08-28',
      dueYear: 2026,
      dueMonth: 8,
      status: 'paid',
      sourceFiles: ['private.csv'],
      entryCount: 1,
      totalPurchasesCents: 44_990,
      totalFeesCents: 0,
      totalInterestCents: 0,
      totalRefundsCents: 0,
      statementTotalCents: 44_990,
      totalPaymentsCents: 39_990,
      openBalanceCents: 5_000,
    }],
    entries: [{
      transactionId: 'private-entry-transaction',
      sourceFileName: 'private.csv',
      sourceRowHash: 'private-entry-hash',
      statementKey: '2026-08',
      postedDate: '2026-08-10',
      amountCents: -44_990,
      entryType: 'purchase',
    }],
    payments: [{
      transactionId: 'private-payment-transaction',
      sourceFileName: 'private.csv',
      sourceRowHash: 'private-payment-hash',
      statementKey: '2026-08',
      paymentDate: '2026-08-20',
      amountCents: 39_990,
      source: 'imported_statement',
    }],
    issues: [],
    blockers: [],
    warnings: [],
    safeToStage: false,
    checksum: 'shadow-v1-05712d54',
  },
  persisted: {
    source: 'engine',
    statements: [
      {
        rowId: 'private-statement-a',
        cardId: 'private-card',
        referenceLabel: 'legacy-a',
        statementKey: '2026-08',
        dueDate: '2026-08-28',
        entryCount: 1,
        statementTotalCents: 44_990,
        totalPaymentsCents: 39_990,
        openBalanceCents: 5_000,
        hasProtectedMetadata: true,
        manualTotalsPresent: true,
        manualTotalsJson: { use_manual: true },
        statementTotalFromFileCents: 44_990,
        totalPaymentsFromFileCents: 39_990,
        linesComputedTotalCents: 44_990,
      },
      {
        rowId: 'private-statement-b',
        cardId: 'private-card',
        referenceLabel: 'legacy-b',
        statementKey: '2026-08',
        dueDate: '2026-08-28',
        entryCount: 0,
        statementTotalCents: 44_990,
        totalPaymentsCents: 0,
        openBalanceCents: 44_990,
      },
    ],
    entries: [{
      rowId: 'private-entry-row',
      transactionId: 'private-entry-transaction',
      statementKey: '2026-08',
      postedDate: '2026-08-10',
      amountCents: -44_990,
      entryType: 'purchase',
    }],
    payments: [{
      rowId: 'private-payment-row',
      transactionId: 'private-payment-transaction',
      statementKey: '2026-08',
      paymentDate: '2026-08-20',
      amountCents: 39_990,
      source: 'imported_statement',
    }],
  },
  comparison: {
    status: 'different',
    safeToActivate: false,
    duplicatePersistedTransactionIds: [],
    repairablePersistedEntryRowIds: [],
    conflictingDuplicatePersistedTransactionIds: [],
    duplicatePersistedStatementKeys: ['2026-08'],
    duplicatePersistedPaymentTransactionIds: [],
    suspiciousPersistedPaymentEventKeys: [],
    repairablePersistedPaymentRowIds: [],
    protectedMetadataStatementKeys: ['2026-08'],
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
  },
  persistedRevision: 'a'.repeat(32),
  ...overrides,
});

const statementConservationPlan = (): AtomicCardStatementConservationPlanReport => ({
  version: 1,
  privacy: 'aggregated-no-identifiers',
  nonAuthoritative: true,
  executable: false,
  mutationPayloadIncluded: false,
  actualWriteOperationCount: 0,
  checksum: 'shadow-v1-05712d54',
  status: 'plan-ready',
  duplicateGroupCount: 1,
  locatedGroupCount: 1,
  sourceStatementRecordCount: 2,
  plannedCompositeStatementCount: 1,
  plannedStatementReplacementCount: 2,
  plannedDuplicateExcessResolutionCount: 1,
  expectedStatementRecordCountAfter: 1,
  affectedEntryLinkCount: 1,
  affectedPaymentLinkCount: 1,
  snapshotStatementRecordCount: 2,
  snapshotEntryLinkCount: 1,
  snapshotPaymentLinkCount: 1,
  rollbackRemoveCompositeCount: 1,
  rollbackRestoreStatementRecordCount: 2,
  rollbackRestoreEntryLinkCount: 1,
  rollbackRestorePaymentLinkCount: 1,
  protectedMetadataGroupCount: 1,
  protectedMetadataLossCount: 0,
  plannedFinancialValueChangeCount: 0,
  plannedTransactionRecordChangeCount: 0,
  requiredGuardCount: 6,
  designedGuardCount: 6,
  executableGuardCount: 0,
  revisionGuardBound: true,
  rollbackCardinalityBalanced: true,
  eligibleForFutureTransactionalImplementation: true,
  eligibleForWrite: false,
  blockerProfiles: [],
  recommendationCodes: ['implement-transactional-rpc-in-later-sprint', 'keep-writes-disabled'],
});

describe('creditCardAtomicRebuildService.audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: 'a'.repeat(32), error: null });
  });

  it('inclui lançamentos manuais em origens por competência sem alterar os objetos originais', () => {
    const manualPurchase: Transaction = {
      ...transaction,
      ID_Transacao: 'manual-day-31',
      Data: '2026-07-31' as unknown as Date,
      Data_Pagamento: '2026-08-28' as unknown as Date,
      Descricao_Original: 'COMPRA MANUAL DIA 31',
      Nome_Fantasia: 'COMPRA MANUAL DIA 31',
      Valor: -31.31,
      Origem: 'manual',
      Fonte: 'Manual',
    };
    const importCycle = {
      fileName: 'fatura-julho.csv',
      referenceMonth: '2026-07',
      dueDate: '2026-08-28',
    };

    const prepared = prepareAtomicCardShadowSource({
      account,
      cycles: [importCycle],
      transactions: [transaction, manualPurchase],
      importLogs: [
        {
          id: 'log-1',
          user_id: account.user_id,
          file_name: importCycle.fileName,
          import_date: '2026-08-01T12:00:00Z',
          total_transactions: 1,
          imported_count: 1,
          ignored_count: 0,
          ignored_details: [],
          imported_details: [
            {
              ID_Conta: account.id,
              Card_Payment_Tx_Ids: ['tx-shadow'],
              Card_Refund_Tx_Ids: ['refund-shadow'],
            },
          ],
        },
      ],
    });

    expect(manualPurchase.Origem).toBe('manual');
    expect(prepared.cycles).toContainEqual({
      fileName: 'manual:2026-07',
      referenceMonth: '2026-07',
      dueDate: '2026-08-28',
    });
    expect(prepared.cycles[0]).toEqual(
      expect.objectContaining({
        paymentTransactionIds: ['tx-shadow'],
        refundTransactionIds: ['refund-shadow'],
      })
    );
    expect(
      prepared.transactions.find((item) => item.ID_Transacao === manualPurchase.ID_Transacao)
        ?.Origem
    ).toBe('manual:2026-07');
  });

  it('faz somente SELECT e lê mais de mil linhas sem publicar página parcial', async () => {
    const statementRows = [
      {
        id: 'statement-1',
        card_id: 'card-1',
        reference_label: '2026-08',
        due_year: 2026,
        due_month: 8,
        due_date: '2026-08-28',
        total_charges: 0,
        total_credits: 0,
        total_payments: 0,
        open_amount: 0,
        statement_total: 10,
        open_balance: 10,
      },
    ];
    const engineRows = Array.from({ length: 1001 }, (_, index) => ({
      id: `entry-${index}`,
      source_file_name: 'fatura-julho.csv',
      source_row_index: index + 1,
      source_row_hash: `source-hash-${index}`,
      import_lot_id: 'lot-private',
      created_at: '2026-08-01T12:00:00Z',
      statement_id: 'statement-1',
      transaction_id: index === 0 ? 'tx-shadow' : `old-${index}`,
      posted_date: '2026-07-10',
      amount: -10,
      entry_type: 'purchase',
    }));
    const rowsByTable: Record<string, unknown[]> = {
      credit_card_statements: statementRows,
      credit_card_entries: engineRows,
      credit_card_statement_items: [],
      credit_card_payments: [],
    };
    const rangesByTable = new Map<string, Array<[number, number]>>();
    const selectedColumnsByTable = new Map<string, string>();

    mocks.from.mockImplementation((table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn((columns: string) => {
        selectedColumnsByTable.set(table, columns);
        return builder;
      });
      builder.eq = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.order = vi.fn(() => builder);
      builder.insert = mocks.insert;
      builder.update = mocks.update;
      builder.upsert = mocks.upsert;
      builder.delete = mocks.remove;
      builder.range = vi.fn(async (from: number, to: number) => {
        const ranges = rangesByTable.get(table) || [];
        ranges.push([from, to]);
        rangesByTable.set(table, ranges);
        return {
          data: (rowsByTable[table] || []).slice(from, to + 1),
          error: null,
        };
      });
      return builder;
    });

    const result = await creditCardAtomicRebuildService.audit({
      account,
      cycles: [
        {
          fileName: 'fatura-julho.csv',
          referenceMonth: '2026-07',
          dueDate: '2026-08-28',
        },
      ],
      transactions: [transaction],
    });

    expect(result.persisted.entries).toHaveLength(1001);
    expect(result.persisted.entries.find((entry) => entry.rowId === 'entry-0')).toMatchObject({
      rowId: 'entry-0',
      sourceFileName: 'fatura-julho.csv',
      sourceRowIndex: 1,
      sourceRowHash: 'source-hash-0',
      importLotId: 'lot-private',
      createdAt: '2026-08-01T12:00:00Z',
    });
    expect(rangesByTable.get('credit_card_entries')).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(selectedColumnsByTable.get('credit_card_entries')).toContain('source_file_name');
    expect(selectedColumnsByTable.get('credit_card_entries')).toContain('source_row_hash');
    expect(selectedColumnsByTable.get('credit_card_entries')).toContain('source_row_index');
    expect(selectedColumnsByTable.get('credit_card_entries')).toContain('import_lot_id');
    expect(mocks.from).toHaveBeenCalledWith('credit_card_statements');
    expect(mocks.from).toHaveBeenCalledWith('credit_card_entries');
    expect(mocks.from).toHaveBeenCalledWith('credit_card_statement_items');
    expect(mocks.from).toHaveBeenCalledWith('credit_card_payments');
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'get_credit_card_projection_revision', {
      p_account_id: account.id,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'get_credit_card_projection_revision', {
      p_account_id: account.id,
    });
  });

  it('conta lançamentos por registro físico ao auditar faturas de competência duplicada', async () => {
    const rowsByTable: Record<string, unknown[]> = {
      credit_card_statements: [
        {
          id: 'statement-a',
          card_id: 'card-1',
          reference_label: '2026-08',
          due_year: 2026,
          due_month: 8,
          due_date: '2026-08-28',
          statement_total: 20,
          total_payments: 0,
          open_balance: 20,
        },
        {
          id: 'statement-b',
          card_id: 'card-1',
          reference_label: '2026-08',
          due_year: 2026,
          due_month: 8,
          due_date: '2026-08-28',
          statement_total: 10,
          total_payments: 0,
          open_balance: 10,
        },
      ],
      credit_card_entries: [
        {
          id: 'entry-a1',
          statement_id: 'statement-a',
          transaction_id: 'tx-a1',
          posted_date: '2026-07-10',
          amount: -10,
          entry_type: 'purchase',
        },
        {
          id: 'entry-a2',
          statement_id: 'statement-a',
          transaction_id: 'tx-a2',
          posted_date: '2026-07-11',
          amount: -10,
          entry_type: 'purchase',
        },
        {
          id: 'entry-b1',
          statement_id: 'statement-b',
          transaction_id: 'tx-b1',
          posted_date: '2026-07-12',
          amount: -10,
          entry_type: 'purchase',
        },
      ],
      credit_card_statement_items: [],
      credit_card_payments: [],
    };

    mocks.from.mockImplementation((table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.order = vi.fn(() => builder);
      builder.insert = mocks.insert;
      builder.update = mocks.update;
      builder.upsert = mocks.upsert;
      builder.delete = mocks.remove;
      builder.range = vi.fn(async (from: number, to: number) => ({
        data: (rowsByTable[table] || []).slice(from, to + 1),
        error: null,
      }));
      return builder;
    });

    const result = await creditCardAtomicRebuildService.audit({
      account,
      cycles: [
        {
          fileName: 'fatura-julho.csv',
          referenceMonth: '2026-07',
          dueDate: '2026-08-28',
        },
      ],
      transactions: [transaction],
    });

    expect(result.persisted.statements).toHaveLength(2);
    expect(result.persisted.statements.map((item) => item.entryCount).sort()).toEqual([1, 2]);
    expect(result.comparison.duplicatePersistedStatementKeys).toHaveLength(1);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('aborta a auditoria inteira se uma página de leitura falhar', async () => {
    const statementRows = [
      {
        id: 'statement-1',
        card_id: 'card-1',
        reference_label: '2026-08',
        due_year: 2026,
        due_month: 8,
        due_date: '2026-08-28',
        statement_total: 10,
        total_payments: 0,
        open_balance: 10,
      },
    ];
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `entry-${index}`,
      statement_id: 'statement-1',
      transaction_id: `old-${index}`,
      posted_date: '2026-07-10',
      amount: -10,
      entry_type: 'purchase',
    }));

    mocks.from.mockImplementation((table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.order = vi.fn(() => builder);
      builder.insert = mocks.insert;
      builder.update = mocks.update;
      builder.upsert = mocks.upsert;
      builder.delete = mocks.remove;
      builder.range = vi.fn(async (from: number) => {
        if (table === 'credit_card_entries') {
          if (from === 0) return { data: firstPage, error: null };
          return { data: null, error: { message: 'segunda página indisponível' } };
        }
        if (table === 'credit_card_statements') {
          return { data: from === 0 ? statementRows : [], error: null };
        }
        return { data: [], error: null };
      });
      return builder;
    });

    await expect(
      creditCardAtomicRebuildService.audit({
        account,
        cycles: [
          {
            fileName: 'fatura-julho.csv',
            referenceMonth: '2026-07',
            dueDate: '2026-08-28',
          },
        ],
        transactions: [transaction],
      })
    ).rejects.toThrow('segunda página indisponível');

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('get_credit_card_projection_revision', {
      p_account_id: account.id,
    });
  });

  it('cancela a auditoria se a revisão mudar durante a leitura paginada', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: 'a'.repeat(32), error: null })
      .mockResolvedValueOnce({ data: 'b'.repeat(32), error: null });

    mocks.from.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.order = vi.fn(() => builder);
      builder.range = vi.fn(async () => ({ data: [], error: null }));
      return builder;
    });

    await expect(
      creditCardAtomicRebuildService.audit({
        account,
        cycles: [],
        transactions: [],
      })
    ).rejects.toThrow('mudou durante a auditoria');
  });

  it('envia somente as candidatas reauditas ao RPC atomico de reparo', async () => {
    const baseAudit = {
      shadow: { checksum: 'shadow-v1-05712d54' },
      persistedRevision: 'a'.repeat(32),
      comparison: {
        repairablePersistedPaymentRowIds: ['obsolete-payment-row'],
      },
    } as unknown as AtomicCardRebuildAuditResult;
    const postRepairAudit = {
      ...baseAudit,
      persistedRevision: 'b'.repeat(32),
      comparison: {
        ...baseAudit.comparison,
        repairablePersistedPaymentRowIds: [],
      },
    } as unknown as AtomicCardRebuildAuditResult;

    vi.spyOn(creditCardAtomicRebuildService, 'isActivationEnabled').mockResolvedValue(true);
    vi.spyOn(creditCardAtomicRebuildService, 'audit')
      .mockResolvedValueOnce(baseAudit)
      .mockResolvedValueOnce(postRepairAudit);
    mocks.rpc.mockResolvedValueOnce({
      data: {
        snapshot_id: 'repair-snapshot',
        before_revision: 'a'.repeat(32),
        after_revision: 'b'.repeat(32),
        deleted_payments: 1,
      },
      error: null,
    });

    const result = await creditCardAtomicRebuildService.repairDeterministicPaymentDuplicates(
      { account, cycles: [], transactions: [] },
      baseAudit
    );

    expect(mocks.rpc).toHaveBeenCalledWith(
      'repair_credit_card_payment_duplicates_atomic_v1',
      {
        p_account_id: account.id,
        p_expected_revision: 'a'.repeat(32),
        p_payment_row_ids: ['obsolete-payment-row'],
      }
    );
    expect(result).toEqual(
      expect.objectContaining({
        snapshotId: 'repair-snapshot',
        deletedPayments: 1,
        postRepairAudit,
      })
    );
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('conserva somente o grupo duplicado re-auditado e verifica a cardinalidade posterior', async () => {
    const expectedAudit = statementConservationAudit();
    const compositeStatement = {
      ...expectedAudit.persisted.statements[0],
      rowId: 'private-composite',
      referenceLabel: '2026-08',
    };
    const postAudit = statementConservationAudit({
      persisted: {
        ...expectedAudit.persisted,
        statements: [compositeStatement],
      },
      comparison: {
        ...expectedAudit.comparison,
        duplicatePersistedStatementKeys: [],
      },
      persistedRevision: 'b'.repeat(32),
    });

    vi.spyOn(
      creditCardAtomicRebuildService,
      'isStatementConservationEnabled'
    ).mockResolvedValue(true);
    vi.spyOn(creditCardAtomicRebuildService, 'audit')
      .mockResolvedValueOnce(expectedAudit)
      .mockResolvedValueOnce(postAudit);
    mocks.rpc.mockResolvedValueOnce({
      data: {
        snapshot_id: 'private-snapshot',
        before_revision: 'a'.repeat(32),
        after_revision: 'b'.repeat(32),
        source_statements: 2,
        entries_relinked: 1,
        legacy_items_relinked: 1,
        payments_relinked: 1,
      },
      error: null,
    });

    const result = await creditCardAtomicRebuildService.conserveDuplicateStatementGroup(
      { account, cycles: [], transactions: [] },
      expectedAudit,
      statementConservationPlan()
    );

    expect(mocks.rpc).toHaveBeenCalledWith(
      'conserve_credit_card_statement_duplicates_atomic_v1',
      expect.objectContaining({
        p_account_id: account.id,
        p_expected_revision: 'a'.repeat(32),
        p_shadow_checksum: 'shadow-v1-05712d54',
        p_statement_key: '2026-08',
        p_source_statement_ids: ['private-statement-a', 'private-statement-b'],
        p_expected_entry_link_count: 1,
        p_expected_payment_link_count: 1,
        p_composite: expect.objectContaining({
          statementKey: '2026-08',
          statementTotalCents: 44_990,
          totalPaymentsCents: 39_990,
          manualTotalsJson: { use_manual: true },
        }),
      })
    );
    expect(result).toEqual(expect.objectContaining({
      snapshotId: 'private-snapshot',
      sourceStatements: 2,
      compositeStatements: 1,
      entriesRelinked: 1,
      legacyItemsRelinked: 1,
      paymentsRelinked: 1,
      postConservationAudit: postAudit,
    }));
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('falha fechado antes do RPC quando a revisão mudou depois da auditoria exibida', async () => {
    const expectedAudit = statementConservationAudit();
    const changedAudit = statementConservationAudit({
      persistedRevision: 'b'.repeat(32),
    });
    vi.spyOn(
      creditCardAtomicRebuildService,
      'isStatementConservationEnabled'
    ).mockResolvedValue(true);
    vi.spyOn(creditCardAtomicRebuildService, 'audit').mockResolvedValueOnce(changedAudit);

    await expect(
      creditCardAtomicRebuildService.conserveDuplicateStatementGroup(
        { account, cycles: [], transactions: [] },
        expectedAudit,
        statementConservationPlan()
      )
    ).rejects.toThrow('mudou depois da auditoria exibida');

    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('mapeia o rollback de conservação sem executar mutações pelo cliente', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        snapshot_id: 'private-snapshot',
        account_id: account.id,
        restored_revision: 'a'.repeat(32),
        restored_statements: 2,
        restored_entries: 3,
        restored_legacy_items: 2,
        restored_payments: 1,
        rolled_back: true,
      },
      error: null,
    });

    await expect(
      creditCardAtomicRebuildService.rollbackStatementConservation('private-snapshot')
    ).resolves.toEqual({
      snapshotId: 'private-snapshot',
      accountId: account.id,
      restoredRevision: 'a'.repeat(32),
      restoredStatements: 2,
      restoredEntries: 3,
      restoredLegacyItems: 2,
      restoredPayments: 1,
      rolledBack: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'rollback_credit_card_statement_conservation_atomic_v1',
      { p_snapshot_id: 'private-snapshot' }
    );
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
