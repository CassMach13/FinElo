import { buildStatementAudit } from './audit';
import { assignEntriesToStatement } from './assignment';
import { classifyEntryType, ClassificationOverrides, ClassificationRules, inferDirection, normalizeDescription } from './classifiers';
import {
  getPreviousStatementRow,
  creditCardPaymentDuplicatesInList,
  creditCardPaymentMatchesImportEntry,
  inferStatusFromTotals,
  resolveImportedInvoicePaymentTarget,
  sumPaymentsForStatement,
} from './payments';
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

/**
 * Identidade estável do lançamento no extrato (como linha do arquivo ou ID da transação).
 * Valor, data e descrição podem mudar na UI sem criar outra linha no motor.
 */
export const buildStableSourceRowHash = (row: {
  sourceFileName: string;
  sourceRowIndex: number;
  transactionId?: string | null;
}): string => {
  const tid = row.transactionId?.trim();
  if (tid) return stableHash(`tx:${tid}`);
  return stableHash(`row:${row.sourceFileName}|${row.sourceRowIndex}`);
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
    transactionId?: string;
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
      const sourceRowHash = buildStableSourceRowHash({
        sourceFileName: input.sourceFileName,
        sourceRowIndex: row.sourceRowIndex,
        transactionId: row.transactionId,
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
    /** Compras/parcelas ainda «needs_review» (ex.: classificação pendente) não entravam em nenhuma soma → fatura subcontada vs XP */
    const unclassifiedDebitPurchases = round2(
      statementEntries
        .filter(
          (entry) => entry.entryType === 'needs_review' && inferDirection(entry.amount) === 'debit'
        )
        .reduce((acc, entry) => acc + Math.abs(entry.amount), 0)
    );
    const totalPurchases = round2(
      statementEntries
        .filter((entry) => entry.entryType === 'purchase' || entry.entryType === 'installment_purchase')
        .reduce((acc, entry) => acc + Math.abs(entry.amount), 0) + unclassifiedDebitPurchases
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
    const sortedAscPick = sorted.map((s) => ({ id: s.id, dueYear: s.dueYear, dueMonth: s.dueMonth }));

    const statementTotalsById = new Map<string, number>();
    sorted.forEach((st) => {
      const statementEntries = input.entriesByStatement.get(st.id) || [];
      const rec = this.recalculateStatement({
        statement: st,
        entries: statementEntries.map((entry) => ({ ...entry, statementId: st.id })),
        payments: [],
      });
      statementTotalsById.set(st.id, rec.statementTotal);
    });

    const paymentAssignments = new Map<string, CreditCardPayment[]>();
    input.payments.forEach((payment) => {
      const current = paymentAssignments.get(payment.statementId) || [];
      current.push({ ...payment });
      paymentAssignments.set(payment.statementId, current);
    });

    for (let i = 0; i < sorted.length - 1; i++) {
      const nextStatement = sorted[i + 1];
      const nextStatementEntries = input.entriesByStatement.get(nextStatement.id) || [];
      const invoicePaymentEntries = nextStatementEntries.filter(
        (entry) => entry.entryType === 'invoice_payment' && inferDirection(entry.amount) === 'credit'
      );

      const bucketNext = paymentAssignments.get(nextStatement.id) || [];
      const importedOnNext = bucketNext.filter((p) => p.source === 'imported_statement');
      const restOnNext = bucketNext.filter((p) => p.source !== 'imported_statement');
      paymentAssignments.set(nextStatement.id, restOnNext);

      if (importedOnNext.length === 0 && invoicePaymentEntries.length === 0) continue;

      const importPick = { dueYear: nextStatement.dueYear, dueMonth: nextStatement.dueMonth };

      for (const entry of invoicePaymentEntries) {
        const target = resolveImportedInvoicePaymentTarget(entry, invoicePaymentEntries, sortedAscPick, importPick, {
          statementTotalsById,
        });
        if (!target) continue;
        const assigned = paymentAssignments.get(target.id) || [];
        if (creditCardPaymentMatchesImportEntry(assigned, entry)) continue;
        assigned.push({
          cardId: nextStatement.cardId,
          statementId: target.id,
          paymentDate: entry.postedDate,
          amount: Math.abs(entry.amount),
          source: 'imported_statement',
          notes: `invoice_payment_entry:${entry.sourceRowHash}`,
        });
        paymentAssignments.set(target.id, assigned);
      }

      for (const payment of importedOnNext) {
        let target: { id: string } | null = null;
        if (invoicePaymentEntries.length < 2) {
          target = getPreviousStatementRow(sortedAscPick, importPick);
        } else {
          target = resolveImportedInvoicePaymentTarget(
            { postedDate: payment.paymentDate, amount: payment.amount },
            invoicePaymentEntries,
            sortedAscPick,
            importPick,
            { statementTotalsById }
          );
        }
        if (!target) continue;
        const assigned = paymentAssignments.get(target.id) || [];
        if (creditCardPaymentDuplicatesInList(assigned, payment)) continue;
        assigned.push({ ...payment, statementId: target.id });
        paymentAssignments.set(target.id, assigned);
      }
    }

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

