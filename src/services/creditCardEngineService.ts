import { supabase } from '../supabaseClient';
import { Account, Transaction } from '../types';
import { creditCardStatementEngine } from '../domain/credit-card/creditCardStatementEngine';
import { getPreviousReferenceLabel } from '../domain/credit-card/assignment';
import { mergePaymentsWithInvoiceLinesFromNextStatement, inferStatusFromTotals } from '../domain/credit-card/payments';
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
const round2 = (value: number): number => Math.round(value * 100) / 100;

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
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const toReferenceLabel = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, '0')}`;

const parseReferenceFromFileName = (fileName: string): { dueYear: number; dueMonth: number } | null => {
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
  return out;
}

function applyManualTotalsOverlay(computed: CreditCardStatement): CreditCardStatement {
  const manual = computed.manualTotals;
  if (!manual?.use_manual) return computed;

  const st =
    manual.statement_total !== null && manual.statement_total !== undefined
      ? round2(Number(manual.statement_total))
      : computed.statementTotal;
  const pay =
    manual.total_payments !== null && manual.total_payments !== undefined
      ? round2(Number(manual.total_payments))
      : computed.totalPayments;
  const open = round2(Math.max(st - pay, 0));
  const status = inferStatusFromTotals(st, pay, computed.dueDate ?? null);

  return {
    ...computed,
    statementTotal: st,
    totalPayments: pay,
    openBalance: open,
    status,
    manualTotals: manual,
  };
}

function mapRowToCreditCardStatement(row: Record<string, unknown>): CreditCardStatement {
  return {
    id: row.id as string,
    cardId: row.card_id as string,
    accountId: row.account_id as string,
    purchaseReferenceLabel: (row.purchase_reference_label || row.reference_label) as string,
    dueYear: (row.due_year as number) || Number(String(row.reference_label || '').slice(0, 4)) || 0,
    dueMonth: (row.due_month as number) || Number(String(row.reference_label || '').slice(5, 7)) || 0,
    dueDate: (row.due_date as string) ?? null,
    closingDate: (row.closing_date || row.close_date) as string | null | undefined,
    status: row.status as CreditCardStatement['status'],
    sourceImportLotIds: Array.isArray(row.source_import_lot_ids) ? (row.source_import_lot_ids as string[]) : [],
    totalPurchases: Number(row.total_purchases || row.total_charges || 0),
    totalFees: Number(row.total_fees || 0),
    totalInterest: Number(row.total_interest || 0),
    totalRefunds: Number(row.total_refunds || row.total_credits || 0),
    statementTotal: Number(row.statement_total || 0),
    totalPayments: Number(row.total_payments || 0),
    openBalance: Number(row.open_balance ?? row.open_amount ?? 0),
    manualTotals: parseManualTotalsJson(row.manual_totals_json),
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
    const nextStmt = idx >= 0 && idx + 1 < sortedAsc.length ? sortedAsc[idx + 1] : undefined;
    let nextEntries: CreditCardImportEntry[] = [];
    if (nextStmt) {
      nextEntries = (await this.getStatementDetail(nextStmt.id)).entries;
    }
    const paymentsForRecalc = mergePaymentsWithInvoiceLinesFromNextStatement(
      detail.statement,
      detail.payments,
      nextEntries
    );
    const recalculated = creditCardStatementEngine.recalculateStatement({
      statement: detail.statement,
      entries: detail.entries,
      payments: paymentsForRecalc,
    });

    const persisted = applyManualTotalsOverlay({
      ...recalculated,
      manualTotals: detail.statement.manualTotals ?? null,
    });

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
      })
      .eq('id', statementId);
    if (updateStatementError) throw updateStatementError;

    return persisted;
  },

  async saveStatementManualTotals(
    statementId: string,
    payload: CreditCardManualTotalsPayload
  ): Promise<CreditCardStatement> {
    const json: Record<string, unknown> = {
      use_manual: Boolean(payload.use_manual),
      user_note: payload.user_note ?? null,
    };
    if (payload.statement_total !== undefined) json.statement_total = payload.statement_total;
    if (payload.total_payments !== undefined) json.total_payments = payload.total_payments;
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
  }): Promise<{ processed: number; statementId: string; lotId: string }> {
    const sorted = [...input.transactions].sort(
      (a, b) => new Date(a.Data).getTime() - new Date(b.Data).getTime()
    );
    const rows = sorted.map((tx, index) => ({
      sourceRowIndex: index + 1,
      postedDate: new Date(tx.Data).toISOString().slice(0, 10),
      description: tx.Descricao_Original || tx.Nome_Fantasia || '',
      holderName: tx.Portador || undefined,
      amount: Number(tx.Valor || 0),
      installmentCurrent: tx.Parcela_Atual || undefined,
      installmentTotal: tx.Total_Parcelas || undefined,
      merchantName: tx.Nome_Fantasia || undefined,
      transactionId: tx.ID_Transacao || undefined,
    }));

    const result = await this.normalizeAndPersistImportLot({
      userId: input.userId,
      account: input.account,
      sourceFileName: input.origin,
      rows,
      dueYear: input.dueYear,
      dueMonth: input.dueMonth,
      dueDate: input.dueDate,
      rules: input.rules,
      paymentOverrideTransactionIds: input.paymentOverrideTransactionIds,
      refundOverrideTransactionIds: input.refundOverrideTransactionIds,
    });

    return { processed: rows.length, statementId: result.statementId, lotId: result.lotId };
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
   * Lançamentos `invoice_payment` importados na fatura N (nome do arquivo / vencimento) representam na prática o
   * pagamento que o banco aplica à fatura do ciclo **anterior**. Persistimos em credit_card_payments na statement N-1
   * para alimentar total_payments / open_balance / limite disponível corretamente.
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
    const currentRef = toReferenceLabel(opts.dueYear, opts.dueMonth);
    const prevRef = getPreviousReferenceLabel(currentRef);

    const { data: prevStmt, error } = await supabase
      .from('credit_card_statements')
      .select('id')
      .eq('card_id', opts.cardId)
      .eq('reference_label', prevRef)
      .maybeSingle();
    if (error) {
      console.warn('[CardEngine] Busca da fatura anterior para pagamentos importados:', error.message);
      return undefined;
    }
    if (!prevStmt?.id) {
      console.info(
        '[CardEngine] Sem fatura anterior no banco (%s); pagamento XP agregado não foi vinculado ainda.',
        prevRef
      );
      return undefined;
    }

    const targets = opts.classifiedEntries.filter(
      (e) => e.entryType === 'invoice_payment' && inferDirection(e.amount) === 'credit'
    );
    if (targets.length === 0) return undefined;

    for (const entry of targets) {
      const row = opts.inputRows.find((r) => r.sourceRowIndex === entry.sourceRowIndex);
      const tid = row?.transactionId || entry.transactionId || undefined;
      const amt = round2(Math.abs(Number(entry.amount || 0)));
      if (!amt || amt <= 0) continue;

      if (tid) {
        await supabase
          .from('credit_card_payments')
          .delete()
          .eq('card_id', opts.cardId)
          .eq('payment_transaction_id', tid);
      } else {
        await supabase
          .from('credit_card_payments')
          .delete()
          .eq('card_id', opts.cardId)
          .eq('statement_id', prevStmt.id)
          .eq('source', 'imported_statement')
          .like('notes', `%${entry.sourceRowHash}%`);
      }

      const { error: insErr } = await supabase.from('credit_card_payments').insert({
        user_id: opts.userId,
        card_id: opts.cardId,
        statement_id: prevStmt.id,
        payment_transaction_id: tid || null,
        payment_date: entry.postedDate,
        amount: amt,
        source: 'imported_statement',
        notes: `${entry.sourceRowHash} · ${opts.sourceFileName} · linha ${entry.sourceRowIndex} · ${entry.description.slice(0, 100)}`,
      });
      if (insErr) {
        console.error('[CardEngine] Falha ao gravar pagamento importado:', insErr.message);
      }
    }

    return prevStmt.id as string;
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

    const statements = await this.getCardStatements(statementData.card_id);
    const statement = statements.find((item) => item.id === statementId);
    if (!statement) {
      throw new Error('Statement not found after mapping.');
    }

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
    rules?: ClassificationRules;
    overrides?: ClassificationOverrides;
    paymentOverrideTransactionIds?: string[];
    refundOverrideTransactionIds?: string[];
  }): Promise<{ statementId: string; lotId: string; entries: number }> {
    const ensuredCard = await this.ensureCreditCardForAccount(input.userId, input.account);
    const inferred = parseReferenceFromFileName(input.sourceFileName);
    const dueYear = input.dueYear || inferred?.dueYear || new Date().getFullYear();
    const dueMonth = input.dueMonth || inferred?.dueMonth || new Date().getMonth() + 1;
    const statementDueDate = input.dueDate || toIsoDate(new Date(dueYear, dueMonth - 1, Math.min(28, input.account.dia_vencimento || 10)));
    const purchaseReferenceLabel = calcReferenceLabelFromDue(dueYear, dueMonth);

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
        },
        { onConflict: 'card_id,source_file_name,checksum' }
      )
      .select('*')
      .single();
    if (lotError) throw lotError;
    const lotId = lotData.id as string;

    const referenceLabel = toReferenceLabel(dueYear, dueMonth);
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
          source_import_lot_ids: [lotId],
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

    const { error: entriesUpsertError } = await supabase
      .from('credit_card_entries')
      .upsert(insertRows, { onConflict: 'card_id,source_file_name,source_row_hash' });
    if (entriesUpsertError) throw entriesUpsertError;

    await this.persistImportedInvoicePaymentsForPreviousStatement({
      userId: input.userId,
      cardId: ensuredCard.id,
      sourceFileName: input.sourceFileName,
      dueYear,
      dueMonth,
      classifiedEntries: assigned,
      inputRows: input.rows,
    });

    await this.recalculateAllStatementsForCard(ensuredCard.id);

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

