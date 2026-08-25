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
  prepareAtomicCardStatementConservationExecution,
} from '../domain/credit-card/atomicRebuildStatementConservationExecution';
import type { AtomicCardStatementConservationPlanReport } from '../domain/credit-card/atomicRebuildStatementConservationPlan';
import { buildAtomicCardProvenanceReport } from '../domain/credit-card/atomicRebuildProvenance';
import { prepareAtomicCardDerivedSettlementExecution } from '../domain/credit-card/atomicRebuildDerivedSettlementExecution';
import {
  parseDueFromReferenceMonth,
  referenceMonthFromTransaction,
} from './creditCardManualCompetence';
import { manualMotorOriginKey } from './creditCardManualMotorSync';
import { supabase } from '../supabaseClient';
import { collectPaginatedRows } from '../utils/paginatedFetch';
import { comparableImportOriginKey } from '../utils/importOriginKey';
import { toDateOnlyIso } from '../utils/dateOnly';

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
  status?: 'open' | 'closed' | 'partial' | 'paid' | 'overdue' | null;
  manual_totals_json?: unknown;
  statement_total_from_file?: number | string | null;
  total_payments_from_file?: number | string | null;
  lines_computed_total?: number | string | null;
  atomic_projection_version?: number | null;
  atomic_projection_checksum?: string | null;
  atomic_projection_snapshot_id?: string | null;
}

interface PersistedEngineEntryRow {
  id: string;
  source_file_name?: string | null;
  source_row_index?: number | null;
  source_row_hash?: string | null;
  import_lot_id?: string | null;
  created_at?: string | null;
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

export interface AtomicCardPaymentRepairResult {
  snapshotId: string;
  beforeRevision: string;
  afterRevision: string;
  deletedPayments: number;
  postRepairAudit: AtomicCardRebuildAuditResult;
}

export interface AtomicCardPaymentRepairRollbackAvailability {
  snapshotId: string;
  accountId: string;
  appliedAt: string;
}

export interface AtomicCardPaymentRepairRollbackResult {
  snapshotId: string;
  accountId: string;
  restoredRevision: string;
  restoredPayments: number;
  rolledBack: boolean;
}

export interface AtomicCardStatementConservationResult {
  snapshotId: string;
  beforeRevision: string;
  afterRevision: string;
  sourceStatements: number;
  compositeStatements: 1;
  entriesRelinked: number;
  legacyItemsRelinked: number;
  paymentsRelinked: number;
  postConservationAudit: AtomicCardRebuildAuditResult;
}

export interface AtomicCardStatementConservationRollbackAvailability {
  snapshotId: string;
  accountId: string;
  statementKey: string;
  appliedAt: string;
}

export interface AtomicCardStatementConservationRollbackResult {
  snapshotId: string;
  accountId: string;
  restoredRevision: string;
  restoredStatements: number;
  restoredEntries: number;
  restoredLegacyItems: number;
  restoredPayments: number;
  rolledBack: boolean;
}

export interface AtomicCardDerivedSettlementReconciliationResult {
  snapshotId: string;
  beforeRevision: string;
  afterRevision: string;
  statementsUpdated: number;
  entryRecordsChanged: 0;
  paymentRecordsChanged: 0;
  postReconciliationAudit: AtomicCardRebuildAuditResult;
}

export interface AtomicCardDerivedSettlementRollbackAvailability {
  snapshotId: string;
  accountId: string;
  shadowChecksum: string;
  appliedAt: string;
}

export interface AtomicCardDerivedSettlementRollbackResult {
  snapshotId: string;
  restoredRevision: string;
  restoredStatements: number;
  entryRecordsChanged: 0;
  paymentRecordsChanged: 0;
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

  // Registros legados não possuem due_year/due_month, mas preservam a
  // competência real em reference_label. O vencimento costuma cair no mês
  // seguinte e, portanto, só pode ser usado como último recurso; priorizá-lo
  // aqui cria uma falsa duplicidade entre competências consecutivas.
  const referenceLabel = String(row.reference_label || '').trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(referenceLabel)) return referenceLabel;

  const dueDate = String(row.due_date || '');
  if (/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(dueDate)) return dueDate.slice(0, 7);
  return referenceLabel || 'sem-competencia';
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
        'id,card_id,reference_label,due_year,due_month,due_date,total_charges,total_credits,total_payments,open_amount,statement_total,open_balance,status,manual_totals_json,statement_total_from_file,total_payments_from_file,lines_computed_total,atomic_projection_version,atomic_projection_checksum,atomic_projection_snapshot_id'
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
      .select(
        'id,statement_id,transaction_id,posted_date,amount,entry_type,source_file_name,source_row_index,source_row_hash,import_lot_id,created_at'
      )
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
          rowId: row.id,
          sourceFileName: row.source_file_name || null,
          sourceRowIndex:
            row.source_row_index === null || row.source_row_index === undefined
              ? null
              : Number(row.source_row_index),
          sourceRowHash: row.source_row_hash || null,
          importLotId: row.import_lot_id || null,
          createdAt: row.created_at || null,
          transactionId: String(row.transaction_id || `engine-row:${row.id}`),
          statementKey: statementKeyById.get(String(row.statement_id || '')) || 'sem-competencia',
          postedDate: row.posted_date || null,
          amountCents: toCents(row.amount),
          entryType: row.entry_type || 'needs_review',
        }))
      : legacyRows.map((row) => ({
          rowId: row.id,
          transactionId: String(row.transaction_id || `legacy-row:${row.id}`),
          statementKey: statementKeyById.get(row.statement_id) || 'sem-competencia',
          postedDate: row.posted_date || null,
          amountCents: toCents(row.amount),
          entryType: legacyItemTypeToEngine(row.item_type),
        }));

  // Keep the count tied to the physical statement row. Grouping by competence
  // would assign the combined count to every duplicate record and hide which
  // one actually owns the persisted entries during the read-only audit.
  const entryCountByStatementId = new Map<string, number>();
  const persistedEntryRows = source === 'engine' ? engineRows : legacyRows;
  persistedEntryRows.forEach((row) => {
    const statementId = String(row.statement_id || '');
    if (!statementId) return;
    entryCountByStatementId.set(
      statementId,
      (entryCountByStatementId.get(statementId) || 0) + 1
    );
  });

  const statements: PersistedAtomicCardStatement[] = statementRows.map((row) => {
    const statementKey = statementKeyForRow(row);
    const legacyTotal = Number(row.total_charges || 0) - Number(row.total_credits || 0);
    return {
      rowId: row.id,
      cardId: row.card_id || null,
      referenceLabel: row.reference_label || null,
      statementKey,
      dueDate: row.due_date || null,
      entryCount: entryCountByStatementId.get(row.id) || 0,
      statementTotalCents: toCents(source === 'engine' ? row.statement_total : legacyTotal),
      totalPaymentsCents: toCents(row.total_payments),
      openBalanceCents: toCents(source === 'engine' ? row.open_balance : row.open_amount),
      openAmountCents: toCents(row.open_amount),
      status: row.status || 'open',
      hasProtectedMetadata:
        row.manual_totals_json != null ||
        row.statement_total_from_file != null ||
        row.total_payments_from_file != null ||
        row.lines_computed_total != null,
      manualTotalsPresent: row.manual_totals_json != null,
      manualTotalsJson: row.manual_totals_json ?? null,
      statementTotalFromFileCents:
        row.statement_total_from_file != null ? toCents(row.statement_total_from_file) : null,
      totalPaymentsFromFileCents:
        row.total_payments_from_file != null ? toCents(row.total_payments_from_file) : null,
      linesComputedTotalCents:
        row.lines_computed_total != null ? toCents(row.lines_computed_total) : null,
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

/**
 * Preserva somente classificações com uma identidade atual inequívoca.
 *
 * Em projeções históricas corrompidas, um mesmo ID imutável pode aparecer em
 * mais de uma linha materializada. Ainda é seguro recuperar a classificação
 * quando exatamente uma dessas linhas coincide com a transação-fonte em data
 * civil e valor em centavos. Zero ou múltiplas coincidências continuam fora do
 * mapa e são expostas como ambiguidade pela comparação; nada é escolhido por
 * ordem, data de criação ou outra heurística frágil.
 */
const persistedEntryTypesForShadow = (
  persisted: PersistedAtomicCardProjection,
  transactions: Transaction[]
): ReadonlyMap<string, string> => {
  const rowsByTransactionId = new Map<string, PersistedAtomicCardEntry[]>();
  persisted.entries.forEach((entry) => {
    if (/^(engine|legacy)-row:/.test(entry.transactionId)) return;
    const rows = rowsByTransactionId.get(entry.transactionId) || [];
    rows.push(entry);
    rowsByTransactionId.set(entry.transactionId, rows);
  });

  const transactionsById = new Map(
    transactions
      .filter((transaction) => Boolean(transaction.ID_Transacao))
      .map((transaction) => [String(transaction.ID_Transacao), transaction])
  );

  return new Map(
    Array.from(rowsByTransactionId.entries())
      .map(([transactionId, rows]) => {
        if (rows.length === 1) return [transactionId, rows[0].entryType] as const;

        const transaction = transactionsById.get(transactionId);
        if (!transaction) return null;
        const sourceDate = toDateOnlyIso(transaction.Data);
        const sourceAmountCents = toCents(transaction.Valor);
        const matchingRows = rows.filter(
          (row) =>
            row.postedDate === sourceDate &&
            row.amountCents === sourceAmountCents
        );
        return matchingRows.length === 1
          ? ([transactionId, matchingRows[0].entryType] as const)
          : null;
      })
      .filter((entry): entry is readonly [string, string] => entry !== null)
  );
};

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

  async isStatementConservationEnabled(): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc(
        'get_atomic_card_statement_conservation_feature_state'
      );
      return !error && data === 'enabled';
    } catch {
      return false;
    }
  },

  async isDerivedSettlementReconciliationEnabled(): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc(
        'get_atomic_card_derived_settlement_feature_state'
      );
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
    const revisionBefore = await readProjectionRevision(input.account.id);
    const persisted = await readPersistedAtomicCardProjection(input.account.id);
    const shadow = buildAtomicCardRebuildShadow({
      ...input,
      cycles: prepared.cycles,
      transactions: prepared.transactions,
      persistedEntryTypesByTransactionId: persistedEntryTypesForShadow(
        persisted,
        prepared.transactions
      ),
    });
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
    const { data, error } = await supabase.rpc('activate_credit_card_projection_atomic_v2', {
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

  /**
   * Remove somente materializações antigas de pagamento que a auditoria
   * classificou como reparáveis de forma determinística. O banco repete todas
   * as guardas sob lock e cria um snapshot próprio antes de qualquer delete.
   */
  async repairDeterministicPaymentDuplicates(
    input: AtomicAuditInput,
    expectedAudit: AtomicCardRebuildAuditResult
  ): Promise<AtomicCardPaymentRepairResult> {
    if (!(await this.isActivationEnabled())) {
      throw new Error('O reparo atômico de cartão não está habilitado para esta conta.');
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

    const expectedRows = [...expectedAudit.comparison.repairablePersistedPaymentRowIds].sort();
    const freshRows = [...freshAudit.comparison.repairablePersistedPaymentRowIds].sort();
    if (
      freshRows.length === 0 ||
      freshRows.length !== expectedRows.length ||
      freshRows.some((rowId, index) => rowId !== expectedRows[index])
    ) {
      throw new Error(
        'As candidatas ao reparo deixaram de coincidir exatamente com a auditoria exibida. Nenhum dado foi alterado.'
      );
    }

    const { data, error } = await supabase.rpc(
      'repair_credit_card_payment_duplicates_atomic_v1',
      {
        p_account_id: input.account.id,
        p_expected_revision: freshAudit.persistedRevision,
        p_payment_row_ids: freshRows,
      }
    );
    if (error) throw error;

    const row = (data || {}) as Record<string, unknown>;
    const snapshotId = String(row.snapshot_id || '');
    if (!snapshotId) throw new Error('O reparo não retornou o snapshot de rollback.');

    const postRepairAudit = await this.audit(input);
    const remainingRepairRows = postRepairAudit.comparison.repairablePersistedPaymentRowIds;
    const deletedPayments = Number(row.deleted_payments || 0);
    if (
      deletedPayments !== freshRows.length ||
      remainingRepairRows.some((rowId) => freshRows.includes(rowId))
    ) {
      throw new Error(
        `O reparo foi confirmado, mas a verificação posterior divergiu. Snapshot ${snapshotId} disponível para rollback.`
      );
    }

    return {
      snapshotId,
      beforeRevision: String(row.before_revision || freshAudit.persistedRevision),
      afterRevision: String(row.after_revision || postRepairAudit.persistedRevision),
      deletedPayments,
      postRepairAudit,
    };
  },

  /**
   * Consolida somente uma competência integralmente reauditada. Não há botão
   * de UI para este método na Sprint 2O; a flag dedicada também nasce desligada.
   */
  async conserveDuplicateStatementGroup(
    input: AtomicAuditInput,
    expectedAudit: AtomicCardRebuildAuditResult,
    expectedPlan: AtomicCardStatementConservationPlanReport
  ): Promise<AtomicCardStatementConservationResult> {
    if (!(await this.isStatementConservationEnabled())) {
      throw new Error(
        'A conservação atômica de faturas não está habilitada para esta conta.'
      );
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

    const preparation = prepareAtomicCardStatementConservationExecution({
      shadow: freshAudit.shadow,
      persisted: freshAudit.persisted,
      comparison: freshAudit.comparison,
      conservationPlan: expectedPlan,
      persistedRevision: freshAudit.persistedRevision,
    });
    if (!preparation.request) {
      throw new Error(
        `O contrato transacional da conservação foi recusado (${preparation.report.blockerCodes.join(', ') || preparation.report.status}). Nenhum dado foi alterado.`
      );
    }

    const request = preparation.request;
    const { data, error } = await supabase.rpc(
      'conserve_credit_card_statement_duplicates_atomic_v1',
      {
        p_account_id: request.accountId,
        p_expected_revision: request.expectedRevision,
        p_shadow_checksum: request.shadowChecksum,
        p_statement_key: request.statementKey,
        p_source_statement_ids: request.sourceStatementIds,
        p_expected_entry_link_count: request.expectedEntryLinkCount,
        p_expected_payment_link_count: request.expectedPaymentLinkCount,
        p_composite: request.composite,
      }
    );
    if (error) throw error;

    const row = (data || {}) as Record<string, unknown>;
    const snapshotId = String(row.snapshot_id || '');
    if (!snapshotId) {
      throw new Error('A conservação não retornou o snapshot de rollback.');
    }

    const postConservationAudit = await this.audit(input);
    const sourceStatements = Number(row.source_statements || 0);
    const entriesRelinked = Number(row.entries_relinked || 0);
    const paymentsRelinked = Number(row.payments_relinked || 0);
    const statementCountDelta =
      freshAudit.persisted.statements.length - postConservationAudit.persisted.statements.length;
    if (
      postConservationAudit.comparison.duplicatePersistedStatementKeys.includes(
        request.statementKey
      ) ||
      statementCountDelta !== sourceStatements - 1 ||
      postConservationAudit.persisted.entries.length !== freshAudit.persisted.entries.length ||
      postConservationAudit.persisted.payments.length !== freshAudit.persisted.payments.length ||
      entriesRelinked !== request.expectedEntryLinkCount ||
      paymentsRelinked !== request.expectedPaymentLinkCount
    ) {
      throw new Error(
        `A conservação foi confirmada, mas a verificação posterior divergiu. Snapshot ${snapshotId} disponível para rollback.`
      );
    }

    return {
      snapshotId,
      beforeRevision: String(row.before_revision || freshAudit.persistedRevision),
      afterRevision: String(
        row.after_revision || postConservationAudit.persistedRevision
      ),
      sourceStatements,
      compositeStatements: 1,
      entriesRelinked,
      legacyItemsRelinked: Number(row.legacy_items_relinked || 0),
      paymentsRelinked,
      postConservationAudit,
    };
  },

  /**
   * Reaudita e corrige somente os quatro campos derivados de quitação nas
   * faturas físicas existentes. O RPC repete as guardas, cria snapshot e não
   * recebe payload capaz de tocar identidades, competências ou pagamentos.
   */
  async reconcileDerivedSettlement(
    input: AtomicAuditInput,
    expectedAudit: AtomicCardRebuildAuditResult
  ): Promise<AtomicCardDerivedSettlementReconciliationResult> {
    if (!(await this.isDerivedSettlementReconciliationEnabled())) {
      throw new Error(
        'A reconciliação derivada Sprint 2T não está habilitada para esta conta.'
      );
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

    const provenance = buildAtomicCardProvenanceReport(
      freshAudit.shadow,
      freshAudit.persisted,
      freshAudit.comparison
    );
    const preparation = prepareAtomicCardDerivedSettlementExecution({
      shadow: freshAudit.shadow,
      persisted: freshAudit.persisted,
      comparison: freshAudit.comparison,
      provenance,
      cycles: input.cycles.map((cycle) => ({
        sourceFileName: cycle.fileName,
        referenceMonth: cycle.referenceMonth,
        dueDate: cycle.dueDate,
        source: 'confirmed-import-history' as const,
      })),
      closingDay: input.account.dia_fechamento,
      persistedRevision: freshAudit.persistedRevision,
    });
    if (!preparation.request) {
      throw new Error(
        `O contrato reversível foi recusado (${preparation.report.blockerCodes.join(', ') || preparation.report.status}). Nenhum dado foi alterado.`
      );
    }

    const request = preparation.request;
    const { data, error } = await supabase.rpc(
      'reconcile_credit_card_derived_settlement_atomic_v1',
      {
        p_account_id: request.accountId,
        p_expected_revision: request.expectedRevision,
        p_shadow_checksum: request.shadowChecksum,
        p_statement_updates: request.statementUpdates,
      }
    );
    if (error) throw error;

    const row = (data || {}) as Record<string, unknown>;
    const snapshotId = String(row.snapshot_id || '');
    if (!snapshotId) {
      throw new Error('A reconciliação não retornou o snapshot de rollback.');
    }

    const statementsUpdated = Number(row.statements_updated || 0);
    const entryRecordsChanged = Number(row.entry_records_changed || 0);
    const paymentRecordsChanged = Number(row.payment_records_changed || 0);
    let postReconciliationAudit: AtomicCardRebuildAuditResult;
    try {
      postReconciliationAudit = await this.audit(input);
      if (
        statementsUpdated !== request.statementUpdates.length ||
        entryRecordsChanged !== 0 ||
        paymentRecordsChanged !== 0 ||
        postReconciliationAudit.comparison.structuralDifferenceCount !== 0 ||
        postReconciliationAudit.persisted.statements.length !==
          freshAudit.persisted.statements.length ||
        postReconciliationAudit.persisted.entries.length !==
          freshAudit.persisted.entries.length ||
        postReconciliationAudit.persisted.payments.length !==
          freshAudit.persisted.payments.length
      ) {
        throw new Error('A auditoria posterior não confirmou as invariantes do contrato.');
      }
    } catch (verificationError: unknown) {
      let automaticRollbackSucceeded = false;
      try {
        const rollback = await this.rollbackDerivedSettlement(snapshotId);
        automaticRollbackSucceeded = rollback.rolledBack;
      } catch {
        // O erro final mantém o snapshot explícito para recuperação manual.
      }
      const verificationMessage =
        verificationError instanceof Error
          ? verificationError.message
          : 'Falha desconhecida na auditoria posterior.';
      if (automaticRollbackSucceeded) {
        throw new Error(
          `A verificação posterior falhou e o rollback automático restaurou o estado anterior. Motivo: ${verificationMessage}`
        );
      }
      throw new Error(
        `A verificação posterior falhou e o rollback automático não foi confirmado. Snapshot ${snapshotId} preservado para recuperação. Motivo: ${verificationMessage}`
      );
    }

    return {
      snapshotId,
      beforeRevision: String(row.before_revision || freshAudit.persistedRevision),
      afterRevision: String(
        row.after_revision || postReconciliationAudit.persistedRevision
      ),
      statementsUpdated,
      entryRecordsChanged: 0,
      paymentRecordsChanged: 0,
      postReconciliationAudit,
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

  async latestPaymentRepairRollback(
    accountId: string
  ): Promise<AtomicCardPaymentRepairRollbackAvailability | null> {
    const { data, error } = await supabase
      .from('credit_card_atomic_repair_snapshots')
      .select('id,account_id,applied_at,after_revision')
      .eq('account_id', accountId)
      .eq('repair_kind', 'duplicate_imported_payment')
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
      appliedAt: String(data.applied_at),
    };
  },

  async rollbackPaymentRepair(
    snapshotId: string
  ): Promise<AtomicCardPaymentRepairRollbackResult> {
    const { data, error } = await supabase.rpc(
      'rollback_credit_card_payment_repair_atomic_v1',
      { p_snapshot_id: snapshotId }
    );
    if (error) throw error;
    const row = (data || {}) as Record<string, unknown>;
    return {
      snapshotId: String(row.snapshot_id || snapshotId),
      accountId: String(row.account_id || ''),
      restoredRevision: String(row.restored_revision || ''),
      restoredPayments: Number(row.restored_payments || 0),
      rolledBack: Boolean(row.rolled_back),
    };
  },

  async latestStatementConservationRollback(
    accountId: string
  ): Promise<AtomicCardStatementConservationRollbackAvailability | null> {
    const { data, error } = await supabase
      .from('credit_card_statement_conservation_snapshots')
      .select('id,account_id,statement_key,applied_at,after_revision')
      .eq('account_id', accountId)
      .eq('operation_kind', 'duplicate_statement_conservation')
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
      statementKey: String(data.statement_key),
      appliedAt: String(data.applied_at),
    };
  },

  async rollbackStatementConservation(
    snapshotId: string
  ): Promise<AtomicCardStatementConservationRollbackResult> {
    const { data, error } = await supabase.rpc(
      'rollback_credit_card_statement_conservation_atomic_v1',
      { p_snapshot_id: snapshotId }
    );
    if (error) throw error;
    const row = (data || {}) as Record<string, unknown>;
    return {
      snapshotId: String(row.snapshot_id || snapshotId),
      accountId: String(row.account_id || ''),
      restoredRevision: String(row.restored_revision || ''),
      restoredStatements: Number(row.restored_statements || 0),
      restoredEntries: Number(row.restored_entries || 0),
      restoredLegacyItems: Number(row.restored_legacy_items || 0),
      restoredPayments: Number(row.restored_payments || 0),
      rolledBack: Boolean(row.rolled_back),
    };
  },

  async latestDerivedSettlementRollback(
    accountId: string
  ): Promise<AtomicCardDerivedSettlementRollbackAvailability | null> {
    const { data, error } = await supabase
      .from('credit_card_reconciliation_snapshots')
      .select('id,account_id,shadow_checksum,applied_at,after_revision')
      .eq('account_id', accountId)
      .eq('operation_kind', 'derived_settlement_reconciliation')
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

  async rollbackDerivedSettlement(
    snapshotId: string
  ): Promise<AtomicCardDerivedSettlementRollbackResult> {
    const { data, error } = await supabase.rpc(
      'rollback_credit_card_derived_settlement_atomic_v1',
      { p_snapshot_id: snapshotId }
    );
    if (error) throw error;
    const row = (data || {}) as Record<string, unknown>;
    return {
      snapshotId: String(row.snapshot_id || snapshotId),
      restoredRevision: String(row.restored_revision || ''),
      restoredStatements: Number(row.statements_restored || 0),
      entryRecordsChanged: 0,
      paymentRecordsChanged: 0,
      rolledBack: Boolean(row.rolled_back),
    };
  },
};
