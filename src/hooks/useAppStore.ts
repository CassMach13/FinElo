import { create } from 'zustand';
import { appAlert } from './useDialogStore';
import { supabase } from '../supabaseClient';
import {
  Transaction,
  Category,
  Budget,
  MappingRule,
  ImportConfig,
  Account,
  ImportLog,
  SupportTicket,
  Subscription,
  AdminMetrics,
  Asset,
  FamilyMember,
  AppView,
  CreditCardReprocessJob,
  CardImportCycleInput,
  CreditCardStatementV2,
  CreditCardStatementAudit,
  CreditCardEntry,
  ManualStatementTotalsPayload,
} from '../types';
import { User } from '@supabase/supabase-js';
import { getDefaultTransactionFilters } from '../utils/transactionPeriodFilters';
import { isCardV2Enabled, isCardV2ShadowEnabled, isCreditCardEngineEnabled } from '../services/featureFlagService';
import { creditCardStatementService, CreditCardShadowDashboardRow, getCreditCardShadowDashboard, CardClassifierRules, CardClassifierOverrides } from '../services/creditCardStatementService';
import { creditCardEngineService, parseCreditCardReferenceFromFileName } from '../services/creditCardEngineService';
import { creditCardMigrationService } from '../services/creditCardMigrationService';
import {
  creditCardRebuildFromImportHistoryService,
  type ImportHistoryRebuildCycle,
  type ImportHistoryRebuildResult,
} from '../services/creditCardRebuildFromImportHistoryService';
import { ClassificationRules } from '../domain/credit-card/classifiers';
import { comparableImportOriginKey } from '../utils/importOriginKey';
import { parseDateOnlyLocal, toDateOnlyIso } from '../utils/dateOnly';
import { collectPaginatedRows } from '../utils/paginatedFetch';
import { isImportedDetailRowsIncomplete } from '../utils/importLogHealth';
import { scheduleManualCreditCardSync } from '../services/creditCardManualMotorSync';
import {
  prepareManualPurchaseCompetenceOnPaymentDateEdit,
  referenceMonthFromTransaction,
} from '../services/creditCardManualCompetence';

const parseClassifierKeywords = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
};

const getCardClassifierRules = (user: User | null): CardClassifierRules | undefined => {
  if (!user) return undefined;
  const metadata = (user.user_metadata || {}) as Record<string, unknown>;
  const paymentKeywords = parseClassifierKeywords(metadata.cardPaymentKeywords);
  const creditKeywords = parseClassifierKeywords(metadata.cardCreditKeywords);
  if (paymentKeywords.length === 0 && creditKeywords.length === 0) return undefined;
  return { paymentKeywords, creditKeywords };
};

const REF_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const shouldAutoSyncCreditCardLedger = (user: User | null): boolean =>
  Boolean(
    user?.id &&
      (isCreditCardEngineEnabled(user) || isCardV2ShadowEnabled(user) || isCardV2Enabled(user))
  );

const engineClassifierRulesFromUser = (user: User | null): ClassificationRules | undefined => {
  const legacy = getCardClassifierRules(user);
  if (!legacy) return undefined;
  const out: ClassificationRules = {};
  if (legacy.paymentKeywords?.length) out.paymentKeywords = legacy.paymentKeywords;
  if (legacy.creditKeywords?.length) out.refundKeywords = legacy.creditKeywords;
  return Object.keys(out).length ? out : undefined;
};

const parseManualCardCycleToDue = (
  cardCycle?: CardImportCycleInput
): { dueYear?: number; dueMonth?: number; dueDate?: string } => {
  const dueDate =
    cardCycle?.dueDate && /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(cardCycle.dueDate)
      ? cardCycle.dueDate
      : undefined;
  if (!cardCycle?.referenceLabel || !/^\d{4}-(0[1-9]|1[0-2])$/.test(cardCycle.referenceLabel)) {
    return { dueDate };
  }
  const [y, m] = cardCycle.referenceLabel.split('-');
  return { dueYear: Number(y), dueMonth: Number(m), dueDate };
};

async function syncImportedCardOrigin(opts: {
  getState: () => { transactions: Transaction[]; accounts: Account[] };
  user: User;
  accountId: string;
  origin: string;
  classifierOverrides?: CardClassifierOverrides;
  cardCycle?: CardImportCycleInput;
}): Promise<void> {
  const { transactions, accounts } = opts.getState();
  const account = accounts.find((a) => a.id === opts.accountId);
  if (!account || account.Tipo_Conta !== 'Cartão de Crédito') return;

  const txs = transactions.filter((t) => t.ID_Conta === opts.accountId && t.Origem === opts.origin);
  const due = opts.cardCycle ? parseManualCardCycleToDue(opts.cardCycle) : {};
  const engineRules = engineClassifierRulesFromUser(opts.user);

  if (isCreditCardEngineEnabled(opts.user)) {
    await creditCardEngineService.reprocessImportOriginFromTransactions({
      userId: opts.user.id,
      account,
      origin: opts.origin,
      transactions: txs,
      rules: engineRules,
      paymentOverrideTransactionIds: opts.classifierOverrides?.paymentTransactionIds,
      refundOverrideTransactionIds: opts.classifierOverrides?.refundTransactionIds,
      dueYear: due.dueYear,
      dueMonth: due.dueMonth,
      dueDate: due.dueDate,
    });
    return;
  }

  if (isCardV2ShadowEnabled(opts.user) || isCardV2Enabled(opts.user)) {
    await creditCardStatementService.reprocessImportOrigin({
      userId: opts.user.id,
      account,
      origin: opts.origin,
      transactions: txs,
      cardCycle: opts.cardCycle,
      classifierRules: getCardClassifierRules(opts.user),
      classifierOverrides: opts.classifierOverrides,
    });
  }
}

async function removeImportedCardArtifacts(opts: {
  userId: string;
  user: User;
  account: Account;
  origin: string;
  deletedTransactions: Transaction[];
}): Promise<void> {
  if (isCreditCardEngineEnabled(opts.user)) {
    await creditCardEngineService.removeOriginFromEngine({
      accountId: opts.account.id,
      origin: opts.origin,
    });
    return;
  }
  if (isCardV2ShadowEnabled(opts.user) || isCardV2Enabled(opts.user)) {
    await creditCardStatementService.removeOriginFromStatements({
      userId: opts.userId,
      account: opts.account,
      origin: opts.origin,
      deletedTransactions: opts.deletedTransactions,
    });
  }
}


// Interface para o estado da nossa aplicação
interface AppState {
  transactions: Transaction[];
  user: User | null;
  accounts: Account[];
  categories: Category[];
  budgets: Budget[];
  mappingRules: MappingRule[];
  importConfigs: ImportConfig[];
  importLogs: ImportLog[]; // New state
  isLoading: boolean;
  transactionFilters: {
    text: string;
    startDate: string;
    endDate: string;
    dateField: 'Data' | 'Pagamento';
    category: string[];
    type: string;
    accountId: string[];
    ownerUserId: string;
    viewScope: 'operation' | 'commitments' | 'all';
    periodPreset: 'current_month' | 'previous_month' | 'last_30_days' | 'all' | 'custom';
  };

  // Assets (Patrimônio)
  assets: Asset[];
  fetchAssets: () => Promise<void>;
  addAsset: (asset: Omit<Asset, 'id' | 'user_id' | 'updated_at'>) => Promise<void>;
  deleteAsset: (assetId: string) => Promise<void>;
  updateAsset: (asset: Partial<Asset> & { id: string }) => Promise<void>;
  recalculateAssetBalance: (assetId: string) => Promise<void>;
  recalculateAllAssetBalances: () => Promise<void>;

  setTransactionFilters: (filters: AppState['transactionFilters']) => void;
  setUser: (user: User | null) => void;
  updateUserPreferences: (preferences: Partial<User['user_metadata']>) => Promise<void>;
  signOut: () => Promise<void>;

  // Novas ações para buscar dados do Supabase
  fetchAllData: () => Promise<void>;
  fetchTransactions: () => Promise<void>;

  // CRUD for Accounts
  fetchAccounts: () => Promise<void>;
  addAccount: (account: Omit<Account, 'id' | 'user_id'>) => Promise<Account | null>;
  updateAccount: (account: Partial<Account> & { id: string }) => Promise<void>;
  deleteAccount: (accountId: string) => Promise<void>;
  archiveAccount: (accountId: string, isArchived: boolean) => Promise<void>;
  getAccountsWithCalculatedBalance: () => Account[];

  // Funções para manipular o estado (ações)
  addTransaction: (transaction: Omit<Transaction, 'ID_Transacao' | 'Origem'> | Omit<Transaction, 'ID_Transacao' | 'Origem'>[]) => Promise<void>;
  addMultipleTransactions: (
    newTransactions: Omit<Transaction, 'ID_Transacao' | 'user_id'>[],
    importConfig: ImportConfig,
    fileName: string,
    ignoredItems?: any[],
    options?: {
      cardCycle?: CardImportCycleInput;
      creditCardFileTotals?: { statementTotal?: number; totalPayments?: number };
    }
  ) => Promise<{ imported: number, ignored: number }>;
  updateTransaction: (updatedTransaction: Partial<Transaction> & { ID_Transacao: string }) => Promise<void>;
  deleteTransaction: (transactionId: string) => Promise<void>;
  deleteManualTransactions: (transactionIds: string[]) => Promise<number>;
  deleteTransactionsByOrigin: (origin: string) => Promise<void>;
  reassignTransactionsAccountByOrigin: (origin: string, accountId: string) => Promise<{ updated: number }>;

  // CRUD for Categories
  fetchCategories: () => Promise<void>;
  addCategory: (category: Omit<Category, 'id' | 'user_id'>) => Promise<{ status: 'created' | 'updated' | 'duplicate' | 'error', message: string }>;
  updateCategory: (category: Category) => Promise<void>;
  deleteCategory: (categoryId: string) => Promise<void>;
  getSortedCategories: () => Category[];

  // CRUD for Budgets
  fetchBudgets: () => Promise<void>;
  addBudget: (budget: Omit<Budget, 'id' | 'user_id'>) => Promise<void>;
  updateBudget: (budget: Budget) => Promise<void>;
  deleteBudget: (budgetId: string) => Promise<void>;

  // CRUD for Mapping Rules
  fetchMappingRules: () => Promise<void>;
  addMappingRule: (rule: Omit<MappingRule, 'id' | 'user_id'>) => Promise<void>;
  updateMappingRule: (rule: MappingRule) => Promise<void>;
  deleteMappingRule: (ruleId: string) => Promise<void>;
  applyRuleToExistingTransactions: (rule: MappingRule) => Promise<void>;
  reApplyAllRules: () => Promise<void>;
  findDuplicateRules: () => MappingRule[][];

  // CRUD for Import Configs
  fetchImportConfigs: () => Promise<void>;
  addImportConfig: (config: Omit<ImportConfig, 'id' | 'user_id'>) => Promise<void>;
  updateImportConfig: (config: ImportConfig) => Promise<void>;
  deleteImportConfig: (configId: string) => Promise<void>;

  // Import Logs
  fetchImportLogs: () => Promise<void>;
  deleteImportLog: (logId: string, fileName: string) => Promise<void>;
  syncLegacyImportLogs: () => Promise<void>;

  // Support Tickets
  supportTickets: SupportTicket[];
  fetchSupportTickets: () => Promise<void>; // Fetch own tickets
  fetchAllTickets: () => Promise<void>; // Admin: Fetch all tickets
  createSupportTicket: (ticket: Omit<SupportTicket, 'id' | 'user_id' | 'status' | 'created_at' | 'updated_at'>, file?: File) => Promise<void>;
  updateSupportTicketStatus: (ticketId: string, status: SupportTicket['status']) => Promise<void>;

  // Subscription
  subscription: Subscription | null;
  fetchSubscription: () => Promise<void>;
  isPremium: boolean; // Helper computed property
  isWealth: boolean; // Helper computed property for Wealth tier
  unlimitedSync: boolean; // NEW: Premium VIP sync bypass
  respondToTicket?: (ticketId: string) => Promise<void>; // Deprecated
  sendMessage: (ticketId: string, message: string, file?: File) => Promise<void>;
  uploadTicketAttachment: (file: File) => Promise<string | null>;

  // Admin Dashboard
  adminMetrics: AdminMetrics | null;
  fetchAdminMetrics: () => Promise<void>;

  // Navigation & UI State
  currentView: AppView;
  setCurrentView: (view: AppView) => void;

  // Family Plan Acceptance
  pendingInvites: FamilyMember[];
  fetchPendingInvites: () => Promise<void>;
  respondToInvite: (inviteId: string, status: 'accepted' | 'declined') => Promise<void>;

  // Card V2 shadow mode
  creditCardShadowDashboard: CreditCardShadowDashboardRow[];
  creditCardReprocessJobs: CreditCardReprocessJob[];
  creditCardStatements: CreditCardStatementV2[];
  creditCardStatementEntries: CreditCardEntry[];
  selectedCreditCardStatementAudit: CreditCardStatementAudit | null;
  refreshCreditCardShadowDashboard: () => Promise<void>;
  fetchCreditCardReprocessJobs: () => Promise<void>;
  /** Incrementado quando o motor de cartão atualiza dados em `credit_card_statements` (refetch nos cards de Transações). */
  creditCardEngineRevision: number;
  bumpCreditCardEngineRevision: () => void;
  getCardStatements: (accountIdOrCardRowId: string) => Promise<CreditCardStatementV2[]>;
  getStatementDetail: (statementId: string) => Promise<{ statement: CreditCardStatementV2; entries: CreditCardEntry[] } | null>;
  getStatementAudit: (statementId: string) => Promise<CreditCardStatementAudit | null>;
  payStatement: (
    statementId: string,
    paymentData: { paymentDate: string; amount: number; paymentAccountId?: string; notes?: string }
  ) => Promise<CreditCardStatementV2 | null>;
  /** Grava totais conferidos na fatura (manual_totals_json) e recalcula com overlay. */
  saveStatementManualTotals: (
    statementId: string,
    payload: Partial<ManualStatementTotalsPayload>
  ) => Promise<CreditCardStatementV2 | null>;
  reprocessImportLot: (importLotId: string) => Promise<{ statementId: string; processedEntries: number }>;
  /** Recalcula todas as competências do cartão no banco (aplica pagamentos vindos da fatura seguinte, corrige «Pago»/«Aberto»). */
  recalculateAllCardStatementsForAccount: (accountId: string) => Promise<void>;
  backfillCreditCardHistory: (accountId: string) => Promise<{ processedLots: number; processedEntries: number }>;
  reprocessCreditCardImportByOrigin: (origin: string, options?: { cardCycle?: CardImportCycleInput }) => Promise<{ processed: number; message: string }>;
  rebuildCreditCardByPeriod: (accountId: string, fromDate: string, toDate: string) => Promise<{ message: string }>;
  /** Reconstrói faturas somando linhas de cada arquivo do histórico (competência + vencimento por arquivo). */
  rebuildCreditCardFromImportHistory: (
    accountId: string,
    cycles: ImportHistoryRebuildCycle[]
  ) => Promise<ImportHistoryRebuildResult>;
  syncCreditCardHistoryFromAccount: (accountId: string) => Promise<{ message: string; origins: number; processed: number }>;
  saveCardImportLotClassification: (
    origin: string,
    accountId: string,
    referenceLabel: string,
    dueDate: string,
    options?: {
      paymentTransactionIds?: string[];
      refundTransactionIds?: string[];
    }
  ) => Promise<{ updatedLogs: number; message: string }>;
  /** Reidrata `imported_details` + `imported_count` nas importações onde o JSON não bate com o ledger (ex.: só metadados de cartão). Opcional: só um registro (`logId`). */
  repairImportLogsImportedDetailsFromLedger: (logId?: string | null) => Promise<{ updated: number; message: string }>;

  // Founder's Pack Counter
  founderCount: number;
  fetchFounderCount: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  // ... existing code ...

  // --- ESTADO INICIAL ---
  transactions: [],
  user: null,
  accounts: [],
  categories: [],
  budgets: [],
  mappingRules: [],
  importConfigs: [],
  importLogs: [],
  supportTickets: [],
  subscription: null,
  isPremium: false,
  isWealth: false,
  unlimitedSync: false,
  isLoading: false,
  adminMetrics: null,
  assets: [],
  transactionFilters: getDefaultTransactionFilters(),
  currentView: 'dashboard',
  setCurrentView: (view) => set({ currentView: view }),

  pendingInvites: [],
  founderCount: 0,
  creditCardShadowDashboard: [],
  creditCardReprocessJobs: [],
  creditCardStatements: [],
  creditCardStatementEntries: [],
  selectedCreditCardStatementAudit: null,
  creditCardEngineRevision: 0,

  // --- AÇÕES ---

  bumpCreditCardEngineRevision: () => set((s) => ({ creditCardEngineRevision: s.creditCardEngineRevision + 1 })),
  // Filtros de Transação
  setTransactionFilters: (filters) => set({ transactionFilters: filters }),
  setUser: (user) => {
    const isAdmin = user?.email?.toLowerCase().trim() === 'cassiomq@gmail.com';
    set({ 
      user, 
      isPremium: isAdmin || get().isPremium, 
      isWealth: isAdmin || get().isWealth,
      unlimitedSync: isAdmin || get().unlimitedSync 
    });
  },
  
  updateUserPreferences: async (preferences) => {
    const { user } = get();
    if (!user) return;
    
    // Update local state optimistically
    const updatedUser = {
      ...user,
      user_metadata: {
        ...user.user_metadata,
        ...preferences
      }
    };
    get().setUser(updatedUser as User);

    // Persist to Supabase Auth
    const { error } = await supabase.auth.updateUser({
      data: preferences
    });
    
    if (error) {
      console.error('Error updating user preferences:', error);
      // Optional: rollback state if needed
    }
  },

  refreshCreditCardShadowDashboard: async () => {
    const { accounts, transactions, user } = get();
    const classifierRules = getCardClassifierRules(user);
    try {
      if (user && isCardV2ShadowEnabled(user) && !isCreditCardEngineEnabled(user)) {
        const creditAccounts = accounts.filter(a => a.Tipo_Conta === 'Cartão de Crédito');
        for (const account of creditAccounts) {
          const accountOrigins = transactions
            .filter(t => t.ID_Conta === account.id && t.Origem && t.Origem !== 'manual')
            .map(t => t.Origem as string);

          const latestOrigin = accountOrigins.sort((a, b) => {
            const aDate = new Date(
              transactions
                .filter(t => t.ID_Conta === account.id && t.Origem === a)
                .sort((x, y) => new Date(y.Data).getTime() - new Date(x.Data).getTime())[0]?.Data || 0
            ).getTime();
            const bDate = new Date(
              transactions
                .filter(t => t.ID_Conta === account.id && t.Origem === b)
                .sort((x, y) => new Date(y.Data).getTime() - new Date(x.Data).getTime())[0]?.Data || 0
            ).getTime();
            return bDate - aDate;
          })[0];

          if (latestOrigin) {
            const txFromOrigin = transactions.filter(t => t.ID_Conta === account.id && t.Origem === latestOrigin);
            await creditCardStatementService.processShadowImport({
              userId: user.id,
              account,
              origin: latestOrigin,
              transactions: txFromOrigin,
              classifierRules,
            });
          }
        }
      }

      const rows = await getCreditCardShadowDashboard(accounts, transactions);
      set({ creditCardShadowDashboard: rows });
    } catch (error) {
      console.error('[CardV2][Shadow] Falha ao atualizar dashboard de divergencias:', error);
    }
  },

  fetchCreditCardReprocessJobs: async () => {
    const { user } = get();
    if (!user) {
      set({ creditCardReprocessJobs: [] });
      return;
    }

    const { data, error } = await supabase
      .from('credit_card_reprocess_jobs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(30);

    if (error) {
      console.error('[CardV2][Ops] Falha ao buscar jobs de reprocessamento:', error);
      return;
    }

    set({ creditCardReprocessJobs: (data as CreditCardReprocessJob[]) || [] });
  },

  getCardStatements: async (accountIdOrCardId) => {
    const user = get().user;
    if (!user) {
      set({ creditCardStatements: [] });
      return [];
    }

    let cardRowId = accountIdOrCardId;
    const account = get().accounts.find((a) => a.id === accountIdOrCardId);

    try {
      if (account?.Tipo_Conta === 'Cartão de Crédito') {
        const ensured = await creditCardEngineService.ensureCreditCardForAccount(user.id, account);
        cardRowId = ensured.id;
      } else if (account && account.Tipo_Conta !== 'Cartão de Crédito') {
        set({ creditCardStatements: [] });
        return [];
      }

      const statements = await creditCardEngineService.getCardStatements(cardRowId);
      const mapped = statements.map((statement) => ({
        id: statement.id,
        user_id: get().user?.id || '',
        card_id: statement.cardId,
        account_id: statement.accountId,
        purchase_reference_label: statement.purchaseReferenceLabel,
        due_year: statement.dueYear,
        due_month: statement.dueMonth,
        due_date: statement.dueDate || null,
        closing_date: statement.closingDate || null,
        status: statement.status,
        source_import_lot_ids: statement.sourceImportLotIds,
        total_purchases: statement.totalPurchases,
        total_fees: statement.totalFees,
        total_interest: statement.totalInterest,
        total_refunds: statement.totalRefunds,
        statement_total: statement.statementTotal,
        total_payments: statement.totalPayments,
        open_balance: statement.openBalance,
        statement_total_from_file: statement.statementTotalFromFile ?? null,
        total_payments_from_file: statement.totalPaymentsFromFile ?? null,
        manual_totals: statement.manualTotals ?? null,
      })) as CreditCardStatementV2[];
      set({ creditCardStatements: mapped });
      return mapped;
    } catch (error) {
      console.error('[CardEngine] Falha ao listar faturas do cartão:', error);
      set({ creditCardStatements: [] });
      throw error;
    }
  },

  getStatementDetail: async (statementId) => {
    try {
      const detail = await creditCardEngineService.getStatementDetail(statementId);
      const statement: CreditCardStatementV2 = {
        id: detail.statement.id,
        user_id: get().user?.id || '',
        card_id: detail.statement.cardId,
        account_id: detail.statement.accountId,
        purchase_reference_label: detail.statement.purchaseReferenceLabel,
        due_year: detail.statement.dueYear,
        due_month: detail.statement.dueMonth,
        due_date: detail.statement.dueDate || null,
        closing_date: detail.statement.closingDate || null,
        status: detail.statement.status,
        source_import_lot_ids: detail.statement.sourceImportLotIds,
        total_purchases: detail.statement.totalPurchases,
        total_fees: detail.statement.totalFees,
        total_interest: detail.statement.totalInterest,
        total_refunds: detail.statement.totalRefunds,
        statement_total: detail.statement.statementTotal,
        total_payments: detail.statement.totalPayments,
        open_balance: detail.statement.openBalance,
        statement_total_from_file: detail.statement.statementTotalFromFile ?? null,
        total_payments_from_file: detail.statement.totalPaymentsFromFile ?? null,
        manual_totals: detail.statement.manualTotals ?? null,
      };
      const entries = detail.entries.map((entry) => ({
        id: entry.id || '',
        user_id: get().user?.id || '',
        card_id: detail.statement.cardId,
        account_id: detail.statement.accountId,
        import_lot_id: entry.importLotId || '',
        source_file_name: entry.sourceFileName,
        source_row_index: entry.sourceRowIndex,
        source_row_hash: entry.sourceRowHash,
        transaction_id: entry.transactionId || null,
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
        category_id: entry.categoryId || null,
        classification_source: entry.classificationSource,
        classification_confidence: entry.classificationConfidence,
        statement_id: entry.statementId || null,
      })) as CreditCardEntry[];
      set({ creditCardStatementEntries: entries });
      return { statement, entries };
    } catch (error) {
      console.error('[CardEngine] Falha ao carregar detalhe da fatura:', error);
      return null;
    }
  },

  getStatementAudit: async (statementId) => {
    try {
      const audit = await creditCardEngineService.getStatementAudit(statementId);
      set({ selectedCreditCardStatementAudit: audit });
      return audit;
    } catch (error) {
      console.error('[CardEngine] Falha ao carregar auditoria da fatura:', error);
      return null;
    }
  },

  payStatement: async (statementId, paymentData) => {
    const { user } = get();
    if (!user) return null;
    try {
      const recalculated = await creditCardEngineService.payStatement(user.id, statementId, paymentData);
      set((state) => ({
        creditCardStatements: state.creditCardStatements.map((statement) =>
          statement.id === statementId
            ? {
                ...statement,
                status: recalculated.status,
                total_purchases: recalculated.totalPurchases,
                total_fees: recalculated.totalFees,
                total_interest: recalculated.totalInterest,
                total_refunds: recalculated.totalRefunds,
                statement_total: recalculated.statementTotal,
                total_payments: recalculated.totalPayments,
                open_balance: recalculated.openBalance,
                manual_totals: recalculated.manualTotals ?? null,
              }
            : statement
        ),
      }));
      get().bumpCreditCardEngineRevision();
      return {
        id: recalculated.id,
        user_id: user.id,
        card_id: recalculated.cardId,
        account_id: recalculated.accountId,
        purchase_reference_label: recalculated.purchaseReferenceLabel,
        due_year: recalculated.dueYear,
        due_month: recalculated.dueMonth,
        due_date: recalculated.dueDate || null,
        closing_date: recalculated.closingDate || null,
        status: recalculated.status,
        source_import_lot_ids: recalculated.sourceImportLotIds,
        total_purchases: recalculated.totalPurchases,
        total_fees: recalculated.totalFees,
        total_interest: recalculated.totalInterest,
        total_refunds: recalculated.totalRefunds,
        statement_total: recalculated.statementTotal,
        total_payments: recalculated.totalPayments,
        open_balance: recalculated.openBalance,
        manual_totals: recalculated.manualTotals ?? null,
      } as CreditCardStatementV2;
    } catch (error) {
      console.error('[CardEngine] Falha ao pagar fatura:', error);
      return null;
    }
  },

  saveStatementManualTotals: async (statementId, payload) => {
    const { user } = get();
    if (!user) return null;
    try {
      const s = await creditCardEngineService.saveStatementManualTotals(statementId, payload);
      const updated: CreditCardStatementV2 = {
        id: s.id,
        user_id: user.id,
        card_id: s.cardId,
        account_id: s.accountId,
        purchase_reference_label: s.purchaseReferenceLabel,
        due_year: s.dueYear,
        due_month: s.dueMonth,
        due_date: s.dueDate || null,
        closing_date: s.closingDate || null,
        status: s.status,
        source_import_lot_ids: s.sourceImportLotIds,
        total_purchases: s.totalPurchases,
        total_fees: s.totalFees,
        total_interest: s.totalInterest,
        total_refunds: s.totalRefunds,
        statement_total: s.statementTotal,
        total_payments: s.totalPayments,
        open_balance: s.openBalance,
        manual_totals: s.manualTotals ?? null,
      };
      set((state) => ({
        creditCardStatements: state.creditCardStatements.map((st) =>
          st.id === statementId ? updated : st
        ),
      }));
      await get().getStatementDetail(statementId);
      get().bumpCreditCardEngineRevision();
      return updated;
    } catch (error) {
      console.error('[CardEngine] Falha ao salvar totais manuais:', error);
      return null;
    }
  },

  reprocessImportLot: async (importLotId) => {
    const result = await creditCardEngineService.reprocessImportLot(importLotId);
    get().bumpCreditCardEngineRevision();
    return result;
  },

  recalculateAllCardStatementsForAccount: async (accountId) => {
    const { user, accounts } = get();
    if (!user) return;
    const account = accounts.find((item) => item.id === accountId);
    if (!account) return;
    const ensured = await creditCardEngineService.ensureCreditCardForAccount(user.id, account);
    await creditCardEngineService.recalculateAllStatementsForCard(ensured.id);
    get().bumpCreditCardEngineRevision();
  },

  backfillCreditCardHistory: async (accountId) => {
    const { user, accounts, transactions, importLogs } = get();
    if (!user) return { processedLots: 0, processedEntries: 0 };
    const account = accounts.find((item) => item.id === accountId);
    if (!account) return { processedLots: 0, processedEntries: 0 };
    return creditCardMigrationService.backfillAccountFromTransactions({
      userId: user.id,
      account,
      transactions,
      importLogs,
    }).then((result) => {
      get().bumpCreditCardEngineRevision();
      return result;
    });
  },

  reprocessCreditCardImportByOrigin: async (origin, options) => {
    const { user, accounts, transactions, importLogs } = get();
    if (!user) return { processed: 0, message: 'Usuário não autenticado.' };

    const targetKey = comparableImportOriginKey(origin);
    let txByOrigin = transactions.filter((t) => t.ID_Conta && comparableImportOriginKey(t.Origem) === targetKey);

    const latestLogForOrigin = [...importLogs]
      .filter((log) => comparableImportOriginKey(log.file_name) === comparableImportOriginKey(origin))
      .sort((a, b) => new Date(b.import_date || 0).getTime() - new Date(a.import_date || 0).getTime())[0];

    if (txByOrigin.length === 0 && latestLogForOrigin) {
      const idSet = new Set<string>();
      const det = Array.isArray(latestLogForOrigin.imported_details) ? latestLogForOrigin.imported_details : [];
      det.forEach((row: any) => {
        const tid = row?.ID_Transacao ?? row?.transaction_id ?? row?.transactionId;
        if (tid && typeof tid === 'string') idSet.add(tid);
      });
      if (idSet.size > 0) {
        txByOrigin = transactions.filter((t) => t.ID_Transacao && idSet.has(t.ID_Transacao));
      }
    }

    if (txByOrigin.length === 0) {
      return {
        processed: 0,
        message:
          'Nenhuma transação encontrada para esta origem. O nome no histórico pode não bater com o campo Origem das transações — reimporte, use “Corrigir conta”, ou confira se o log ainda guarda os IDs das linhas importadas.',
      };
    }

    const originWeights = new Map<string, number>();
    txByOrigin.forEach((tx) => {
      const o = String(tx.Origem || '');
      if (!o) return;
      originWeights.set(o, (originWeights.get(o) || 0) + 1);
    });
    const canonicalOrigin =
      Array.from(originWeights.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ||
      origin ||
      latestLogForOrigin?.file_name ||
      '';

    const frequency = new Map<string, number>();
    txByOrigin.forEach((tx) => {
      const id = tx.ID_Conta as string;
      frequency.set(id, (frequency.get(id) || 0) + 1);
    });

    const targetAccountId = Array.from(frequency.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    const account = accounts.find((a) => a.id === targetAccountId);

    if (!account) {
      return { processed: 0, message: 'Conta associada não encontrada para esta origem.' };
    }

    if (account.Tipo_Conta !== 'Cartão de Crédito') {
      return { processed: 0, message: `A origem está ligada à conta "${account.Nome_Conta}", que não é cartão de crédito.` };
    }

    const scopedTx = txByOrigin.filter((t) => t.ID_Conta === account.id);

    const extractCardCycleFromLog = (log?: ImportLog): CardImportCycleInput | undefined => {
      if (!log) return undefined;
      const details = Array.isArray(log.imported_details) ? log.imported_details : [];
      const withMetadata = details.find((d: any) =>
        d?.ID_Conta === account.id &&
        (d?.Card_Reference_Label || d?.Card_Due_Date || d?.Card_Cycle_Mode)
      );
      if (!withMetadata) return undefined;
      return {
        mode: withMetadata.Card_Cycle_Mode || 'auto',
        referenceLabel: withMetadata.Card_Reference_Label || null,
        dueDate: withMetadata.Card_Due_Date || null,
      };
    };

    const effectiveCardCycle = options?.cardCycle || extractCardCycleFromLog(latestLogForOrigin);
    const due = effectiveCardCycle ? parseManualCardCycleToDue(effectiveCardCycle) : {};

    let processed = 0;
    if (isCreditCardEngineEnabled(user)) {
      const result = await creditCardEngineService.reprocessImportOriginFromTransactions({
        userId: user.id,
        account,
        origin: canonicalOrigin,
        transactions: scopedTx,
        rules: engineClassifierRulesFromUser(user),
        dueYear: due.dueYear,
        dueMonth: due.dueMonth,
        dueDate: due.dueDate,
      });
      processed = result.processed;
    } else {
      const result = await creditCardStatementService.reprocessImportOrigin({
        userId: user.id,
        account,
        origin: canonicalOrigin,
        transactions: scopedTx,
        cardCycle: effectiveCardCycle,
        classifierRules: getCardClassifierRules(user),
      });
      processed = result.processed;
    }

    await get().refreshCreditCardShadowDashboard();
    await get().fetchCreditCardReprocessJobs();
    get().bumpCreditCardEngineRevision();
    return { processed, message: `Fatura reprocessada (${processed} itens).` };
  },

  rebuildCreditCardFromImportHistory: async (accountId, cycles) => {
    const { user, accounts, transactions } = get();
    if (!user) {
      return {
        processedFiles: 0,
        previews: [],
        message: 'Usuário não autenticado.',
      };
    }
    const account = accounts.find((a) => a.id === accountId);
    if (!account) {
      return { processedFiles: 0, previews: [], message: 'Conta não encontrada.' };
    }
    if (account.Tipo_Conta !== 'Cartão de Crédito') {
      return { processedFiles: 0, previews: [], message: 'A conta selecionada não é cartão de crédito.' };
    }
    if (!isCreditCardEngineEnabled(user)) {
      return {
        processedFiles: 0,
        previews: [],
        message: 'Ative o motor de cartão para reconstruir faturas pelo histórico de importações.',
      };
    }

    const rules = engineClassifierRulesFromUser(user);
    const result = await creditCardRebuildFromImportHistoryService.rebuildFromImportHistory({
      userId: user.id,
      account,
      cycles,
      transactions,
      rules,
    });

    for (const cycle of cycles) {
      const preview = result.previews.find((p) => p.fileName === cycle.fileName);
      if (!preview || preview.transactionCount === 0) continue;
      await get().saveCardImportLotClassification(
        cycle.fileName,
        accountId,
        cycle.referenceMonth,
        cycle.dueDate
      );
    }

    await get().fetchTransactions();
    await get().fetchImportLogs();
    get().bumpCreditCardEngineRevision();
    await get().refreshCreditCardShadowDashboard();

    return result;
  },

  rebuildCreditCardByPeriod: async (accountId, fromDate, toDate) => {
    const { user, accounts } = get();
    if (!user) return { message: 'Usuário não autenticado.' };
    const classifierRules = getCardClassifierRules(user);

    const account = accounts.find((a) => a.id === accountId);
    if (!account) return { message: 'Conta não encontrada.' };
    if (account.Tipo_Conta !== 'Cartão de Crédito') {
      return { message: 'A conta selecionada não é cartão de crédito.' };
    }

    if (isCreditCardEngineEnabled(user)) {
      return {
        message:
          'Contas no motor novo de cartão não usam mais a reconstrução legado por período. Migre ou sincronize o histórico a partir das importações e do reprocessamento pela origem (Configurações → Histórico de importações).',
      };
    }

    await creditCardStatementService.rebuildStatementsForWindow({
      userId: user.id,
      accountId,
      fromDate,
      toDate,
      classifierRules,
    });

    await get().refreshCreditCardShadowDashboard();
    await get().fetchCreditCardReprocessJobs();
    return { message: `Reconstrução concluída para ${account.Nome_Conta} (${fromDate} até ${toDate}).` };
  },

  syncCreditCardHistoryFromAccount: async (accountId) => {
    const { user, accounts, importLogs } = get();
    if (!user) return { message: 'Usuário não autenticado.', origins: 0, processed: 0 };
    const classifierRules = getCardClassifierRules(user);

    const account = accounts.find((a) => a.id === accountId);
    if (!account) return { message: 'Conta não encontrada.', origins: 0, processed: 0 };
    if (account.Tipo_Conta !== 'Cartão de Crédito') {
      return { message: 'A conta selecionada não é cartão de crédito.', origins: 0, processed: 0 };
    }

    const freshCardTx = await collectPaginatedRows<Transaction>(async (from, to) => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('ID_Conta', accountId)
        .neq('Origem', 'manual')
        .order('ID_Transacao', { ascending: true })
        .range(from, to);
      return { data: (data as Transaction[] | null) ?? null, error };
    });
    const cardTx = freshCardTx
      .filter((tx) => tx.Origem && tx.Origem !== 'manual');
    if (cardTx.length === 0) {
      return { message: `Nenhuma importação de cartão encontrada para ${account.Nome_Conta}.`, origins: 0, processed: 0 };
    }

    const toReferenceFromTxDate = (value?: string | Date | null): string | null => {
      if (!value) return null;
      const iso = toDateOnlyIso(value);
      return iso ? iso.slice(0, 7) : null;
    };
    const buildDueDateFromReference = (referenceLabel: string): string => {
      const [yearStr, monthStr] = referenceLabel.split('-');
      const year = Number(yearStr);
      const month = Number(monthStr);
      const safeYear = Number.isNaN(year) ? new Date().getFullYear() : year;
      const safeMonth = Number.isNaN(month) ? (new Date().getMonth() + 1) : month;
      const dueDate = new Date(safeYear, safeMonth, 1); // competência (compras) + 1 mês
      const safeDay = Math.min(Math.max(account.dia_vencimento || 10, 1), 28);
      return `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
    };

    const groupedByOrigin = new Map<string, Transaction[]>();
    cardTx.forEach((tx) => {
      const origin = tx.Origem as string;
      const current = groupedByOrigin.get(origin) || [];
      current.push(tx);
      groupedByOrigin.set(origin, current);
    });

    const origins = Array.from(groupedByOrigin.keys());
    let latestImportLogs = importLogs;
    if (origins.length > 0) {
      const originSet = new Set(origins);
      const freshLogs = await collectPaginatedRows<ImportLog>(async (from, to) => {
        const { data, error } = await supabase
          .from('import_logs')
          .select('*')
          .order('import_date', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to);
        return { data: (data as ImportLog[] | null) ?? null, error };
      });
      latestImportLogs = freshLogs.filter((log) => originSet.has(log.file_name));
    }

    const lotByOrigin = new Map<string, {
      referenceLabel: string;
      dueDate: string | null;
      classifierOverrides?: CardClassifierOverrides;
    }>();
    latestImportLogs
      .slice()
      .sort((a, b) => new Date(b.import_date || 0).getTime() - new Date(a.import_date || 0).getTime())
      .forEach((log) => {
        if (!groupedByOrigin.has(log.file_name)) return;
        if (lotByOrigin.has(log.file_name)) return;
        const details = Array.isArray(log.imported_details) ? log.imported_details : [];
        const row = details.find((d: any) =>
          d?.ID_Conta === accountId &&
          d?.Card_Reference_Label &&
          /^\d{4}-(0[1-9]|1[0-2])$/.test(d.Card_Reference_Label)
        );
        if (!row) return;
        lotByOrigin.set(log.file_name, {
          referenceLabel: row.Card_Reference_Label,
          dueDate: row.Card_Due_Date && /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(row.Card_Due_Date)
            ? row.Card_Due_Date
            : null,
          classifierOverrides: {
            paymentTransactionIds: Array.isArray(row.Card_Payment_Tx_Ids) ? row.Card_Payment_Tx_Ids.filter(Boolean) : [],
            refundTransactionIds: Array.isArray(row.Card_Refund_Tx_Ids) ? row.Card_Refund_Tx_Ids.filter(Boolean) : [],
          },
        });
      });

    const lotAssignments: Array<{
      origin: string;
      txs: Transaction[];
      referenceLabel: string;
      dueDate: string;
      classified: boolean;
      classifierOverrides?: CardClassifierOverrides;
    }> = [];
    const pendingOrigins: string[] = [];

    groupedByOrigin.forEach((txs, origin) => {
      const maxDateIso = txs
        .map((tx) => toDateOnlyIso(tx.Data))
        .filter(Boolean)
        .sort((a, b) => b.localeCompare(a))[0];
      const maxDate = parseDateOnlyLocal(maxDateIso);
      const inferredReference = maxDate ? toReferenceFromTxDate(maxDate) : null;
      const lot = lotByOrigin.get(origin);
      const referenceLabel = lot?.referenceLabel || inferredReference;
      if (!referenceLabel) return;

      const dueDate = lot?.dueDate || buildDueDateFromReference(referenceLabel);
      const classified = Boolean(lot?.referenceLabel);
      if (!classified) pendingOrigins.push(origin);

      lotAssignments.push({
        origin,
        txs,
        referenceLabel,
        dueDate,
        classified,
        classifierOverrides: lot?.classifierOverrides,
      });
    });

    if (lotAssignments.length === 0) {
      return { message: `Não foi possível inferir competências para ${account.Nome_Conta}.`, origins: 0, processed: 0 };
    }

    // Rebuild completo da conta para evitar lixo legado/duplicado.
    const { data: existingStatements, error: existingStatementsError } = await supabase
      .from('credit_card_statements')
      .select('id')
      .eq('account_id', accountId);
    if (existingStatementsError) throw existingStatementsError;

    const statementIds = (existingStatements || []).map((s: any) => s.id).filter(Boolean);
    if (statementIds.length > 0) {
      for (let i = 0; i < statementIds.length; i += 200) {
        const idsChunk = statementIds.slice(i, i + 200);
        const { error: deleteItemsError } = await supabase
          .from('credit_card_statement_items')
          .delete()
          .in('statement_id', idsChunk);
        if (deleteItemsError) throw deleteItemsError;
      }
      const { error: deleteStatementsError } = await supabase
        .from('credit_card_statements')
        .delete()
        .eq('account_id', accountId);
      if (deleteStatementsError) throw deleteStatementsError;
    }

    const orderedAssignments = lotAssignments
      .slice()
      .sort((a, b) => {
        if (a.referenceLabel !== b.referenceLabel) return a.referenceLabel.localeCompare(b.referenceLabel);
        return a.origin.localeCompare(b.origin);
      });

    let processedTotal = 0;
    for (const assignment of orderedAssignments) {
      if (isCreditCardEngineEnabled(user)) {
        const dueParsed = parseManualCardCycleToDue({
          mode: 'manual',
          referenceLabel: assignment.referenceLabel,
          dueDate: assignment.dueDate || buildDueDateFromReference(assignment.referenceLabel),
        });
        const engineResult = await creditCardEngineService.reprocessImportOriginFromTransactions({
          userId: user.id,
          account,
          origin: assignment.origin,
          transactions: assignment.txs,
          rules: engineClassifierRulesFromUser(user),
          paymentOverrideTransactionIds: assignment.classifierOverrides?.paymentTransactionIds,
          refundOverrideTransactionIds: assignment.classifierOverrides?.refundTransactionIds,
          dueYear: dueParsed.dueYear,
          dueMonth: dueParsed.dueMonth,
          dueDate:
            assignment.dueDate ||
            dueParsed.dueDate ||
            buildDueDateFromReference(assignment.referenceLabel),
        });
        processedTotal += engineResult.processed;
      } else {
        const result = await creditCardStatementService.reprocessImportOrigin({
          userId: user.id,
          account,
          origin: assignment.origin,
          transactions: assignment.txs,
          cardCycle: {
            mode: 'manual',
            referenceLabel: assignment.referenceLabel,
            dueDate: assignment.dueDate || buildDueDateFromReference(assignment.referenceLabel),
          },
          classifierRules,
          classifierOverrides: assignment.classifierOverrides,
        });
        processedTotal += result.processed;
      }
    }

    await get().refreshCreditCardShadowDashboard();
    await get().fetchCreditCardReprocessJobs();

    get().bumpCreditCardEngineRevision();
    return {
      message: pendingOrigins.length > 0
        ? `Histórico sincronizado para ${account.Nome_Conta}: ${orderedAssignments.length} lote(s) processados. ${pendingOrigins.length} lote(s) ainda sem classificação manual (${pendingOrigins.join(', ')}).`
        : `Histórico sincronizado para ${account.Nome_Conta}: ${orderedAssignments.length} lote(s) processados com classificação manual.`,
      origins: orderedAssignments.length,
      processed: processedTotal,
    };
  },

  saveCardImportLotClassification: async (origin, accountId, referenceLabel, dueDate, options) => {
    const { importLogs } = get();
    const targetLogs = importLogs
      .filter((log) => log.file_name === origin)
      .sort((a, b) => new Date(b.import_date || 0).getTime() - new Date(a.import_date || 0).getTime());

    if (targetLogs.length === 0) {
      return { updatedLogs: 0, message: 'Nenhum lote encontrado para esta origem.' };
    }

    const isReferenceValid = /^\d{4}-(0[1-9]|1[0-2])$/.test(referenceLabel);
    const isDueValid = /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(dueDate);
    if (!isReferenceValid || !isDueValid) {
      return { updatedLogs: 0, message: 'Competência ou vencimento inválidos.' };
    }

    let updatedLogs = 0;
    const paymentTransactionIds = Array.from(new Set((options?.paymentTransactionIds || []).filter(Boolean)));
    const refundTransactionIds = Array.from(new Set((options?.refundTransactionIds || []).filter(Boolean)));
    for (const log of targetLogs) {
      const details = Array.isArray(log.imported_details) ? [...log.imported_details] : [];
      let touched = false;

      if (details.length === 0) {
        const originKey = comparableImportOriginKey(origin);
        const txsForOrigin = get().transactions.filter(
          (t) =>
            t.ID_Conta === accountId &&
            t.Origem &&
            t.Origem !== 'manual' &&
            comparableImportOriginKey(String(t.Origem)) === originKey
        );
        const accountLabel = get().accounts.find((a) => a.id === accountId)?.Nome_Conta;
        if (txsForOrigin.length > 0) {
          txsForOrigin.sort((a, b) => new Date(a.Data).getTime() - new Date(b.Data).getTime());
          txsForOrigin.forEach((tx) => {
            details.push({
              ID_Transacao: tx.ID_Transacao,
              Origem: tx.Origem,
              Data: tx.Data,
              Descricao: tx.Descricao_Original,
              Nome_Fantasia: tx.Nome_Fantasia,
              Valor: tx.Valor,
              Categoria: tx.Categoria,
              ID_Conta: tx.ID_Conta,
              Conta_Nome: accountLabel || null,
              Card_Cycle_Mode: 'manual',
              Card_Reference_Label: referenceLabel,
              Card_Due_Date: dueDate,
              Card_Payment_Tx_Ids: paymentTransactionIds,
              Card_Refund_Tx_Ids: refundTransactionIds,
            });
          });
        } else {
          details.push({
            ID_Conta: accountId,
            Card_Cycle_Mode: 'manual',
            Card_Reference_Label: referenceLabel,
            Card_Due_Date: dueDate,
            Card_Payment_Tx_Ids: paymentTransactionIds,
            Card_Refund_Tx_Ids: refundTransactionIds,
          });
        }
        touched = true;
      } else {
        let updatedAnyRow = false;
        for (let i = 0; i < details.length; i += 1) {
          const row = details[i] || {};
          const shouldUpdateRow =
            row.ID_Conta === accountId ||
            row.ID_Conta === null ||
            row.ID_Conta === undefined ||
            row.ID_Conta === '';

          if (!shouldUpdateRow) continue;

          details[i] = {
            ...row,
            ID_Conta: row.ID_Conta || accountId,
            Card_Cycle_Mode: 'manual',
            Card_Reference_Label: referenceLabel,
            Card_Due_Date: dueDate,
            Card_Payment_Tx_Ids: paymentTransactionIds,
            Card_Refund_Tx_Ids: refundTransactionIds,
          };
          touched = true;
          updatedAnyRow = true;
        }

        // Alguns lotes legados possuem detalhes sem conta vinculada ao cartão.
        // Nesses casos, persistimos uma linha de metadados para não bloquear classificação.
        if (!updatedAnyRow) {
          details.push({
            ID_Conta: accountId,
            Card_Cycle_Mode: 'manual',
            Card_Reference_Label: referenceLabel,
            Card_Due_Date: dueDate,
            Card_Payment_Tx_Ids: paymentTransactionIds,
            Card_Refund_Tx_Ids: refundTransactionIds,
            _meta_only: true,
          });
          touched = true;
        }
      }

      if (!touched) continue;

      const countableRows = details.filter((r: any) => !(r && (r as { _meta_only?: boolean })._meta_only));
      const updatePayload: { imported_details: typeof details; imported_count?: number } = {
        imported_details: details,
      };
      if (
        countableRows.length > 1 ||
        (countableRows.length === 1 && Boolean(countableRows[0]?.ID_Transacao))
      ) {
        updatePayload.imported_count = countableRows.length;
      }

      const { error } = await supabase.from('import_logs').update(updatePayload).eq('id', log.id);
      if (!error) updatedLogs += 1;
    }

    if (updatedLogs > 0) {
      await get().fetchImportLogs();
      return { updatedLogs, message: `Classificação salva em ${updatedLogs} lote(s).` };
    }

    return { updatedLogs: 0, message: 'Nenhum lote foi atualizado.' };
  },

  repairImportLogsImportedDetailsFromLedger: async (onlyLogId?: string | null) => {
    const { user } = get();
    if (!user) return { updated: 0, message: 'Usuário não autenticado.' };

    await get().fetchTransactions();
    const { importLogs, transactions, accounts } = get();

    const logsToProcess = onlyLogId
      ? importLogs.filter((l) => l.id === onlyLogId)
      : importLogs;

    if (onlyLogId && logsToProcess.length === 0) {
      return { updated: 0, message: 'Registro de importação não encontrado.' };
    }

    let updated = 0;
    for (const log of logsToProcess) {
      const det = Array.isArray(log.imported_details) ? log.imported_details : [];
      const key = comparableImportOriginKey(log.file_name);
      if (!key) continue;
      const rows = transactions.filter(
        (t) =>
          t.Origem &&
          t.Origem !== 'manual' &&
          comparableImportOriginKey(String(t.Origem)) === key
      );
      if (rows.length === 0) continue;

      if (
        det.length === rows.length &&
        log.imported_count === rows.length &&
        !isImportedDetailRowsIncomplete(det)
      ) {
        continue;
      }

      const meta: Record<string, unknown> = {};
      const fromDet = det.find(
        (r: any) =>
          r &&
          typeof r === 'object' &&
          (r.Card_Reference_Label || r.Card_Due_Date || r.Card_Cycle_Mode)
      );
      const keysMeta = ['Card_Cycle_Mode', 'Card_Reference_Label', 'Card_Due_Date', 'Card_Payment_Tx_Ids', 'Card_Refund_Tx_Ids'] as const;
      if (fromDet && typeof fromDet === 'object') {
        for (const mk of keysMeta) {
          if ((fromDet as Record<string, unknown>)[mk] != null) meta[mk] = (fromDet as Record<string, unknown>)[mk];
        }
      }

      const sorted = [...rows].sort((a, b) => new Date(a.Data).getTime() - new Date(b.Data).getTime());
      const nameForAccount = (id: string | null | undefined) =>
        id ? accounts.find((a) => a.id === id)?.Nome_Conta || null : null;

      const nextDetails = sorted.map((tx) => ({
        ID_Transacao: tx.ID_Transacao,
        Origem: tx.Origem,
        Data: tx.Data,
        Descricao: tx.Descricao_Original,
        Nome_Fantasia: tx.Nome_Fantasia,
        Valor: tx.Valor,
        Categoria: tx.Categoria,
        ID_Conta: tx.ID_Conta,
        Conta_Nome: nameForAccount(tx.ID_Conta),
        ...meta,
      }));

      const { error } = await supabase
        .from('import_logs')
        .update({
          imported_details: nextDetails,
          imported_count: nextDetails.length,
        })
        .eq('id', log.id);
      if (!error) updated += 1;
    }

    if (updated > 0) await get().fetchImportLogs();

    if (onlyLogId) {
      return {
        updated,
        message:
          updated === 0
            ? 'Nada foi alterado: este arquivo já está alinhado com o ledger, ou não há transações (origem não manual) com a mesma chave de arquivo.'
            : 'Este arquivo foi reidratado: imported_details e imported_count foram alinhados às transações já guardadas.',
      };
    }

    return {
      updated,
      message:
        updated === 0
          ? 'Nenhum registro precisou de reidratação (ou não há transações no ledger para estas origens).'
          : `${updated} registro(s) de importação reidratado(s) com base nas transações guardadas.`,
    };
  },

  signOut: async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Erro ao fazer log-off (mas limpando estado local):', error.message);
    }

    // Limpa o estado da aplicação SEMPRE, independente do erro no servidor
    set({
      user: null,
      transactions: [],
      accounts: [],
      categories: [],
      budgets: [],
      mappingRules: [],
      importConfigs: [],
      importLogs: [],
      creditCardShadowDashboard: [],
      creditCardReprocessJobs: [],
      creditCardStatements: [],
      creditCardStatementEntries: [],
      selectedCreditCardStatementAudit: null,
      creditCardEngineRevision: 0,
    });
    // O redirecionamento será tratado no componente App.tsx
  },

  fetchAllData: async () => {
    set({ isLoading: true });
    await Promise.all([
      get().fetchTransactions(),
      get().fetchAccounts(),
      get().fetchCategories(),
      get().fetchBudgets(),
      get().fetchMappingRules(),
      get().fetchImportConfigs(),
      get().fetchPendingInvites(),
      get().fetchImportLogs(),
      get().fetchSubscription(),
      get().fetchAssets(),
      get().fetchFounderCount(),
      get().fetchCreditCardReprocessJobs(),
    ]);
    set({ isLoading: false });
  },


  // Transações (agora com Supabase)
  fetchTransactions: async () => {
    set({ isLoading: true });
    try {
      const allTransactions = await collectPaginatedRows<Transaction>(async (from, to) => {
        const { data, error } = await supabase
          .from('transactions')
          .select('*')
          .order('ID_Transacao', { ascending: true })
          .range(from, to);
        return { data: (data as Transaction[] | null) ?? null, error };
      });
      set({ transactions: allTransactions, isLoading: false });
    } catch (error) {
      console.error('Erro ao buscar o histórico completo de transações:', error);
      set({ isLoading: false });
      await appAlert(
        'Não foi possível carregar todo o histórico. A lista anterior foi preservada e nenhum dado foi apagado. Tente atualizar novamente.',
        'Histórico incompleto',
        'warning'
      );
    }
  },

  // Contas
  fetchAccounts: async () => {
    const { data, error } = await supabase.from('contas').select('*');
    if (error) {
      console.error('Erro ao buscar contas:', error);
    } else {
      set({ accounts: data as Account[] });
    }
  },
  addAccount: async (account) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    console.log('%c[Store: addAccount] 1. Dados recebidos para nova conta:', 'color: #9933ff', account);

    const { data, error } = await supabase.from('contas').insert([{ ...account, user_id: user.id }]).select();

    if (error) {
      console.error('%c[Store: addAccount] 2. Erro do Supabase ao adicionar conta:', 'color: #ff3333', error);
      return null;
    } else if (data) {
      console.log('%c[Store: addAccount] 2. Sucesso! Resposta do Supabase:', 'color: #33cc33', data[0]);
      const newAccount = data[0] as Account;
      set((state) => {
        const newState = { accounts: [...state.accounts, newAccount] };
        console.log('%c[Store: addAccount] 3. Estado atualizado. Novo array de contas:', 'color: #3399ff', newState.accounts);
        return newState;
      });
      if (newAccount.Tipo_Conta === 'Cartão de Crédito' && isCreditCardEngineEnabled(user)) {
        try {
          await creditCardEngineService.ensureCreditCardForAccount(user.id, newAccount);
        } catch (syncErr) {
          console.warn('[Store: addAccount] Falha ao criar/sincronizar credit_cards:', syncErr);
        }
      }
      return newAccount;
    } else {
      console.warn('%c[Store: addAccount] 2. Supabase não retornou nem erro, nem dados.', 'color: #ff9933');
      return null;
    }
  },
  updateAccount: async (updatedAccount) => {
    const { id, ...fieldsToUpdate } = updatedAccount;
    // Remove o campo calculado para não tentar salvá-lo no banco
    delete (fieldsToUpdate as Partial<Account>).Saldo_Atual_Calculado;

    console.log('[Store: updateAccount] Iniciando atualização da conta ID:', id);
    console.log('[Store: updateAccount] Campos a serem atualizados:', fieldsToUpdate);

    const { data, error } = await supabase.from('contas').update(fieldsToUpdate).eq('id', id).select();
    
    if (error) {
      console.error('[Store: updateAccount] Erro do Supabase ao atualizar conta:', error);
      console.error('[Store: updateAccount] Detalhes do erro:', error.details, error.hint, error.message);
    } else if (data) {
      console.log('[Store: updateAccount] Sucesso! Conta atualizada:', data[0]);
      set((state) => ({
        accounts: state.accounts.map((a) => (a.id === id ? (data[0] as Account) : a)),
      }));

      const saved = data[0] as Account;
      const syncUser = get().user;
      if (syncUser?.id && saved?.Tipo_Conta === 'Cartão de Crédito' && isCreditCardEngineEnabled(syncUser)) {
        try {
          await creditCardEngineService.ensureCreditCardForAccount(syncUser.id, saved);
        } catch (syncErr) {
          console.warn('[Store: updateAccount] Falha ao sincronizar credit_cards (limite/dias):', syncErr);
        }
      }
    }
  },

  archiveAccount: async (accountId: string, isArchived: boolean) => {
    const { data, error } = await supabase
      .from('contas')
      .update({ is_archived: isArchived })
      .eq('id', accountId)
      .select();

    if (error) {
      console.error('Erro ao arquivar/desarquivar conta:', error);
    } else if (data) {
      set((state) => ({
        accounts: state.accounts.map(a => a.id === accountId ? data[0] as Account : a)
      }));
    }
  },

  deleteAccount: async (accountId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Verificar se existem transações vinculadas
    const { count, error: countError } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('ID_Conta', accountId);
      
    if (countError) {
      console.error('Erro ao verificar transações da conta:', countError);
      return;
    }
    
    if (count && count > 0) {
      // Retorna uma rejeição para a UI capturar e mostrar um alerta
      return Promise.reject(new Error('has_transactions'));
    }

    // 2. Delete the account
    const { error } = await supabase.from('contas').delete().eq('id', accountId);
    if (error) {
      console.error('Erro ao deletar conta:', error);
    } else {
      set((state) => ({
        accounts: state.accounts.filter((a) => a.id !== accountId),
      }));
    }
  },

  getAccountsWithCalculatedBalance: () => {
    const { accounts, transactions } = get();
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    return accounts.map(account => {
      const isCreditCard = account.Tipo_Conta === 'Cartão de Crédito';
      const initialBalanceDate = toDateOnlyIso(account.Data_Saldo_Inicial);

      const relevantTransactionsSum = transactions
        .filter(t => {
          if (t.ID_Conta !== account.id) return false;
          
          const transactionPurchaseDate = toDateOnlyIso(t.Data);
          if (!transactionPurchaseDate || !initialBalanceDate) return false;
          // For credit cards, we care about the PURCHASE date (limit consumption), 
          // and we include ALL transactions (past and future) to reflect total debt.
          if (isCreditCard) {
            return transactionPurchaseDate > initialBalanceDate;
          }

          // For other accounts, we use the Payment Date filter (cash flow view)
          const paymentDateStr = toDateOnlyIso(t.Data_Pagamento || t.Data);
          return transactionPurchaseDate > initialBalanceDate && paymentDateStr <= todayStr;
        })
        .reduce((sum, t) => sum + t.Valor, 0);

      return { ...account, Saldo_Atual_Calculado: Math.round((account.Saldo_Inicial + relevantTransactionsSum) * 100) / 100 };
    });
  },

  addTransaction: async (newTransactions) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const transactionsArray = (Array.isArray(newTransactions) ? newTransactions : [newTransactions]) as Omit<Transaction, 'ID_Transacao' | 'Origem'>[];

    const payloads = transactionsArray.map(tx => ({
      user_id: user.id,
      Data: tx.Data,
      Data_Pagamento: tx.Data_Pagamento,
      Nome_Fantasia: tx.Nome_Fantasia,
      Descricao_Original: tx.Descricao_Original || tx.Nome_Fantasia,
      Categoria: tx.Categoria,
      Tipo: tx.Tipo,
      Valor: tx.Valor,
      Parcela_Atual: tx.Parcela_Atual,
      Total_Parcelas: tx.Total_Parcelas,
      Fonte: (tx as any).Fonte || 'Manual',
      Origem: (tx as any).Origem || 'manual',
      ID_Conta: tx.ID_Conta,
      linked_asset_id: tx.linked_asset_id,
    }));

    const { data, error } = await supabase
      .from('transactions')
      .insert(payloads)
      .select();

    if (error) {
      console.error('Erro ao adicionar transação(ões):', error);
      throw error;
    } else if (data) {
      const addedTransactions = data as Transaction[];
      set((state) => ({ transactions: [...state.transactions, ...addedTransactions] }));

      // Automação: Atualizar saldo do patrimônio se houver vínculo
      const affectedAssetIds = new Set(addedTransactions.filter(tx => tx.linked_asset_id).map(tx => tx.linked_asset_id as string));
      for (const assetId of affectedAssetIds) {
        await get().recalculateAssetBalance(assetId);
      }

      const ledgerSync = shouldAutoSyncCreditCardLedger(user);
      if (ledgerSync) {
        const cardAccounts = new Map(
          get().accounts
            .filter(a => a.Tipo_Conta === 'Cartão de Crédito')
            .map(a => [a.id, a])
        );

        const grouped = new Map<string, Transaction[]>();
        addedTransactions.forEach((tx) => {
          if (!tx.ID_Conta || tx.Origem === 'manual') return;
          if (!cardAccounts.has(tx.ID_Conta)) return;
          const key = `${tx.ID_Conta}::${tx.Origem}`;
          const current = grouped.get(key) || [];
          current.push(tx);
          grouped.set(key, current);
        });

        for (const [key] of grouped.entries()) {
          const [accountId, origin] = key.split('::');
          if (!cardAccounts.has(accountId)) continue;
          try {
            await syncImportedCardOrigin({
              getState: () => ({
                transactions: get().transactions,
                accounts: get().accounts,
              }),
              user,
              accountId,
              origin,
            });
          } catch (autoError) {
            console.error('[CardV2][Auto] Falha ao sincronizar inclusão manual/importada:', autoError);
          }
        }

        const manualCardAccountIds = new Set(
          addedTransactions
            .filter(
              (tx) =>
                tx.ID_Conta &&
                cardAccounts.has(tx.ID_Conta) &&
                String(tx.Origem || 'manual').trim().toLowerCase() === 'manual'
            )
            .map((tx) => tx.ID_Conta as string)
        );
        const engineRules = engineClassifierRulesFromUser(user);
        const classifierRules = getCardClassifierRules(user);
        for (const accountId of manualCardAccountIds) {
          scheduleManualCreditCardSync({
            getState: () => ({
              transactions: get().transactions,
              accounts: get().accounts,
              importLogs: get().importLogs,
            }),
            user,
            accountId,
            rules: engineRules,
            classifierRules,
            onComplete: () => {
              get().bumpCreditCardEngineRevision();
              if (isCardV2ShadowEnabled(user)) {
                void get().refreshCreditCardShadowDashboard();
                void get().fetchCreditCardReprocessJobs();
              }
            },
          });
        }

        if (grouped.size > 0) {
          get().bumpCreditCardEngineRevision();
        }

        if (isCardV2ShadowEnabled(user) && grouped.size > 0) {
          await get().refreshCreditCardShadowDashboard();
          await get().fetchCreditCardReprocessJobs();
        }
      }
    }
  },

  addMultipleTransactions: async (newTransactions, importConfig, fileName, ignoredItems = [], options) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { imported: 0, ignored: 0 };

    // Política de proteção simplificada:
    // bloquear apenas quando o nome do arquivo já foi importado pelo usuário.
    const { data: existingFileLog, error: existingFileLogError } = await supabase
      .from('import_logs')
      .select('id')
      .eq('file_name', fileName)
      .limit(1);
    if (existingFileLogError) {
      throw new Error(`Não foi possível validar duplicidade de arquivo: ${existingFileLogError.message}`);
    }
    if ((existingFileLog || []).length > 0) {
      throw new Error(`Arquivo já importado anteriormente (${fileName}). Renomeie o arquivo se quiser importar novamente.`);
    }

    const normalizeCardCycle = (input?: CardImportCycleInput): CardImportCycleInput | undefined => {
      if (!input) return undefined;
      const safeRef = input.referenceLabel && /^\d{4}-(0[1-9]|1[0-2])$/.test(input.referenceLabel)
        ? input.referenceLabel
        : null;
      const safeDue = input.dueDate && /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(input.dueDate)
        ? input.dueDate
        : null;
      return {
        mode: input.mode || 'auto',
        referenceLabel: safeRef,
        dueDate: safeDue,
      };
    };
    const normalizedCardCycle = normalizeCardCycle(options?.cardCycle);

    // 1. Sem deduplicação por linha: todos os lançamentos parseados seguem para importação.
    const duplicates: any[] = [];
    const toImport: Omit<Transaction, 'ID_Transacao' | 'user_id'>[] = [...newTransactions];

    // 2. Prepare transactions to insert
    const transactionsWithContext = toImport.map(t => ({
      ...t,
      user_id: user.id,
      ID_Conta: importConfig.ID_Conta_Associada || null,
    }));

    // 3. Insert new transactions
    let insertedBatch: Transaction[] = [];
    /** Erro bulk insert (quando há; `select()` vazio não indica erro se `error` vier preenchido). */
    let bulkInsertErrorMessage: string | null = null;
    if (transactionsWithContext.length > 0) {
      const { data, error } = await supabase
        .from('transactions')
        .insert(transactionsWithContext)
        .select();

      if (error) {
        bulkInsertErrorMessage = error.message;
        console.error('Erro ao adicionar múltiplas transações:', error);
      } else if (data) {
        insertedBatch = data as Transaction[];
        const attempted = transactionsWithContext.length;
        const got = insertedBatch.length;
        if (got !== attempted) {
          console.error(
            '[addMultipleTransactions] Divergência pós-insert: linhas tentadas:',
            attempted,
            'persistidas conforme retorno da API:',
            got,
            '— log de importação gravará apenas com len(imported_details) === imported_count.'
          );
        }
        set((state) => ({ transactions: [...state.transactions, ...insertedBatch] }));

        // Automação: Atualizar saldo do patrimônio para a nova leva se houver vínculo
        const affectedAssetIds = new Set(insertedBatch.filter(tx => tx.linked_asset_id).map(tx => tx.linked_asset_id as string));
        for (const assetId of affectedAssetIds) {
          await get().recalculateAssetBalance(assetId);
        }
      }
    }

    // 4. Log the import result
    // Combine duplicates found here with ignored items passed from parser
    let allIgnoredDetails = [...duplicates, ...ignoredItems];

    const targetAccount = get().accounts.find(a => a.id === importConfig.ID_Conta_Associada);

    const attemptedCount = transactionsWithContext.length;
    const persistedCount = insertedBatch.length;

    /** Só usar linhas efetivamente retornadas pelo insert+.select(); nunca declarar mais importações que entries no JSON (evita 125 vs 124 no histórico). */
    let imported_details_payload =
      persistedCount > 0
        ? insertedBatch.map((tx) => ({
            ID_Transacao: tx.ID_Transacao,
            Origem: tx.Origem ?? null,
            Data: tx.Data,
            Descricao: tx.Descricao_Original,
            Nome_Fantasia: tx.Nome_Fantasia,
            Valor: tx.Valor,
            Categoria: tx.Categoria,
            ID_Conta: tx.ID_Conta || null,
            Conta_Nome: targetAccount?.Nome_Conta || null,
            Card_Cycle_Mode: normalizedCardCycle?.mode || null,
            Card_Reference_Label: normalizedCardCycle?.referenceLabel || null,
            Card_Due_Date: normalizedCardCycle?.dueDate || null,
          }))
        : [];

    if (attemptedCount > 0 && persistedCount === 0) {
      allIgnoredDetails = [
        ...allIgnoredDetails,
        {
          Motivo:
            bulkInsertErrorMessage ??
            'API não retornou linhas após insert (verifique erro de rede, RLS ou constraints).',
          Esperadas: attemptedCount,
        },
      ];
    }

    /** Contagem persistida deve coincidir sempre com imported_details_payload.length */
    const imported_count_saved = imported_details_payload.length;

    const logEntry = {
      user_id: user.id,
      file_name: fileName,
      total_transactions: newTransactions.length + ignoredItems.length, // Linhas vistas pelo parser + ignoradas por ele
      imported_count: imported_count_saved,
      ignored_count: allIgnoredDetails.length,
      ignored_details: allIgnoredDetails,
      imported_details: imported_details_payload,
    };

    const { error: logError } = await supabase.from('import_logs').insert([logEntry]);
    if (logError) console.error('Erro ao salvar log de importação:', logError);
    else get().fetchImportLogs(); // Refresh logs

    // 5. Card engine processing (single source of truth)
    if (insertedBatch.length > 0 && shouldAutoSyncCreditCardLedger(user)) {
      const targetAccount = get().accounts.find(a => a.id === importConfig.ID_Conta_Associada);
      if (targetAccount?.Tipo_Conta === 'Cartão de Crédito') {
        try {
          const rows = insertedBatch.map((tx, index) => ({
            sourceRowIndex: index + 1,
            postedDate: toDateOnlyIso(tx.Data),
            description: tx.Descricao_Original || tx.Nome_Fantasia || '',
            holderName: tx.Portador || undefined,
            amount: Number(tx.Valor || 0),
            installmentCurrent: tx.Parcela_Atual || undefined,
            installmentTotal: tx.Total_Parcelas || undefined,
            merchantName: tx.Nome_Fantasia || undefined,
            transactionId: tx.ID_Transacao || undefined,
          }));
          let dueYear = normalizedCardCycle?.referenceLabel
            ? Number(normalizedCardCycle.referenceLabel.split('-')[0])
            : undefined;
          let dueMonth = normalizedCardCycle?.referenceLabel
            ? Number(normalizedCardCycle.referenceLabel.split('-')[1])
            : undefined;
          if (dueYear === undefined || dueMonth === undefined) {
            const inferredRef = parseCreditCardReferenceFromFileName(fileName);
            if (inferredRef) {
              dueYear = dueYear ?? inferredRef.dueYear;
              dueMonth = dueMonth ?? inferredRef.dueMonth;
            }
          }
          const engineResult = await creditCardEngineService.normalizeAndPersistImportLot({
            userId: user.id,
            account: targetAccount,
            sourceFileName: fileName,
            rows,
            dueYear,
            dueMonth,
            dueDate: normalizedCardCycle?.dueDate || undefined,
            rules: engineClassifierRulesFromUser(user),
            fileTotals: options?.creditCardFileTotals,
          });
          console.log('[CardEngine] Importação processada:', {
            fileName,
            account: targetAccount.Nome_Conta,
            entries: engineResult.entries,
            statementId: engineResult.statementId,
          });
          get().bumpCreditCardEngineRevision();
          if (isCardV2ShadowEnabled(user)) {
            await get().refreshCreditCardShadowDashboard();
            await get().fetchCreditCardReprocessJobs();
          }
        } catch (engineError) {
          console.error('[CardEngine] Falha ao processar importação no engine:', engineError);
        }
      }
    }

    return { imported: imported_count_saved, ignored: allIgnoredDetails.length };
  },

  updateTransaction: async (updatedTransaction) => {
    const { ID_Transacao, ...fieldsToUpdate } = updatedTransaction; 
    
    // Pegar o estado anterior para identificar o asset antigo
    const oldTransaction = get().transactions.find(t => t.ID_Transacao === ID_Transacao);
    const oldAssetId = oldTransaction?.linked_asset_id;

    let payload = fieldsToUpdate;
    if (oldTransaction && fieldsToUpdate.Data_Pagamento !== undefined) {
      const account = get().accounts.find(
        (a) => a.id === (fieldsToUpdate.ID_Conta as string | undefined) || oldTransaction.ID_Conta
      );
      if (account) {
        payload = prepareManualPurchaseCompetenceOnPaymentDateEdit(oldTransaction, fieldsToUpdate, account);
      }
    }

    const { data, error } = await supabase
      .from('transactions')
      .update(payload)
      .eq('ID_Transacao', ID_Transacao)
      .select();

    if (error) {
      console.error('Erro ao atualizar transação:', error);
    } else if (data) {
      const updated = data[0] as Transaction;
      set((state) => ({
        transactions: state.transactions.map(t => t.ID_Transacao === ID_Transacao ? updated : t)
      }));

      // Recalcular saldos se houver vínculo
      if (updated.linked_asset_id) {
        await get().recalculateAssetBalance(updated.linked_asset_id);
      }
      // Se o asset mudou, recalcular o antigo também
      if (oldAssetId && oldAssetId !== updated.linked_asset_id) {
        await get().recalculateAssetBalance(oldAssetId);
      }

      const { user, accounts, importLogs } = get();
      if (user && shouldAutoSyncCreditCardLedger(user)) {
        const engineRules = engineClassifierRulesFromUser(user);
        const cardAccounts = accounts.filter((a) => a.Tipo_Conta === 'Cartão de Crédito');
        const accountsToSync = new Map<string, { refs: Set<string>; extraRefs: Set<string> }>();

        const trackRef = (accountId: string, ref: string, isExtra = false) => {
          if (!REF_MONTH_RE.test(ref.trim())) return;
          let bucket = accountsToSync.get(accountId);
          if (!bucket) {
            bucket = { refs: new Set(), extraRefs: new Set() };
            accountsToSync.set(accountId, bucket);
          }
          if (isExtra) bucket.extraRefs.add(ref.trim());
          else bucket.refs.add(ref.trim());
        };

        const isManualTx = (t: Transaction | undefined) =>
          t && String(t.Origem || 'manual').trim().toLowerCase() === 'manual';

        if (isManualTx(oldTransaction) && oldTransaction?.ID_Conta) {
          const acc = cardAccounts.find((a) => a.id === oldTransaction.ID_Conta);
          if (acc) trackRef(acc.id, referenceMonthFromTransaction(oldTransaction, acc));
        }
        if (isManualTx(updated) && updated.ID_Conta) {
          const acc = cardAccounts.find((a) => a.id === updated.ID_Conta);
          if (acc) trackRef(acc.id, referenceMonthFromTransaction(updated, acc));
        }
        if (
          oldTransaction?.ID_Conta &&
          updated.ID_Conta &&
          oldTransaction.ID_Conta !== updated.ID_Conta &&
          isManualTx(oldTransaction)
        ) {
          const oldAcc = cardAccounts.find((a) => a.id === oldTransaction.ID_Conta);
          if (oldAcc) {
            trackRef(
              oldAcc.id,
              referenceMonthFromTransaction(oldTransaction, oldAcc),
              true
            );
          }
        }

        const classifierRules = getCardClassifierRules(user);
        for (const [accountId, { refs, extraRefs }] of accountsToSync) {
          scheduleManualCreditCardSync({
            getState: () => ({
              transactions: get().transactions,
              accounts: get().accounts,
              importLogs,
            }),
            user,
            accountId,
            referenceMonths: [...refs],
            extraReferenceMonths: [...extraRefs],
            rules: engineRules,
            classifierRules,
            onComplete: () => {
              get().bumpCreditCardEngineRevision();
              if (isCardV2ShadowEnabled(user)) {
                void get().refreshCreditCardShadowDashboard();
                void get().fetchCreditCardReprocessJobs();
              }
            },
          });
        }
      }
    }
  },

  deleteTransaction: async (transactionId) => {
    const transaction = get().transactions.find(t => t.ID_Transacao === transactionId);
    const assetId = transaction?.linked_asset_id;
    const { user, accounts } = get();

    const { error } = await supabase.from('transactions').delete().eq('ID_Transacao', transactionId);

    if (error) {
      console.error('Erro ao deletar transação:', error);
    } else {
      set((state) => ({
        transactions: state.transactions.filter(t => t.ID_Transacao !== transactionId)
      }));

      // Recalcular saldo se houver vínculo
      if (assetId) {
        await get().recalculateAssetBalance(assetId);
      }

      if (user && transaction?.ID_Conta) {
        const ledgerSync = shouldAutoSyncCreditCardLedger(user);
        const account = accounts.find((a) => a.id === transaction.ID_Conta);
        const isManual = String(transaction.Origem || 'manual').trim().toLowerCase() === 'manual';

        if (ledgerSync && account?.Tipo_Conta === 'Cartão de Crédito') {
          try {
            if (isManual) {
              const ref = referenceMonthFromTransaction(transaction, account);
              scheduleManualCreditCardSync({
                getState: () => ({
                  transactions: get().transactions,
                  accounts: get().accounts,
                  importLogs: get().importLogs,
                }),
                user,
                accountId: account.id,
                extraReferenceMonths: REF_MONTH_RE.test(ref) ? [ref] : [],
                rules: engineClassifierRulesFromUser(user),
                classifierRules: getCardClassifierRules(user),
                onComplete: () => get().bumpCreditCardEngineRevision(),
              });
            } else if (transaction.Origem) {
              const remainingTx = get().transactions.filter(
                (t) => t.ID_Conta === account.id && t.Origem === transaction.Origem
              );

              if (remainingTx.length > 0) {
                await syncImportedCardOrigin({
                  getState: () => ({
                    transactions: get().transactions,
                    accounts: get().accounts,
                  }),
                  user,
                  accountId: account.id,
                  origin: transaction.Origem,
                });
              } else {
                await removeImportedCardArtifacts({
                  userId: user.id,
                  user,
                  account,
                  origin: transaction.Origem,
                  deletedTransactions: [transaction],
                });
              }
            }
          } catch (autoError) {
            console.error('[CardV2][Auto] Falha ao sincronizar exclusão de transação:', autoError);
          }

          if (!isManual) {
            get().bumpCreditCardEngineRevision();
            if (isCardV2ShadowEnabled(user)) {
              await get().refreshCreditCardShadowDashboard();
              await get().fetchCreditCardReprocessJobs();
            }
          }
        }
      }
    }
  },

  deleteManualTransactions: async (transactionIds) => {
    if (transactionIds.length === 0) return 0;

    const uniqueIds = [...new Set(transactionIds)];
    const toDelete = get().transactions.filter(
      (t) =>
        uniqueIds.includes(t.ID_Transacao) &&
        String(t.Origem || 'manual').trim().toLowerCase() === 'manual'
    );

    if (toDelete.length === 0) return 0;

    const ids = toDelete.map((t) => t.ID_Transacao);
    const affectedAssetIds = new Set(
      toDelete.filter((t) => t.linked_asset_id).map((t) => t.linked_asset_id as string)
    );

    const chunkSize = 100;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { error } = await supabase.from('transactions').delete().in('ID_Transacao', chunk);
      if (error) {
        console.error('Erro ao deletar transações manuais:', error);
        return 0;
      }
    }

    set((state) => ({
      transactions: state.transactions.filter((t) => !ids.includes(t.ID_Transacao)),
    }));

    for (const assetId of affectedAssetIds) {
      await get().recalculateAssetBalance(assetId);
    }

    const { user, accounts } = get();
    if (user && shouldAutoSyncCreditCardLedger(user)) {
      const syncByAccount = new Map<string, Set<string>>();

      for (const transaction of toDelete) {
        if (!transaction.ID_Conta) continue;
        const account = accounts.find((a) => a.id === transaction.ID_Conta);
        if (account?.Tipo_Conta !== 'Cartão de Crédito') continue;

        const ref = referenceMonthFromTransaction(transaction, account);
        if (!syncByAccount.has(account.id)) syncByAccount.set(account.id, new Set());
        if (REF_MONTH_RE.test(ref)) syncByAccount.get(account.id)!.add(ref);
      }

      for (const [accountId, refs] of syncByAccount) {
        try {
          scheduleManualCreditCardSync({
            getState: () => ({
              transactions: get().transactions,
              accounts: get().accounts,
              importLogs: get().importLogs,
            }),
            user,
            accountId,
            extraReferenceMonths: [...refs],
            rules: engineClassifierRulesFromUser(user),
            classifierRules: getCardClassifierRules(user),
            onComplete: () => get().bumpCreditCardEngineRevision(),
          });
        } catch (autoError) {
          console.error('[CardV2][Auto] Falha ao sincronizar exclusão em lote de manuais:', autoError);
        }
      }
    }

    return ids.length;
  },

  deleteTransactionsByOrigin: async (origin) => {
    const { data: authData } = await supabase.auth.getUser();
    const authUser = authData.user;
    if (!authUser) return;

    const transactionsByOrigin = get().transactions.filter(t => t.Origem === origin);

    // Identify affected assets before deletion
    const affectedAssetIds = new Set(
      transactionsByOrigin
        .filter(t => t.linked_asset_id)
        .map(t => t.linked_asset_id as string)
    );

    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('Origem', origin)
      .eq('user_id', authUser.id);
    if (error) {
      console.error('Erro ao deletar lote de transações:', error);
    } else {
      set((state) => ({
        transactions: state.transactions.filter(t => t.Origem !== origin)
      }));

      // Recalcular saldo de todos os ativos afetados
      for (const assetId of affectedAssetIds) {
        await get().recalculateAssetBalance(assetId);
      }

      const ledgerSync = shouldAutoSyncCreditCardLedger(authUser);
      if (ledgerSync) {
        const cardAccounts = get().accounts.filter(a => a.Tipo_Conta === 'Cartão de Crédito');
        const groupedByAccount = new Map<string, Transaction[]>();

        transactionsByOrigin.forEach((tx) => {
          if (!tx.ID_Conta) return;
          const account = cardAccounts.find((a) => a.id === tx.ID_Conta);
          if (!account) return;
          const current = groupedByAccount.get(account.id) || [];
          current.push(tx);
          groupedByAccount.set(account.id, current);
        });

        for (const [accountId, deletedTx] of groupedByAccount.entries()) {
          const account = cardAccounts.find((a) => a.id === accountId);
          if (!account) continue;

          try {
            await removeImportedCardArtifacts({
              userId: authUser.id,
              user: authUser,
              account,
              origin,
              deletedTransactions: deletedTx,
            });
          } catch (autoError) {
            console.error('[CardV2][Auto] Falha ao sincronizar exclusão por origem:', autoError);
          }
        }

        if (groupedByAccount.size > 0) {
          get().bumpCreditCardEngineRevision();
        }

        if (isCardV2ShadowEnabled(authUser)) {
          await get().refreshCreditCardShadowDashboard();
          await get().fetchCreditCardReprocessJobs();
        }
      }
    }
  },

  reassignTransactionsAccountByOrigin: async (origin, accountId) => {
    const { data: authData } = await supabase.auth.getUser();
    const authUser = authData.user;
    if (!authUser) {
      console.error('Usuário não autenticado para reatribuição por origem.');
      return { updated: 0 };
    }

    const { data, error } = await supabase
      .from('transactions')
      .update({ ID_Conta: accountId })
      .eq('Origem', origin)
      .eq('user_id', authUser.id)
      .select('ID_Transacao');

    if (error) {
      console.error('Erro ao reatribuir conta das transações por origem:', error);
      return { updated: 0 };
    }

    const updatedIds = new Set((data || []).map((row: any) => row.ID_Transacao));

    if (updatedIds.size > 0) {
      set((state) => ({
        transactions: state.transactions.map((t) =>
          updatedIds.has(t.ID_Transacao) ? { ...t, ID_Conta: accountId } : t
        ),
      }));

      const targetAccount = get().accounts.find((a) => a.id === accountId);
      const shouldProcessCardLedger =
        targetAccount?.Tipo_Conta === 'Cartão de Crédito' && shouldAutoSyncCreditCardLedger(authUser);

      if (targetAccount && shouldProcessCardLedger) {
        try {
          const scopedTx = get().transactions
            .filter((t) => t.Origem === origin)
            .map((t) => (updatedIds.has(t.ID_Transacao) ? { ...t, ID_Conta: accountId } : t))
            .filter((t) => t.ID_Conta === accountId);

          await syncImportedCardOrigin({
            getState: () => ({
              transactions: get().transactions.map((t) =>
                updatedIds.has(t.ID_Transacao) ? { ...t, ID_Conta: accountId } : t
              ),
              accounts: get().accounts,
            }),
            user: authUser,
            accountId,
            origin,
          });

          if (isCardV2ShadowEnabled(authUser)) {
            await get().refreshCreditCardShadowDashboard();
            await get().fetchCreditCardReprocessJobs();
          }
        } catch (reprocessError) {
          console.error('[CardV2][Auto] Falha ao reprocessar após corrigir conta:', reprocessError);
        }
        get().bumpCreditCardEngineRevision();
      }
    }

    return { updated: updatedIds.size };
  },

  // Categorias (com Supabase)
  fetchCategories: async () => {
    const { data, error } = await supabase.from('categories').select('*');
    if (error) console.error('Erro ao buscar categorias:', error);
    else set({ categories: data as Category[] });
  },
  addCategory: async (newCategory) => {
    const state = get();
    const categoryName = newCategory.Nome_Categoria.trim();
    if (!categoryName) return { status: 'error', message: 'O nome da categoria não pode estar vazio.' };

    const existingCategory = state.categories.find(c => c.Nome_Categoria.trim().toLowerCase() === categoryName.toLowerCase());
    if (existingCategory) {
      if (existingCategory.Tipo !== newCategory.Tipo && existingCategory.Tipo !== 'Ambos') {
        const updatedCategory = { ...existingCategory, Tipo: 'Ambos' as const };
        await get().updateCategory(updatedCategory);
        return { status: 'updated', message: `Categoria "${existingCategory.Nome_Categoria}" atualizada para o tipo "Ambos".` };
      }
      return { status: 'duplicate', message: `A categoria "${existingCategory.Nome_Categoria}" já existe.` };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { status: 'error', message: 'Usuário não autenticado.' };

    const { data, error } = await supabase.from('categories').insert([{ ...newCategory, user_id: user.id }]).select();
    if (error) {
      console.error('Erro ao adicionar categoria:', error);
      return { status: 'error', message: error.message };
    }
    if (data) {
      set({ categories: [...state.categories, data[0] as Category] });
    }
    return { status: 'created', message: `Categoria "${categoryName}" criada com sucesso!` };
  },
  updateCategory: async (updatedCategory) => {
    const { id, ...fieldsToUpdate } = updatedCategory;
    const { data, error } = await supabase.from('categories').update(fieldsToUpdate).eq('id', id).select();
    if (error) console.error('Erro ao atualizar categoria:', error);
    else if (data) set((state) => ({ categories: state.categories.map(c => c.id === id ? data[0] as Category : c) }));
  },
  deleteCategory: async (categoryId) => {
    const { error } = await supabase.from('categories').delete().eq('id', categoryId);
    if (error) console.error('Erro ao deletar categoria:', error);
    else set((state) => ({ categories: state.categories.filter(c => c.id !== categoryId) }));
  },
  getSortedCategories: () => {
    const { categories } = get();
    return [...categories].sort((a, b) => a.Nome_Categoria.localeCompare(b.Nome_Categoria, 'pt-BR'));
  },

  // Orçamentos (com Supabase)
  fetchBudgets: async () => {
    const { data, error } = await supabase.from('budgets').select('*');
    if (error) console.error('Erro ao buscar orçamentos:', error);
    else set({ budgets: data as Budget[] });
  },
  addBudget: async (budget) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from('budgets').insert([{ ...budget, user_id: user.id }]).select();
    if (error) console.error('Erro ao adicionar orçamento:', error);
    else if (data) set((state) => ({ budgets: [...state.budgets, data[0] as Budget] }));
  },
  updateBudget: async (updatedBudget) => {
    const { id, ...fieldsToUpdate } = updatedBudget;
    const { data, error } = await supabase.from('budgets').update(fieldsToUpdate).eq('id', id).select();
    if (error) console.error('Erro ao atualizar orçamento:', error);
    else if (data) set((state) => ({ budgets: state.budgets.map(b => b.id === id ? data[0] as Budget : b) }));
  },
  deleteBudget: async (budgetId) => {
    const { error } = await supabase.from('budgets').delete().eq('id', budgetId);
    if (error) console.error('Erro ao deletar orçamento:', error);
    else set((state) => ({ budgets: state.budgets.filter(b => b.id !== budgetId) }));
  },

  // Regras de Mapeamento (com Supabase) 
  fetchMappingRules: async () => {
    const { data, error } = await supabase.from('mapping_rules').select('*').range(0, 9999);
    if (error) console.error('Erro ao buscar regras:', error);
    else set({ mappingRules: data as MappingRule[] });
  },
  addMappingRule: async (ruleData) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from('mapping_rules').insert([{ ...ruleData, user_id: user.id }]).select();
    if (error) console.error('Erro ao adicionar regra:', error);
    else if (data) {
      const newRule = data[0] as MappingRule;
      set((state) => ({ mappingRules: [...state.mappingRules, newRule] }));
      get().applyRuleToExistingTransactions(newRule);
    }
  },
  updateMappingRule: async (updatedRule) => {
    const { id, ...fieldsToUpdate } = updatedRule;
    const { data, error } = await supabase.from('mapping_rules').update(fieldsToUpdate).eq('id', id).select();
    if (error) console.error('Erro ao atualizar regra:', error);
    else if (data) {
      const updated = data[0] as MappingRule;
      set((state) => ({ mappingRules: state.mappingRules.map(r => r.id === id ? updated : r) }));
      get().applyRuleToExistingTransactions(updated);
    }
  },
  deleteMappingRule: async (ruleId) => {
    const { error } = await supabase.from('mapping_rules').delete().eq('id', ruleId);
    if (error) console.error('Erro ao deletar regra:', error);
    else set((state) => ({ mappingRules: state.mappingRules.filter(r => r.id !== ruleId) }));
  },
  applyRuleToExistingTransactions: async (rule: MappingRule) => {
    const { transactions } = get();
    const keyword = rule.Texto_Contido_Descricao.toLowerCase();
    const cleanKeyword = keyword.replace(/\s+/g, ''); // Remove all whitespace for fuzzy match

    const transactionsToUpdate = transactions.filter(t => {
      const originalDesc = t.Descricao_Original ? t.Descricao_Original.toLowerCase() : '';
      const cleanOriginalDesc = originalDesc.replace(/\s+/g, '');

      // Check match:
      // 1. Exact substring match (standard)
      // 2. Whitespace-insensitive match (for banks with variable spacing)
      const match = originalDesc.includes(keyword) || cleanOriginalDesc.includes(cleanKeyword);

      if (match) {
        const needsUpdate = t.Categoria !== rule.Categoria_Sugerida || 
                          t.Nome_Fantasia !== rule.Nome_Fantasia_Sugerido ||
                          t.linked_asset_id !== rule.linked_asset_id;
        return needsUpdate;
      }
      return false;
    });

    // O upsert precisa de um array de objetos que correspondam à tabela.
    // O tipo `Partial<Transaction>` ajuda o TypeScript a entender a forma dos dados.
    const updatePayload: Partial<Transaction>[] = transactionsToUpdate.map(t => ({
      ID_Transacao: t.ID_Transacao,
      Categoria: rule.Categoria_Sugerida,
      Nome_Fantasia: rule.Nome_Fantasia_Sugerido,
      linked_asset_id: rule.linked_asset_id,
    }));

    if (updatePayload.length === 0) {
      return;
    }

    // FALLBACK: Se o upsert falhar por constraints, fazemos updates individuais.
    // Isso é mais seguro pois o update ignora colunas não fornecidas (como Data).
    const updatePromises = updatePayload.map(payload =>
      supabase.from('transactions')
        .update({ 
          Categoria: payload.Categoria, 
          Nome_Fantasia: payload.Nome_Fantasia,
          linked_asset_id: payload.linked_asset_id 
        })
        .eq('ID_Transacao', payload.ID_Transacao)
        .select()
    );

    const results = await Promise.all(updatePromises);

    const successfulUpdates = results.flatMap(r => (r.data && !r.error) ? [r.data[0] as Transaction] : []);
    const errors = results.filter(r => r.error).map(r => r.error);

    if (errors.length > 0) {
      console.error('Alguns updates falharam:', errors);
    }

    if (successfulUpdates.length > 0) {
      set(state => {
        const newTransactions = state.transactions.map(t => {
          const updated = successfulUpdates.find(u => u.ID_Transacao === t.ID_Transacao);
          if (updated) {
            return { 
              ...t, 
              Categoria: updated.Categoria, 
              Nome_Fantasia: updated.Nome_Fantasia,
              linked_asset_id: updated.linked_asset_id
            };
          }
          return t;
        });
        return { transactions: newTransactions };
      });

      // Recalcular saldo se a regra tiver vínculo
      if (rule.linked_asset_id) {
        await get().recalculateAssetBalance(rule.linked_asset_id);
      }
    }
  },

  // Admin Metrics
  fetchAdminMetrics: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    // Apenas tenta buscar se houver usúario e for o admin
    if (!user || user.email !== 'cassiomq@gmail.com') return;

    set({ isLoading: true });
    // Chama a function segura via RPC
    const { data, error } = await supabase.rpc('get_admin_metrics');
    if (error) {
      console.error('Erro ao buscar métricas de administrador:', error);
      set({ isLoading: false });
    } else {
      set({ adminMetrics: data as AdminMetrics, isLoading: false });
    }
  },

  reApplyAllRules: async () => {
    console.log('Fetching latest rules before re-applying...');
    await get().fetchMappingRules();
    const { mappingRules } = get();
    console.log(`Re-applying ${mappingRules.length} rules...`);

    for (const rule of mappingRules) {
      await get().applyRuleToExistingTransactions(rule);
    }
    console.log('All rules re-applied.');
  },

  findDuplicateRules: () => {
    const { mappingRules } = get();
    const normalizedMap = new Map<string, MappingRule[]>();

    mappingRules.forEach(rule => {
      const normalized = rule.Texto_Contido_Descricao.toLowerCase().replace(/\s+/g, '');
      if (!normalizedMap.has(normalized)) {
        normalizedMap.set(normalized, []);
      }
      normalizedMap.get(normalized)?.push(rule);
    });

    // Filter only groups with more than 1 rule
    const duplicates: MappingRule[][] = [];
    normalizedMap.forEach((rules) => {
      if (rules.length > 1) {
        duplicates.push(rules);
      }
    });

    return duplicates;
  },

  // Configurações de Importação (com Supabase)
  fetchImportConfigs: async () => {
    const { data, error } = await supabase.from('import_configs').select('*');
    if (error) console.error('Erro ao buscar configs de importação:', error);
    else set({ importConfigs: data as ImportConfig[] });
  },
  addImportConfig: async (config) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from('import_configs').insert([{ ...config, user_id: user.id }]).select();
    if (error) console.error('Erro ao adicionar config de importação:', error);
    else if (data) set((state) => ({ importConfigs: [...state.importConfigs, data[0] as ImportConfig] }));
  },
  updateImportConfig: async (updatedConfig) => {
    const { id, ...fieldsToUpdate } = updatedConfig;
    const { data, error } = await supabase.from('import_configs').update(fieldsToUpdate).eq('id', id).select();
    if (error) console.error('Erro ao atualizar config de importação:', error);
    else if (data) set((state) => ({ importConfigs: state.importConfigs.map(c => c.id === id ? data[0] as ImportConfig : c) }));
  },
  deleteImportConfig: async (configId) => {
    const { error } = await supabase.from('import_configs').delete().eq('id', configId);
    if (error) console.error('Erro ao deletar config de importação:', error);
    else set((state) => ({ importConfigs: state.importConfigs.filter(c => c.id !== configId) }));
  },

  fetchImportLogs: async () => {
    try {
      const logs = await collectPaginatedRows<ImportLog>(async (from, to) => {
        const { data, error } = await supabase
          .from('import_logs')
          .select('*')
          .order('import_date', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to);
        return { data: (data as ImportLog[] | null) ?? null, error };
      });
      set({ importLogs: logs });
    } catch (error) {
      console.error('Erro ao buscar o histórico completo de importações:', error);
      await appAlert(
        'Não foi possível carregar todo o histórico de importações. A lista anterior foi preservada e nenhum dado foi apagado.',
        'Histórico de importações incompleto',
        'warning'
      );
    }
  },

  deleteImportLog: async (logId: string, fileName: string) => {
    console.log(`%c[deleteImportLog] Iniciando exclusão. ID: ${logId}, Arquivo: ${fileName}`, 'color: orange; font-weight: bold');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('[deleteImportLog] Usuário não autenticado.');
      return;
    }

    const transactionsByOrigin = get().transactions.filter(t => t.Origem === fileName);

    // 1. Delete transactions from this import
    console.log(`[deleteImportLog] Tentando excluir transações com Origem = "${fileName}"...`);
    const { error: txError, count } = await supabase
      .from('transactions')
      .delete({ count: 'exact' }) // Request count of deleted rows
      .eq('Origem', fileName)
      .eq('user_id', user.id);

    if (txError) {
      console.error('[deleteImportLog] Erro ao deletar transações:', txError);
      await appAlert('Erro ao deletar transações associadas. O log não será apagado.', 'Erro', 'danger');
      return;
    }
    console.log(`[deleteImportLog] Transações deletadas: ${count}`);

    // 2. Delete the log entry
    console.log(`[deleteImportLog] Tentando excluir log com ID = "${logId}"...`);
    const { error: logError } = await supabase
      .from('import_logs')
      .delete()
      .eq('id', logId);

    if (logError) {
      console.error('[deleteImportLog] Erro ao deletar log:', logError);
      await appAlert('Transações deletadas, mas erro ao apagar o log. Verifique as permissões (RLS) no Supabase.', 'Erro', 'danger');
    } else {
      console.log('[deleteImportLog] Log excluído com sucesso.');
      
      // Identify affected assets BEFORE updating local state
      const affectedAssetIds = new Set(
        get().transactions
          .filter(t => t.Origem === fileName && t.linked_asset_id)
          .map(t => t.linked_asset_id as string)
      );

      set((state) => ({
        importLogs: state.importLogs.filter(l => l.id !== logId),
        transactions: state.transactions.filter(t => t.Origem !== fileName)
      }));

      console.log('[deleteImportLog] Estado local atualizado.');

      // Recalcular saldo de todos os ativos afetados
      for (const assetId of affectedAssetIds) {
        await get().recalculateAssetBalance(assetId);
      }

      const ledgerSync = shouldAutoSyncCreditCardLedger(user);
      if (ledgerSync) {
        const cardAccounts = get().accounts.filter(a => a.Tipo_Conta === 'Cartão de Crédito');
        const groupedByAccount = new Map<string, Transaction[]>();

        transactionsByOrigin.forEach((tx) => {
          if (!tx.ID_Conta) return;
          const account = cardAccounts.find((a) => a.id === tx.ID_Conta);
          if (!account) return;
          const current = groupedByAccount.get(account.id) || [];
          current.push(tx);
          groupedByAccount.set(account.id, current);
        });

        for (const [accountId, deletedTx] of groupedByAccount.entries()) {
          const account = cardAccounts.find((a) => a.id === accountId);
          if (!account) continue;
          try {
            await removeImportedCardArtifacts({
              userId: user.id,
              user,
              account,
              origin: fileName,
              deletedTransactions: deletedTx,
            });
          } catch (autoError) {
            console.error('[CardV2][Auto] Falha ao sincronizar exclusão de importação:', autoError);
          }
        }

        if (isCardV2ShadowEnabled(user)) {
          await get().refreshCreditCardShadowDashboard();
          await get().fetchCreditCardReprocessJobs();
        }
      }

      await appAlert('Importação e transações associadas excluídas com sucesso!', 'Sucesso', 'success');
    }
  },

  syncLegacyImportLogs: async () => {
    console.log('%c[syncLegacyImportLogs] Verificando histórico antigo...', 'color: blue');
    const { transactions, importLogs } = get();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Agrupar transações por Origem
    const legacyImports = new Map<string, { count: number, minDate: Date }>();
    transactions.forEach(t => {
      // Ignora transações manuais ou vazias
      if (t.Origem && t.Origem !== 'manual') {
        const current = legacyImports.get(t.Origem) || { count: 0, minDate: new Date(t.Data) };
        legacyImports.set(t.Origem, {
          count: current.count + 1,
          minDate: new Date(t.Data) < current.minDate ? new Date(t.Data) : current.minDate
        });
      }
    });

    console.log('[syncLegacyImportLogs] Origens encontradas nas transações:', Array.from(legacyImports.keys()));

    // 2. Filtrar as que já existem no log
    const newLogs: any[] = [];
    legacyImports.forEach((data, origin) => {
      const exists = importLogs.some(log => log.file_name === origin);
      if (!exists) {
        console.log(`[syncLegacyImportLogs] Encontrada origem sem log: "${origin}" (Transações: ${data.count}). Criando log...`);
        newLogs.push({
          user_id: user.id,
          file_name: origin,
          import_date: data.minDate.toISOString(),
          total_transactions: data.count,
          imported_count: data.count,
          ignored_count: 0,
          ignored_details: [],
          imported_details: [] // Added for legacy sync
        });
      }
    });

    // 3. Inserir novos logs
    if (newLogs.length > 0) {
      const { error } = await supabase.from('import_logs').insert(newLogs);
      if (error) {
        console.error('[syncLegacyImportLogs] Erro ao inserir novos logs:', error);
      } else {
        await get().fetchImportLogs();
        console.log(`[syncLegacyImportLogs] ${newLogs.length} logs recriados.`);
        // alert(`${newLogs.length} registros de importação antigos foram recuperados.`); // Comentado para não spammar se for automático
      }
    } else {
      console.log('[syncLegacyImportLogs] Nenhum log novo necessário.');
      // alert('O histórico já está atualizado.');
    }
  },

  // Support Tickets
  fetchSupportTickets: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*, messages:support_messages(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) console.error('Erro ao buscar chamados:', error);
    else set({ supportTickets: data as any }); // Cast needed due to complex join
  },

  fetchAllTickets: async () => {
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*, messages:support_messages(*)')
      .order('created_at', { ascending: false });

    if (error) console.error('Erro ao buscar todos os chamados:', error);
    else set({ supportTickets: data as any });
  },

  createSupportTicket: async (ticketData, file?: File) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let attachment_url = undefined;
    if (file) {
      attachment_url = await get().uploadTicketAttachment(file) || undefined;
    }

    const { error } = await supabase.from('support_tickets').insert([{
      ...ticketData,
      user_id: user.id,
      attachment_url,
      status: 'open' // Default status
    }]);

    if (error) {
      console.error('Erro ao criar chamado:', error);
      await appAlert('Erro ao criar chamado: ' + error.message, 'Erro', 'danger');
    } else {
      await get().fetchSupportTickets();
      await appAlert('Chamado aberto com sucesso! Acompanhe na aba "Meus Chamados".', 'Sucesso', 'success');
    }
  },

  updateSupportTicketStatus: async (ticketId, status) => {
    const { error } = await supabase.from('support_tickets').update({ status }).eq('id', ticketId);
    if (error) {
      console.error('Erro ao atualizar status do chamado:', error);
    } else {
      set((state) => ({
        supportTickets: state.supportTickets.map(t => t.id === ticketId ? { ...t, status } : t)
      }));
    }
  },

  sendMessage: async (ticketId, message, file) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Check if locked BEFORE inserting
    const { supportTickets, fetchAllTickets, fetchSupportTickets } = get();
    const isAdmin = user.email === 'cassiomq@gmail.com';
    const ticket = supportTickets.find(t => t.id === ticketId);

    if (ticket && (ticket.status === 'resolved' || ticket.status === 'closed')) {
      if (!isAdmin) {
        await appAlert(`Este chamado está encerrado (Protocolo: ${ticket.protocol}). Por favor, abra um novo chamado informando este protocolo.`, 'Aviso', 'warning');
        return;
      }
    }

    let attachment_url = undefined;
    if (file) {
      attachment_url = await get().uploadTicketAttachment(file) || undefined;
    }

    // 2. Insert message
    const { error } = await supabase.from('support_messages').insert([{
      ticket_id: ticketId,
      sender_id: user.id,
      attachment_url,
      message
    }]);

    if (error) {
      console.error('Erro ao enviar mensagem:', error);
      await appAlert('Erro ao enviar mensagem: ' + error.message, 'Erro', 'danger');
      return;
    }

    // 3. Refresh tickets to show new message
    if (isAdmin) await fetchAllTickets();
    else await fetchSupportTickets();
  },

  uploadTicketAttachment: async (file) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `ticket-attachments/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('images') // Using existing bucket or need to create one. 
                        // The user usually has a 'images' or 'attachments' bucket.
                        // Based on standard supabase setup, 'images' is common.
        .upload(filePath, file);

      if (uploadError) {
        console.error('Error uploading file:', uploadError);
        return null;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('images')
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (error) {
      console.error('Upload error:', error);
      return null;
    }
  },

  respondToTicket: async () => { console.warn('Deprecated'); }, // Placeholder logic


  // Assinaturas (Stripe)
  fetchSubscription: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      set({ subscription: null, isPremium: false, isWealth: false, unlimitedSync: false });
      return;
    }

    try {
      // 1. Check direct subscription
      const { data: directSub, error: subError } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .in('status', ['active', 'trialing', 'past_due', 'lifetime'])
        .maybeSingle();

      if (subError) console.error('Erro ao buscar assinatura direta:', subError);

      let effectiveSubscription = directSub as Subscription | null;
      let isInherited = false;

      // 2. If no direct sub, check if family member (excluding self-references)
      if (!effectiveSubscription) {
        const currentUserEmail = user.email?.toLowerCase().trim();
        const { data: familyEntries, error: familyError } = await supabase
          .from('family_members')
          .select('owner_id, owner_email, status, member_email')
          .ilike('member_email', currentUserEmail)
          .eq('status', 'accepted')
          .neq('owner_id', user.id); // Jamais herdar de si mesmo para evitar loops

        if (familyError) console.error('Erro ao buscar vinculos familiares:', familyError);
        
        console.log(`[Subscription] Diagnóstico de Herança:`, {
            buscandoPor: currentUserEmail,
            encontrados: familyEntries?.length || 0,
            detalhes: familyEntries
        });

        if (familyEntries && familyEntries.length > 0) {
          console.log(`[Subscription] Encontrados ${familyEntries.length} convites aceitos. Buscando assinatura do titular...`);
          
          // Busca a assinatura do primeiro vinculo que tiver uma assinatura ativa
          for (const entry of familyEntries) {
            // BYPASS ADMIN: Se o titular for o Cassio, ele é Premium por definição
            if (entry.owner_email === 'cassiomq@gmail.com') {
              console.log('%c[Subscription] Herança confirmada de: cassiomq@gmail.com (Via Admin Bypass)', 'color: #ff9900; font-weight: bold;');
              effectiveSubscription = {
                status: 'lifetime',
                plan_type: 'lifetime',
                tier: 'wealth',
                plan: 'founders_pack',
                family_slots: 5,
                unlimited_sync: true
              } as any;
              isInherited = true;
              break;
            }

            const { data: ownerSub, error: ownerSubError } = await supabase
              .from('subscriptions')
              .select('*')
              .eq('user_id', entry.owner_id)
              .in('status', ['active', 'trialing', 'past_due', 'lifetime'])
              .maybeSingle();

            if (ownerSubError) console.error(`Erro ao buscar assinatura do titular (${entry.owner_email}):`, ownerSubError);
            
            if (ownerSub) {
              console.log(`[Subscription] Herança confirmada de: ${entry.owner_email}`);
              effectiveSubscription = ownerSub as Subscription;
              isInherited = true;
              break; // Encontrou uma assinatura válida, para de procurar
            }
          }
        } else {
          console.log('[Subscription] Nenhum convite aceito de terceiros encontrado.');
        }
      }
      
      const email = user.email?.toLowerCase().trim();
      const isAdmin = email === 'cassiomq@gmail.com';
      
      // Ajustar isPremium para incluir past_due (já que o banco permite acesso)
      const isPremium = isAdmin || ['active', 'lifetime', 'trialing', 'past_due'].includes(effectiveSubscription?.status || '');
      const isWealth = isAdmin || effectiveSubscription?.status === 'lifetime' || effectiveSubscription?.tier === 'wealth';
      const unlimitedSync = isAdmin || (effectiveSubscription?.unlimited_sync === true);


      set({ 
        subscription: effectiveSubscription, 
        isPremium, 
        isWealth, 
        unlimitedSync,
        isLoading: false
      });
    } catch (err) {
      console.error('Erro inesperado ao buscar assinatura:', err);
    }
  },

  // Assets (Patrimônio) Actions
  fetchAssets: async () => {
    const { data, error } = await supabase.from('assets').select('*').order('name');
    if (error) console.error('Erro ao buscar ativos:', error);
    else {
      set({ assets: data as Asset[] });
      // Sincronizar saldos de todos os ativos financiados na carga inicial
      // Usamos um delay curto ou fazemos em background
      get().recalculateAllAssetBalances();
    }
  },

  fetchFounderCount: async () => {
    // Usamos RPC para contornar o RLS e pegar a contagem global, mesmo deslogado
    const { data, error } = await supabase.rpc('get_founder_count');

    if (error) {
      console.error('Erro ao buscar contagem de Founders:', error);
    } else {
      set({ founderCount: data || 0 });
    }
  },

  addAsset: async (assetData) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from('assets').insert([{ ...assetData, user_id: user.id }]).select();
    if (error) console.error('Erro ao adicionar ativo:', error);
    else if (data) {
      set((state) => ({ assets: [...state.assets, data[0] as Asset] }));
      // Disparar recálculo se for financiado
      if (data[0].is_financed) {
        await get().recalculateAssetBalance(data[0].id);
      }
    }
  },

  updateAsset: async (updatedAsset) => {
    const { id, ...fieldsToUpdate } = updatedAsset;
    const { data, error } = await supabase.from('assets').update({ ...fieldsToUpdate, updated_at: new Date().toISOString() }).eq('id', id).select();
    if (error) console.error('Erro ao atualizar ativo:', error);
    else if (data) {
      set((state) => ({ assets: state.assets.map(a => a.id === id ? data[0] as Asset : a) }));
      // Disparar recálculo se for financiado
      if (data[0].is_financed) {
        await get().recalculateAssetBalance(id);
      }
    }
  },

  deleteAsset: async (assetId) => {
    const { error } = await supabase.from('assets').delete().eq('id', assetId);
    if (error) console.error('Erro ao deletar ativo:', error);
    else set((state) => ({ assets: state.assets.filter(a => a.id !== assetId) }));
  },

  recalculateAssetBalance: async (assetId: string) => {
    const asset = get().assets.find(a => a.id === assetId);
    if (!asset || !asset.is_financed) return;

    const { data: linkedTransactions, error } = await supabase
      .from('transactions')
      .select('Valor, Tipo')
      .eq('linked_asset_id', assetId);

    if (error) {
      console.error('Erro ao buscar transações vinculadas para recálculo:', error);
      return;
    }

    const totalPaid = linkedTransactions.reduce((sum, tx) => {
      // Despesa (Saída) é positiva para o abatimento da dívida
      // Renda (Entrada/Estorno) é negativa para o abatimento da dívida
      const value = tx.Tipo === 'Renda' ? -Math.abs(tx.Valor) : Math.abs(tx.Valor);
      return sum + value;
    }, 0);
    
    const paidCount = linkedTransactions.length;

    const updatedData = {
      remaining_balance: Math.max(0, (asset.financed_amount || 0) - totalPaid),
      paid_installments: paidCount,
      updated_at: new Date().toISOString()
    };

    const { error: updateError, data } = await supabase
      .from('assets')
      .update(updatedData)
      .eq('id', assetId)
      .select();

    if (updateError) {
      console.error('Erro ao atualizar saldo do ativo após recálculo:', updateError);
    } else if (data) {
      set((state) => ({
        assets: state.assets.map(a => a.id === assetId ? data[0] as Asset : a)
      }));
    }
  },

  recalculateAllAssetBalances: async () => {
    const { assets } = get();
    const financedAssets = assets.filter(a => a.is_financed);
    
    // Executamos sequencialmente para não sobrecarregar
    for (const asset of financedAssets) {
      await get().recalculateAssetBalance(asset.id);
    }
  },

  fetchPendingInvites: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from('family_members')
      .select('*')
      .ilike('member_email', user.email?.toLowerCase().trim())
      .eq('status', 'pending');
    
    if (error) console.error('Erro ao buscar convites pendentes:', error);
    else set({ pendingInvites: data as FamilyMember[] });
  },

  respondToInvite: async (inviteId, status) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const invite = get().pendingInvites.find((i) => i.id === inviteId);

    const { error } = await supabase
      .from('family_members')
      .update({ status })
      .eq('id', inviteId);

    if (error) {
      console.error('Erro ao responder convite:', error);
      throw error;
    }

    if (status === 'accepted' && invite?.owner_email) {
      const ownerEmail = invite.owner_email.toLowerCase().trim();
      const memberEmail = user.email?.toLowerCase().trim();
      if (ownerEmail && memberEmail && ownerEmail !== memberEmail) {
        const { error: reciprocalError } = await supabase.from('family_members').upsert(
          {
            owner_id: user.id,
            owner_email: memberEmail,
            member_email: ownerEmail,
            status: 'accepted',
          },
          { onConflict: 'owner_id,member_email', ignoreDuplicates: false }
        );
        if (reciprocalError) {
          console.warn('[Family] Vínculo recíproco não criado (RLS/slots):', reciprocalError.message);
        }
      }
    }

    set((state) => ({
      pendingInvites: state.pendingInvites.filter((i) => i.id !== inviteId),
    }));

    if (status === 'accepted') {
      await get().fetchSubscription();
      await get().fetchAllData();
    }
  },
}));
