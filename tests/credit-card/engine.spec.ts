import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyEntryType, normalizeDescription } from '../../src/domain/credit-card/classifiers';
import { creditCardStatementEngine } from '../../src/domain/credit-card/creditCardStatementEngine';
import {
  mergePaymentsWithInvoiceLinesFromFutureStatements,
  mergePaymentsWithInvoiceLinesFromNextStatement,
  resolveImportedInvoicePaymentTarget,
} from '../../src/domain/credit-card/payments';
import type { CreditCardImportEntry, CreditCardPayment, CreditCardStatement } from '../../src/domain/credit-card/types';

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

  it('conta lançamentos needs_review em débito no total da fatura (evita subtotal quando há revisão pendente)', () => {
    const janStatement: CreditCardStatement = {
      id: 'st-jan-2026',
      cardId: 'card-xp',
      accountId: 'acc-xp',
      purchaseReferenceLabel: '2025-12',
      dueYear: 2026,
      dueMonth: 1,
      dueDate: '2026-01-10',
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
    const entries: CreditCardImportEntry[] = [
      {
        sourceRowIndex: 1,
        sourceRowHash: 'ha',
        postedDate: '2025-12-01',
        description: 'Compra A',
        descriptionNormalized: 'compra a',
        amount: -6226.66,
        absAmount: 6226.66,
        direction: 'debit',
        entryType: 'purchase',
        classificationSource: 'system',
        classificationConfidence: 0.9,
        sourceFileName: 'Cassio_Jan_2026.csv',
        statementId: janStatement.id,
      },
      {
        sourceRowIndex: 1,
        sourceRowHash: 'hb',
        postedDate: '2025-10-13',
        description: 'MP*LOJAMIRANTE',
        descriptionNormalized: 'mp*lojamirante',
        amount: -77.8,
        absAmount: 77.8,
        direction: 'debit',
        entryType: 'needs_review',
        classificationSource: 'system',
        classificationConfidence: 0,
        sourceFileName: 'Ione_Jan_2026.csv',
        statementId: janStatement.id,
      },
    ];
    const rec = creditCardStatementEngine.recalculateStatement({
      statement: janStatement,
      entries,
      payments: [],
    });
    expect(rec.statementTotal).toBeCloseTo(6304.46, 2);
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

  it('histórico: dois Pagamento de fatura no mesmo CSV direciona cada valor pela data civil', () => {
    const novStatement: CreditCardStatement = {
      id: 'st-nov',
      cardId: 'card-x',
      accountId: 'acc',
      purchaseReferenceLabel: '2025-10',
      dueYear: 2025,
      dueMonth: 11,
      dueDate: '2025-11-10',
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
    const decStatement: CreditCardStatement = {
      ...novStatement,
      id: 'st-dec',
      dueYear: 2025,
      dueMonth: 12,
      purchaseReferenceLabel: '2025-11',
    };
    const entriesByStatement = new Map<string, CreditCardImportEntry[]>();
    entriesByStatement.set('st-nov', []);
    entriesByStatement.set('st-dec', [
      {
        sourceRowIndex: 2,
        sourceRowHash: 'h-pay-nov',
        postedDate: '2025-11-01',
        description: 'Pagamento de fatura',
        descriptionNormalized: normalizeDescription('Pagamento de fatura'),
        amount: 77.82,
        absAmount: 77.82,
        direction: 'credit',
        entryType: 'invoice_payment',
        sourceFileName: 'Fatura_Dez_2025.csv',
        classificationSource: 'system',
        classificationConfidence: 0.95,
        statementId: 'st-dec',
      },
      {
        sourceRowIndex: 3,
        sourceRowHash: 'h-pay-dec',
        postedDate: '2025-12-01',
        description: 'Pagamento de fatura',
        descriptionNormalized: normalizeDescription('Pagamento de fatura'),
        amount: 77.8,
        absAmount: 77.8,
        direction: 'credit',
        entryType: 'invoice_payment',
        sourceFileName: 'Fatura_Dez_2025.csv',
        classificationSource: 'system',
        classificationConfidence: 0.95,
        statementId: 'st-dec',
      },
    ]);

    const recalculated = creditCardStatementEngine.recalculateCardHistory({
      statements: [novStatement, decStatement],
      entriesByStatement,
      payments: [],
    });
    const nov = recalculated.find((s) => s.id === 'st-nov');
    const dec = recalculated.find((s) => s.id === 'st-dec');
    expect(nov?.totalPayments).toBeCloseTo(77.82, 2);
    expect(dec?.totalPayments).toBeCloseTo(77.8, 2);
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

describe('resolveImportedInvoicePaymentTarget (pagamento único)', () => {
  const baseSibling = {
    sourceRowHash: 'hx',
    description: 'Pagamentos Validos Normais',
    descriptionNormalized: normalizeDescription('Pagamentos Validos Normais'),
    amount: 100,
    absAmount: 100,
    direction: 'credit' as const,
    entryType: 'invoice_payment' as const,
    classificationSource: 'system' as const,
    classificationConfidence: 0.95,
    sourceFileName: 'x.csv',
    sourceRowIndex: 1,
  };

  it('CSV mar/2025 com única linha em fev liquida março (antecipação no mesmo PDF)', () => {
    const sorted = [
      { id: 'st-fev', dueYear: 2025, dueMonth: 2 },
      { id: 'st-mar', dueYear: 2025, dueMonth: 3 },
      { id: 'st-apr', dueYear: 2025, dueMonth: 4 },
    ];
    const sibling = {
      ...baseSibling,
      postedDate: '2025-02-10',
    };
    const t = resolveImportedInvoicePaymentTarget(sibling, [sibling], sorted, { dueYear: 2025, dueMonth: 3 });
    expect(t?.id).toBe('st-mar');
  });

  it('CSV fev/2025 com linha em fev continua liquidando janeiro (XP clássico)', () => {
    const sorted = [
      { id: 'st-jan', dueYear: 2025, dueMonth: 1 },
      { id: 'st-fev', dueYear: 2025, dueMonth: 2 },
    ];
    const sibling = {
      ...baseSibling,
      postedDate: '2025-02-10',
    };
    const t = resolveImportedInvoicePaymentTarget(sibling, [sibling], sorted, { dueYear: 2025, dueMonth: 2 });
    expect(t?.id).toBe('st-jan');
  });

  it('pagamento único em nov no CSV de dez: sem totais vai para dez; com totais escolhe nov se o valor casa melhor', () => {
    const sorted = [
      { id: 'stmt-nov', dueYear: 2025, dueMonth: 11 },
      { id: 'stmt-dec', dueYear: 2025, dueMonth: 12 },
    ];
    const sibling = {
      ...baseSibling,
      postedDate: '2025-11-10',
      amount: 4532.91,
    };
    const importPick = { dueYear: 2025, dueMonth: 12 };

    const semMapa = resolveImportedInvoicePaymentTarget(sibling, [sibling], sorted, importPick);
    expect(semMapa?.id).toBe('stmt-dec');

    const totals = new Map<string, number>([
      ['stmt-nov', 4610.73],
      ['stmt-dec', 120.5],
    ]);
    const comMapa = resolveImportedInvoicePaymentTarget(sibling, [sibling], sorted, importPick, {
      statementTotalsById: totals,
    });
    expect(comMapa?.id).toBe('stmt-nov');
  });
});

describe('mergePaymentsWithInvoiceLinesFromNextStatement', () => {
  const stmtsDecJan2026 = [
    { id: 'stmt-dec', dueYear: 2025, dueMonth: 12 },
    { id: 'stmt-jan', dueYear: 2026, dueMonth: 1 },
  ];
  const janImportPick = { dueYear: 2026, dueMonth: 1 };

  const janInvoicePaymentEntry = {
    sourceRowIndex: 5,
    sourceRowHash: 'pay-hash-xp',
    postedDate: '2026-01-12',
    description: 'Pagamentos Validos Normais',
    descriptionNormalized: normalizeDescription('Pagamentos Validos Normais'),
    amount: 5935.31,
    absAmount: 5935.31,
    direction: 'credit' as const,
    entryType: 'invoice_payment' as const,
    classificationSource: 'system' as const,
    classificationConfidence: 0.95,
    sourceFileName: 'Fatura_Jan_2026.csv',
    transactionId: 'tx-999',
    merchantName: undefined,
    holderName: undefined,
    installmentCurrent: undefined,
    installmentTotal: undefined,
    statementId: 'stmt-jan',
  };

  it('injeta pagamento sintético a partir das linhas invoice_payment da fatura seguinte', () => {
    const merged = mergePaymentsWithInvoiceLinesFromNextStatement(
      { id: 'stmt-dec', cardId: 'card-1', dueYear: 2025, dueMonth: 12 },
      [],
      [janInvoicePaymentEntry],
      stmtsDecJan2026,
      janImportPick
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].amount).toBeCloseTo(5935.31, 2);
    expect(merged[0].statementId).toBe('stmt-dec');
    expect(merged[0].notes).toContain('synthetic_next_statement_entry');
  });

  it('não duplica pagamento persistido + sintético com o mesmo sourceRowHash nas notas', () => {
    const direct: CreditCardPayment[] = [
      {
        cardId: 'card-1',
        statementId: 'stmt-dec',
        paymentDate: '2026-01-12',
        amount: 5935.31,
        source: 'imported_statement',
        notes: 'pay-hash-xp · Fatura_Jan_2026.csv · linha 5 · Pagamentos',
      },
    ];
    const merged = mergePaymentsWithInvoiceLinesFromNextStatement(
      { id: 'stmt-dec', cardId: 'card-1', dueYear: 2025, dueMonth: 12 },
      direct,
      [janInvoicePaymentEntry],
      stmtsDecJan2026,
      janImportPick
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].notes).toContain('Fatura_Jan');
  });

  it('com duas linhas invoice_payment no mesmo CSV, usa mês civil da data para competência (nov vs dez)', () => {
    const stmtsNovDec = [
      { id: 'stmt-nov', dueYear: 2025, dueMonth: 11 },
      { id: 'stmt-dec', dueYear: 2025, dueMonth: 12 },
    ];
    const decImportPick = { dueYear: 2025, dueMonth: 12 };
    const payNov = {
      ...janInvoicePaymentEntry,
      sourceRowHash: 'pay-nov',
      postedDate: '2025-11-01',
      amount: 77.82,
      absAmount: 77.82,
      sourceRowIndex: 2,
      description: 'Pagamento de fatura',
      descriptionNormalized: normalizeDescription('Pagamento de fatura'),
      statementId: 'stmt-dec',
      transactionId: undefined,
    };
    const payDec = {
      ...payNov,
      sourceRowHash: 'pay-dec',
      postedDate: '2025-12-01',
      amount: 77.8,
      absAmount: 77.8,
      sourceRowIndex: 3,
    };
    const entries = [payNov, payDec];

    const mergedNov = mergePaymentsWithInvoiceLinesFromNextStatement(
      { id: 'stmt-nov', cardId: 'card-1', dueYear: 2025, dueMonth: 11 },
      [],
      entries,
      stmtsNovDec,
      decImportPick
    );
    expect(mergedNov).toHaveLength(1);
    expect(mergedNov[0].amount).toBeCloseTo(77.82, 2);
    expect(mergedNov[0].statementId).toBe('stmt-nov');

    const mergedDec = mergePaymentsWithInvoiceLinesFromNextStatement(
      { id: 'stmt-dec', cardId: 'card-1', dueYear: 2025, dueMonth: 12 },
      [],
      entries,
      stmtsNovDec,
      decImportPick
    );
    expect(mergedDec).toHaveLength(1);
    expect(mergedDec[0].amount).toBeCloseTo(77.8, 2);
    expect(mergedDec[0].statementId).toBe('stmt-dec');
  });
});

describe('mergePaymentsWithInvoiceLinesFromFutureStatements', () => {
  it('liga invoice_payment do extrato N+2 pelo saldo remanescente da competência mais antiga', () => {
    const sorted = [
      { id: 'st-dec', dueYear: 2025, dueMonth: 12 },
      { id: 'st-jan', dueYear: 2026, dueMonth: 1 },
      { id: 'st-fev', dueYear: 2026, dueMonth: 2 },
    ];
    const decStmt = { id: 'st-dec', cardId: 'c1', dueYear: 2025, dueMonth: 12 };
    const janImport = { id: 'st-jan', dueYear: 2026, dueMonth: 1 };
    const febImport = { id: 'st-fev', dueYear: 2026, dueMonth: 2 };

    const totals = new Map<string, number>([
      ['st-dec', 6304.46],
      ['st-jan', 0],
      ['st-fev', 0],
    ]);

    const directOnDec: CreditCardPayment[] = [
      { cardId: 'c1', statementId: 'st-dec', paymentDate: '2026-01-12', amount: 77.8, source: 'imported_statement' },
    ];

    const febEntry: CreditCardImportEntry = {
      sourceRowIndex: 1,
      sourceRowHash: 'hpay-fev',
      postedDate: '2026-01-12',
      description: 'Pagamentos Validos Normais',
      descriptionNormalized: normalizeDescription('Pagamentos Validos Normais'),
      amount: 6226.66,
      absAmount: 6226.66,
      direction: 'credit',
      entryType: 'invoice_payment',
      classificationSource: 'system',
      classificationConfidence: 0.95,
      sourceFileName: 'Fatura_Fev_2026.csv',
      statementId: 'st-fev',
    };

    const merged = mergePaymentsWithInvoiceLinesFromFutureStatements(
      decStmt,
      directOnDec,
      [...directOnDec],
      [
        { importStatement: janImport, entries: [] },
        { importStatement: febImport, entries: [febEntry] },
      ],
      sorted,
      totals
    );

    expect(merged).toHaveLength(2);
    const synth = merged.find((p) => p.amount === 6226.66);
    expect(synth?.statementId).toBe('st-dec');
    expect(synth?.notes).toContain('synthetic_next_statement_entry');
  });
});
