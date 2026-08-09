export type CreditCardEntryDirection = 'debit' | 'credit';

export type CreditCardEntryType =
  | 'purchase'
  | 'installment_purchase'
  | 'refund'
  | 'invoice_payment'
  | 'fee'
  | 'interest'
  | 'adjustment'
  | 'ignored'
  | 'needs_review';

export type CreditCardClassificationSource = 'import_rule' | 'user' | 'system' | 'reprocess';

export type CreditCardStatementStatus = 'open' | 'closed' | 'paid' | 'partial' | 'overdue';

export type CreditCardPaymentSource = 'manual' | 'imported_statement' | 'bank_account_import';

/** Classificação opcional pelo usuário para micro-divergência entre total da fatura e total pago. */
export type CreditCardMicroDivergenceFeedback =
  | 'credit'
  | 'bank_adjustment'
  /** Déficit coberto com valor que o usuário marcou como «crédito» em competências anteriores. */
  | 'offset_prior_credit';

export interface CreditCardImportLotInput {
  userId: string;
  cardId: string;
  accountId: string;
  sourceFileName: string;
  statementDueYear: number;
  statementDueMonth: number;
  statementDueDate?: string | null;
  purchaseReferenceLabel?: string | null;
  checksum?: string | null;
}

export interface CreditCardRawImportRow {
  sourceRowIndex: number;
  postedDate: string;
  description: string;
  holderName?: string;
  amount: number;
  installmentCurrent?: number;
  installmentTotal?: number;
  merchantName?: string;
}

export interface CreditCardImportEntry extends CreditCardRawImportRow {
  id?: string;
  sourceRowHash: string;
  descriptionNormalized: string;
  direction: CreditCardEntryDirection;
  absAmount: number;
  entryType: CreditCardEntryType;
  classificationSource: CreditCardClassificationSource;
  classificationConfidence: number;
  statementId?: string | null;
  importLotId?: string;
  transactionId?: string | null;
  sourceFileName: string;
  categoryId?: string | null;
}

export interface CreditCardStatement {
  id: string;
  cardId: string;
  accountId: string;
  purchaseReferenceLabel: string;
  dueYear: number;
  dueMonth: number;
  dueDate?: string | null;
  closingDate?: string | null;
  status: CreditCardStatementStatus;
  sourceImportLotIds: string[];
  totalPurchases: number;
  totalFees: number;
  totalInterest: number;
  totalRefunds: number;
  statementTotal: number;
  totalPayments: number;
  openBalance: number;
  /** Totais opcionais informados pelo usuário (persistidos em manual_totals_json). */
  manualTotals?: CreditCardManualTotalsPayload | null;
  /** Total conforme arquivo importado (prioridade sobre soma de linhas). */
  statementTotalFromFile?: number | null;
  totalPaymentsFromFile?: number | null;
  /** Soma das linhas pelo motor (auditoria). */
  linesComputedTotal?: number | null;
  atomicProjectionVersion?: number | null;
  atomicProjectionChecksum?: string | null;
  atomicProjectionSnapshotId?: string | null;
}

/** Shape de `manual_totals_json` na tabela credit_card_statements. */
export interface CreditCardManualTotalsPayload {
  use_manual: boolean;
  statement_total?: number | null;
  total_payments?: number | null;
  user_note?: string | null;
  /** Feedback do usuário sobre micro-divergência fatura vs pago (crédito/ajuste só registram; abatimento altera total pago persistido). */
  micro_divergence_feedback?: CreditCardMicroDivergenceFeedback | null;
  /** Valor somado ao total pago para cobrir micro-déficit com base em crédito declarado em competências anteriores. */
  prior_credit_abatement?: number | null;
}

export interface CreditCardPayment {
  id?: string;
  cardId: string;
  statementId: string;
  paymentAccountId?: string | null;
  paymentTransactionId?: string | null;
  paymentDate: string;
  amount: number;
  source: CreditCardPaymentSource;
  notes?: string;
}

export interface CreditCardStatementAudit {
  statementId: string;
  sourceCsvRows: number;
  importedEntries: number;
  statementItems: number;
  ignoredRows: number;
  needsReviewRows: number;
  purchasesTotal: number;
  refundsTotal: number;
  feesTotal: number;
  interestTotal: number;
  paymentsFromNextInvoice: number;
  statementTotal: number;
  openBalance: number;
  unclassifiedPositiveEntries: number;
  rowsInImportNotInStatement: number;
  rowsInStatementNotInImport: number;
  duplicateSourceHashes: number;
  crossCardContaminationRisk: boolean;
}

