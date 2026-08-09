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
  atomic_projection_version?: number | null;
  atomic_projection_checksum?: string | null;
  atomic_projection_snapshot_id?: string | null;
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
  /** Revisão opaca calculada no banco antes e depois da leitura paginada. */
  persistedRevision: string;
}

export interface AtomicCardActivationResult {
  snapshotId: string;
  shadowChecksum: string;
  beforeRevision: string;
  afterRevision: string;
  statementsUpdated: number;
  entriesUpdated: number;
  paymentsUpdated: number;
  postActivationAudit: AtomicCardRebuildAuditResult;
}

export interface AtomicCardRollbackAvailability {
  snapshotId: string;
  accountId: string;
  shadowChecksum: string;
  appliedAt: string;
}

export interface AtomicCardRollbackResult {
  snapshotId: string;
  accountId: string;
  restoredRevision: string;
  rolledBack: boolean;
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
        'id,card_id,reference_label,due_year,due_month,due_date,total_charges,total_credits,total_payments,open_amount,statement_total,open_balance,manual_totals_json,statement_total_from_file,total_payments_from_file,atomic_projection_version,atomic_projection_checksum,atomic_projection_snapshot_id'
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

async function readProjectionRevision(accountId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_credit_card_projection_revision', {
    p_account_id: accountId,
  });
  if (error) throw error;
  const revision = String(data || '');
  if (!/^[a-f0-9]{32}$/.test(revision)) {
    throw new Error('O banco não retornou uma revisão válida para a projeção do cartão.');
  }
  return revision;
}

const buildAudit = (
  shadow: AtomicCardShadowProjection,
  persisted: PersistedAtomicCardProjection,
  persistedRevision: string
): AtomicCardRebuildAuditResult => ({
  shadow,
  persisted,
  comparison: compareAtomicCardProjections(shadow, persisted),
  persistedRevision,
});

const toActivationPayload = (shadow: AtomicCardShadowProjection) => ({
  statements: shadow.statements.map((statement) => ({
    statementKey: statement.statementKey,
    purchaseReferenceMonth: statement.purchaseReferenceMonth,
    dueDate: statement.dueDate,
    dueYear: statement.dueYear,
    dueMonth: statement.dueMonth,
    status: statement.status,
    totalPurchasesCents: statement.totalPurchasesCents,
    totalFeesCents: statement.totalFeesCents,
    totalInterestCents: statement.totalInterestCents,
    totalRefundsCents: statement.totalRefundsCents,
    statementTotalCents: statement.statementTotalCents,
    totalPaymentsCents: statement.totalPaymentsCents,
    openBalanceCents: statement.openBalanceCents,
  })),
  entries: shadow.entries.map((entry) => ({
    transactionId: entry.transactionId,
    statementKey: entry.statementKey,
    postedDate: entry.postedDate,
    amountCents: entry.amountCents,
    entryType: entry.entryType,
  })),
  payments: shadow.payments.map((payment) => ({
    transactionId: payment.transactionId,
    statementKey: payment.statementKey,
    paymentDate: payment.paymentDate,
    amountCents: payment.amountCents,
    source: payment.source,
  })),
});

type AtomicAuditInput = {
  account: Account;
  cycles: AtomicCardRebuildCycle[];
  transactions: Transaction[];
  importLogs?: ImportLog[];
  rules?: ClassificationRules;
};

export const creditCardAtomicRebuildService = {
  async isActivationEnabled(): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('get_atomic_card_rebuild_feature_state');
      return !error && data === 'enabled';
    } catch {
      return false;
    }
  },

  /**
   * Prévia integral e somente leitura. Diferenças são relatadas; nunca aplicadas.
   */
  async audit(input: AtomicAuditInput): Promise<AtomicCardRebuildAuditResult> {
    const prepared = prepareAtomicCardShadowSource(input);
    const shadow = buildAtomicCardRebuildShadow({
      ...input,
      cycles: prepared.cycles,
      transactions: prepared.transactions,
    });
    const revisionBefore = await readProjectionRevision(input.account.id);
    const persisted = await readPersistedAtomicCardProjection(input.account.id);
    const revisionAfter = await readProjectionRevision(input.account.id);
    if (revisionBefore !== revisionAfter) {
      throw new Error(
        'A projeção do cartão mudou durante a auditoria. Nenhum dado foi alterado; execute a auditoria novamente.'
      );
    }
    return buildAudit(shadow, persisted, revisionAfter);
  },

  /**
   * Reaudita imediatamente e envia a projeção ao único RPC que pode gravá-la.
   * O banco repete as guardas sob lock e salva o snapshot na mesma transação.
   */
  async activate(
    input: AtomicAuditInput,
    expectedAudit: AtomicCardRebuildAuditResult
  ): Promise<AtomicCardActivationResult> {
    if (!(await this.isActivationEnabled())) {
      throw new Error('A ativação atômica de cartão não está habilitada para esta conta.');
    }
    const freshAudit = await this.audit(input);
    if (
      freshAudit.shadow.checksum !== expectedAudit.shadow.checksum ||
      freshAudit.persistedRevision !== expectedAudit.persistedRevision
    ) {
      throw new Error(
        'A projeção mudou depois da auditoria exibida. Nenhum dado foi alterado; audite novamente.'
      );
    }
    if (!freshAudit.comparison.safeToActivate) {
      throw new Error(
        'A auditoria atual não permite uma ativação somente por atualização. Nenhum dado foi alterado.'
      );
    }

    const payload = toActivationPayload(freshAudit.shadow);
    const { data, error } = await supabase.rpc('activate_credit_card_projection_atomic', {
      p_account_id: input.account.id,
      p_expected_revision: freshAudit.persistedRevision,
      p_shadow_checksum: freshAudit.shadow.checksum,
      p_statements: payload.statements,
      p_entries: payload.entries,
      p_payments: payload.payments,
    });
    if (error) throw error;

    const row = (data || {}) as Record<string, unknown>;
    const snapshotId = String(row.snapshot_id || '');
    if (!snapshotId) throw new Error('A ativação não retornou o snapshot de rollback.');

    const postActivationAudit = await this.audit(input);
    if (
      postActivationAudit.shadow.checksum !== freshAudit.shadow.checksum ||
      postActivationAudit.comparison.structuralDifferenceCount !== 0
    ) {
      throw new Error(
        `A ativação foi confirmada, mas a verificação posterior divergiu. Snapshot ${snapshotId} disponível para rollback.`
      );
    }

    return {
      snapshotId,
      shadowChecksum: String(row.shadow_checksum || freshAudit.shadow.checksum),
      beforeRevision: String(row.before_revision || freshAudit.persistedRevision),
      afterRevision: String(row.after_revision || postActivationAudit.persistedRevision),
      statementsUpdated: Number(row.statements_updated || 0),
      entriesUpdated: Number(row.entries_updated || 0),
      paymentsUpdated: Number(row.payments_updated || 0),
      postActivationAudit,
    };
  },

  async latestRollback(accountId: string): Promise<AtomicCardRollbackAvailability | null> {
    const { data, error } = await supabase
      .from('credit_card_atomic_rebuild_snapshots')
      .select('id,account_id,shadow_checksum,applied_at,after_revision')
      .eq('account_id', accountId)
      .is('rolled_back_at', null)
      .not('after_revision', 'is', null)
      .order('applied_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const currentRevision = await readProjectionRevision(accountId);
    if (String(data.after_revision || '') !== currentRevision) return null;
    return {
      snapshotId: String(data.id),
      accountId: String(data.account_id),
      shadowChecksum: String(data.shadow_checksum),
      appliedAt: String(data.applied_at),
    };
  },

  async rollback(snapshotId: string): Promise<AtomicCardRollbackResult> {
    const { data, error } = await supabase.rpc('rollback_credit_card_projection_atomic', {
      p_snapshot_id: snapshotId,
    });
    if (error) throw error;
    const row = (data || {}) as Record<string, unknown>;
    return {
      snapshotId: String(row.snapshot_id || snapshotId),
      accountId: String(row.account_id || ''),
      restoredRevision: String(row.restored_revision || ''),
      rolledBack: Boolean(row.rolled_back),
    };
  },
};
