import type { Account, Transaction } from '../../types';
import { toDateOnlyIso } from '../../utils/dateOnly';
import { comparableImportOriginKey } from '../../utils/importOriginKey';
import { importedPaymentProvenanceKeyFromNotes } from '../../utils/creditCardPaymentIntegrity';
import type { ClassificationRules } from './classifiers';
import { creditCardStatementEngine } from './creditCardStatementEngine';
import { resolveImportedInvoicePaymentTarget } from './payments';
import type {
  CreditCardImportEntry,
  CreditCardPayment,
  CreditCardStatement,
  CreditCardStatementStatus,
} from './types';

export interface AtomicCardRebuildCycle {
  fileName: string;
  /** Competência das compras (AAAA-MM). */
  referenceMonth: string;
  /** Vencimento da fatura (AAAA-MM-DD). */
  dueDate: string;
  /** Decisões de classificação já confirmadas pelo usuário no lote. */
  paymentTransactionIds?: string[];
  refundTransactionIds?: string[];
}

export type AtomicCardShadowIssueCode =
  | 'not-credit-card'
  | 'no-cycles'
  | 'duplicate-cycle-origin'
  | 'invalid-reference-month'
  | 'invalid-due-date'
  | 'conflicting-reference-due-date'
  | 'conflicting-statement-due-date'
  | 'cycle-without-transactions'
  | 'transaction-without-id'
  | 'transaction-in-multiple-cycles'
  | 'invalid-transaction-date'
  | 'invalid-transaction-amount'
  | 'transaction-sign-conflict'
  | 'uncovered-imported-transactions'
  | 'payment-before-rebuild-window'
  | 'unresolved-imported-payment-target';

export interface AtomicCardShadowIssue {
  code: AtomicCardShadowIssueCode;
  severity: 'blocker' | 'warning';
  message: string;
  fileName?: string;
  transactionId?: string;
  count?: number;
}

export interface AtomicCardShadowEntry {
  transactionId: string;
  sourceFileName: string;
  sourceRowHash: string;
  statementKey: string;
  postedDate: string;
  amountCents: number;
  entryType: CreditCardImportEntry['entryType'];
}

export interface AtomicCardShadowStatement {
  statementKey: string;
  purchaseReferenceMonth: string;
  dueDate: string;
  dueYear: number;
  dueMonth: number;
  status: CreditCardStatementStatus;
  sourceFiles: string[];
  entryCount: number;
  totalPurchasesCents: number;
  totalFeesCents: number;
  totalInterestCents: number;
  totalRefundsCents: number;
  statementTotalCents: number;
  totalPaymentsCents: number;
  openBalanceCents: number;
}

export interface AtomicCardShadowPayment {
  transactionId: string;
  sourceFileName: string;
  sourceRowHash: string;
  statementKey: string;
  paymentDate: string;
  amountCents: number;
  source: CreditCardPayment['source'];
}

export interface AtomicCardShadowProjection {
  version: 1;
  accountId: string;
  sourceCycleCount: number;
  sourceTransactionCount: number;
  projectedEntryCount: number;
  projectedPaymentCount: number;
  statements: AtomicCardShadowStatement[];
  entries: AtomicCardShadowEntry[];
  payments: AtomicCardShadowPayment[];
  issues: AtomicCardShadowIssue[];
  blockers: AtomicCardShadowIssue[];
  warnings: AtomicCardShadowIssue[];
  safeToStage: boolean;
  checksum: string;
}

export interface PersistedAtomicCardStatement {
  statementKey: string;
  dueDate: string | null;
  entryCount: number;
  statementTotalCents: number;
  totalPaymentsCents: number;
  openBalanceCents: number;
  hasProtectedMetadata?: boolean;
  manualTotalsPresent?: boolean;
  statementTotalFromFileCents?: number | null;
  totalPaymentsFromFileCents?: number | null;
}

export interface PersistedAtomicCardEntry {
  /** Identidade da linha materializada, usada apenas para auditoria/reparo seguro. */
  rowId?: string;
  /** Proveniência persistida; permanece opcional para leituras do modelo legado. */
  sourceFileName?: string | null;
  sourceRowIndex?: number | null;
  sourceRowHash?: string | null;
  importLotId?: string | null;
  createdAt?: string | null;
  transactionId: string;
  statementKey: string;
  postedDate: string | null;
  amountCents: number;
  entryType: string;
}

export interface PersistedAtomicCardPayment {
  rowId: string;
  transactionId: string | null;
  statementKey: string;
  paymentDate: string | null;
  amountCents: number;
  source: string;
  notes?: string | null;
  createdAt?: string | null;
}

export interface PersistedAtomicCardProjection {
  source: 'engine' | 'legacy' | 'none';
  statements: PersistedAtomicCardStatement[];
  entries: PersistedAtomicCardEntry[];
  payments: PersistedAtomicCardPayment[];
}

export interface AtomicCardProjectionComparison {
  status: 'blocked' | 'identical' | 'informational' | 'different';
  /**
   * True only for the deliberately narrow Sprint 2C activation mode: every
   * normalized row already exists and can be updated in place. No insert,
   * delete or ambiguous repair is permitted.
   */
  safeToActivate: boolean;
  duplicatePersistedTransactionIds: string[];
  /** Duplicidades em que uma linha coincide com a fonte e as demais podem ser removidas. */
  repairablePersistedEntryRowIds: string[];
  /** Duplicidades sem uma linha canônica inequívoca; exigem investigação manual. */
  conflictingDuplicatePersistedTransactionIds: string[];
  duplicatePersistedStatementKeys: string[];
  duplicatePersistedPaymentTransactionIds: string[];
  suspiciousPersistedPaymentEventKeys: string[];
  repairablePersistedPaymentRowIds: string[];
  protectedMetadataStatementKeys: string[];
  missingTransactionIds: string[];
  orphanTransactionIds: string[];
  changedTransactionIds: string[];
  missingStatementKeys: string[];
  orphanStatementKeys: string[];
  changedStatementKeys: string[];
  missingPaymentKeys: string[];
  orphanPaymentKeys: string[];
  changedPaymentTransactionIds: string[];
  /** Structural differences that an activation would have to reconcile. */
  structuralDifferenceCount: number;
  /** Existing rows that can be updated in place by the Sprint 2C RPC. */
  activationChangeCount: number;
  differenceCount: number;
}

const REFERENCE_MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const round2 = (value: number): number => Math.round(value * 100) / 100;
const toCents = (value: number): number => Math.round(round2(Number(value || 0)) * 100);

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `shadow-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const isValidDateOnly = (value: string): boolean => {
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
};

const normalizeTransactionAmount = (transaction: Transaction): number => {
  const raw = round2(Number(transaction.Valor));
  if (transaction.Tipo === 'Despesa') return raw <= 0 ? raw : -Math.abs(raw);
  return raw >= 0 ? raw : Math.abs(raw);
};

const VALID_ENTRY_TYPES = new Set<CreditCardImportEntry['entryType']>([
  'purchase',
  'installment_purchase',
  'fee',
  'interest',
  'refund',
  'invoice_payment',
  'adjustment',
  'ignored',
  'needs_review',
]);

const isEntryType = (value: string | undefined): value is CreditCardImportEntry['entryType'] =>
  Boolean(value && VALID_ENTRY_TYPES.has(value as CreditCardImportEntry['entryType']));

const canonicalProjection = (
  accountId: string,
  statements: AtomicCardShadowStatement[],
  entries: AtomicCardShadowEntry[],
  payments: AtomicCardShadowPayment[]
): string =>
  JSON.stringify({
    accountId,
    statements: statements.map((statement) => ({
      key: statement.statementKey,
      dueDate: statement.dueDate,
      files: statement.sourceFiles,
      count: statement.entryCount,
      purchases: statement.totalPurchasesCents,
      fees: statement.totalFeesCents,
      interest: statement.totalInterestCents,
      refunds: statement.totalRefundsCents,
      total: statement.statementTotalCents,
      payments: statement.totalPaymentsCents,
      open: statement.openBalanceCents,
    })),
    entries: entries.map((entry) => ({
      id: entry.transactionId,
      file: entry.sourceFileName,
      hash: entry.sourceRowHash,
      statement: entry.statementKey,
      date: entry.postedDate,
      amount: entry.amountCents,
      type: entry.entryType,
    })),
    payments: payments.map((payment) => ({
      id: payment.transactionId,
      file: payment.sourceFileName,
      hash: payment.sourceRowHash,
      statement: payment.statementKey,
      date: payment.paymentDate,
      amount: payment.amountCents,
      source: payment.source,
    })),
  });

/**
 * Constrói uma projeção determinística inteiramente em memória.
 *
 * Esta função não importa o cliente Supabase e não possui qualquer primitiva de
 * escrita. Ela é o estágio sombra da Sprint 2A: primeiro prova cobertura,
 * identidade, datas e centavos; uma futura RPC poderá aplicar exatamente esse
 * plano dentro de uma única transação PostgreSQL.
 */
export function buildAtomicCardRebuildShadow(input: {
  account: Account;
  cycles: AtomicCardRebuildCycle[];
  transactions: Transaction[];
  rules?: ClassificationRules;
  /**
   * Classificações já materializadas para IDs imutáveis e não ambíguos.
   * A reconstrução preserva essas decisões; confirmações explícitas do lote
   * (pagamento/estorno) continuam tendo prioridade.
   */
  persistedEntryTypesByTransactionId?: ReadonlyMap<string, string>;
}): AtomicCardShadowProjection {
  const {
    account,
    cycles,
    transactions,
    rules,
    persistedEntryTypesByTransactionId,
  } = input;
  const issues: AtomicCardShadowIssue[] = [];

  if (account.Tipo_Conta !== 'Cartão de Crédito') {
    issues.push({
      code: 'not-credit-card',
      severity: 'blocker',
      message: 'A conta selecionada não é um cartão de crédito.',
    });
  }
  if (cycles.length === 0) {
    issues.push({
      code: 'no-cycles',
      severity: 'blocker',
      message: 'Nenhuma competência foi informada para a reconstrução.',
    });
  }

  const cyclesByOrigin = new Map<string, AtomicCardRebuildCycle>();
  const dueDateByReferenceMonth = new Map<string, string>();
  const referenceMonthByDueDate = new Map<string, string>();
  const statementSeeds = new Map<string, CreditCardStatement>();
  const sourceFilesByStatement = new Map<string, Set<string>>();
  const entriesByStatement = new Map<string, CreditCardImportEntry[]>();
  const directManualPayments: CreditCardPayment[] = [];
  const directManualPaymentHashes = new Set<string>();
  const projectedEntries: AtomicCardShadowEntry[] = [];
  const projectedPayments: AtomicCardShadowPayment[] = [];
  const assignedTransactionIds = new Set<string>();

  const sortedCycles = [...cycles].sort((left, right) => {
    const byReference = left.referenceMonth.localeCompare(right.referenceMonth);
    if (byReference !== 0) return byReference;
    return comparableImportOriginKey(left.fileName).localeCompare(comparableImportOriginKey(right.fileName));
  });

  for (const cycle of sortedCycles) {
    const originKey = comparableImportOriginKey(cycle.fileName);
    if (cyclesByOrigin.has(originKey)) {
      issues.push({
        code: 'duplicate-cycle-origin',
        severity: 'blocker',
        fileName: cycle.fileName,
        message: `A origem "${cycle.fileName}" aparece mais de uma vez no plano.`,
      });
      continue;
    }
    cyclesByOrigin.set(originKey, cycle);

    if (!REFERENCE_MONTH_RE.test(cycle.referenceMonth)) {
      issues.push({
        code: 'invalid-reference-month',
        severity: 'blocker',
        fileName: cycle.fileName,
        message: `Competência inválida em "${cycle.fileName}"; use AAAA-MM.`,
      });
      continue;
    }
    if (!isValidDateOnly(cycle.dueDate)) {
      issues.push({
        code: 'invalid-due-date',
        severity: 'blocker',
        fileName: cycle.fileName,
        message: `Vencimento inválido em "${cycle.fileName}"; use uma data civil válida.`,
      });
      continue;
    }

    const cycleTransactions = transactions
      .filter(
        (transaction) =>
          transaction.ID_Conta === account.id &&
          transaction.Origem !== 'manual' &&
          comparableImportOriginKey(String(transaction.Origem || '')) === originKey
      )
      .sort((left, right) => {
        const byDate = toDateOnlyIso(left.Data).localeCompare(toDateOnlyIso(right.Data));
        if (byDate !== 0) return byDate;
        return String(left.ID_Transacao || '').localeCompare(String(right.ID_Transacao || ''));
      });

    if (cycleTransactions.length === 0) {
      issues.push({
        code: 'cycle-without-transactions',
        severity: 'warning',
        fileName: cycle.fileName,
        message: `A origem "${cycle.fileName}" não possui transações ativas.`,
      });
      continue;
    }

    const [referenceYear, referenceMonth] = cycle.referenceMonth.split('-').map(Number);
    // A identidade da fatura no FinElo é a competência confirmada pelo usuário.
    // O vencimento costuma cair no mês seguinte e não pode deslocar os lançamentos.
    const statementKey = cycle.referenceMonth;
    const priorDueDate = dueDateByReferenceMonth.get(cycle.referenceMonth);
    if (priorDueDate && priorDueDate !== cycle.dueDate) {
      const changedDueMonth = priorDueDate.slice(0, 7) !== cycle.dueDate.slice(0, 7);
      issues.push({
        code: changedDueMonth
          ? 'conflicting-reference-due-date'
          : 'conflicting-statement-due-date',
        severity: 'blocker',
        fileName: cycle.fileName,
        message: changedDueMonth
          ? `A competência ${cycle.referenceMonth} aponta para vencimentos em meses diferentes.`
          : `A competência ${cycle.referenceMonth} aponta para dias de vencimento diferentes.`,
      });
      continue;
    }
    dueDateByReferenceMonth.set(cycle.referenceMonth, cycle.dueDate);
    const priorReferenceMonth = referenceMonthByDueDate.get(cycle.dueDate);
    if (priorReferenceMonth && priorReferenceMonth !== cycle.referenceMonth) {
      issues.push({
        code: 'conflicting-statement-due-date',
        severity: 'blocker',
        fileName: cycle.fileName,
        message: `O vencimento ${cycle.dueDate} foi associado a mais de uma competência.`,
      });
      continue;
    }
    referenceMonthByDueDate.set(cycle.dueDate, cycle.referenceMonth);
    const statementId = `shadow:${statementKey}`;
    const priorStatement = statementSeeds.get(statementKey);
    if (priorStatement && priorStatement.purchaseReferenceLabel !== cycle.referenceMonth) {
      issues.push({
        code: 'invalid-reference-month',
        severity: 'blocker',
        fileName: cycle.fileName,
        message: `Arquivos do vencimento ${statementKey} apontam para competências diferentes.`,
      });
      continue;
    }
    if (priorStatement && priorStatement.dueDate !== cycle.dueDate) {
      issues.push({
        code: 'conflicting-statement-due-date',
        severity: 'blocker',
        fileName: cycle.fileName,
        message: `Arquivos da fatura ${statementKey} apontam para dias de vencimento diferentes.`,
      });
      continue;
    }

    const statement =
      priorStatement ||
      ({
        id: statementId,
        cardId: `shadow-card:${account.id}`,
        accountId: account.id,
        purchaseReferenceLabel: cycle.referenceMonth,
        dueYear: referenceYear,
        dueMonth: referenceMonth,
        dueDate: cycle.dueDate,
        status: 'open',
        sourceImportLotIds: [],
        totalPurchases: 0,
        totalFees: 0,
        totalInterest: 0,
        totalRefunds: 0,
        statementTotal: 0,
        totalPayments: 0,
        openBalance: 0,
      } satisfies CreditCardStatement);
    statementSeeds.set(statementKey, statement);

    const sourceFiles = sourceFilesByStatement.get(statementKey) || new Set<string>();
    sourceFiles.add(cycle.fileName);
    sourceFilesByStatement.set(statementKey, sourceFiles);

    const validRows: Array<{
      sourceRowIndex: number;
      postedDate: string;
      description: string;
      holderName?: string;
      amount: number;
      installmentCurrent?: number;
      installmentTotal?: number;
      merchantName?: string;
      transactionId?: string;
    }> = [];

    cycleTransactions.forEach((transaction, index) => {
      const transactionId = String(transaction.ID_Transacao || '').trim();
      if (!transactionId) {
        issues.push({
          code: 'transaction-without-id',
          severity: 'blocker',
          fileName: cycle.fileName,
          message: `Uma linha de "${cycle.fileName}" não possui ID imutável.`,
        });
        return;
      }
      if (assignedTransactionIds.has(transactionId)) {
        issues.push({
          code: 'transaction-in-multiple-cycles',
          severity: 'blocker',
          fileName: cycle.fileName,
          transactionId,
          message: `A transação ${transactionId} foi encontrada em mais de uma competência.`,
        });
        return;
      }

      const postedDate = toDateOnlyIso(transaction.Data);
      if (!isValidDateOnly(postedDate)) {
        issues.push({
          code: 'invalid-transaction-date',
          severity: 'blocker',
          fileName: cycle.fileName,
          transactionId,
          message: `A transação ${transactionId} possui uma data civil inválida.`,
        });
        return;
      }
      if (!Number.isFinite(Number(transaction.Valor))) {
        issues.push({
          code: 'invalid-transaction-amount',
          severity: 'blocker',
          fileName: cycle.fileName,
          transactionId,
          message: `A transação ${transactionId} possui valor inválido.`,
        });
        return;
      }

      const rawAmount = round2(Number(transaction.Valor));
      const normalizedAmount = normalizeTransactionAmount(transaction);
      if (rawAmount !== 0 && Math.sign(rawAmount) !== Math.sign(normalizedAmount)) {
        issues.push({
          code: 'transaction-sign-conflict',
          severity: 'blocker',
          fileName: cycle.fileName,
          transactionId,
          message: `O sinal da transação ${transactionId} foi normalizado conforme o Tipo FinElo.`,
        });
      }

      assignedTransactionIds.add(transactionId);
      validRows.push({
        sourceRowIndex: index + 1,
        postedDate,
        description: transaction.Descricao_Original || transaction.Nome_Fantasia || '',
        holderName: transaction.Portador || undefined,
        amount: normalizedAmount,
        installmentCurrent: transaction.Parcela_Atual || undefined,
        installmentTotal: transaction.Total_Parcelas || undefined,
        merchantName: transaction.Nome_Fantasia || undefined,
        transactionId,
      });
    });

    const normalized = creditCardStatementEngine.normalizeImportLot({
      userId: account.user_id,
      cardId: `shadow-card:${account.id}`,
      accountId: account.id,
      sourceFileName: cycle.fileName,
      statementDueYear: referenceYear,
      statementDueMonth: referenceMonth,
      statementDueDate: cycle.dueDate,
      purchaseReferenceLabel: cycle.referenceMonth,
      rows: validRows,
    });
    const paymentOverrides = new Set((cycle.paymentTransactionIds || []).filter(Boolean));
    const refundOverrides = new Set((cycle.refundTransactionIds || []).filter(Boolean));
    const bySourceRowHash: Record<string, CreditCardImportEntry['entryType']> = {};
    normalized.entries.forEach((entry) => {
      const row = validRows.find((candidate) => candidate.sourceRowIndex === entry.sourceRowIndex);
      const persistedEntryType = row?.transactionId
        ? persistedEntryTypesByTransactionId?.get(row.transactionId)
        : undefined;
      if (isEntryType(persistedEntryType)) {
        bySourceRowHash[entry.sourceRowHash] = persistedEntryType;
      }
      if (row?.transactionId && paymentOverrides.has(row.transactionId)) {
        bySourceRowHash[entry.sourceRowHash] = 'invoice_payment';
      }
      if (row?.transactionId && refundOverrides.has(row.transactionId)) {
        bySourceRowHash[entry.sourceRowHash] = 'refund';
      }
    });
    const classified = creditCardStatementEngine.classifyEntries(
      normalized.entries,
      rules,
      Object.keys(bySourceRowHash).length > 0 ? { bySourceRowHash } : undefined
    );
    const assigned = creditCardStatementEngine.assignEntriesToStatement(classified, statement);
    const existingEntries = entriesByStatement.get(statementKey) || [];
    entriesByStatement.set(statementKey, [...existingEntries, ...assigned]);

    assigned.forEach((entry) => {
      const row = validRows.find((candidate) => candidate.sourceRowIndex === entry.sourceRowIndex);
      if (cycle.fileName.startsWith('manual:') && entry.entryType === 'invoice_payment') {
        directManualPaymentHashes.add(entry.sourceRowHash);
        directManualPayments.push({
          cardId: statement.cardId,
          statementId: statement.id,
          paymentTransactionId: row?.transactionId || undefined,
          paymentDate: entry.postedDate,
          amount: Math.abs(entry.amount),
          source: 'manual',
          notes: `shadow_directed_manual_payment:${entry.sourceRowHash}`,
        });
        projectedPayments.push({
          transactionId: String(row?.transactionId || ''),
          sourceFileName: cycle.fileName,
          sourceRowHash: entry.sourceRowHash,
          statementKey,
          paymentDate: entry.postedDate,
          amountCents: toCents(Math.abs(entry.amount)),
          source: 'manual',
        });
      }
      projectedEntries.push({
        transactionId: String(row?.transactionId || ''),
        sourceFileName: cycle.fileName,
        sourceRowHash: entry.sourceRowHash,
        statementKey,
        postedDate: entry.postedDate,
        amountCents: toCents(entry.amount),
        entryType: entry.entryType,
      });
    });
  }

  const coveredOrigins = new Set(cyclesByOrigin.keys());
  const uncoveredTransactions = transactions.filter(
    (transaction) =>
      transaction.ID_Conta === account.id &&
      transaction.Origem !== 'manual' &&
      !coveredOrigins.has(comparableImportOriginKey(String(transaction.Origem || '')))
  );
  if (uncoveredTransactions.length > 0) {
    issues.push({
      code: 'uncovered-imported-transactions',
      severity: 'blocker',
      count: uncoveredTransactions.length,
      message: `${uncoveredTransactions.length} transação(ões) importada(s) do cartão ficaram fora do plano.`,
    });
  }

  const sortedStatements = Array.from(statementSeeds.values()).sort((left, right) => {
    if (left.dueYear !== right.dueYear) return left.dueYear - right.dueYear;
    return left.dueMonth - right.dueMonth;
  });
  const historyEntries = new Map<string, CreditCardImportEntry[]>();
  sortedStatements.forEach((statement) => {
    historyEntries.set(statement.id, entriesByStatement.get(`${statement.dueYear}-${String(statement.dueMonth).padStart(2, '0')}`) || []);
  });
  const recalculationEntries = new Map<string, CreditCardImportEntry[]>();
  historyEntries.forEach((entries, statementId) => {
    recalculationEntries.set(
      statementId,
      entries.map((entry) =>
        directManualPaymentHashes.has(entry.sourceRowHash)
          ? { ...entry, entryType: 'ignored' }
          : entry
      )
    );
  });
  const statementTotalsById = new Map<string, number>();
  sortedStatements.forEach((statement) => {
    const recalculatedStatement = creditCardStatementEngine.recalculateStatement({
      statement,
      entries: recalculationEntries.get(statement.id) || [],
      payments: [],
    });
    statementTotalsById.set(statement.id, recalculatedStatement.statementTotal);
  });
  const sortedStatementPicks = sortedStatements.map((statement) => ({
    id: statement.id,
    dueYear: statement.dueYear,
    dueMonth: statement.dueMonth,
  }));
  sortedStatements.forEach((importStatement) => {
    const invoicePaymentEntries = (historyEntries.get(importStatement.id) || []).filter(
      (entry) =>
        entry.entryType === 'invoice_payment' &&
        entry.direction === 'credit' &&
        !directManualPaymentHashes.has(entry.sourceRowHash)
    );
    invoicePaymentEntries.forEach((entry) => {
      const target = resolveImportedInvoicePaymentTarget(
        entry,
        invoicePaymentEntries,
        sortedStatementPicks,
        importStatement,
        { statementTotalsById }
      );
      if (!target) return;
      const targetStatement = sortedStatements.find((statement) => statement.id === target.id);
      if (!targetStatement) return;
      const statementKey = `${targetStatement.dueYear}-${String(targetStatement.dueMonth).padStart(2, '0')}`;
      const sourceProjection = projectedEntries.find(
        (projected) => projected.sourceRowHash === entry.sourceRowHash
      );
      projectedPayments.push({
        transactionId: sourceProjection?.transactionId || String(entry.transactionId || ''),
        sourceFileName: entry.sourceFileName,
        sourceRowHash: entry.sourceRowHash,
        statementKey,
        paymentDate: entry.postedDate,
        amountCents: toCents(Math.abs(entry.amount)),
        source: 'imported_statement',
      });
    });
  });

  const recalculated = creditCardStatementEngine.recalculateCardHistory({
    statements: sortedStatements,
    entriesByStatement: recalculationEntries,
    // Pagamentos importados continuam sendo derivados das próprias entradas pelo
    // motor puro. Passá-los também aqui duplicaria o mesmo evento no recálculo.
    payments: directManualPayments,
  });

  const statements: AtomicCardShadowStatement[] = recalculated.map((statement) => {
    const statementKey = `${statement.dueYear}-${String(statement.dueMonth).padStart(2, '0')}`;
    const entries = historyEntries.get(statement.id) || [];
    return {
      statementKey,
      purchaseReferenceMonth: statement.purchaseReferenceLabel,
      dueDate: statement.dueDate || `${statementKey}-01`,
      dueYear: statement.dueYear,
      dueMonth: statement.dueMonth,
      status: statement.status,
      sourceFiles: Array.from(sourceFilesByStatement.get(statementKey) || []).sort(),
      entryCount: entries.length,
      totalPurchasesCents: toCents(statement.totalPurchases),
      totalFeesCents: toCents(statement.totalFees),
      totalInterestCents: toCents(statement.totalInterest),
      totalRefundsCents: toCents(statement.totalRefunds),
      statementTotalCents: toCents(statement.statementTotal),
      totalPaymentsCents: toCents(statement.totalPayments),
      openBalanceCents: toCents(statement.openBalance),
    };
  });

  projectedEntries.sort((left, right) => {
    const byStatement = left.statementKey.localeCompare(right.statementKey);
    if (byStatement !== 0) return byStatement;
    return left.transactionId.localeCompare(right.transactionId);
  });
  projectedPayments.sort((left, right) => {
    const byStatement = left.statementKey.localeCompare(right.statementKey);
    if (byStatement !== 0) return byStatement;
    return left.transactionId.localeCompare(right.transactionId);
  });

  const projectedPaymentHashes = new Set(
    projectedPayments.map((payment) => payment.sourceRowHash)
  );
  const firstStatementKey = sortedStatements[0]
    ? `${sortedStatements[0].dueYear}-${String(sortedStatements[0].dueMonth).padStart(2, '0')}`
    : null;
  projectedEntries
    .filter(
      (entry) =>
        entry.entryType === 'invoice_payment' &&
        !entry.sourceFileName.startsWith('manual:') &&
        !projectedPaymentHashes.has(entry.sourceRowHash)
    )
    .forEach((entry) => {
      const isBeforeRebuildWindow = firstStatementKey === entry.statementKey;
      issues.push({
        code: isBeforeRebuildWindow
          ? 'payment-before-rebuild-window'
          : 'unresolved-imported-payment-target',
        severity: isBeforeRebuildWindow ? 'warning' : 'blocker',
        fileName: entry.sourceFileName,
        transactionId: entry.transactionId,
        message: isBeforeRebuildWindow
          ? `O pagamento importado ${entry.transactionId} de "${entry.sourceFileName}" foi preservado como lançamento, mas sua fatura anterior está fora da janela reconstruída.`
          : `O pagamento importado ${entry.transactionId} de "${entry.sourceFileName}" não possui uma fatura anterior disponível para receber sua quitação.`,
      });
    });

  const blockers = issues.filter((issue) => issue.severity === 'blocker');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const checksum = stableHash(
    canonicalProjection(account.id, statements, projectedEntries, projectedPayments)
  );

  return {
    version: 1,
    accountId: account.id,
    sourceCycleCount: cycles.length,
    sourceTransactionCount: assignedTransactionIds.size,
    projectedEntryCount: projectedEntries.length,
    projectedPaymentCount: projectedPayments.length,
    statements,
    entries: projectedEntries,
    payments: projectedPayments,
    issues,
    blockers,
    warnings,
    safeToStage:
      blockers.length === 0 && assignedTransactionIds.size === projectedEntries.length,
    checksum,
  };
}

const entrySignature = (entry: PersistedAtomicCardEntry | AtomicCardShadowEntry): string =>
  [
    entry.statementKey,
    entry.postedDate || '',
    entry.amountCents,
    entry.entryType,
  ].join('|');

const statementSignature = (
  statement: PersistedAtomicCardStatement | AtomicCardShadowStatement
): string =>
  [
    statement.dueDate || '',
    statement.entryCount,
    statement.statementTotalCents,
    statement.totalPaymentsCents,
    statement.openBalanceCents,
  ].join('|');

const paymentSignature = (
  payment: PersistedAtomicCardPayment | AtomicCardShadowPayment
): string =>
  [
    payment.statementKey,
    'paymentDate' in payment ? payment.paymentDate || '' : '',
    payment.amountCents,
    payment.source,
  ].join('|');

export function compareAtomicCardProjections(
  shadow: AtomicCardShadowProjection,
  persisted: PersistedAtomicCardProjection
): AtomicCardProjectionComparison {
  const desiredEntries = new Map(shadow.entries.map((entry) => [entry.transactionId, entry]));
  const persistedEntriesByTransactionId = new Map<string, PersistedAtomicCardEntry[]>();
  persisted.entries.forEach((entry) => {
    const rows = persistedEntriesByTransactionId.get(entry.transactionId) || [];
    rows.push(entry);
    persistedEntriesByTransactionId.set(entry.transactionId, rows);
  });
  const duplicatePersistedTransactionIds = Array.from(persistedEntriesByTransactionId.entries())
    .filter(([, entries]) => entries.length > 1)
    .map(([id]) => id)
    .sort();
  const repairablePersistedEntryRowIds: string[] = [];
  const conflictingDuplicatePersistedTransactionIds: string[] = [];
  duplicatePersistedTransactionIds.forEach((transactionId) => {
    const expected = desiredEntries.get(transactionId);
    const rows = persistedEntriesByTransactionId.get(transactionId) || [];
    if (!expected) {
      conflictingDuplicatePersistedTransactionIds.push(transactionId);
      return;
    }
    const matchingRows = rows
      .filter((row) => entrySignature(row) === entrySignature(expected))
      .sort((left, right) => String(left.rowId || '').localeCompare(String(right.rowId || '')));
    const canonical = matchingRows[0];
    const obsoleteRows = canonical ? rows.filter((row) => row !== canonical) : [];
    if (!canonical || obsoleteRows.some((row) => !row.rowId)) {
      conflictingDuplicatePersistedTransactionIds.push(transactionId);
      return;
    }
    repairablePersistedEntryRowIds.push(
      ...obsoleteRows.map((row) => String(row.rowId)).filter(Boolean)
    );
  });
  repairablePersistedEntryRowIds.sort();
  conflictingDuplicatePersistedTransactionIds.sort();
  const missingTransactionIds = Array.from(desiredEntries.keys())
    .filter((id) => !persistedEntriesByTransactionId.has(id))
    .sort();
  const orphanTransactionIds = Array.from(persistedEntriesByTransactionId.keys())
    .filter((id) => !desiredEntries.has(id))
    .sort();
  const changedTransactionIds = Array.from(desiredEntries.keys())
    .filter((id) => {
      const currentRows = persistedEntriesByTransactionId.get(id) || [];
      const expected = desiredEntries.get(id)!;
      return currentRows.length > 0 && !currentRows.some(
        (current) => entrySignature(expected) === entrySignature(current)
      );
    })
    .sort();

  const persistedStatementFrequency = new Map<string, number>();
  persisted.statements.forEach((statement) => {
    persistedStatementFrequency.set(
      statement.statementKey,
      (persistedStatementFrequency.get(statement.statementKey) || 0) + 1
    );
  });
  const duplicatePersistedStatementKeys = Array.from(persistedStatementFrequency.entries())
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
  const desiredStatements = new Map(shadow.statements.map((statement) => [statement.statementKey, statement]));
  const currentStatements = new Map(persisted.statements.map((statement) => [statement.statementKey, statement]));
  const missingStatementKeys = Array.from(desiredStatements.keys())
    .filter((key) => !currentStatements.has(key))
    .sort();
  const orphanStatementKeys = Array.from(currentStatements.keys())
    .filter((key) => !desiredStatements.has(key))
    .sort();
  const changedStatementKeys = Array.from(desiredStatements.keys())
    .filter((key) => {
      const current = currentStatements.get(key);
      return current ? statementSignature(desiredStatements.get(key)!) !== statementSignature(current) : false;
    })
    .sort();
  const protectedMetadataStatementKeys = persisted.statements
    .filter((statement) => statement.hasProtectedMetadata)
    .map((statement) => statement.statementKey)
    .sort();

  const persistedPaymentTransactionFrequency = new Map<string, number>();
  persisted.payments.forEach((payment) => {
    if (!payment.transactionId) return;
    persistedPaymentTransactionFrequency.set(
      payment.transactionId,
      (persistedPaymentTransactionFrequency.get(payment.transactionId) || 0) + 1
    );
  });
  const duplicatePersistedPaymentTransactionIds = Array.from(
    persistedPaymentTransactionFrequency.entries()
  )
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();
  const persistedPaymentsByEconomicEvent = new Map<string, PersistedAtomicCardPayment[]>();
  persisted.payments.forEach((payment) => {
    const signature = paymentSignature(payment);
    const rows = persistedPaymentsByEconomicEvent.get(signature) || [];
    rows.push(payment);
    persistedPaymentsByEconomicEvent.set(signature, rows);
  });
  const suspiciousPersistedPaymentEventKeys = Array.from(
    persistedPaymentsByEconomicEvent.entries()
  )
    .filter(([, payments]) => payments.length > 1 && payments.some((payment) => !payment.transactionId))
    .map(([signature]) => signature)
    .sort();
  const repairablePersistedPaymentRowIds = suspiciousPersistedPaymentEventKeys
    .flatMap((signature) => {
      const payments = persistedPaymentsByEconomicEvent.get(signature) || [];
      const expected = shadow.payments.find(
        (payment) => paymentSignature(payment) === signature && Boolean(payment.transactionId)
      );
      if (!expected || expected.source !== 'imported_statement') return [];

      const linkedRows = payments.filter(
        (payment) => payment.transactionId === expected.transactionId
      );
      const rowsWithoutIdentity = payments.filter((payment) => !payment.transactionId);
      if (linkedRows.length !== 1 || rowsWithoutIdentity.length === 0) return [];

      const provenanceKeys = payments.map((payment) =>
        importedPaymentProvenanceKeyFromNotes(payment.notes)
      );
      const firstProvenanceKey = provenanceKeys[0];
      if (
        !firstProvenanceKey ||
        provenanceKeys.some((key) => !key || key !== firstProvenanceKey)
      ) {
        return [];
      }

      return rowsWithoutIdentity.map((payment) => payment.rowId);
    })
    .sort();
  const unmatchedPersistedPaymentIndexes = new Set(
    persisted.payments.map((_, index) => index)
  );
  const missingPaymentKeys: string[] = [];
  const changedPaymentTransactionIds: string[] = [];
  shadow.payments.forEach((expected) => {
    const exactTransactionIndex = persisted.payments.findIndex(
      (current, index) =>
        unmatchedPersistedPaymentIndexes.has(index) &&
        Boolean(expected.transactionId) &&
        current.transactionId === expected.transactionId
    );
    if (exactTransactionIndex >= 0) {
      unmatchedPersistedPaymentIndexes.delete(exactTransactionIndex);
      if (paymentSignature(persisted.payments[exactTransactionIndex]) !== paymentSignature(expected)) {
        changedPaymentTransactionIds.push(expected.transactionId);
      }
      return;
    }

    const signature = paymentSignature(expected);
    const compatibleIndex = persisted.payments.findIndex(
      (current, index) =>
        unmatchedPersistedPaymentIndexes.has(index) && paymentSignature(current) === signature
    );
    if (compatibleIndex >= 0) {
      unmatchedPersistedPaymentIndexes.delete(compatibleIndex);
      return;
    }
    missingPaymentKeys.push(expected.transactionId || `shadow:${expected.sourceRowHash}`);
  });
  const orphanPaymentKeys = Array.from(unmatchedPersistedPaymentIndexes)
    .map((index) => {
      const payment = persisted.payments[index];
      return payment.transactionId || `row:${payment.rowId}`;
    })
    .sort();
  missingPaymentKeys.sort();
  changedPaymentTransactionIds.sort();

  const structuralDifferenceCount =
    duplicatePersistedTransactionIds.length +
    duplicatePersistedStatementKeys.length +
    duplicatePersistedPaymentTransactionIds.length +
    suspiciousPersistedPaymentEventKeys.length +
    missingTransactionIds.length +
    orphanTransactionIds.length +
    changedTransactionIds.length +
    missingStatementKeys.length +
    orphanStatementKeys.length +
    changedStatementKeys.length +
    missingPaymentKeys.length +
    orphanPaymentKeys.length +
    changedPaymentTransactionIds.length;
  const activationChangeCount =
    changedTransactionIds.length +
    changedStatementKeys.length +
    changedPaymentTransactionIds.length;
  const differenceCount =
    structuralDifferenceCount + protectedMetadataStatementKeys.length;

  const hasUnsafePersistedProjection =
    persisted.source !== 'engine' ||
    duplicatePersistedTransactionIds.length > 0 ||
    duplicatePersistedStatementKeys.length > 0 ||
    duplicatePersistedPaymentTransactionIds.length > 0 ||
    suspiciousPersistedPaymentEventKeys.length > 0 ||
    missingTransactionIds.length > 0 ||
    orphanTransactionIds.length > 0 ||
    missingStatementKeys.length > 0 ||
    orphanStatementKeys.length > 0 ||
    missingPaymentKeys.length > 0 ||
    orphanPaymentKeys.length > 0;
  const status: AtomicCardProjectionComparison['status'] =
    shadow.blockers.length > 0
      ? 'blocked'
      : differenceCount === 0
        ? 'identical'
        : structuralDifferenceCount === 0
          ? 'informational'
          : 'different';

  return {
    status,
    safeToActivate:
      shadow.safeToStage && !hasUnsafePersistedProjection && activationChangeCount > 0,
    duplicatePersistedTransactionIds,
    repairablePersistedEntryRowIds,
    conflictingDuplicatePersistedTransactionIds,
    duplicatePersistedStatementKeys,
    duplicatePersistedPaymentTransactionIds,
    suspiciousPersistedPaymentEventKeys,
    repairablePersistedPaymentRowIds,
    protectedMetadataStatementKeys,
    missingTransactionIds,
    orphanTransactionIds,
    changedTransactionIds,
    missingStatementKeys,
    orphanStatementKeys,
    changedStatementKeys,
    missingPaymentKeys,
    orphanPaymentKeys,
    changedPaymentTransactionIds,
    structuralDifferenceCount,
    activationChangeCount,
    differenceCount,
  };
}
