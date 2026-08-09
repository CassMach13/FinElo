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
    expect(result.persisted.entries[0]).toMatchObject({
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
});
