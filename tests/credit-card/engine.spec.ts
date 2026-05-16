import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyEntryType, normalizeDescription } from '../../src/domain/credit-card/classifiers';
import { creditCardStatementEngine } from '../../src/domain/credit-card/creditCardStatementEngine';
import { mergePaymentsWithInvoiceLinesFromNextStatement } from '../../src/domain/credit-card/payments';

interface CsvRow {
  date: string;
  description: string;
  amount: number;
  holder: string;
}

const parseFixture = (fileName: string): CsvRow[] => {
  const raw = readFileSync(join(process.cwd(), 'tests/credit-card', fileName), 'utf-8')
    .trim()
    .split('\n');
  const rows = raw.slice(1);
  return rows.map((line) => {
    const [date, description, amount, holder] = line.split(',');
    return { date, description, amount: Number(amount), holder };
  });
};

describe('creditCardStatementEngine', () => {
  it('mantém a linha R$49,76 na fatura Jan/2025 e fecha total R$6.052,63', () => {
    const cassioRows = parseFixture('cassio-jan-2025.fixture.csv');
    const normalized = creditCardStatementEngine.normalizeImportLot({
      userId: 'u1',
      cardId: 'card-cassio',
      accountId: 'acc-cassio',
      sourceFileName: 'Fatura_Cartao_XP_Cassio_Jan_2025.csv',
      statementDueYear: 2025,
      statementDueMonth: 1,
      statementDueDate: '2025-01-10',
      purchaseReferenceLabel: '2024-12',
      rows: cassioRows.map((row, index) => ({
        sourceRowIndex: index + 1,
        postedDate: row.date,
        description: row.description,
        holderName: row.holder,
        amount: row.amount,
      })),
    });

    const classified = creditCardStatementEngine.classifyEntries(normalized.entries);
    const janStatement: CreditCardStatement = {
      id: 'st-jan-2025-cassio',
      cardId: 'card-cassio',
      accountId: 'acc-cassio',
      purchaseReferenceLabel: '2024-12',
      dueYear: 2025,
      dueMonth: 1,
      dueDate: '2025-01-10',
      status: 'open',
      sourceImportLotIds: ['lot-jan-cassio'],
      totalPurchases: 0,
      totalFees: 0,
      totalInterest: 0,
      totalRefunds: 0,
      statementTotal: 0,
      totalPayments: 0,
      openBalance: 0,
    };
    const assigned = creditCardStatementEngine.assignEntriesToStatement(classified, janStatement);
    const recalculated = creditCardStatementEngine.recalculateStatement({
      statement: janStatement,
      entries: assigned,
      payments: [],
    });

    const targetRow = assigned.find((entry) => Math.abs(entry.absAmount - 49.76) < 0.001);
    expect(targetRow).toBeTruthy();
    expect(targetRow?.entryType).toBe('purchase');
    expect(targetRow?.sourceFileName).toContain('Cassio');

    expect(assigned.every((entry) => entry.statementId === janStatement.id)).toBe(true);
    expect(recalculated.statementTotal).toBe(6052.63);
    expect(recalculated.statementTotal).not.toBe(6002.87);
  });

  it('aplica pagamento importado em N+1 na fatura N', () => {
    const janStatement: CreditCardStatement = {
      id: 'st-jan',
      cardId: 'card-cassio',
      accountId: 'acc-cassio',
      purchaseReferenceLabel: '2024-12',
      dueYear: 2025,
      dueMonth: 1,
      dueDate: '2025-01-10',
      status: 'open',
      sourceImportLotIds: ['lot-jan'],
      totalPurchases: 0,
      totalFees: 0,
      totalInterest: 0,
      totalRefunds: 0,
      statementTotal: 0,
      totalPayments: 0,
      openBalance: 0,
    };
    const febStatement: CreditCardStatement = {
      ...janStatement,
      id: 'st-fev',
      dueYear: 2025,
      dueMonth: 2,
      purchaseReferenceLabel: '2025-01',
      sourceImportLotIds: ['lot-fev'],
    };

    const entriesByStatement = new Map<string, any[]>();
    entriesByStatement.set('st-jan', [
      {
        sourceRowIndex: 1,
        sourceRowHash: 'h1',
        postedDate: '2024-12-03',
        description: 'COMPRA SUPERMERCADO',
        descriptionNormalized: 'compra supermercado',
        amount: -6052.63,
        absAmount: 6052.63,
        direction: 'debit',
        entryType: 'purchase',
        sourceFileName: 'Fatura_Cartao_XP_Cassio_Jan_2025.csv',
        classificationSource: 'system',
        classificationConfidence: 0.9,
        statementId: 'st-jan',
      },
    ]);
    entriesByStatement.set('st-fev', []);

    const payments: CreditCardPayment[] = [
      {
        cardId: 'card-cassio',
        statementId: 'st-fev',
        paymentDate: '2025-02-10',
        amount: 6052.63,
        source: 'imported_statement',
      },
    ];

    const recalculated = creditCardStatementEngine.recalculateCardHistory({
      statements: [janStatement, febStatement],
      entriesByStatement,
      payments,
    });
    const jan = recalculated.find((statement) => statement.id === 'st-jan');

    expect(jan?.statementTotal).toBe(6052.63);
    expect(jan?.totalPayments).toBe(6052.63);
    expect(jan?.openBalance).toBe(0);
    expect(jan?.status).toBe('paid');
  });

  it('aplica linha invoice_payment do CSV seguinte como pagamento na fatura N (sem linha em credit_card_payments no teste)', () => {
    const janStatement: CreditCardStatement = {
      id: 'st-jan',
      cardId: 'card-cassio',
      accountId: 'acc-cassio',
      purchaseReferenceLabel: '2024-12',
      dueYear: 2025,
      dueMonth: 1,
      dueDate: '2025-01-10',
      status: 'open',
      sourceImportLotIds: ['lot-jan'],
      totalPurchases: 0,
      totalFees: 0,
      totalInterest: 0,
      totalRefunds: 0,
      statementTotal: 0,
      totalPayments: 0,
      openBalance: 0,
    };
    const febStatement: CreditCardStatement = {
      ...janStatement,
      id: 'st-fev',
      dueYear: 2025,
      dueMonth: 2,
      purchaseReferenceLabel: '2025-01',
      sourceImportLotIds: ['lot-fev'],
    };

    const entriesByStatement = new Map<string, CreditCardImportEntry[]>();
    entriesByStatement.set('st-jan', [
      {
        sourceRowIndex: 1,
        sourceRowHash: 'h-purchase',
        postedDate: '2024-12-03',
        description: 'COMPRA SUPERMERCADO',
        descriptionNormalized: 'compra supermercado',
        amount: -6052.63,
        absAmount: 6052.63,
        direction: 'debit',
        entryType: 'purchase',
        sourceFileName: 'Fatura_Cartao_XP_Cassio_Jan_2025.csv',
        classificationSource: 'system',
        classificationConfidence: 0.9,
        statementId: 'st-jan',
      },
    ]);
    entriesByStatement.set('st-fev', [
      {
        sourceRowIndex: 1,
        sourceRowHash: 'h-pay',
        postedDate: '2025-02-10',
        description: 'Pagamentos Validos Normais',
        descriptionNormalized: normalizeDescription('Pagamentos Validos Normais'),
        amount: 6052.63,
        absAmount: 6052.63,
        direction: 'credit',
        entryType: 'invoice_payment',
        sourceFileName: 'Fatura_Cartao_XP_Cassio_Fev_2025.csv',
        classificationSource: 'system',
        classificationConfidence: 0.95,
        statementId: 'st-fev',
      },
    ]);

    const recalculated = creditCardStatementEngine.recalculateCardHistory({
      statements: [janStatement, febStatement],
      entriesByStatement,
      payments: [],
    });
    const jan = recalculated.find((statement) => statement.id === 'st-jan');

    expect(jan?.statementTotal).toBe(6052.63);
    expect(jan?.totalPayments).toBe(6052.63);
    expect(jan?.openBalance).toBe(0);
    expect(jan?.status).toBe('paid');
  });

  it('não mistura entradas de Ione na fatura Cassio', () => {
    const cassioRows = parseFixture('cassio-jan-2025.fixture.csv');
    const ioneRows = parseFixture('ione-jan-2025.fixture.csv');

    const cassioNormalized = creditCardStatementEngine.normalizeImportLot({
      userId: 'u1',
      cardId: 'card-cassio',
      accountId: 'acc-cassio',
      sourceFileName: 'Fatura_Cartao_XP_Cassio_Jan_2025.csv',
      statementDueYear: 2025,
      statementDueMonth: 1,
      rows: cassioRows.map((row, index) => ({
        sourceRowIndex: index + 1,
        postedDate: row.date,
        description: row.description,
        holderName: row.holder,
        amount: row.amount,
      })),
    });
    const ioneNormalized = creditCardStatementEngine.normalizeImportLot({
      userId: 'u1',
      cardId: 'card-ione',
      accountId: 'acc-ione',
      sourceFileName: 'Fatura_Cartao_XP_Ione_Jan_2025.csv',
      statementDueYear: 2025,
      statementDueMonth: 1,
      rows: ioneRows.map((row, index) => ({
        sourceRowIndex: index + 1,
        postedDate: row.date,
        description: row.description,
        holderName: row.holder,
        amount: row.amount,
      })),
    });

    const cassioHashes = new Set(cassioNormalized.entries.map((entry) => entry.sourceRowHash));
    const ioneHashes = new Set(ioneNormalized.entries.map((entry) => entry.sourceRowHash));
    let overlap = false;
    cassioHashes.forEach((hash) => {
      if (ioneHashes.has(hash)) overlap = true;
    });
    expect(overlap).toBe(false);
  });

  it('crédito needs_review legado reduz statementTotal como abatimento (estorno fora das keywords)', () => {
    const st: CreditCardStatement = {
      id: 'st-estorno',
      cardId: 'c1',
      accountId: 'a1',
      purchaseReferenceLabel: '2026-04',
      dueYear: 2026,
      dueMonth: 5,
      dueDate: '2026-05-10',
      status: 'open',
      sourceImportLotIds: [],
      totalPurchases: 0,
      totalFees: 0,
      totalInterest: 0,
      totalRefunds: 0,
      statementTotal: 0,
      totalPayments: 0,
      openBalance: 0,
    };
    const base = {
      sourceRowHash: 'h1',
      sourceFileName: 'Fatura_Test.csv',
      classificationSource: 'system' as const,
      merchantName: undefined,
      holderName: '',
    };
    const entries: CreditCardImportEntry[] = [
      {
        ...base,
        sourceRowIndex: 1,
        postedDate: '2026-04-09',
        description: 'COMPRA',
        descriptionNormalized: 'compra',
        amount: -6436.77,
        absAmount: 6436.77,
        direction: 'debit',
        entryType: 'purchase',
        classificationConfidence: 0.8,
        statementId: st.id,
      },
      {
        ...base,
        sourceRowHash: 'h2',
        sourceRowIndex: 2,
        postedDate: '2026-04-09',
        description: 'SHOPEE *HAISHOPLAMPADA',
        descriptionNormalized: 'shopee *haishoplampada',
        amount: 33.8,
        absAmount: 33.8,
        direction: 'credit',
        entryType: 'needs_review',
        classificationConfidence: 0.2,
        statementId: st.id,
      },
    ];

    const r = creditCardStatementEngine.recalculateStatement({
      statement: st,
      entries,
      payments: [],
    });

    expect(r.totalRefunds).toBeCloseTo(33.8, 2);
    expect(r.statementTotal).toBeCloseTo(6436.77 - 33.8, 2);
  });

  it('classificação: Pagamentos Validos Normais XP vira invoice_payment', () => {
    const r = classifyEntryType({
      amount: 5935.31,
      descriptionNormalized: normalizeDescription('Pagamentos Validos Normais'),
      sourceRowHash: 'hx',
      installmentTotal: undefined,
    });
    expect(r.entryType).toBe('invoice_payment');
  });
});

describe('mergePaymentsWithInvoiceLinesFromNextStatement', () => {
  it('injeta pagamento sintético a partir das linhas invoice_payment da fatura seguinte', () => {
    const merged = mergePaymentsWithInvoiceLinesFromNextStatement(
      { id: 'stmt-dec', cardId: 'card-1' },
      [],
      [
        {
          sourceRowIndex: 5,
          sourceRowHash: 'pay-hash-xp',
          postedDate: '2026-01-12',
          description: 'Pagamentos Validos Normais',
          descriptionNormalized: normalizeDescription('Pagamentos Validos Normais'),
          amount: 5935.31,
          absAmount: 5935.31,
          direction: 'credit',
          entryType: 'invoice_payment',
          classificationSource: 'system',
          classificationConfidence: 0.95,
          sourceFileName: 'Fatura_Jan_2026.csv',
          transactionId: 'tx-999',
          merchantName: undefined,
          holderName: undefined,
          installmentCurrent: undefined,
          installmentTotal: undefined,
          statementId: 'stmt-jan',
        },
      ]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].amount).toBeCloseTo(5935.31, 2);
    expect(merged[0].statementId).toBe('stmt-dec');
    expect(merged[0].notes).toContain('synthetic_next_statement_entry');
  });

  it('evita duplicar quando já existe pagamento com o mesmo hash nas notas', () => {
    const direct: CreditCardPayment[] = [
      {
        cardId: 'card-1',
        statementId: 'stmt-dec',
        paymentDate: '2026-01-10',
        amount: 5935.31,
        source: 'imported_statement',
        notes: 'pay-hash-xp · Fatura_Jan_2026.csv',
      },
    ];
    const merged = mergePaymentsWithInvoiceLinesFromNextStatement(
      { id: 'stmt-dec', cardId: 'card-1' },
      direct,
      [
        {
          sourceRowIndex: 5,
          sourceRowHash: 'pay-hash-xp',
          postedDate: '2026-01-12',
          description: 'Pagamentos Validos Normais',
          descriptionNormalized: normalizeDescription('Pagamentos Validos Normais'),
          amount: 5935.31,
          absAmount: 5935.31,
          direction: 'credit',
          entryType: 'invoice_payment',
          classificationSource: 'system',
          classificationConfidence: 0.95,
          sourceFileName: 'Fatura_Jan_2026.csv',
          transactionId: 'tx-999',
          merchantName: undefined,
          holderName: undefined,
          installmentCurrent: undefined,
          installmentTotal: undefined,
          statementId: 'stmt-jan',
        },
      ]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].notes).toContain('Fatura_Jan');
  });
});
