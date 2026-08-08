import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreditCardImportEntry, CreditCardStatement } from '../../src/domain/credit-card/types';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  ranges: [] as Array<[number, number]>,
}));

vi.mock('../../src/supabaseClient', () => ({
  supabase: { from: mocks.from },
}));

import { creditCardEngineService } from '../../src/services/creditCardEngineService';

const statements: CreditCardStatement[] = [
  {
    id: 'statement-july',
    cardId: 'card-a',
    accountId: 'account-a',
    purchaseReferenceLabel: '2026-07',
    dueYear: 2026,
    dueMonth: 7,
    dueDate: '2026-07-28',
    status: 'paid',
    sourceImportLotIds: [],
    totalPurchases: 399.9,
    totalFees: 0,
    totalInterest: 0,
    totalRefunds: 0,
    statementTotal: 399.9,
    totalPayments: 399.9,
    openBalance: 0,
  },
  {
    id: 'statement-august',
    cardId: 'card-a',
    accountId: 'account-a',
    purchaseReferenceLabel: '2026-08',
    dueYear: 2026,
    dueMonth: 8,
    dueDate: '2026-08-28',
    status: 'open',
    sourceImportLotIds: [],
    totalPurchases: 449.9,
    totalFees: 0,
    totalInterest: 0,
    totalRefunds: 0,
    statementTotal: 449.9,
    totalPayments: 0,
    openBalance: 449.9,
  },
];

const paymentEntry: CreditCardImportEntry = {
  sourceRowIndex: 4,
  sourceRowHash: 'hnew',
  postedDate: '2026-08-20',
  description: 'Pagamentos Validos',
  descriptionNormalized: 'pagamentos validos',
  amount: 399.9,
  absAmount: 399.9,
  direction: 'credit',
  entryType: 'invoice_payment',
  sourceFileName: '11_xp_cartao_fatura_agosto_2026.csv',
  classificationSource: 'system',
  classificationConfidence: 1,
  statementId: 'statement-august',
  transactionId: 'tx-payment',
};

function paymentTableBuilder(existingRows: unknown[], failFrom?: number) {
  let mode: 'read' | 'insert' | 'update' = 'read';
  let payload: Record<string, unknown> | null = null;
  const builder: Record<string, any> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.range = vi.fn(async (from: number, to: number) => {
    mocks.ranges.push([from, to]);
    if (from === failFrom) {
      return { data: null, error: { message: 'página indisponível' } };
    }
    return { data: existingRows.slice(from, to + 1), error: null };
  });
  builder.update = vi.fn((value: Record<string, unknown>) => {
    mode = 'update';
    payload = value;
    mocks.update(value);
    return builder;
  });
  builder.insert = vi.fn((value: Record<string, unknown>) => {
    mode = 'insert';
    payload = value;
    mocks.insert(value);
    return builder;
  });
  builder.single = vi.fn(async () => ({
    data: {
      id: mode === 'update' ? 'legacy-row' : 'inserted-row',
      payment_transaction_id: payload?.payment_transaction_id || null,
      notes: payload?.notes || null,
    },
    error: null,
  }));
  builder.then = (
    resolve: (value: { data: unknown[]; error: null }) => unknown,
    reject: (reason: unknown) => unknown
  ) => Promise.resolve({ data: existingRows, error: null }).then(resolve, reject);
  return builder;
}

describe('creditCardEngineService payment persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ranges.length = 0;
    vi.spyOn(creditCardEngineService, 'getCardStatements').mockResolvedValue(statements);
    vi.spyOn(creditCardEngineService, 'buildStatementTotalsMapForIds').mockResolvedValue(
      new Map([
        ['statement-july', 399.9],
        ['statement-august', 449.9],
      ])
    );
  });

  it('promove a linha anônima no mesmo registro em vez de inserir uma duplicata', async () => {
    mocks.from.mockImplementation(() =>
      paymentTableBuilder([
        {
          id: 'legacy-row',
          payment_transaction_id: null,
          notes:
            'hold · 11_xp_cartao_fatura_agosto_2026.csv · linha 4 · Pagamentos Validos',
        },
      ])
    );

    await creditCardEngineService.persistImportedInvoicePaymentsForPreviousStatement({
      userId: 'user-a',
      cardId: 'card-a',
      sourceFileName: paymentEntry.sourceFileName,
      dueYear: 2026,
      dueMonth: 8,
      classifiedEntries: [paymentEntry],
      inputRows: [{ sourceRowIndex: 4, transactionId: 'tx-payment' }],
    });

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        statement_id: 'statement-july',
        payment_transaction_id: 'tx-payment',
        amount: 399.9,
      })
    );
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('falha sem gravar quando o histórico já possui as duas projeções', async () => {
    mocks.from.mockImplementation(() =>
      paymentTableBuilder([
        {
          id: 'legacy-row',
          payment_transaction_id: null,
          notes:
            'hold · 11_xp_cartao_fatura_agosto_2026.csv · linha 4 · Pagamentos Validos',
        },
        {
          id: 'linked-row',
          payment_transaction_id: 'tx-payment',
          notes:
            'hnew · 11_xp_cartao_fatura_agosto_2026.csv · linha 4 · Pagamentos Validos',
        },
      ])
    );

    await expect(
      creditCardEngineService.persistImportedInvoicePaymentsForPreviousStatement({
        userId: 'user-a',
        cardId: 'card-a',
        sourceFileName: paymentEntry.sourceFileName,
        dueYear: 2026,
        dueMonth: 8,
        classifiedEntries: [paymentEntry],
        inputRows: [{ sourceRowIndex: 4, transactionId: 'tx-payment' }],
      })
    ).rejects.toThrow(/2 projeções.*nenhuma linha foi alterada/);

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('localiza a identidade após mil linhas sem aceitar uma página parcial', async () => {
    const irrelevantRows = Array.from({ length: 1000 }, (_, index) => ({
      id: `other-${String(index).padStart(4, '0')}`,
      payment_transaction_id: `other-tx-${index}`,
      notes: `h${index} · outro_arquivo.csv · linha ${index + 1} · Outro pagamento`,
    }));
    mocks.from.mockImplementation(() =>
      paymentTableBuilder([
        ...irrelevantRows,
        {
          id: 'legacy-row',
          payment_transaction_id: null,
          notes:
            'hold · 11_xp_cartao_fatura_agosto_2026.csv · linha 4 · Pagamentos Validos',
        },
      ])
    );

    await creditCardEngineService.persistImportedInvoicePaymentsForPreviousStatement({
      userId: 'user-a',
      cardId: 'card-a',
      sourceFileName: paymentEntry.sourceFileName,
      dueYear: 2026,
      dueMonth: 8,
      classifiedEntries: [paymentEntry],
      inputRows: [{ sourceRowIndex: 4, transactionId: 'tx-payment' }],
    });

    expect(mocks.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(mocks.update).toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('não grava se qualquer página da leitura de identidades falhar', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `other-${index}`,
      payment_transaction_id: `other-tx-${index}`,
      notes: `h${index} · outro_arquivo.csv · linha ${index + 1} · Outro pagamento`,
    }));
    mocks.from.mockImplementation(() => paymentTableBuilder(firstPage, 1000));

    await expect(
      creditCardEngineService.persistImportedInvoicePaymentsForPreviousStatement({
        userId: 'user-a',
        cardId: 'card-a',
        sourceFileName: paymentEntry.sourceFileName,
        dueYear: 2026,
        dueMonth: 8,
        classifiedEntries: [paymentEntry],
        inputRows: [{ sourceRowIndex: 4, transactionId: 'tx-payment' }],
      })
    ).rejects.toThrow(/página indisponível/);

    expect(mocks.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
