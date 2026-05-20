import { classifyEntryType, inferDirection, normalizeDescription } from './classifiers';
import type { ClassificationRules } from './classifiers';
import type { CreditCardEntryType } from './types';

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface ImportLedgerLineInput {
  postedDate: string;
  description: string;
  amount: number;
  installmentTotal?: number;
}

export interface ImportLedgerTotalsResult {
  /** Compras + taxas + juros + débitos não classificados */
  totalDebits: number;
  totalRefunds: number;
  /** Pagamentos de fatura (créditos classificados como invoice_payment) */
  totalInvoicePayments: number;
  /** Outros créditos (estorno/ajuste) */
  totalOtherCredits: number;
  /** totalDebits - totalRefunds (valor típico da fatura) */
  statementTotal: number;
  /** Soma dos pagamentos neste arquivo (competência do arquivo) */
  totalPayments: number;
  openBalance: number;
  lineCount: number;
  byType: Partial<Record<CreditCardEntryType, number>>;
}

/**
 * Soma linhas do extrato importado (convenção cartão: negativo = saída/despesa).
 * Por arquivo: compras e estornos compõem o total da fatura desta competência; pagamentos de fatura
 * aparecem no extrato mas, na agregação por competência, abatem a fatura do mês anterior (N+1 → N).
 */
export function computeImportLedgerTotals(
  lines: ImportLedgerLineInput[],
  rules?: ClassificationRules
): ImportLedgerTotalsResult {
  const byType: Partial<Record<CreditCardEntryType, number>> = {};
  let totalDebits = 0;
  let totalRefunds = 0;
  let totalInvoicePayments = 0;
  let totalOtherCredits = 0;

  for (const line of lines) {
    const amount = round2(Number(line.amount || 0));
    const normalized = normalizeDescription(line.description || '');
    const classified = classifyEntryType(
      {
        amount,
        descriptionNormalized: normalized,
        sourceRowHash: 'preview',
        installmentTotal: line.installmentTotal,
      },
      rules
    );
    const type = classified.entryType;
    byType[type] = round2((byType[type] || 0) + Math.abs(amount));

    if (type === 'invoice_payment') {
      totalInvoicePayments = round2(totalInvoicePayments + Math.abs(amount));
      continue;
    }
    if (type === 'refund' || type === 'adjustment') {
      totalRefunds = round2(totalRefunds + Math.abs(amount));
      continue;
    }
    if (type === 'ignored') continue;

    if (type === 'purchase' || type === 'installment_purchase' || type === 'fee' || type === 'interest') {
      totalDebits = round2(totalDebits + Math.abs(amount));
      continue;
    }

    if (type === 'needs_review') {
      if (inferDirection(amount) === 'debit' || amount < 0) {
        totalDebits = round2(totalDebits + Math.abs(amount));
      } else {
        totalOtherCredits = round2(totalOtherCredits + Math.abs(amount));
      }
    }
  }

  const statementTotal = round2(Math.max(0, totalDebits - totalRefunds));
  const totalPayments = totalInvoicePayments;
  const openBalance = round2(Math.max(0, statementTotal - totalPayments));

  return {
    totalDebits,
    totalRefunds,
    totalInvoicePayments,
    totalOtherCredits,
    statementTotal,
    totalPayments,
    openBalance,
    lineCount: lines.length,
    byType,
  };
}
