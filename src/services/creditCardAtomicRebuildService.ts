import type { Account, ImportLog, Transaction } from '../types';
import {
  buildAtomicCardRebuildShadow,
  compareAtomicCardProjections,
  type AtomicCardProjectionComparison,
  type AtomicCardRebuildCycle,
  type AtomicCardShadowProjection,
  type PersistedAtomicCardEntry,
  type PersistedAtomicCardPayment,
  type PersistedAtomicCardProjection,
  type PersistedAtomicCardStatement,
} from '../domain/credit-card/atomicRebuildShadow';
import type { ClassificationRules } from '../domain/credit-card/classifiers';
import {
  parseDueFromReferenceMonth,
  referenceMonthFromTransaction,
} from './creditCardManualCompetence';
import { manualMotorOriginKey } from './creditCardManualMotorSync';
import { supabase } from '../supabaseClient';
import { collectPaginatedRows } from '../utils/paginatedFetch';
import { comparableImportOriginKey } from '../utils/importOriginKey';

interface PersistedStatementRow {
  id: string;
  card_id?: string | null;
  reference_label?: string | null;
  due_year?: number | null;
  due_month?: number | null;
  due_date?: string | null;
  total_charges?: number | string | null;
  total_credits?: number | string | null;
  total_payments?: number | string | null;
  open_amount?: number | string | null;
  statement_total?: number | string | null;
  open_balance?: number | string | null;
  manual_totals_json?: unknown;
  statement_total_from_file?: number | string | null;
  total_payments_from_file?: number | string | null;
}

interface PersistedEngineEntryRow {
  id: string;
  statement_id?: string | null;
  transaction_id?: string | null;
  posted_date?: string | null;
  amount?: number | string | null;
  entry_type?: string | null;
}

interface PersistedLegacyItemRow {
  id: string;
  statement_id: string;
  transaction_id?: string | null;
  posted_date?: string | null;
  amount?: number | string | null;
  item_type?: string | null;
}

interface PersistedPaymentRow {
  id: string;
  statement_id: string;
  payment_transaction_id?: string | null;
  payment_date?: string | null;
  amount?: number | string | null;
  source?: string | null;
  notes?: string | null;
  created_at?: string | null;
}

export interface AtomicCardRebuildAuditResult {
  shadow: AtomicCardShadowProjection;
  persisted: PersistedAtomicCardProjection;
  comparison: AtomicCardProjectionComparison;
}

const toCents = (value: number | string | null | undefined): number =>
  Math.round(Number(value || 0) * 100);

const statementKeyForRow = (row: PersistedStatementRow): string => {
  const dueYear = Number(row.due_year || 0);
  const dueMonth = Number(row.due_month || 0);
  if (dueYear >= 1900 && dueMonth >= 1 && dueMonth <= 12) {
    return `${dueYear}-${String(dueMonth).padStart(2, '0')}`;
  }
  const dueDate = String(row.due_date || '');
  if (/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(dueDate)) return dueDate.slice(0, 7);
  return String(row.reference_label || 'sem-competencia');
};

const legacyItemTypeToEngine = (itemType?: string | null): string => {
  if (itemType === 'charge') return 'purchase';
  if (itemType === 'payment') return 'invoice_payment';
  if (itemType === 'refund') return 'refund';
  return itemType || 'needs_review';
};

/**
 * Replica em memória a organização que o motor atual usa para lançamentos manuais:
 * uma origem `manual:AAAA-MM` por competência. As transações originais não são
 * alteradas; apenas cópias entram no plano sombra.
 */
export function prepareAtomicCardShadowSource(input: {
  account: Account;
  cycles: AtomicCardRebuildCycle[];
  transactions: Transaction[];
  importLogs?: ImportLog[];
}): { cycles: AtomicCardRebuildCycle[]; transactions: Transaction[] } {
  const cyclesWithOverrides = input.cycles.map((cycle) => {
    const originKey = comparableImportOriginKey(cycle.fileName);
    const latestLog = [...(input.importLogs || [])]
      .filter((log) => comparableImportOriginKey(log.file_name) === originKey)
      .sort(
        (left, right) =>
          new Date(right.import_date || 0).getTime() - new Date(left.import_date || 0).getTime()
      )[0];
    const details = Array.isArray(latestLog?.imported_details)
      ? (latestLog.imported_details as Array<Record<string, unknown>>)
      : [];
    const accountRows = details.filter(
      (row) => String(row.ID_Conta || '') === input.account.id
    );
    const paymentTransactionIds = Array.from(
      new Set(
        accountRows.flatMap((row) =>
          Array.isArray(row.Card_Payment_Tx_Ids)
            ? row.Card_Payment_Tx_Ids.map(String).filter(Boolean)
            : []
        )
      )
    );
    const refundTransactionIds = Array.from(
      new Set(
        accountRows.flatMap((row) =>
          Array.isArray(row.Card_Refund_Tx_Ids)
            ? row.Card_Refund_Tx_Ids.map(String).filter(Boolean)
            : []
        )
      )
    );
    return {
      ...cycle,
      paymentTransactionIds,
      refundTransactionIds,
    };
  });
  const manualReferences = new Set<string>();
  const projectedTransactions = input.transactions.map((transaction) => {
    if (transaction.ID_Conta !== input.account.id) return transaction;
    if (String(transaction.Origem || 'manual').trim().toLowerCase() !== 'manual') {
      return transaction;
    }

    const inferredReference = referenceMonthFromTransaction(transaction, input.account).trim();
    const referenceMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(inferredReference)
      ? inferredReference
      : 'sem-competencia';
    manualReferences.add(referenceMonth);
    return { ...transaction, Origem: manualMotorOriginKey(referenceMonth) };
  });

  const manualCycles = Array.from(manualReferences)
    .sort()
    .map((referenceMonth) => {
      const matchingImportCycle = cyclesWithOverrides.find(
        (cycle) => cycle.referenceMonth.trim() === referenceMonth
      );
      return {
        fileName: manualMotorOriginKey(referenceMonth),
        referenceMonth,
        dueDate:
          matchingImportCycle?.dueDate ||
          parseDueFromReferenceMonth(referenceMonth, Number(input.account.dia_vencimento) || 10),
      };
    });

  return {
    cycles: [...cyclesWithOverrides, ...manualCycles],
    transactions: projectedTransactions,
  };
}

async function readAllStatements(accountId: string): Promise<PersistedStatementRow[]> {
  return collectPaginatedRows<PersistedStatementRow>(async (from, to) => {
    const { data, error } = await supabase
      .from('credit_card_statements')
      .select(
        'id,card_id,reference_label,due_year,due_month,due_date,total_charges,total_credits,total_payments,open_amount,statement_total,open_balance,manual_totals_json,statement_total_from_file,total_payments_from_file'
      )
      .eq('account_id', accountId)
      .order('id', { ascending: true })
      .range(from, to);
    return { data: (data as PersistedStatementRow[] | null) || null, error };
  });
}

async function readAllEngineEntries(accountId: string): Promise<PersistedEngineEntryRow[]> {
  return collectPaginatedRows<PersistedEngineEntryRow>(async (from, to) => {
    const { data, error } = await supabase
      .from('credit_card_entries')
      .select('id,statement_id,transaction_id,posted_date,amount,entry_type')
      .eq('account_id', accountId)
      .order('id', { ascending: true })
      .range(from, to);
    return { data: (data as PersistedEngineEntryRow[] | null) || null, error };
  });
}

async function readAllLegacyItems(accountId: string): Promise<PersistedLegacyItemRow[]> {
  return collectPaginatedRows<PersistedLegacyItemRow>(async (from, to) => {
    const { data, error } = await supabase
      .from('credit_card_statement_items')
      .select('id,statement_id,transaction_id,posted_date,amount,item_type')
      .eq('account_id', accountId)
      .order('id', { ascending: true })
      .range(from, to);
    return { data: (data as PersistedLegacyItemRow[] | null) || null, error };
  });
}

async function readAllPayments(statementIds: string[]): Promise<PersistedPaymentRow[]> {
  if (statementIds.length === 0) return [];
  return collectPaginatedRows<PersistedPaymentRow>(async (from, to) => {
    const { data, error } = await supabase
      .from('credit_card_payments')
      .select('id,statement_id,payment_transaction_id,payment_date,amount,source,notes,created_at')
      .in('statement_id', statementIds)
      .order('id', { ascending: true })
      .range(from, to);
    return { data: (data as PersistedPaymentRow[] | null) || null, error };
  });
}

/**
 * Fotografa a projeção atual usando somente SELECT paginado.
 * Nenhum caminho desta função cria cartão, fatura, job ou item.
 */
export async function readPersistedAtomicCardProjection(
  accountId: string
): Promise<PersistedAtomicCardProjection> {
  const [statementRows, engineRows, legacyRows] = await Promise.all([
    readAllStatements(accountId),
    readAllEngineEntries(accountId),
    readAllLegacyItems(accountId),
  ]);
  const paymentRows = await readAllPayments(statementRows.map((row) => row.id));

  const source: PersistedAtomicCardProjection['source'] =
    engineRows.length > 0 || paymentRows.length > 0 || statementRows.some((row) => Boolean(row.card_id))
      ? 'engine'
      : legacyRows.length > 0 || statementRows.length > 0
        ? 'legacy'
        : 'none';
  const statementKeyById = new Map(statementRows.map((row) => [row.id, statementKeyForRow(row)]));

  const entries: PersistedAtomicCardEntry[] =
    source === 'engine'
      ? engineRows.map((row) => ({
          transactionId: String(row.transaction_id || `engine-row:${row.id}`),
          statementKey: statementKeyById.get(String(row.statement_id || '')) || 'sem-competencia',
          postedDate: row.posted_date || null,
          amountCents: toCents(row.amount),
          entryType: row.entry_type || 'needs_review',
        }))
      : legacyRows.map((row) => ({
          transactionId: String(row.transaction_id || `legacy-row:${row.id}`),
          statementKey: statementKeyById.get(row.statement_id) || 'sem-competencia',
          postedDate: row.posted_date || null,
          amountCents: toCents(row.amount),
          entryType: legacyItemTypeToEngine(row.item_type),
        }));

  const entryCountByStatement = new Map<string, number>();
  entries.forEach((entry) => {
    entryCountByStatement.set(
      entry.statementKey,
      (entryCountByStatement.get(entry.statementKey) || 0) + 1
    );
  });

  const statements: PersistedAtomicCardStatement[] = statementRows.map((row) => {
    const statementKey = statementKeyForRow(row);
    const legacyTotal = Number(row.total_charges || 0) - Number(row.total_credits || 0);
    return {
      statementKey,
      dueDate: row.due_date || null,
      entryCount: entryCountByStatement.get(statementKey) || 0,
      statementTotalCents: toCents(source === 'engine' ? row.statement_total : legacyTotal),
      totalPaymentsCents: toCents(row.total_payments),
      openBalanceCents: toCents(source === 'engine' ? row.open_balance : row.open_amount),
      hasProtectedMetadata:
        row.manual_totals_json != null ||
        row.statement_total_from_file != null ||
        row.total_payments_from_file != null,
      manualTotalsPresent: row.manual_totals_json != null,
      statementTotalFromFileCents:
        row.statement_total_from_file != null ? toCents(row.statement_total_from_file) : null,
      totalPaymentsFromFileCents:
        row.total_payments_from_file != null ? toCents(row.total_payments_from_file) : null,
    };
  });
  const payments: PersistedAtomicCardPayment[] = paymentRows.map((row) => ({
    rowId: row.id,
    transactionId: row.payment_transaction_id || null,
    statementKey: statementKeyById.get(row.statement_id) || 'sem-competencia',
    paymentDate: row.payment_date || null,
    amountCents: toCents(row.amount),
    source: row.source || 'manual',
    notes: row.notes || null,
    createdAt: row.created_at || null,
  }));

  statements.sort((left, right) => left.statementKey.localeCompare(right.statementKey));
  entries.sort((left, right) => {
    const byStatement = left.statementKey.localeCompare(right.statementKey);
    if (byStatement !== 0) return byStatement;
    return left.transactionId.localeCompare(right.transactionId);
  });
  payments.sort((left, right) => {
    const byStatement = left.statementKey.localeCompare(right.statementKey);
    if (byStatement !== 0) return byStatement;
    return left.rowId.localeCompare(right.rowId);
  });

  return { source, statements, entries, payments };
}

export const creditCardAtomicRebuildService = {
  /**
   * Prévia integral e somente leitura. Diferenças são relatadas; nunca aplicadas.
   */
  async audit(input: {
    account: Account;
    cycles: AtomicCardRebuildCycle[];
    transactions: Transaction[];
    importLogs?: ImportLog[];
    rules?: ClassificationRules;
  }): Promise<AtomicCardRebuildAuditResult> {
    const prepared = prepareAtomicCardShadowSource(input);
    const shadow = buildAtomicCardRebuildShadow({
      ...input,
      cycles: prepared.cycles,
      transactions: prepared.transactions,
    });
    const persisted = await readPersistedAtomicCardProjection(input.account.id);
    const comparison = compareAtomicCardProjections(shadow, persisted);
    return { shadow, persisted, comparison };
  },
};
