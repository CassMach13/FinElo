import { supabase } from '../supabaseClient';
import { Account, Transaction } from '../types';
import { creditCardStatementEngine } from '../domain/credit-card/creditCardStatementEngine';
import {
  mergePaymentsWithInvoiceLinesFromFutureStatements,
  getPreviousStatementRow,
  inferStatusFromTotals,
  resolveImportedInvoicePaymentTarget,
} from '../domain/credit-card/payments';
import {
  ClassificationOverrides,
  ClassificationRules,
  inferDirection,
} from '../domain/credit-card/classifiers';
import {
  CreditCardEntryType,
  CreditCardImportEntry,
  CreditCardPayment,
  CreditCardStatement,
  CreditCardStatementAudit,
  CreditCardManualTotalsPayload,
} from '../domain/credit-card/types';
import { sumInvoicePaymentsFromClassifiedEntries } from '../utils/parseCreditCardFileTotals';
import { toDateOnlyIso } from '../utils/dateOnly';
import { collectPaginatedRows } from '../utils/paginatedFetch';
import {
  planCreditCardEntryPersistence,
  type ExistingCreditCardEntryIdentity,
} from '../utils/creditCardEntryIntegrity';
import {
  assertUniqueImportedPaymentBatch,
  planImportedPaymentPersistence,
  type ExistingImportedPaymentIdentity,
} from '../utils/creditCardPaymentIntegrity';

const round2 = (value: number): number => Math.round(value * 100) / 100;

export interface CreditCardFileTotalsInput {
  statementTotal?: number | null;
  totalPayments?: number | null;
}

/** Abatimento por crédito anterior; apenas valores finitos e > 0 são aplicados ao overlay. */
const normalizePriorCreditAbatement = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return round2(n);
};

const mergeClassificationOverridesFromPaymentRefundTxIds = (
  normalizedEntries: CreditCardImportEntry[],
  rows: Array<{ sourceRowIndex: number; transactionId?: string }>,
  paymentTxIds?: string[],
  refundTxIds?: string[],
  base?: ClassificationOverrides
): ClassificationOverrides | undefined => {
  const pay = new Set((paymentTxIds || []).filter(Boolean));
  const ref = new Set((refundTxIds || []).filter(Boolean));
  const fromIds: Record<string, CreditCardEntryType> = {};
  rows.forEach((row) => {
    const tid = row.transactionId;
    if (!tid) return;
    const entry = normalizedEntries.find((e) => e.sourceRowIndex === row.sourceRowIndex);
    if (!entry) return;
    if (pay.has(tid)) fromIds[entry.sourceRowHash] = 'invoice_payment';
    if (ref.has(tid)) fromIds[entry.sourceRowHash] = 'refund';
  });

  const mergedHashes: Record<string, CreditCardEntryType> = {
    ...fromIds,
    ...(base?.bySourceRowHash || {}),
  };

  return Object.keys(mergedHashes).length ? { bySourceRowHash: mergedHashes } : undefined;
};

const toIsoDate = (value: Date | string | undefined | null): string | null => {
  return toDateOnlyIso(value) || null;
};

const toReferenceLabel = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, '0')}`;

/** Inferência de competência (vencimento) a partir do nome do arquivo — também usada na importação pelo store. */
export const parseCreditCardReferenceFromFileName = (fileName: string): { dueYear: number; dueMonth: number } | null => {
  const normalized = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const monthMap: Record<string, number> = {
    jan: 1,
    fev: 2,
    mar: 3,
    abr: 4,
    mai: 5,
    jun: 6,
    jul: 7,
    ago: 8,
    set: 9,
    out: 10,
    nov: 11,
    dez: 12,
  };

  const monthTextMatch = normalized.match(/(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[_-]?(\d{4})/);
  if (monthTextMatch) {
    return {
      dueYear: Number(monthTextMatch[2]),
      dueMonth: monthMap[monthTextMatch[1]],
    };
  }

  const numericMatch = normalized.match(/(\d{1,2})[_-](\d{4})/);
  if (!numericMatch) return null;
  const month = Number(numericMatch[1]);
  const year = Number(numericMatch[2]);
  if (month < 1 || month > 12) return null;
  return { dueYear: year, dueMonth: month };
};

const calcReferenceLabelFromDue = (dueYear: number, dueMonth: number): string => {
  const ref = new Date(dueYear, dueMonth - 2, 1);
  return toReferenceLabel(ref.getFullYear(), ref.getMonth() + 1);
};

/** Lê manual_totals_json da tabela. */
export function parseManualTotalsJson(raw: unknown): CreditCardManualTotalsPayload | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const out: CreditCardManualTotalsPayload = {
    use_manual: Boolean(o.use_manual),
  };
  if (typeof o.statement_total === 'number') out.statement_total = o.statement_total;
  else if (o.statement_total === null) out.statement_total = null;
  if (typeof o.total_payments === 'number') out.total_payments = o.total_payments;
  else if (o.total_payments === null) out.total_payments = null;
  if (typeof o.user_note === 'string') out.user_note = o.user_note;
  else if (o.user_note === null) out.user_note = null;
  const fb = o.micro_divergence_feedback;
  if (fb === 'credit' || fb === 'bank_adjustment' || fb === 'offset_prior_credit') {
    out.micro_divergence_feedback = fb;
  } else {
    out.micro_divergence_feedback = null;
  }
  const ab = o.prior_credit_abatement;
  const normalizedAb = normalizePriorCreditAbatement(ab);
  if (normalizedAb !== null) out.prior_credit_abatement = normalizedAb;
  else if (ab === null) out.prior_credit_abatement = null;

  return out;
}

function applyManualTotalsOverlay(computed: CreditCardStatement): CreditCardStatement {
  const manual = computed.manualTotals;

  let st = computed.statementTotal;
  let pay = computed.totalPayments;

  if (manual?.use_manual) {
    if (manual.statement_total !== null && manual.statement_total !== undefined) {
      st = round2(Number(manual.statement_total));
    }
    if (manual.total_payments !== null && manual.total_payments !== undefined) {
      pay = round2(Number(manual.total_payments));
    }
  }

  const abate = normalizePriorCreditAbatement(manual?.prior_credit_abatement);
  if (abate !== null) {
    pay = round2(pay + abate);
  }

  const open = round2(Math.max(st - pay, 0));
  const status = inferStatusFromTotals(st, pay, computed.dueDate ?? null);

  return {
    ...computed,
    statementTotal: st,
    totalPayments: pay,
    openBalance: open,
    status,
    manualTotals: manual ?? null,
  };
}

/** Prioridade: conferência manual > totais do arquivo/lote > soma calculada das linhas. */
function applyDisplayTotalsOverlay(
  computed: CreditCardStatement,
  opts: {
    linesComputedTotal: number;
    fromFile?: CreditCardFileTotalsInput | null;
    useFileTotalsForDisplay?: boolean;
  }
): CreditCardStatement {
  const manual = computed.manualTotals;
  const withManual = applyManualTotalsOverlay({ ...computed, manualTotals: manual ?? null });

  const hasManualStatement =
    Boolean(manual?.use_manual) &&
    manual?.statement_total !== null &&
    manual?.statement_total !== undefined;
  const hasManualPayments =
    Boolean(manual?.use_manual) &&
    manual?.total_payments !== null &&
    manual?.total_payments !== undefined;

  let st = withManual.statementTotal;
  let pay = withManual.totalPayments;

  const file = opts.fromFile;
  if (
    opts.useFileTotalsForDisplay !== false &&
    !hasManualStatement &&
    file?.statementTotal != null &&
    Number.isFinite(file.statementTotal) &&
    file.statementTotal > 0
  ) {
    st = round2(Number(file.statementTotal));
  }
  if (
    opts.useFileTotalsForDisplay !== false &&
    !hasManualPayments &&
    file?.totalPayments != null &&
    Number.isFinite(file.totalPayments) &&
    file.totalPayments >= 0
  ) {
    pay = round2(Number(file.totalPayments));
  }

  const open = round2(Math.max(st - pay, 0));
  const status = inferStatusFromTotals(st, pay, withManual.dueDate ?? null);

  return {
    ...withManual,
    statementTotal: st,
    totalPayments: pay,
    openBalance: open,
    status,
    statementTotalFromFile: file?.statementTotal ?? withManual.statementTotalFromFile ?? null,
    totalPaymentsFromFile: file?.totalPayments ?? withManual.totalPaymentsFromFile ?? null,
    linesComputedTotal: opts.linesComputedTotal,
  };
}

async function loadFileTotalsForStatement(statement: CreditCardStatement): Promise<CreditCardFileTotalsInput | null> {
  const lotIds = statement.sourceImportLotIds || [];
  if (lotIds.length === 0) {
    if (statement.statementTotalFromFile != null || statement.totalPaymentsFromFile != null) {
      return {
        statementTotal: statement.statementTotalFromFile ?? null,
        totalPayments: statement.totalPaymentsFromFile ?? null,
      };
    }
    return null;
  }

  const { data, error } = await supabase
    .from('credit_card_import_lots')
    .select(
      'statement_total_from_file, total_payments_from_file, statement_due_year, statement_due_month'
    )
    .in('id', lotIds);
  if (error) throw error;

  const rows = (data || []) as Array<{
    statement_total_from_file: number | null;
    total_payments_from_file: number | null;
    statement_due_year: number;
    statement_due_month: number;
  }>;

  const matching =
    rows.find(
      (r) =>
        r.statement_due_year === statement.dueYear && r.statement_due_month === statement.dueMonth
    ) || rows[0];

  if (!matching) return null;

  return {
    statementTotal:
      matching.statement_total_from_file ?? statement.statementTotalFromFile ?? null,
    totalPayments: matching.total_payments_from_file ?? statement.totalPaymentsFromFile ?? null,
  };
}

function hasAuthoritativeFileTotals(file: CreditCardFileTotalsInput | null | undefined): boolean {
  return Boolean(
    file?.statementTotal != null && Number.isFinite(file.statementTotal) && file.statementTotal > 0
  );
}

export function mapRowToCreditCardStatement(row: Record<string, unknown>): CreditCardStatement {
  const dueDate = ((row.due_date as string) ?? null) as string | null;
  const statementTotal = Number(row.statement_total || 0);
  const totalPayments = Number(row.total_payments || 0);

  return {
    id: row.id as string,
    cardId: row.card_id as string,
    accountId: row.account_id as string,
    purchaseReferenceLabel: (row.purchase_reference_label || row.reference_label) as string,
    dueYear: (row.due_year as number) || Number(String(row.reference_label || '').slice(0, 4)) || 0,
    dueMonth: (row.due_month as number) || Number(String(row.reference_label || '').slice(5, 7)) || 0,
    dueDate,
    closingDate: (row.closing_date || row.close_date) as string | null | undefined,
    /**
     * Derivado dos totais da própria linha, e não lido da coluna `status`.
     *
     * A coluna pode ficar defasada: o upsert de importação grava `status: 'open'`
     * fixo e depende de um recálculo posterior para corrigir. Staging tem faturas
     * com `open_balance = 0`, `total_payments = statement_total` e `status = 'open'`
     * gravadas depois do pagamento — combinação que `inferStatusFromTotals` não
     * produz. Derivar na leitura torna a UI imune a essa deriva e é idempotente:
     * é exatamente a mesma função usada na escrita.
     */
    status: inferStatusFromTotals(statementTotal, totalPayments, dueDate),
    sourceImportLotIds: Array.isArray(row.source_import_lot_ids) ? (row.source_import_lot_ids as string[]) : [],
    totalPurchases: Number(row.total_purchases || row.total_charges || 0),
    totalFees: Number(row.total_fees || 0),
    totalInterest: Number(row.total_interest || 0),
    totalRefunds: Number(row.total_refunds || row.total_credits || 0),
    statementTotal,
    totalPayments,
    openBalance: Number(row.open_balance ?? row.open_amount ?? 0),
    manualTotals: parseManualTotalsJson(row.manual_totals_json),
    statementTotalFromFile:
      row.statement_total_from_file != null ? Number(row.statement_total_from_file) : null,
    totalPaymentsFromFile:
      row.total_payments_from_file != null ? Number(row.total_payments_from_file) : null,
    linesComputedTotal:
      row.lines_computed_total != null ? Number(row.lines_computed_total) : null,
    atomicProjectionVersion:
      row.atomic_projection_version != null ? Number(row.atomic_projection_version) : null,
    atomicProjectionChecksum:
      row.atomic_projection_checksum != null ? String(row.atomic_projection_checksum) : null,
    atomicProjectionSnapshotId:
      row.atomic_projection_snapshot_id != null ? String(row.atomic_projection_snapshot_id) : null,
  };
}

export const creditCardEngineService = {
  async recalculateAndPersistStatement(statementId: string): Promise<CreditCardStatement> {
    const detail = await this.getStatementDetail(statementId);
    const cardStatements = await this.getCardStatements(detail.statement.cardId);
    const sortedAsc = [...cardStatements].sort((a, b) =>
      a.dueYear !== b.dueYear ? a.dueYear - b.dueYear : a.dueMonth - b.dueMonth
    );
    const idx = sortedAsc.findIndex((s) => s.id === statementId);
    const futureStmts = idx >= 0 ? sortedAsc.slice(idx + 1) : [];
    const futurePacks = await Promise.all(
      futureStmts.map(async (fs) => ({
        importStatement: { id: fs.id, dueYear: fs.dueYear, dueMonth: fs.dueMonth },
        entries: (await this.getStatementDetail(fs.id)).entries,
      }))
    );

    const fileTotals = await loadFileTotalsForStatement(detail.statement);
    const atomicProjectionActive = detail.statement.atomicProjectionVersion === 1;
    const authoritativeFile = !atomicProjectionActive && hasAuthoritativeFileTotals(fileTotals);

    const needsFutureInvoiceMerge =
      !authoritativeFile &&
      futurePacks.some((p) =>
        p.entries.some((e) => e.entryType === 'invoice_payment' && inferDirection(e.amount) === 'credit')
      );

    let paymentsForRecalc = detail.payments;
    if (needsFutureInvoiceMerge) {
      const invoiceTotalsById = await this.buildStatementTotalsMapForIds(sortedAsc.map((s) => s.id));

      const { data: allPayRows, error: allPayErr } = await supabase
        .from('credit_card_payments')
        .select('*')
        .eq('card_id', detail.statement.cardId)
        .order('payment_date', { ascending: true });
      if (allPayErr) throw allPayErr;

      const allPaymentsOnCard = ((allPayRows || []) as any[]).map((row) => ({
        id: row.id,
        cardId: row.card_id,
        statementId: row.statement_id,
        paymentAccountId: row.payment_account_id,
        paymentTransactionId: row.payment_transaction_id,
        paymentDate: row.payment_date,
        amount: Number(row.amount || 0),
        source: row.source,
        notes: row.notes || undefined,
      })) as CreditCardPayment[];

      paymentsForRecalc = mergePaymentsWithInvoiceLinesFromFutureStatements(
        detail.statement,
        detail.payments,
        allPaymentsOnCard,
        futurePacks,
        sortedAsc,
        invoiceTotalsById
      );
    }
    const recalculated = creditCardStatementEngine.recalculateStatement({
      statement: detail.statement,
      entries: detail.entries,
      payments: paymentsForRecalc,
    });

    const linesComputedTotal = recalculated.statementTotal;

    const persisted = applyDisplayTotalsOverlay(
      { ...recalculated, manualTotals: detail.statement.manualTotals ?? null },
      {
        linesComputedTotal,
        fromFile: fileTotals,
        useFileTotalsForDisplay: !atomicProjectionActive,
      }
    );

    const { error: updateStatementError } = await supabase
      .from('credit_card_statements')
      .update({
        total_purchases: persisted.totalPurchases,
        total_fees: persisted.totalFees,
        total_interest: persisted.totalInterest,
        total_refunds: persisted.totalRefunds,
        statement_total: persisted.statementTotal,
        total_payments: persisted.totalPayments,
        open_balance: persisted.openBalance,
        status: persisted.status,
        statement_total_from_file: persisted.statementTotalFromFile ?? null,
        total_payments_from_file: persisted.totalPaymentsFromFile ?? null,
        lines_computed_total: persisted.linesComputedTotal ?? linesComputedTotal,
      })
      .eq('id', statementId);
    if (updateStatementError) throw updateStatementError;

    return persisted;
  },

  async saveStatementManualTotals(
    statementId: string,
    payload: Partial<CreditCardManualTotalsPayload>
  ): Promise<CreditCardStatement> {
    const detail = await this.getStatementDetail(statementId);
    const prev = detail.statement.manualTotals ?? undefined;
    const mergedPriorAbate =
      payload.prior_credit_abatement !== undefined
        ? normalizePriorCreditAbatement(payload.prior_credit_abatement)
        : normalizePriorCreditAbatement(prev?.prior_credit_abatement);

    const merged: CreditCardManualTotalsPayload = {
      use_manual:
        payload.use_manual !== undefined ? Boolean(payload.use_manual) : Boolean(prev?.use_manual),
      statement_total:
        payload.statement_total !== undefined ? payload.statement_total : prev?.statement_total,
      total_payments:
        payload.total_payments !== undefined ? payload.total_payments : prev?.total_payments,
      user_note: payload.user_note !== undefined ? payload.user_note : prev?.user_note,
      micro_divergence_feedback:
        payload.micro_divergence_feedback !== undefined
          ? payload.micro_divergence_feedback ?? null
          : prev?.micro_divergence_feedback ?? null,
      prior_credit_abatement: mergedPriorAbate,
    };

    const json: Record<string, unknown> = {
      use_manual: merged.use_manual,
      user_note: merged.user_note ?? null,
      micro_divergence_feedback: merged.micro_divergence_feedback ?? null,
      prior_credit_abatement: merged.prior_credit_abatement ?? null,
    };
    if (merged.statement_total !== undefined) json.statement_total = merged.statement_total;
    if (merged.total_payments !== undefined) json.total_payments = merged.total_payments;

    const { error } = await supabase
      .from('credit_card_statements')
      .update({ manual_totals_json: json })
      .eq('id', statementId);
    if (error) throw error;
    return this.recalculateAndPersistStatement(statementId);
  },

  async removeOriginFromEngine(input: { accountId: string; origin: string }): Promise<void> {
    const { data: entryRows, error: selError } = await supabase
      .from('credit_card_entries')
      .select('statement_id')
      .eq('account_id', input.accountId)
      .eq('source_file_name', input.origin);
    if (selError) throw selError;

    const statementIds = [
      ...new Set((entryRows || []).map((row: any) => row.statement_id).filter(Boolean)),
    ] as string[];

    const { error: delEntriesError } = await supabase
      .from('credit_card_entries')
      .delete()
      .eq('account_id', input.accountId)
      .eq('source_file_name', input.origin);
    if (delEntriesError) throw delEntriesError;

    const { error: delLotsError } = await supabase
      .from('credit_card_import_lots')
      .delete()
      .eq('account_id', input.accountId)
      .eq('source_file_name', input.origin);
    if (delLotsError) throw delLotsError;

    for (const statementId of statementIds) {
      await this.recalculateAndPersistStatement(statementId);
    }
  },

  async reprocessImportOriginFromTransactions(input: {
    userId: string;
    account: Account;
    origin: string;
    transactions: Transaction[];
    rules?: ClassificationRules;
    paymentOverrideTransactionIds?: string[];
    refundOverrideTransactionIds?: string[];
    dueYear?: number;
    dueMonth?: number;
    dueDate?: string;
    purchaseReferenceLabel?: string;
    /** Evita recalcular o cartão inteiro a cada origem (use um recálculo ao final do lote). */
    skipRecalculateAllStatements?: boolean;
  }): Promise<{ processed: number; statementId: string; lotId: string }> {
    const rows = await this.buildImportRowsFromTransactionsPreservingIndices({
      accountId: input.account.id,
      origin: input.origin,
      transactions: input.transactions,
    });

    const result = await this.normalizeAndPersistImportLot({
      userId: input.userId,
      account: input.account,
      sourceFileName: input.origin,
      rows,
      dueYear: input.dueYear,
      dueMonth: input.dueMonth,
      dueDate: input.dueDate,
      purchaseReferenceLabel: input.purchaseReferenceLabel,
      rules: input.rules,
      paymentOverrideTransactionIds: input.paymentOverrideTransactionIds,
      refundOverrideTransactionIds: input.refundOverrideTransactionIds,
      skipRecalculateAllStatements: input.skipRecalculateAllStatements,
    });

    return { processed: rows.length, statementId: result.statementId, lotId: result.lotId };
  },

  /**
   * Monta linhas de importação a partir de transações sem reordenar índices já gravados no motor
   * (evita duplicar lançamentos ao reprocessar após edição de data/valor).
   */
  async buildImportRowsFromTransactionsPreservingIndices(input: {
    accountId: string;
    origin: string;
    transactions: Transaction[];
  }): Promise<
    Array<{
      sourceRowIndex: number;
      postedDate: string;
      description: string;
      holderName?: string;
      amount: number;
      installmentCurrent?: number;
      installmentTotal?: number;
      merchantName?: string;
      transactionId?: string;
    }>
  > {
    const { data: existingRows, error } = await supabase
      .from('credit_card_entries')
      .select('source_row_index, transaction_id')
      .eq('account_id', input.accountId)
      .eq('source_file_name', input.origin);
    if (error) throw error;

    const indexByTxId = new Map<string, number>();
    let maxIndex = 0;
    (existingRows || []).forEach((row: { source_row_index?: number; transaction_id?: string | null }) => {
      const idx = Number(row.source_row_index || 0);
      if (idx > maxIndex) maxIndex = idx;
      if (row.transaction_id) indexByTxId.set(row.transaction_id, idx);
    });

    let nextIndex = maxIndex + 1;
    const sorted = [...input.transactions].sort(
      (a, b) => new Date(a.Data).getTime() - new Date(b.Data).getTime()
    );

    return sorted.map((tx) => {
      const txId = tx.ID_Transacao || undefined;
      let sourceRowIndex = txId ? indexByTxId.get(txId) : undefined;
      if (sourceRowIndex === undefined) {
        sourceRowIndex = nextIndex;
        nextIndex += 1;
        if (txId) indexByTxId.set(txId, sourceRowIndex);
      }

      return {
        sourceRowIndex,
        postedDate: toDateOnlyIso(tx.Data),
        description: tx.Descricao_Original || tx.Nome_Fantasia || '',
        holderName: tx.Portador || undefined,
        amount: Number(tx.Valor || 0),
        installmentCurrent: tx.Parcela_Atual || undefined,
        installmentTotal: tx.Total_Parcelas || undefined,
        merchantName: tx.Nome_Fantasia || undefined,
        transactionId: txId,
      };
    });
  },

  async pruneOrphanEntriesForImportSource(input: {
    cardId: string;
    sourceFileName: string;
    activeSourceRowHashes: string[];
  }): Promise<void> {
    const keep = new Set(input.activeSourceRowHashes);
    const { data: existing, error } = await supabase
      .from('credit_card_entries')
      .select('id, source_row_hash')
      .eq('card_id', input.cardId)
      .eq('source_file_name', input.sourceFileName);
    if (error) throw error;

    const orphanIds = (existing || [])
      .filter((row: { id: string; source_row_hash: string }) => !keep.has(row.source_row_hash))
      .map((row: { id: string }) => row.id);

    if (orphanIds.length === 0) return;

    const { error: delError } = await supabase.from('credit_card_entries').delete().in('id', orphanIds);
    if (delError) throw delError;
  },

  async ensureCreditCardForAccount(userId: string, account: Account): Promise<{ id: string; account_id: string }> {
    const payload = {
      user_id: userId,
      account_id: account.id,
      name: account.Nome_Conta,
      holder_name: null,
      issuer: null,
      limit_amount: Number(account.limite_credito || 0),
      closing_day: Number(account.dia_fechamento || 5),
      due_day: Number(account.dia_vencimento || 10),
      archived: Boolean(account.is_archived),
    };

    const { data, error } = await supabase
      .from('credit_cards')
      .upsert(payload, { onConflict: 'account_id' })
      .select('id,account_id')
      .single();
    if (error) throw error;
    return data as { id: string; account_id: string };
  },

  /**
   * Persiste linhas `invoice_payment` do CSV na competência correta:
   * - uma única linha no arquivo: mantém convenção XP (crédito aplicado à fatura **anterior** à competência do arquivo);
   * - duas ou mais linhas: cada uma vai para a competência cujo (due_year, due_month) coincide com o mês civil da data,
   *   desde que essa fatura exista e esteja entre [anterior ao arquivo, arquivo] (inclusive) — cobre pagamentos parciais
   *   em meses diferentes que aparecem no mesmo extrato.
   */
  async persistImportedInvoicePaymentsForPreviousStatement(opts: {
    userId: string;
    cardId: string;
    sourceFileName: string;
    dueYear: number;
    dueMonth: number;
    classifiedEntries: CreditCardImportEntry[];
    inputRows: Array<{ sourceRowIndex: number; transactionId?: string }>;
  }): Promise<string | undefined> {
    const cardStatements = await this.getCardStatements(opts.cardId);
    const sortedAsc = [...cardStatements].sort((a, b) =>
      a.dueYear !== b.dueYear ? a.dueYear - b.dueYear : a.dueMonth - b.dueMonth
    );
    const sortedPick = sortedAsc.map((s) => ({ id: s.id, dueYear: s.dueYear, dueMonth: s.dueMonth }));
    const importPick = { dueYear: opts.dueYear, dueMonth: opts.dueMonth };

    const targets = opts.classifiedEntries.filter(
      (e) => e.entryType === 'invoice_payment' && inferDirection(e.amount) === 'credit'
    );
    if (targets.length === 0) return undefined;

    assertUniqueImportedPaymentBatch(
      targets.map((entry) => {
        const row = opts.inputRows.find(
          (candidate) => candidate.sourceRowIndex === entry.sourceRowIndex
        );
        return {
          sourceFileName: opts.sourceFileName,
          sourceRowIndex: entry.sourceRowIndex,
          transactionId: row?.transactionId || entry.transactionId || null,
        };
      })
    );

    const existingPaymentIdentities = await collectPaginatedRows<ExistingImportedPaymentIdentity>(
      async (from, to) => {
        const { data, error } = await supabase
          .from('credit_card_payments')
          .select('id,payment_transaction_id,notes')
          .eq('card_id', opts.cardId)
          .eq('source', 'imported_statement')
          .order('id', { ascending: true })
          .range(from, to);
        return {
          data: (data || []) as ExistingImportedPaymentIdentity[],
          error,
        };
      }
    );

    const prevStmt = getPreviousStatementRow(sortedPick, importPick);
    const importRowStmt = sortedPick.find(
      (s) => s.dueYear === importPick.dueYear && s.dueMonth === importPick.dueMonth
    );
    const totalsIds = [prevStmt?.id, importRowStmt?.id].filter(Boolean) as string[];
    let statementTotalsById: Map<string, number> | undefined;
    if (totalsIds.length >= 2) {
      statementTotalsById = await this.buildStatementTotalsMapForIds(totalsIds);
    }

    let lastStmtId: string | undefined;

    for (const entry of targets) {
      const targetStmt = resolveImportedInvoicePaymentTarget(
        entry,
        targets,
        sortedPick,
        importPick,
        statementTotalsById ? { statementTotalsById } : undefined
      );
      if (!targetStmt?.id) {
        console.info(
          '[CardEngine] Pagamento importado sem statement alvo (competência inexistente ou fora da faixa):',
          entry.sourceRowHash
        );
        continue;
      }

      const row = opts.inputRows.find((r) => r.sourceRowIndex === entry.sourceRowIndex);
      const tid = row?.transactionId || entry.transactionId || undefined;
      const amt = round2(Math.abs(Number(entry.amount || 0)));
      if (!amt || amt <= 0) continue;
      const notes = `${entry.sourceRowHash} · ${opts.sourceFileName} · linha ${entry.sourceRowIndex} · ${entry.description.slice(0, 100)}`;
      const persistencePlan = planImportedPaymentPersistence(
        {
          sourceFileName: opts.sourceFileName,
          sourceRowIndex: entry.sourceRowIndex,
          transactionId: tid,
        },
        existingPaymentIdentities
      );
      const payload = {
        user_id: opts.userId,
        card_id: opts.cardId,
        statement_id: targetStmt.id,
        payment_transaction_id: persistencePlan.transactionId,
        payment_date: entry.postedDate,
        amount: amt,
        source: 'imported_statement',
        notes,
      };

      const writeQuery =
        persistencePlan.action === 'update'
          ? supabase
              .from('credit_card_payments')
              .update(payload)
              .eq('id', persistencePlan.rowId)
              .eq('card_id', opts.cardId)
          : supabase.from('credit_card_payments').insert(payload);
      const { data: writtenPayment, error: writeError } = await writeQuery
        .select('id,payment_transaction_id,notes')
        .single();
      if (writeError) {
        throw new Error(`Falha ao persistir pagamento importado sem duplicação: ${writeError.message}`);
      }

      const writtenIdentity = writtenPayment as ExistingImportedPaymentIdentity;
      const priorIndex = existingPaymentIdentities.findIndex(
        (candidate) => candidate.id === writtenIdentity.id
      );
      if (priorIndex >= 0) existingPaymentIdentities[priorIndex] = writtenIdentity;
      else existingPaymentIdentities.push(writtenIdentity);
      lastStmtId = targetStmt.id;
    }

    return lastStmtId;
  },

  async getCardStatements(cardId: string): Promise<CreditCardStatement[]> {
    const { data, error } = await supabase
      .from('credit_card_statements')
      .select('*')
      .eq('card_id', cardId)
      .order('due_year', { ascending: false })
      .order('due_month', { ascending: false });
    if (error) throw error;
    return ((data || []) as Record<string, unknown>[]).map((row) => mapRowToCreditCardStatement(row));
  },

  /** Totais de fatura só com lançamentos (sem pagamentos), para desempatar vínculo de pagamento importado. */
  async buildStatementTotalsMapForIds(statementIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const unique = [...new Set(statementIds.filter(Boolean))];
    for (const id of unique) {
      const detail = await this.getStatementDetail(id);
      const rec = creditCardStatementEngine.recalculateStatement({
        statement: detail.statement,
        entries: detail.entries,
        payments: [],
      });
      map.set(id, rec.statementTotal);
    }
    return map;
  },

  /** Recalcula todas as competências do cartão em ordem cronológica (cada fatura incorpora linhas de pagamento da seguinte). */
  async recalculateAllStatementsForCard(cardId: string): Promise<void> {
    const stmts = await this.getCardStatements(cardId);
    const asc = [...stmts].sort((a, b) =>
      a.dueYear !== b.dueYear ? a.dueYear - b.dueYear : a.dueMonth - b.dueMonth
    );
    for (const s of asc) {
      await this.recalculateAndPersistStatement(s.id);
    }
  },

  async getStatementDetail(statementId: string): Promise<{
    statement: CreditCardStatement;
    entries: CreditCardImportEntry[];
    payments: CreditCardPayment[];
  }> {
    const { data: statementData, error: statementError } = await supabase
      .from('credit_card_statements')
      .select('*')
      .eq('id', statementId)
      .single();
    if (statementError) throw statementError;

    const statement = mapRowToCreditCardStatement(statementData as Record<string, unknown>);

    const { data: entriesData, error: entriesError } = await supabase
      .from('credit_card_entries')
      .select('*')
      .eq('statement_id', statementId)
      .order('posted_date', { ascending: true });
    if (entriesError) throw entriesError;

    const { data: paymentsData, error: paymentsError } = await supabase
      .from('credit_card_payments')
      .select('*')
      .eq('statement_id', statementId)
      .order('payment_date', { ascending: true });
    if (paymentsError) throw paymentsError;

    const entries = ((entriesData || []) as any[]).map((row) => ({
      id: row.id,
      sourceRowIndex: Number(row.source_row_index || 0),
      postedDate: row.posted_date,
      description: row.description_raw,
      descriptionNormalized: row.description_normalized || '',
      holderName: row.holder_name || undefined,
      amount: Number(row.amount || 0),
      absAmount: Number(row.abs_amount || 0),
      direction: row.direction,
      entryType: row.entry_type,
      installmentCurrent: row.installment_current || undefined,
      installmentTotal: row.installment_total || undefined,
      merchantName: row.merchant_name || undefined,
      sourceRowHash: row.source_row_hash,
      sourceFileName: row.source_file_name,
      classificationSource: row.classification_source,
      classificationConfidence: Number(row.classification_confidence || 0),
      statementId: row.statement_id,
      importLotId: row.import_lot_id,
      transactionId: row.transaction_id,
      categoryId: row.category_id,
    })) as CreditCardImportEntry[];

    const payments = ((paymentsData || []) as any[]).map((row) => ({
      id: row.id,
      cardId: row.card_id,
      statementId: row.statement_id,
      paymentAccountId: row.payment_account_id,
      paymentTransactionId: row.payment_transaction_id,
      paymentDate: row.payment_date,
      amount: Number(row.amount || 0),
      source: row.source,
      notes: row.notes || undefined,
    })) as CreditCardPayment[];

    return { statement, entries, payments };
  },

  async getStatementAudit(statementId: string): Promise<CreditCardStatementAudit> {
    const detail = await this.getStatementDetail(statementId);
    const importLotIds = Array.from(new Set(detail.entries.map((entry) => entry.importLotId).filter(Boolean))) as string[];
    if (importLotIds.length === 0) {
      return creditCardStatementEngine.getStatementAudit(detail.statement, detail.entries, detail.entries);
    }

    const { data: importEntriesData, error: importEntriesError } = await supabase
      .from('credit_card_entries')
      .select('*')
      .in('import_lot_id', importLotIds);
    if (importEntriesError) throw importEntriesError;

    const importEntries = ((importEntriesData || []) as any[]).map((row) => ({
      sourceRowIndex: Number(row.source_row_index || 0),
      postedDate: row.posted_date,
      description: row.description_raw || '',
      descriptionNormalized: row.description_normalized || '',
      amount: Number(row.amount || 0),
      absAmount: Number(row.abs_amount || 0),
      direction: row.direction,
      entryType: row.entry_type,
      sourceRowHash: row.source_row_hash,
      sourceFileName: row.source_file_name,
      classificationSource: row.classification_source,
      classificationConfidence: Number(row.classification_confidence || 0),
    })) as CreditCardImportEntry[];

    return creditCardStatementEngine.getStatementAudit(detail.statement, importEntries, detail.entries);
  },

  async payStatement(
    userId: string,
    statementId: string,
    input: {
      paymentDate: string;
      amount: number;
      paymentAccountId?: string;
      source?: CreditCardPayment['source'];
      notes?: string;
    }
  ): Promise<CreditCardStatement> {
    const detail = await this.getStatementDetail(statementId);
    const safeAmount = round2(Math.max(0, input.amount));

    const { error: insertPaymentError } = await supabase.from('credit_card_payments').insert({
      user_id: userId,
      card_id: detail.statement.cardId,
      statement_id: statementId,
      payment_account_id: input.paymentAccountId || null,
      payment_date: input.paymentDate,
      amount: safeAmount,
      source: input.source || 'manual',
      notes: input.notes || null,
    });
    if (insertPaymentError) throw insertPaymentError;

    await this.recalculateAllStatementsForCard(detail.statement.cardId);
    const list = await this.getCardStatements(detail.statement.cardId);
    const out = list.find((s) => s.id === statementId);
    if (!out) throw new Error('Fatura não encontrada após recálculo do cartão.');
    return out;
  },

  async normalizeAndPersistImportLot(input: {
    userId: string;
    account: Account;
    sourceFileName: string;
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
    dueYear?: number;
    dueMonth?: number;
    dueDate?: string;
    purchaseReferenceLabel?: string;
    rules?: ClassificationRules;
    overrides?: ClassificationOverrides;
    paymentOverrideTransactionIds?: string[];
    refundOverrideTransactionIds?: string[];
    fileTotals?: CreditCardFileTotalsInput;
    skipRecalculateAllStatements?: boolean;
  }): Promise<{ statementId: string; lotId: string; entries: number }> {
    const ensuredCard = await this.ensureCreditCardForAccount(input.userId, input.account);
    const inferred = parseCreditCardReferenceFromFileName(input.sourceFileName);
    const dueYear = input.dueYear || inferred?.dueYear || new Date().getFullYear();
    const dueMonth = input.dueMonth || inferred?.dueMonth || new Date().getMonth() + 1;
    const statementDueDate = input.dueDate || toIsoDate(new Date(dueYear, dueMonth - 1, Math.min(28, input.account.dia_vencimento || 10)));
    const purchaseReferenceLabel = /^\d{4}-(0[1-9]|1[0-2])$/.test(
      input.purchaseReferenceLabel || ''
    )
      ? input.purchaseReferenceLabel!
      : calcReferenceLabelFromDue(dueYear, dueMonth);

    const normalized = creditCardStatementEngine.normalizeImportLot({
      userId: input.userId,
      cardId: ensuredCard.id,
      accountId: input.account.id,
      sourceFileName: input.sourceFileName,
      statementDueYear: dueYear,
      statementDueMonth: dueMonth,
      statementDueDate,
      purchaseReferenceLabel,
      rows: input.rows,
    });

    const mergedOverrides = mergeClassificationOverridesFromPaymentRefundTxIds(
      normalized.entries,
      input.rows,
      input.paymentOverrideTransactionIds,
      input.refundOverrideTransactionIds,
      input.overrides
    );

    const classified = creditCardStatementEngine.classifyEntries(
      normalized.entries,
      input.rules,
      mergedOverrides
    );

    const assignedForTotals = creditCardStatementEngine.assignEntriesToStatement(classified, {
      id: 'preview',
      dueYear,
      dueMonth,
    });
    const paymentsFromLotLines = sumInvoicePaymentsFromClassifiedEntries(assignedForTotals);
    const resolvedFileTotals: CreditCardFileTotalsInput = {
      statementTotal:
        input.fileTotals?.statementTotal != null && input.fileTotals.statementTotal > 0
          ? input.fileTotals.statementTotal
          : null,
      totalPayments:
        input.fileTotals?.totalPayments != null && input.fileTotals.totalPayments >= 0
          ? input.fileTotals.totalPayments
          : paymentsFromLotLines,
    };

    const { data: lotData, error: lotError } = await supabase
      .from('credit_card_import_lots')
      .upsert(
        {
          user_id: input.userId,
          card_id: ensuredCard.id,
          account_id: input.account.id,
          source_file_name: input.sourceFileName,
          statement_due_year: dueYear,
          statement_due_month: dueMonth,
          statement_due_date: statementDueDate,
          purchase_reference_label: purchaseReferenceLabel,
          checksum: normalized.lot.checksum,
          status: classified.some((entry) => entry.entryType === 'needs_review') ? 'pending_review' : 'confirmed',
          raw_row_count: input.rows.length,
          imported_row_count: classified.length,
          ignored_row_count: classified.filter((entry) => entry.entryType === 'ignored').length,
          statement_total_from_file: resolvedFileTotals.statementTotal ?? null,
          total_payments_from_file: resolvedFileTotals.totalPayments ?? null,
        },
        { onConflict: 'card_id,source_file_name,checksum' }
      )
      .select('*')
      .single();
    if (lotError) throw lotError;
    const lotId = lotData.id as string;

    const referenceLabel = toReferenceLabel(dueYear, dueMonth);

    const { data: existingStmt } = await supabase
      .from('credit_card_statements')
      .select('source_import_lot_ids')
      .eq('user_id', input.userId)
      .eq('account_id', input.account.id)
      .eq('reference_label', referenceLabel)
      .maybeSingle();

    const priorLotIds = Array.isArray(existingStmt?.source_import_lot_ids)
      ? (existingStmt!.source_import_lot_ids as string[])
      : [];
    const mergedLotIds = [...new Set([...priorLotIds, lotId])];

    const { data: statementData, error: statementError } = await supabase
      .from('credit_card_statements')
      .upsert(
        {
          user_id: input.userId,
          card_id: ensuredCard.id,
          account_id: input.account.id,
          reference_label: referenceLabel,
          purchase_reference_label: purchaseReferenceLabel,
          due_year: dueYear,
          due_month: dueMonth,
          due_date: statementDueDate,
          source_import_lot_ids: mergedLotIds,
          status: 'open',
        },
        { onConflict: 'user_id,account_id,reference_label' }
      )
      .select('*')
      .single();
    if (statementError) throw statementError;
    const statementId = statementData.id as string;

    const assigned = creditCardStatementEngine.assignEntriesToStatement(classified, {
      id: statementId,
      dueYear,
      dueMonth,
    });

    const insertRows = assigned.map((entry) => ({
      user_id: input.userId,
      card_id: ensuredCard.id,
      account_id: input.account.id,
      import_lot_id: lotId,
      source_file_name: input.sourceFileName,
      source_row_index: entry.sourceRowIndex,
      source_row_hash: entry.sourceRowHash,
      transaction_id: input.rows.find((row) => row.sourceRowIndex === entry.sourceRowIndex)?.transactionId || null,
      posted_date: entry.postedDate,
      description_raw: entry.description,
      description_normalized: entry.descriptionNormalized,
      merchant_name: entry.merchantName || null,
      holder_name: entry.holderName || null,
      amount: entry.amount,
      abs_amount: entry.absAmount,
      direction: entry.direction,
      entry_type: entry.entryType,
      installment_current: entry.installmentCurrent || null,
      installment_total: entry.installmentTotal || null,
      classification_source: entry.classificationSource,
      classification_confidence: entry.classificationConfidence,
      statement_id: statementId,
    }));

    const incomingTransactionIds = [
      ...new Set(insertRows.map((row) => row.transaction_id).filter(Boolean)),
    ] as string[];
    const existingProjectionRows: ExistingCreditCardEntryIdentity[] = [];
    for (let index = 0; index < incomingTransactionIds.length; index += 200) {
      const chunk = incomingTransactionIds.slice(index, index + 200);
      const { data: existingData, error: existingError } = await supabase
        .from('credit_card_entries')
        .select('id,transaction_id,card_id,account_id,source_file_name,source_row_hash')
        .in('transaction_id', chunk);
      if (existingError) throw existingError;
      existingProjectionRows.push(...((existingData || []) as ExistingCreditCardEntryIdentity[]));
    }

    const persistencePlan = planCreditCardEntryPersistence(insertRows, existingProjectionRows);

    if (persistencePlan.upserts.length > 0) {
      const { error: entriesUpsertError } = await supabase
        .from('credit_card_entries')
        .upsert(persistencePlan.upserts, { onConflict: 'card_id,source_file_name,source_row_hash' });
      if (entriesUpsertError) throw entriesUpsertError;
    }

    for (const update of persistencePlan.updates) {
      // transaction_id é a identidade imutável: atualizamos a projeção existente
      // pelo id em vez de inserir outra linha quando data/descrição/hash mudarem.
      const { transaction_id: transactionId, ...updatePayload } = update.row;
      const { error: entryUpdateError } = await supabase
        .from('credit_card_entries')
        .update(updatePayload)
        .eq('id', update.id)
        .eq('transaction_id', transactionId!);
      if (entryUpdateError) throw entryUpdateError;
    }

    await this.pruneOrphanEntriesForImportSource({
      cardId: ensuredCard.id,
      sourceFileName: input.sourceFileName,
      activeSourceRowHashes: assigned.map((entry) => entry.sourceRowHash),
    });

    const authoritativeFromFile = hasAuthoritativeFileTotals(resolvedFileTotals);
    if (!authoritativeFromFile) {
      await this.persistImportedInvoicePaymentsForPreviousStatement({
        userId: input.userId,
        cardId: ensuredCard.id,
        sourceFileName: input.sourceFileName,
        dueYear,
        dueMonth,
        classifiedEntries: assigned,
        inputRows: input.rows,
      });
    }

    if (!input.skipRecalculateAllStatements) {
      await this.recalculateAllStatementsForCard(ensuredCard.id);
    }

    const linesComputedAfter = (
      await creditCardStatementEngine.recalculateStatement({
        statement: {
          id: statementId,
          cardId: ensuredCard.id,
          accountId: input.account.id,
          purchaseReferenceLabel,
          dueYear,
          dueMonth,
          dueDate: statementDueDate,
          status: 'open',
          sourceImportLotIds: mergedLotIds,
          totalPurchases: 0,
          totalFees: 0,
          totalInterest: 0,
          totalRefunds: 0,
          statementTotal: 0,
          totalPayments: 0,
          openBalance: 0,
        },
        entries: assigned,
        payments: [],
      })
    ).statementTotal;

    await supabase
      .from('credit_card_import_lots')
      .update({ lines_computed_total: linesComputedAfter })
      .eq('id', lotId);

    return { statementId, lotId, entries: assigned.length };
  },

  async reprocessImportLot(importLotId: string): Promise<{ statementId: string; processedEntries: number }> {
    const { data: lot, error: lotError } = await supabase
      .from('credit_card_import_lots')
      .select('*')
      .eq('id', importLotId)
      .single();
    if (lotError) throw lotError;

    const { data: entriesData, error: entriesError } = await supabase
      .from('credit_card_entries')
      .select('*')
      .eq('import_lot_id', importLotId)
      .order('source_row_index', { ascending: true });
    if (entriesError) throw entriesError;
    const entries = (entriesData || []) as any[];
    if (entries.length === 0) {
      return { statementId: '', processedEntries: 0 };
    }

    const referenceLabel = toReferenceLabel(Number(lot.statement_due_year), Number(lot.statement_due_month));
    const { data: statementData, error: statementError } = await supabase
      .from('credit_card_statements')
      .select('*')
      .eq('card_id', lot.card_id)
      .eq('reference_label', referenceLabel)
      .single();
    if (statementError) throw statementError;

    const typedEntries = entries.map((row) => ({
      id: row.id,
      sourceRowIndex: Number(row.source_row_index || 0),
      sourceRowHash: row.source_row_hash,
      postedDate: row.posted_date,
      description: row.description_raw,
      descriptionNormalized: row.description_normalized || '',
      amount: Number(row.amount || 0),
      absAmount: Number(row.abs_amount || 0),
      direction: row.direction,
      entryType: row.entry_type,
      sourceFileName: row.source_file_name,
      classificationSource: row.classification_source,
      classificationConfidence: Number(row.classification_confidence || 0),
      statementId: statementData.id,
      transactionId: row.transaction_id || null,
    })) as CreditCardImportEntry[];

    const reclassified = creditCardStatementEngine.classifyEntries(typedEntries);
    const updates = reclassified.map((entry) => ({
      id: entry.id,
      entry_type: entry.entryType,
      classification_source: 'reprocess',
      classification_confidence: entry.classificationConfidence,
      statement_id: statementData.id,
    }));
    const { error: updateEntriesError } = await supabase.from('credit_card_entries').upsert(updates);
    if (updateEntriesError) throw updateEntriesError;

    await this.persistImportedInvoicePaymentsForPreviousStatement({
      userId: lot.user_id as string,
      cardId: lot.card_id as string,
      sourceFileName: lot.source_file_name as string,
      dueYear: Number(lot.statement_due_year),
      dueMonth: Number(lot.statement_due_month),
      classifiedEntries: reclassified,
      inputRows: reclassified.map((e) => ({
        sourceRowIndex: e.sourceRowIndex,
        transactionId: e.transactionId || undefined,
      })),
    });

    await this.recalculateAllStatementsForCard(lot.card_id as string);

    const { error: updateLotError } = await supabase
      .from('credit_card_import_lots')
      .update({
        status: reclassified.some((entry) => entry.entryType === 'needs_review') ? 'pending_review' : 'reprocessed',
      })
      .eq('id', importLotId);
    if (updateLotError) throw updateLotError;

    return { statementId: statementData.id, processedEntries: reclassified.length };
  },
};
