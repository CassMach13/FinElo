import { buildStatementAudit } from './audit';
import { assignEntriesToStatement, formatReferenceLabel, getNextReferenceLabel } from './assignment';
import { classifyEntryType, ClassificationOverrides, ClassificationRules, inferDirection, normalizeDescription } from './classifiers';
import { applyImportedPaymentFromNextStatement, inferStatusFromTotals, sumPaymentsForStatement } from './payments';
import {
  CreditCardImportEntry,
  CreditCardImportLotInput,
  CreditCardPayment,
  CreditCardStatement,
  CreditCardStatementAudit,
} from './types';

const round2 = (value: number): number => Math.round(value * 100) / 100;

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16)}`;
};

const rowHash = (row: {
  sourceFileName: string;
  sourceRowIndex: number;
  postedDate: string;
  description: string;
  amount: number;
}): string => {
  const source = `${row.sourceFileName}|${row.sourceRowIndex}|${row.postedDate}|${row.description}|${round2(row.amount)}`;
  return stableHash(source);
};

export interface NormalizeImportLotInput extends CreditCardImportLotInput {
  rows: Array<{
    sourceRowIndex: number;
    postedDate: string;
    description: string;
    holderName?: string;
    amount: number;
    installmentCurrent?: number;
    installmentTotal?: number;
    merchantName?: string;
  }>;
}

export interface NormalizeImportLotOutput {
  lot: CreditCardImportLotInput & { checksum: string };
  entries: CreditCardImportEntry[];
}

export interface RecalculateStatementInput {
  statement: CreditCardStatement;
  entries: CreditCardImportEntry[];
  payments: CreditCardPayment[];
}

export interface RecalculateCardHistoryInput {
  statements: CreditCardStatement[];
  entriesByStatement: Map<string, CreditCardImportEntry[]>;
  payments: CreditCardPayment[];
}

export const creditCardStatementEngine = {
  normalizeImportLot(input: NormalizeImportLotInput): NormalizeImportLotOutput {
    const entries = input.rows.map((row) => {
      const sourceRowHash = rowHash({
        sourceFileName: input.sourceFileName,
        sourceRowIndex: row.sourceRowIndex,
        postedDate: row.postedDate,
        description: row.description,
        amount: row.amount,
      });
      const normalized = normalizeDescription(row.description);
      const amount = round2(row.amount);
      return {
        sourceRowIndex: row.sourceRowIndex,
        postedDate: row.postedDate,
        description: row.description,
        holderName: row.holderName,
        amount,
        installmentCurrent: row.installmentCurrent,
        installmentTotal: row.installmentTotal,
        merchantName: row.merchantName,
        sourceRowHash,
        descriptionNormalized: normalized,
        direction: inferDirection(amount),
        absAmount: Math.abs(amount),
        entryType: 'needs_review',
        classificationSource: 'system',
        classificationConfidence: 0,
        sourceFileName: input.sourceFileName,
      } satisfies CreditCardImportEntry;
    });

    const checksum = stableHash(entries.map((e) => e.sourceRowHash).join('|'));

    return {
      lot: {
        userId: input.userId,
        cardId: input.cardId,
        accountId: input.accountId,
        sourceFileName: input.sourceFileName,
        statementDueYear: input.statementDueYear,
        statementDueMonth: input.statementDueMonth,
        statementDueDate: input.statementDueDate || null,
        purchaseReferenceLabel: input.purchaseReferenceLabel || null,
        checksum,
      },
      entries,
    };
  },

  classifyEntries(
    entries: CreditCardImportEntry[],
    rules?: ClassificationRules,
    overrides?: ClassificationOverrides
  ): CreditCardImportEntry[] {
    return entries.map((entry) => {
      const result = classifyEntryType(entry, rules, overrides);
      return {
        ...entry,
        entryType: result.entryType,
        classificationSource: result.classificationSource,
        classificationConfidence: result.classificationConfidence,
      };
    });
  },

  assignEntriesToStatement(
    entries: CreditCardImportEntry[],
    statement: Pick<CreditCardStatement, 'id' | 'dueYear' | 'dueMonth'>
  ): CreditCardImportEntry[] {
    return assignEntriesToStatement(entries, {
      dueYear: statement.dueYear,
      dueMonth: statement.dueMonth,
      statementId: statement.id,
    });
  },

  recalculateStatement(input: RecalculateStatementInput): CreditCardStatement {
    const statementEntries = input.entries.filter((entry) => entry.statementId === input.statement.id);
    const totalPurchases = round2(
      statementEntries
        .filter((entry) => entry.entryType === 'purchase' || entry.entryType === 'installment_purchase')
        .reduce((acc, entry) => acc + Math.abs(entry.amount), 0)
    );
    const totalFees = round2(
      statementEntries
        .filter((entry) => entry.entryType === 'fee')
        .reduce((acc, entry) => acc + Math.abs(entry.amount), 0)
    );
    const totalInterest = round2(
      statementEntries
        .filter((entry) => entry.entryType === 'interest')
        .reduce((acc, entry) => acc + Math.abs(entry.amount), 0)
    );
    const totalRefundsExplicit = round2(
      statementEntries
        .filter((entry) => entry.entryType === 'refund' || entry.entryType === 'adjustment')
        .reduce((acc, entry) => acc + Math.abs(entry.amount), 0)
    );
    /** Histórico: créditos ainda marcados como needs_review não entravam em nenhuma soma → fatura inflada vs banco */
    const unclassifiedCredits = round2(
      statementEntries
        .filter(
          (entry) =>
            entry.entryType === 'needs_review' &&
            entry.amount > 0 &&
            inferDirection(entry.amount) === 'credit'
        )
        .reduce((acc, entry) => acc + Math.abs(entry.amount), 0)
    );
    const totalRefunds = round2(totalRefundsExplicit + unclassifiedCredits);

    const statementTotal = round2(totalPurchases + totalFees + totalInterest - totalRefunds);
    const totalPayments = sumPaymentsForStatement(input.payments, input.statement.id);
    const openBalance = round2(Math.max(statementTotal - totalPayments, 0));
    const status = inferStatusFromTotals(statementTotal, totalPayments, input.statement.dueDate);

    return {
      ...input.statement,
      totalPurchases,
      totalFees,
      totalInterest,
      totalRefunds,
      statementTotal,
      totalPayments,
      openBalance,
      status,
    };
  },

  recalculateCardHistory(input: RecalculateCardHistoryInput): CreditCardStatement[] {
    const sorted = [...input.statements].sort((a, b) => {
      if (a.dueYear !== b.dueYear) return a.dueYear - b.dueYear;
      return a.dueMonth - b.dueMonth;
    });
    const statementsByReference = new Map<string, CreditCardStatement>(
      sorted.map((statement) => [formatReferenceLabel(statement.dueYear, statement.dueMonth), statement])
    );

    const paymentAssignments = new Map<string, CreditCardPayment[]>();
    input.payments.forEach((payment) => {
      const current = paymentAssignments.get(payment.statementId) || [];
      current.push(payment);
      paymentAssignments.set(payment.statementId, current);
    });

    // Rule: imported payment observed in N+1 should apply to N.
    sorted.forEach((statement) => {
      const currentReference = formatReferenceLabel(statement.dueYear, statement.dueMonth);
      const nextReference = getNextReferenceLabel(currentReference);
      const nextStatement = statementsByReference.get(nextReference);
      if (!nextStatement) return;

      const nextStatementPayments = input.payments.filter(
        (payment) => payment.statementId === nextStatement.id && payment.source === 'imported_statement'
      );

      const nextStatementEntries = input.entriesByStatement.get(nextStatement.id) || [];
      const nextStatementEntryInvoicePayments = nextStatementEntries.filter(
        (entry) =>
          entry.entryType === 'invoice_payment' && inferDirection(entry.amount) === 'credit'
      );

      if (nextStatementPayments.length === 0 && nextStatementEntryInvoicePayments.length === 0) return;

      const targetStatement = applyImportedPaymentFromNextStatement(statementsByReference, nextReference);
      if (!targetStatement || targetStatement.id !== statement.id) return;

      const assigned = paymentAssignments.get(statement.id) || [];
      const syntheticFromEntries: CreditCardPayment[] = nextStatementEntryInvoicePayments.map((entry) => ({
        cardId: nextStatement.cardId,
        statementId: statement.id,
        paymentDate: entry.postedDate,
        amount: Math.abs(entry.amount),
        source: 'imported_statement',
        notes: `invoice_payment_entry:${entry.sourceRowHash}`,
      }));

      paymentAssignments.set(statement.id, [
        ...assigned,
        ...nextStatementPayments.map((payment) => ({
          ...payment,
          statementId: statement.id,
        })),
        ...syntheticFromEntries,
      ]);
    });

    return sorted.map((statement) => {
      const statementEntries = input.entriesByStatement.get(statement.id) || [];
      const payments = paymentAssignments.get(statement.id) || [];
      return this.recalculateStatement({
        statement,
        entries: statementEntries.map((entry) => ({ ...entry, statementId: statement.id })),
        payments,
      });
    });
  },

  getStatementAudit(
    statement: CreditCardStatement,
    importEntries: CreditCardImportEntry[],
    statementEntries: CreditCardImportEntry[]
  ): CreditCardStatementAudit {
    return buildStatementAudit({
      statement,
      importEntries,
      statementEntries,
    });
  },
};

