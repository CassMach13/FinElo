import { supabase } from '../supabaseClient';
import {
  Account,
  CardImportCycleInput,
  CreditCardReprocessJob,
  CreditCardStatement,
  CreditCardStatementItem,
  CreditCardStatementItemType,
  CreditCardStatementStatus,
  Transaction,
} from '../types';
import { localTodayIso, toDateOnlyIso } from '../utils/dateOnly';

interface UpsertStatementInput {
  userId: string;
  accountId: string;
  referenceLabel: string; // ex: 2026-05
  closeDate?: string | null;
  dueDate?: string | null;
  sourceOrigin?: string | null;
  status?: CreditCardStatementStatus;
}

interface UpsertStatementTotalsInput {
  statementId: string;
  totalCharges: number;
  totalCredits: number;
  totalPayments: number;
  openAmount: number;
  status: CreditCardStatementStatus;
}

interface AddStatementItemInput {
  userId: string;
  accountId: string;
  statementId: string;
  transactionId?: string | null;
  itemType: CreditCardStatementItemType;
  amount: number;
  postedDate?: string | null;
}

interface ReprocessWindowInput {
  userId: string;
  accountId: string;
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  classifierRules?: CardClassifierRules;
}

interface ProcessShadowImportInput {
  userId: string;
  account: Account;
  origin: string;
  transactions: Transaction[];
  cardCycle?: CardImportCycleInput;
  classifierRules?: CardClassifierRules;
  classifierOverrides?: CardClassifierOverrides;
}

interface ReprocessOriginInput {
  userId: string;
  account: Account;
  origin: string;
  transactions: Transaction[];
  cardCycle?: CardImportCycleInput;
  classifierRules?: CardClassifierRules;
  classifierOverrides?: CardClassifierOverrides;
}

export interface CardClassifierRules {
  paymentKeywords?: string[];
  creditKeywords?: string[];
}

export interface CardClassifierOverrides {
  paymentTransactionIds?: string[];
  refundTransactionIds?: string[];
}

interface RemoveOriginInput {
  userId: string;
  account: Account;
  origin: string;
  deletedTransactions: Transaction[];
}

export interface CreditCardShadowDashboardRow {
  accountId: string;
  accountName: string;
  lastOrigin: string | null;
  v1CurrentGross: number;
  v2CurrentGross: number;
  v2OpenAmount: number;
  absoluteDiff: number;
  diffPercent: number;
  status: 'ok' | 'divergent' | 'no-data';
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

const formatReferenceLabel = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const parseReferenceLabelFromOrigin = (origin: string): string | null => {
  const normalized = origin.replace(/\s+/g, '_');
  const match = normalized.match(/(?:^|_)(\d{1,2})[_-](\d{4})(?:_|$)/);
  if (!match) return null;
  const month = Number(match[1]);
  const year = Number(match[2]);
  if (Number.isNaN(month) || Number.isNaN(year) || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, '0')}`;
};

const inferReferenceLabel = (origin: string, transactions: Transaction[]): string => {
  const fromOrigin = parseReferenceLabelFromOrigin(origin);
  if (fromOrigin) return fromOrigin;

  const maxDateIso = transactions
    .map((t) => toDateOnlyIso(t.Data))
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0];

  if (!maxDateIso) {
    return localTodayIso().slice(0, 7);
  }

  const [year, month] = maxDateIso.split('-').map(Number);
  const dueCycle = new Date(year, month, 1);
  return formatReferenceLabel(dueCycle);
};

const sortByDateDesc = (a: Transaction, b: Transaction): number =>
  toDateOnlyIso(b.Data).localeCompare(toDateOnlyIso(a.Data));
const PAYMENT_EPSILON = 0.5;

const chunkArray = <T,>(arr: T[], chunkSize: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize));
  }
  return chunks;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DEBUG_TARGET_ORIGIN = 'fatura_cartao_xp_cassio_jan_2025.csv';
const DEBUG_TARGET_AMOUNT = 49.76;
const isDebugTargetTx = (tx: Transaction): boolean => {
  const normalizedOrigin = String(tx.Origem || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  const normalizedAmount = Math.abs(Number(tx.Valor || 0));
  return normalizedOrigin.includes(DEBUG_TARGET_ORIGIN) && Math.abs(normalizedAmount - DEBUG_TARGET_AMOUNT) < 0.001;
};

const classifyItemType = (
  tx: Transaction,
  rules?: CardClassifierRules,
  overrides?: CardClassifierOverrides
): CreditCardStatementItemType => {
  const txId = tx.ID_Transacao || '';
  const paymentOverrides = new Set((overrides?.paymentTransactionIds || []).filter(Boolean));
  const refundOverrides = new Set((overrides?.refundTransactionIds || []).filter(Boolean));
  if (txId && paymentOverrides.has(txId)) return 'payment';
  if (txId && refundOverrides.has(txId)) return 'refund';

  const rawText = `${tx.Descricao_Original || ''} ${tx.Nome_Fantasia || ''}`.toLowerCase();
  const defaultCreditKeywords = ['estorno', 'reembolso', 'devolu', 'cancelamento', 'ajuste positivo'];
  const defaultPaymentKeywords = ['pagamentos válidos normais', 'pagamentos validos normais', 'pagamentos válidos', 'pagamentos validos', 'pagamento de fatura', 'pagto de fatura'];
  const creditKeywords = (rules?.creditKeywords && rules.creditKeywords.length > 0 ? rules.creditKeywords : defaultCreditKeywords)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  const paymentKeywords = (rules?.paymentKeywords && rules.paymentKeywords.length > 0 ? rules.paymentKeywords : defaultPaymentKeywords)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);

  const hasRefundKeyword = new RegExp(creditKeywords.map(escapeRegex).join('|'), 'i').test(rawText);
  const hasStatementPaymentKeyword = new RegExp(paymentKeywords.map(escapeRegex).join('|'), 'i').test(rawText);

  if (hasStatementPaymentKeyword) return 'payment';
  if (tx.Tipo === 'Renda' && hasRefundKeyword) return 'refund';
  if (hasRefundKeyword) return 'refund';
  // Do not classify every positive card row as refund by default.
  // If not explicitly matched as payment/refund, keep it in statement charges.
  return 'charge';
};

/**
 * Credit Card V2 core service.
 *
 * Phase 0 scope:
 * - Provide typed methods and low-risk CRUD primitives.
 * - No UI replacement yet.
 */
export const creditCardStatementService = {
  async getCurrentStatement(accountId: string): Promise<CreditCardStatement | null> {
    const { data, error } = await supabase
      .from('credit_card_statements')
      .select('*')
      .eq('account_id', accountId)
      .in('status', ['open', 'partial'])
      .order('due_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return (data as CreditCardStatement | null) ?? null;
  },

  async getStatementHistory(accountId: string, limit = 12): Promise<CreditCardStatement[]> {
    const { data, error } = await supabase
      .from('credit_card_statements')
      .select('*')
      .eq('account_id', accountId)
      .order('due_date', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data as CreditCardStatement[]) ?? [];
  },

  async getStatementItems(statementId: string): Promise<CreditCardStatementItem[]> {
    const { data, error } = await supabase
      .from('credit_card_statement_items')
      .select('*')
      .eq('statement_id', statementId)
      .order('posted_date', { ascending: true });

    if (error) throw error;
    return (data as CreditCardStatementItem[]) ?? [];
  },

  async upsertStatement(input: UpsertStatementInput): Promise<CreditCardStatement> {
    const payload = {
      user_id: input.userId,
      account_id: input.accountId,
      reference_label: input.referenceLabel,
      close_date: input.closeDate ?? null,
      due_date: input.dueDate ?? null,
      source_origin: input.sourceOrigin ?? null,
      status: input.status ?? 'open',
    };

    const { data, error } = await supabase
      .from('credit_card_statements')
      .upsert(payload, { onConflict: 'user_id,account_id,reference_label' })
      .select('*')
      .single();

    if (error) throw error;
    return data as CreditCardStatement;
  },

  async updateStatementTotals(input: UpsertStatementTotalsInput): Promise<CreditCardStatement> {
    const { data, error } = await supabase
      .from('credit_card_statements')
      .update({
        total_charges: input.totalCharges,
        total_credits: input.totalCredits,
        total_payments: input.totalPayments,
        open_amount: input.openAmount,
        status: input.status,
      })
      .eq('id', input.statementId)
      .select('*')
      .single();

    if (error) throw error;
    return data as CreditCardStatement;
  },

  async addStatementItem(input: AddStatementItemInput): Promise<CreditCardStatementItem> {
    const { data, error } = await supabase
      .from('credit_card_statement_items')
      .upsert(
        {
          user_id: input.userId,
          account_id: input.accountId,
          statement_id: input.statementId,
          transaction_id: input.transactionId ?? null,
          item_type: input.itemType,
          amount: input.amount,
          posted_date: input.postedDate ?? null,
        },
        { onConflict: 'transaction_id' }
      )
      .select('*')
      .single();

    if (error) throw error;
    return data as CreditCardStatementItem;
  },

  async recalculateStatement(statementId: string): Promise<CreditCardStatement> {
    const items = await this.getStatementItems(statementId);

    const totals = items.reduce(
      (acc, item) => {
        if (item.item_type === 'charge') acc.totalCharges += Math.abs(item.amount);
        if (item.item_type === 'refund') acc.totalCredits += Math.abs(item.amount);
        if (item.item_type === 'payment') acc.totalPayments += Math.abs(item.amount);
        return acc;
      },
      { totalCharges: 0, totalCredits: 0, totalPayments: 0 }
    );

    const rawOpenAmount = round2(totals.totalCharges - totals.totalCredits - totals.totalPayments);
    const openAmount = Math.abs(rawOpenAmount) <= PAYMENT_EPSILON ? 0 : rawOpenAmount;

    const status: CreditCardStatementStatus =
      openAmount <= 0 ? 'paid' : totals.totalPayments > 0 ? 'partial' : 'open';

    return this.updateStatementTotals({
      statementId,
      totalCharges: round2(totals.totalCharges),
      totalCredits: round2(totals.totalCredits),
      totalPayments: round2(totals.totalPayments),
      openAmount: round2(Math.max(openAmount, 0)),
      status,
    });
  },

  async processShadowImport(input: ProcessShadowImportInput): Promise<{ statementId: string | null; processed: number }> {
    if (input.account.Tipo_Conta !== 'Cartão de Crédito') return { statementId: null, processed: 0 };
    if (input.transactions.length === 0) return { statementId: null, processed: 0 };

    const referenceLabel = input.cardCycle?.referenceLabel || inferReferenceLabel(input.origin, input.transactions);
    const [yearStr, monthStr] = referenceLabel.split('-');
    const dueBaseDate = new Date(Number(yearStr), Number(monthStr), 1); // competência (compras) + 1 mês
    const dueDay = input.account.dia_vencimento || 10;
    const dueDateFromReference = `${dueBaseDate.getFullYear()}-${String(dueBaseDate.getMonth() + 1).padStart(2, '0')}-${String(Math.min(Math.max(dueDay, 1), 28)).padStart(2, '0')}`;
    const dueDate = input.cardCycle?.dueDate || dueDateFromReference;

    const statement = await this.upsertStatement({
      userId: input.userId,
      accountId: input.account.id,
      referenceLabel,
      dueDate,
      sourceOrigin: input.origin,
      status: 'open',
    });

    const touchedStatementIds = new Set<string>([statement.id]);
    const statementCache = new Map<string, CreditCardStatement>([[referenceLabel, statement]]);
    const buildDueDateFromReference = (ref: string): string => {
      const [y, m] = ref.split('-').map(Number);
      const safeYear = Number.isNaN(y) ? new Date().getFullYear() : y;
      const safeMonth = Number.isNaN(m) ? (new Date().getMonth() + 1) : m;
      const dueBaseDate = new Date(safeYear, safeMonth, 1); // competência (compras) + 1 mês
      const safeDay = Math.min(Math.max(input.account.dia_vencimento || 10, 1), 28);
      return `${dueBaseDate.getFullYear()}-${String(dueBaseDate.getMonth() + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
    };

    let processed = 0;
    for (const tx of input.transactions) {
      const itemType = classifyItemType(tx, input.classifierRules, input.classifierOverrides);
      if (import.meta.env.DEV && isDebugTargetTx(tx)) {
        console.log('[CardV2][debug][Cassio Jan/2025 R$49.76][processShadowImport]', {
          transactionId: tx.ID_Transacao,
          origin: tx.Origem,
          amount: tx.Valor,
          tipo: tx.Tipo,
          itemType,
          referenceLabel,
          dueDate,
        });
      }
      const postedDate = toDateOnlyIso(tx.Data);

      // Pagamento vindo no lote atual quita a fatura anterior.
      if (itemType === 'payment') {
        const [yearStr, monthStr] = referenceLabel.split('-');
        const year = Number(yearStr);
        const month = Number(monthStr);
        const previousRef = formatReferenceLabel(new Date(year, month - 2, 1));

        let targetStatement = statementCache.get(previousRef) || null;
        if (!targetStatement) {
          targetStatement = await this.upsertStatement({
            userId: input.userId,
            accountId: input.account.id,
            referenceLabel: previousRef,
            dueDate: buildDueDateFromReference(previousRef),
            sourceOrigin: input.origin,
            status: 'partial',
          });
          statementCache.set(previousRef, targetStatement);
        }

        await this.addStatementItem({
          userId: input.userId,
          accountId: input.account.id,
          statementId: targetStatement.id,
          transactionId: tx.ID_Transacao || null,
          itemType,
          amount: Math.abs(Number(tx.Valor || 0)),
          postedDate,
        });
        touchedStatementIds.add(targetStatement.id);
        processed += 1;
        continue;
      }

      await this.addStatementItem({
        userId: input.userId,
        accountId: input.account.id,
        statementId: statement.id,
        transactionId: tx.ID_Transacao || null,
        itemType,
        amount: Math.abs(Number(tx.Valor || 0)),
        postedDate,
      });
      processed += 1;
    }

    for (const statementId of touchedStatementIds) {
      await this.recalculateStatement(statementId);
    }
    return { statementId: statement.id, processed };
  },

  async reprocessImportOrigin(input: ReprocessOriginInput): Promise<{ jobId: string; statementId: string | null; processed: number }> {
    const txs = input.transactions.filter((t) => t.ID_Conta === input.account.id);

    if (txs.length === 0) {
      const emptyJob = await this.createReprocessJob({
        userId: input.userId,
        accountId: input.account.id,
        fromDate: localTodayIso(),
        toDate: localTodayIso(),
      });
      await this.finalizeReprocessJob(emptyJob.id, 'success', {
        reason: 'no-transactions-for-origin',
        origin: input.origin,
        processed: 0,
      });
      return { jobId: emptyJob.id, statementId: null, processed: 0 };
    }

    const ordered = [...txs].sort(sortByDateDesc);
    const fromDate = toDateOnlyIso(ordered[ordered.length - 1].Data);
    const toDate = toDateOnlyIso(ordered[0].Data);

    const job = await this.createReprocessJob({
      userId: input.userId,
      accountId: input.account.id,
      fromDate,
      toDate,
    });

    try {
      const referenceLabel = input.cardCycle?.referenceLabel || inferReferenceLabel(input.origin, txs);
      const txIds = Array.from(new Set(txs.map((t) => t.ID_Transacao).filter(Boolean) as string[]));
      // Limpeza defensiva:
      // remove os itens dessas transações em QUALQUER fatura do cartão
      // para evitar duplicidade ao mudar competência no reprocessamento.
      let affectedStatementIds: string[] = [];
      if (txIds.length > 0) {
        const txChunks = chunkArray(txIds, 200);
        let existingLinksAll: any[] = [];

        for (const txChunk of txChunks) {
          const { data: existingLinks, error: existingLinksError } = await supabase
            .from('credit_card_statement_items')
            .select('statement_id')
            .eq('account_id', input.account.id)
            .in('transaction_id', txChunk);
          if (existingLinksError) throw existingLinksError;
          existingLinksAll = existingLinksAll.concat(existingLinks || []);
        }

        affectedStatementIds = Array.from(
          new Set([...affectedStatementIds, ...existingLinksAll.map((row: any) => row.statement_id).filter(Boolean)])
        );

        for (const txChunk of txChunks) {
          const { error: deleteLinksError } = await supabase
            .from('credit_card_statement_items')
            .delete()
            .eq('account_id', input.account.id)
            .in('transaction_id', txChunk);
          if (deleteLinksError) throw deleteLinksError;
        }
      }

      // Recalcula faturas afetadas para limpar saldos antigos.
      for (const statementId of affectedStatementIds) {
        await this.recalculateStatement(statementId);
      }

      const result = await this.processShadowImport({
        userId: input.userId,
        account: input.account,
        origin: input.origin,
        transactions: txs,
        cardCycle: input.cardCycle,
        classifierRules: input.classifierRules,
        classifierOverrides: input.classifierOverrides,
      });

      // Remove faturas órfãs (sem itens e sem totais) que ficaram de competências antigas.
      for (const statementId of affectedStatementIds) {
        if (statementId === result.statementId) continue;
        const { data: staleStatement, error: staleStatementError } = await supabase
          .from('credit_card_statements')
          .select('id,total_charges,total_credits,total_payments,open_amount')
          .eq('id', statementId)
          .maybeSingle();
        if (staleStatementError) throw staleStatementError;

        const totals = staleStatement as any;
        const isEmpty =
          totals &&
          Number(totals.total_charges || 0) === 0 &&
          Number(totals.total_credits || 0) === 0 &&
          Number(totals.total_payments || 0) === 0 &&
          Number(totals.open_amount || 0) === 0;

        if (isEmpty) {
          const { error: deleteStatementError } = await supabase
            .from('credit_card_statements')
            .delete()
            .eq('id', statementId);
          if (deleteStatementError) throw deleteStatementError;
        }
      }

      await this.finalizeReprocessJob(job.id, 'success', {
        mode: 'origin',
        origin: input.origin,
        referenceLabel,
        statementId: result.statementId,
        processed: result.processed,
      });

      return { jobId: job.id, statementId: result.statementId, processed: result.processed };
    } catch (error: any) {
      await this.finalizeReprocessJob(job.id, 'failed', {
        mode: 'origin',
        origin: input.origin,
        error: error?.message || 'unknown-error',
      });
      throw error;
    }
  },

  async removeOriginFromStatements(input: RemoveOriginInput): Promise<{ jobId: string; removedItems: number }> {
    const txs = input.deletedTransactions.filter((t) => t.ID_Conta === input.account.id && t.Origem === input.origin);
    const fallbackDate = localTodayIso();
    const ordered = [...txs].sort(sortByDateDesc);
    const fromDate = ordered.length > 0 ? toDateOnlyIso(ordered[ordered.length - 1].Data) : fallbackDate;
    const toDate = ordered.length > 0 ? toDateOnlyIso(ordered[0].Data) : fallbackDate;

    const job = await this.createReprocessJob({
      userId: input.userId,
      accountId: input.account.id,
      fromDate,
      toDate,
    });

    try {
      if (txs.length === 0) {
        await this.finalizeReprocessJob(job.id, 'success', {
          mode: 'delete-origin',
          origin: input.origin,
          removedItems: 0,
          reason: 'no-transactions-provided',
        });
        return { jobId: job.id, removedItems: 0 };
      }

      const referenceLabel = inferReferenceLabel(input.origin, txs);
      const statement = await this.getStatementByReference(input.account.id, referenceLabel);

      if (!statement) {
        await this.finalizeReprocessJob(job.id, 'success', {
          mode: 'delete-origin',
          origin: input.origin,
          referenceLabel,
          removedItems: 0,
          reason: 'statement-not-found',
        });
        return { jobId: job.id, removedItems: 0 };
      }

      const idsToDelete = txs.map((t) => t.ID_Transacao).filter(Boolean) as string[];
      if (idsToDelete.length > 0) {
        await supabase
          .from('credit_card_statement_items')
          .delete()
          .eq('statement_id', statement.id)
          .in('transaction_id', idsToDelete);
      }

      await this.recalculateStatement(statement.id);

      await this.finalizeReprocessJob(job.id, 'success', {
        mode: 'delete-origin',
        origin: input.origin,
        referenceLabel,
        removedItems: idsToDelete.length,
        statementId: statement.id,
      });

      return { jobId: job.id, removedItems: idsToDelete.length };
    } catch (error: any) {
      await this.finalizeReprocessJob(job.id, 'failed', {
        mode: 'delete-origin',
        origin: input.origin,
        error: error?.message || 'unknown-error',
      });
      throw error;
    }
  },

  async getStatementByReference(
    accountId: string,
    referenceLabel: string
  ): Promise<CreditCardStatement | null> {
    const { data, error } = await supabase
      .from('credit_card_statements')
      .select('*')
      .eq('account_id', accountId)
      .eq('reference_label', referenceLabel)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return (data as CreditCardStatement | null) ?? null;
  },

  async createReprocessJob(input: ReprocessWindowInput): Promise<CreditCardReprocessJob> {
    const { data, error } = await supabase
      .from('credit_card_reprocess_jobs')
      .insert({
        user_id: input.userId,
        account_id: input.accountId,
        status: 'running',
        summary_json: { fromDate: input.fromDate, toDate: input.toDate },
      })
      .select('*')
      .single();

    if (error) throw error;
    return data as CreditCardReprocessJob;
  },

  async finalizeReprocessJob(
    jobId: string,
    status: CreditCardReprocessJob['status'],
    summary: Record<string, unknown>
  ): Promise<CreditCardReprocessJob> {
    const { data, error } = await supabase
      .from('credit_card_reprocess_jobs')
      .update({
        status,
        finished_at: new Date().toISOString(),
        summary_json: summary,
      })
      .eq('id', jobId)
      .select('*')
      .single();

    if (error) throw error;
    return data as CreditCardReprocessJob;
  },

  /**
   * Placeholder for Phase 1 shadow processing.
   * Intentionally explicit to avoid accidental production use before validation.
   */
  async rebuildStatementsForWindow(_input: ReprocessWindowInput): Promise<void> {
    const job = await this.createReprocessJob({
      userId: _input.userId,
      accountId: _input.accountId,
      fromDate: _input.fromDate,
      toDate: _input.toDate,
    });

    try {
      const { data: txData, error: txError } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', _input.userId)
        .eq('ID_Conta', _input.accountId)
        .gte('Data', _input.fromDate)
        .lte('Data', _input.toDate)
        .order('Data', { ascending: true });

      if (txError) throw txError;

      const allTx = (txData as Transaction[]) ?? [];
      const groupedByOrigin = new Map<string, Transaction[]>();

      allTx.forEach((tx) => {
        const origin = tx.Origem || 'manual';
        if (origin === 'manual') return;
        const current = groupedByOrigin.get(origin) || [];
        current.push(tx);
        groupedByOrigin.set(origin, current);
      });

      const origins = Array.from(groupedByOrigin.keys());
      if (origins.length > 0) {
        const { data: oldStatementsByOrigin, error: oldByOriginError } = await supabase
          .from('credit_card_statements')
          .select('id')
          .eq('account_id', _input.accountId)
          .in('source_origin', origins);
        if (oldByOriginError) throw oldByOriginError;

        const ids = (oldStatementsByOrigin || []).map((s: any) => s.id).filter(Boolean);
        if (ids.length > 0) {
          const { error: deleteOldItemsError } = await supabase
            .from('credit_card_statement_items')
            .delete()
            .in('statement_id', ids);
          if (deleteOldItemsError) throw deleteOldItemsError;
        }
      }

      const { data: accountData, error: accountError } = await supabase
        .from('contas')
        .select('*')
        .eq('id', _input.accountId)
        .single();

      if (accountError) throw accountError;
      const account = accountData as Account;

      let processed = 0;
      for (const [origin, txs] of groupedByOrigin.entries()) {
        const result = await this.processShadowImport({
          userId: _input.userId,
          account,
          origin,
          transactions: txs,
          classifierRules: _input.classifierRules,
        });
        processed += result.processed;
      }

      await this.finalizeReprocessJob(job.id, 'success', {
        mode: 'window',
        fromDate: _input.fromDate,
        toDate: _input.toDate,
        origins: groupedByOrigin.size,
        processed,
      });
    } catch (error: any) {
      await this.finalizeReprocessJob(job.id, 'failed', {
        mode: 'window',
        fromDate: _input.fromDate,
        toDate: _input.toDate,
        error: error?.message || 'unknown-error',
      });
      throw error;
    }
  },
};

export const getCreditCardShadowDashboard = async (
  accounts: Account[],
  transactions: Transaction[]
): Promise<CreditCardShadowDashboardRow[]> => {
  const creditAccounts = accounts.filter((a) => a.Tipo_Conta === 'Cartão de Crédito');
  if (creditAccounts.length === 0) return [];

  const rows = await Promise.all(
    creditAccounts.map(async (account) => {
      const accountTx = transactions.filter((t) => t.ID_Conta === account.id);
      const nonManual = accountTx.filter((t) => t.Origem && t.Origem !== 'manual');

      let lastOrigin: string | null = null;
      let v1CurrentGross = 0;

      if (nonManual.length > 0) {
        const latestTx = nonManual.sort(
          (a, b) => new Date(b.Data).getTime() - new Date(a.Data).getTime()
        )[0];
        lastOrigin = latestTx.Origem || null;

        v1CurrentGross = round2(nonManual
          .filter((t) => t.Origem === lastOrigin)
          .reduce((sum, t) => {
            const rawText = `${t.Descricao_Original || ''} ${t.Nome_Fantasia || ''}`.toLowerCase();
            const isStatementPayment = /(pagamentos?\s+validos?\s+normais|pagamento.*fatura|pagamentos?)/i.test(rawText);
            if (isStatementPayment) return sum; // alinhado com card atual

            if (t.Tipo === 'Despesa') return sum + Math.abs(Number(t.Valor || 0));
            return sum - Math.abs(Number(t.Valor || 0)); // estorno/reembolso
          }, 0));
      }

      let v2CurrentGross = 0;
      let v2OpenAmount = 0;

      const txFromLastOrigin = lastOrigin
        ? accountTx.filter((t) => t.Origem === lastOrigin)
        : [];
      const referenceLabel = lastOrigin
        ? inferReferenceLabel(lastOrigin, txFromLastOrigin)
        : null;
      const statement = referenceLabel
        ? await creditCardStatementService.getStatementByReference(account.id, referenceLabel)
        : await creditCardStatementService.getCurrentStatement(account.id);
      if (statement) {
        v2CurrentGross = round2(statement.total_charges || 0);
        v2OpenAmount = round2(statement.open_amount || 0);
      }

      const absoluteDiff = round2(Math.abs(v1CurrentGross - v2OpenAmount));
      const diffPercent =
        v1CurrentGross > 0 ? round2((absoluteDiff / v1CurrentGross) * 100) : absoluteDiff > 0 ? 100 : 0;

      let status: CreditCardShadowDashboardRow['status'] = 'ok';
      if (v1CurrentGross === 0 && v2CurrentGross === 0) status = 'no-data';
      else if (absoluteDiff >= 0.01) status = 'divergent';

      return {
        accountId: account.id,
        accountName: account.Nome_Conta,
        lastOrigin,
        v1CurrentGross,
        v2CurrentGross,
        v2OpenAmount,
        absoluteDiff,
        diffPercent,
        status,
      };
    })
  );

  return rows.sort((a, b) => {
    if (a.status === 'divergent' && b.status !== 'divergent') return -1;
    if (b.status === 'divergent' && a.status !== 'divergent') return 1;
    return b.absoluteDiff - a.absoluteDiff;
  });
};
