import { CreditCardImportEntry, CreditCardPayment, CreditCardStatement, CreditCardStatementStatus } from './types';
import { getPreviousReferenceLabel } from './assignment';
import { inferDirection } from './classifiers';

const round2 = (value: number): number => Math.round(value * 100) / 100;

export const sumPaymentsForStatement = (payments: CreditCardPayment[], statementId: string): number =>
  round2(
    payments
      .filter((p) => p.statementId === statementId)
      .reduce((acc, p) => acc + Math.abs(Number(p.amount || 0)), 0)
  );

/**
 * Linhas `invoice_payment` da fatura seguinte (CSV) liquidam a competência anterior na prática do XP.
 * Alguns fluxos gravam só `credit_card_entries` e falham ao persistir em `credit_card_payments`; aqui
 * incorporamos esse crédito no recálculo sem duplicar quando o pagamento já foi persistido.
 */
export function mergePaymentsWithInvoiceLinesFromNextStatement(
  statement: Pick<CreditCardStatement, 'id' | 'cardId'>,
  directPayments: CreditCardPayment[],
  nextStatementEntries: CreditCardImportEntry[]
): CreditCardPayment[] {
  const invoicePaymentsNext = nextStatementEntries.filter(
    (e) => e.entryType === 'invoice_payment' && inferDirection(e.amount) === 'credit'
  );
  const out: CreditCardPayment[] = [...directPayments];
  for (const entry of invoicePaymentsNext) {
    const already = directPayments.some((p) => {
      if (p.notes?.includes(entry.sourceRowHash)) return true;
      const tid = entry.transactionId || undefined;
      if (tid && p.paymentTransactionId === tid) return true;
      return false;
    });
    if (already) continue;
    out.push({
      cardId: statement.cardId,
      statementId: statement.id,
      paymentDate: entry.postedDate,
      amount: Math.abs(entry.amount),
      source: 'imported_statement',
      notes: `synthetic_next_statement_entry:${entry.sourceRowHash}`,
      paymentTransactionId: entry.transactionId || undefined,
    });
  }
  return out;
}

export const inferStatusFromTotals = (statementTotal: number, totalPayments: number, dueDate?: string | null): CreditCardStatementStatus => {
  const open = round2(Math.max(statementTotal - totalPayments, 0));
  if (open <= 0) return 'paid';
  if (totalPayments > 0) return 'partial';

  if (dueDate) {
    const today = new Date();
    const due = new Date(dueDate);
    if (!Number.isNaN(due.getTime()) && today.getTime() > due.getTime()) {
      return 'overdue';
    }
  }
  return 'open';
};

export const applyImportedPaymentFromNextStatement = (
  statementsByReference: Map<string, CreditCardStatement>,
  currentReferenceLabel: string
): CreditCardStatement | null => {
  const previousReference = getPreviousReferenceLabel(currentReferenceLabel);
  return statementsByReference.get(previousReference) || null;
};

