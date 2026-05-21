import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useAppStore } from '../../hooks/useAppStore';
import { appAlert, appConfirm } from '../../hooks/useDialogStore';
import {
  Transaction,
  Category,
  MappingRule,
  Account,
  CreditCardStatement,
  CreditCardStatementItem,
  CreditCardStatementV2,
} from './../../types';
import Card from './../ui/Card';
import Modal from './../ui/Modal';
import Input from './../ui/Input';
import MultiSelect from './../ui/MultiSelect';
import Select from './../ui/Select';
import Button from './../ui/Button';
import { TourButton } from '../TourButton';
import { isCardV2Enabled, isCreditCardEngineEnabled } from '../../services/featureFlagService';
import { creditCardEngineService } from '../../services/creditCardEngineService';
import { supabase } from '../../supabaseClient';

import { formatCurrency, formatCurrencySigned } from '../../utils/formatters';
import {
  creditCardRebuildFromImportHistoryService,
  type CompetenceHistoryCard,
  type CompetenceHistoryFileLine,
} from '../../services/creditCardRebuildFromImportHistoryService';
import { MANUAL_COMPETENCE_FILE_LABEL } from '../../services/creditCardManualCompetence';
import {
  buildDirectedPaymentDescription,
} from '../../services/creditCardDirectedPayment';
import PayCreditCardInvoiceModal from '../modals/PayCreditCardInvoiceModal';
import {
  listCompetencePaymentConfirmations,
  listCompetencePaymentConfirmationsForUser,
  removeCompetencePaymentConfirmation,
  saveCompetencePaymentConfirmation,
  type CompetencePaymentConfirmation,
} from '../../services/competenceInvoiceUserConfirmations';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import CreditCardInvoiceCyclesModal from '../modals/CreditCardInvoiceCyclesModal';
import AccountModal from './AccountModal';
import CategoryModal from '../modals/CategoryModal';
import NewTransactionModal from '../modals/NewTransactionModal';
import MappingRuleModal from '../modals/MappingRuleModal';
import { SwipeableItem } from '../ui/SwipeableItem';
import { SkeletonCard } from '../ui/Skeleton';
import { NATIVE_BANK_CONFIGS } from '../../services/parsers/nativeBankParsers';
import AccountBalanceCard from '../transactions/AccountBalanceCard';
import { computeAccountCardDisplay } from '../transactions/accountBalanceCardMetrics';
import { mergeMotorSnapshotWithManualLedger } from '../../services/creditCardManualMotorSync';

const DEFAULT_CARD_PAYMENT_KEYWORDS = [
  'pagamentos válidos normais',
  'pagamentos validos normais',
  'pagamentos válidos',
  'pagamentos validos',
  'pagamento de fatura',
  'pagto de fatura',
];

const DEFAULT_CARD_CREDIT_KEYWORDS = [
  'estorno',
  'reembolso',
  'devolu',
  'cancelamento',
  'ajuste positivo',
];

const normalizeRuleText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const normalizeOriginKey = (value?: string | null) =>
  (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const parseKeywordList = (value: unknown, fallback: string[]) => {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
};

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

/** Dados vindos do motor/Supabase; o uso pelo ledger é recalculado no render com transactions atuais. */
type CreditCardMotorStatementSnap = {
  currentOpenAmount: number;
  hasData: boolean;
  fetchCompleted: boolean;
};

/** Cobre todos os cartões após tentativa de snapshot — evita mapa vazio e UX pendente infinita. */
function buildCreditCardSnapshotPlaceholderMap(creditAccountIds: string[]): Map<string, CreditCardMotorStatementSnap> {
  const m = new Map<string, CreditCardMotorStatementSnap>();
  creditAccountIds.forEach((id) =>
    m.set(id, { currentOpenAmount: 0, hasData: false, fetchCompleted: true })
  );
  return m;
}

const PT_BR_MONTH_TO_NUMBER: Record<string, number> = {
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

const parseInvoicePeriodFromOrigin = (origin?: string | null): { referenceLabel: string; dueYear: number; dueMonth: number } | null => {
  if (!origin) return null;
  const match = origin.match(/(?:_|-|\s)(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)(?:_|-|\s)(\d{4})/i);
  if (!match) return null;
  const dueMonth = PT_BR_MONTH_TO_NUMBER[match[1].toLowerCase()];
  const dueYear = Number(match[2]);
  if (!dueMonth || !dueYear) return null;

  const refDate = new Date(dueYear, dueMonth - 2, 1); // mês de compras = mês anterior ao mês da fatura
  return {
    referenceLabel: `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, '0')}`,
    dueYear,
    dueMonth,
  };
};

const normalizeOriginBaseKey = (value?: string | null) => {
  const raw = (value || '').trim();
  if (!raw) return '';
  const parts = raw.split(/[\\/]/g);
  const base = parts[parts.length - 1] || raw;
  return normalizeOriginKey(base);
};

const DEBUG_TARGET_ORIGIN = 'fatura_cartao_xp_cassio_jan_2025.csv';
const DEBUG_TARGET_AMOUNT = 49.76;
const isDebugTargetTx = (origin?: string | null, amount?: number | null) => {
  const normalizedOrigin = normalizeOriginKey(origin || '');
  const normalizedAmount = Math.abs(Number(amount || 0));
  return normalizedOrigin.includes(DEBUG_TARGET_ORIGIN) && Math.abs(normalizedAmount - DEBUG_TARGET_AMOUNT) < 0.001;
};

const TransactionsView: React.FC = () => {
  const {
    transactions,
    accounts,
    assets,
    fetchAllData,
    isLoading,
    getSortedCategories,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    deleteTransactionsByOrigin,
    addMappingRule,
    transactionFilters,
    setTransactionFilters,
    addCategory,
    addAccount,
    updateAccount,
    getAccountsWithCalculatedBalance,
    user,
    syncCreditCardHistoryFromAccount,
    saveCardImportLotClassification,
    updateUserPreferences,
    getCardStatements,
    payStatement,
    setCurrentView,
    creditCardEngineRevision,
    importLogs,
    bumpCreditCardEngineRevision,
  } = useAppStore();
  const [isNewTransactionModalOpen, setNewTransactionModalOpen] = useState(false);
  const [isCategoryModalOpen, setCategoryModalOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ transactionId: string; origin: string; count: number } | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof Transaction; direction: 'ascending' | 'descending' }>({ key: 'Data', direction: 'descending' });

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [predefinedTransaction, setPredefinedTransaction] = useState<Transaction | null>(null);
  const [payInvoiceModal, setPayInvoiceModal] = useState<{
    open: boolean;
    account: Account | null;
    suggestedAmount: number;
    competenceCards: CompetenceHistoryCard[];
    loading: boolean;
  }>({
    open: false,
    account: null,
    suggestedAmount: 0,
    competenceCards: [],
    loading: false,
  });

  const [motorInvoiceHistoryOpen, setMotorInvoiceHistoryOpen] = useState(false);
  const [motorInvoiceHistoryAccount, setMotorInvoiceHistoryAccount] = useState<Account | null>(null);
  const [motorInvoiceLoading, setMotorInvoiceLoading] = useState(false);
  const [motorInvoiceError, setMotorInvoiceError] = useState<string | null>(null);
  const [motorInvoiceCompetenceCards, setMotorInvoiceCompetenceCards] = useState<
    CompetenceHistoryCard[]
  >([]);
  const [competenceConfirmRevision, setCompetenceConfirmRevision] = useState(0);
  const [paymentConfirmationsByAccount, setPaymentConfirmationsByAccount] = useState<
    Map<string, CompetencePaymentConfirmation[]>
  >(new Map());

  const isoTodayStr = () => new Date().toISOString().slice(0, 10);

  const [creditInvoiceCyclesAccountId, setCreditInvoiceCyclesAccountId] = useState<string | null>(null);

  const loadImportHistoryCompetenceCards = useCallback(
    async (account: Account) => {
      const ownerUserId = account.user_id;
      const userPaymentConfirmations = ownerUserId
        ? await listCompetencePaymentConfirmations(ownerUserId, account.id)
        : [];
      return creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
        accountId: account.id,
        account,
        accounts,
        transactions,
        importLogs,
        userPaymentConfirmations,
      });
    },
    [accounts, transactions, importLogs, competenceConfirmRevision]
  );

  const openMotorInvoiceHistoryModal = useCallback((account: Account) => {
    setMotorInvoiceHistoryAccount(account);
    setMotorInvoiceHistoryOpen(true);
    setMotorInvoiceError(null);
    setMotorInvoiceCompetenceCards([]);
  }, []);

  useEffect(() => {
    if (!motorInvoiceHistoryOpen || !motorInvoiceHistoryAccount) return;
    if (creditInvoiceCyclesAccountId !== null) return;

    let cancelled = false;
    setMotorInvoiceLoading(true);
    setMotorInvoiceError(null);

    void (async () => {
      try {
        const cards = await loadImportHistoryCompetenceCards(motorInvoiceHistoryAccount);
        if (!cancelled) setMotorInvoiceCompetenceCards(cards);
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : 'Não foi possível carregar o histórico de faturas.';
          setMotorInvoiceError(msg);
        }
      } finally {
        if (!cancelled) setMotorInvoiceLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    motorInvoiceHistoryOpen,
    motorInvoiceHistoryAccount,
    creditInvoiceCyclesAccountId,
    importLogs,
    transactions,
    loadImportHistoryCompetenceCards,
  ]);

  const handleConfirmCompetenceResidualPaid = useCallback(
    async (card: CompetenceHistoryCard) => {
      if (!user?.id || !motorInvoiceHistoryAccount) return;
      const amount = card.openBalance;
      if (amount < 0.005) return;

      const ok = await appConfirm(
        `O sistema indica ${formatCurrency(amount)} em aberto na competência ${card.competenceBR}. Se você já quitou esse valor no banco (ajuste, crédito ou arredondamento), confirme para o histórico seguir como pago.`,
        'Confirmar pagamento da fatura',
        'Sim, está pago',
        'info'
      );
      if (!ok) return;

      try {
        await saveCompetencePaymentConfirmation({
          userId: motorInvoiceHistoryAccount.user_id,
          accountId: motorInvoiceHistoryAccount.id,
          referenceMonth: card.referenceMonth,
          settledAmount: amount,
          confirmedAt: new Date().toISOString(),
        });
        setCompetenceConfirmRevision((v) => v + 1);
        setMotorInvoiceCompetenceCards(await loadImportHistoryCompetenceCards(motorInvoiceHistoryAccount));
      } catch {
        await appAlert(
          'Não foi possível salvar a confirmação. Verifique sua conexão e se a migração do banco foi aplicada.',
          'Erro',
          'danger'
        );
      }
    },
    [user?.id, motorInvoiceHistoryAccount, loadImportHistoryCompetenceCards]
  );

  const handleUndoCompetenceResidualPaid = useCallback(
    async (card: CompetenceHistoryCard) => {
      if (!user?.id || !motorInvoiceHistoryAccount) return;

      const ok = await appConfirm(
        `Voltar a exibir o saldo automático de ${formatCurrency(card.userConfirmedAmount ?? 0)} em aberto para ${card.competenceBR}?`,
        'Desfazer confirmação',
        'Desfazer',
        'warning'
      );
      if (!ok) return;

      try {
        await removeCompetencePaymentConfirmation(
          motorInvoiceHistoryAccount.user_id,
          motorInvoiceHistoryAccount.id,
          card.referenceMonth
        );
        setCompetenceConfirmRevision((v) => v + 1);
        setMotorInvoiceCompetenceCards(await loadImportHistoryCompetenceCards(motorInvoiceHistoryAccount));
      } catch {
        await appAlert(
          'Não foi possível desfazer a confirmação. Verifique sua conexão e se a migração do banco foi aplicada.',
          'Erro',
          'danger'
        );
      }
    },
    [user?.id, motorInvoiceHistoryAccount, loadImportHistoryCompetenceCards]
  );

  const formatHistoryFileAudit = useCallback((f: CompetenceHistoryFileLine): string => {
    const refunds = f.totalRefunds ?? 0;
    const debits =
      f.totalDebits != null && Number.isFinite(f.totalDebits)
        ? f.totalDebits
        : Math.max(0, f.statementTotal);
    const parts = [`${f.transactionCount} lanç.`];
    if (debits > 0.005) parts.push(`compras ${formatCurrency(debits)}`);
    if (refunds > 0.005) parts.push(`estornos ${formatCurrency(refunds)}`);
    parts.push(`líquido ${formatCurrency(f.statementTotal)}`);
    if (f.totalPayments > 0.005) parts.push(`pag. ${formatCurrency(f.totalPayments)}`);
    return parts.join(' · ');
  }, []);

  const competenceCardStatusLabel = useCallback((card: CompetenceHistoryCard): string => {
    if (card.openBalance <= 0.005) return 'Paga';
    if (card.totalPayments > 0.005) return 'Parcial';
    const due = new Date(`${card.dueDate}T12:00:00`);
    if (!Number.isNaN(due.getTime()) && due < new Date()) return 'Vencida';
    return 'Aberta';
  }, []);

  const closePayInvoiceModal = useCallback(() => {
    setPayInvoiceModal({
      open: false,
      account: null,
      suggestedAmount: 0,
      competenceCards: [],
      loading: false,
    });
  }, []);

  const handlePayInvoice = useCallback(
    (account: Account, amount: number) => {
      setPayInvoiceModal({
        open: true,
        account,
        suggestedAmount: amount,
        competenceCards: [],
        loading: true,
      });

      void (async () => {
        try {
          const cards = await loadImportHistoryCompetenceCards(account);
          setPayInvoiceModal((s) => ({
            ...s,
            competenceCards: cards,
            loading: false,
          }));
        } catch (error) {
          console.error('[TransactionsView] Carregar faturas para pagamento:', error);
          closePayInvoiceModal();
          await appAlert(
            'Não foi possível carregar as faturas em aberto. Tente novamente.',
            'Pagamento',
            'danger'
          );
        }
      })();
    },
    [loadImportHistoryCompetenceCards, closePayInvoiceModal]
  );

  const submitPayCreditCardInvoice = useCallback(
    async ({
      referenceMonth,
      paymentDate,
      amount,
      category,
    }: {
      referenceMonth: string;
      paymentDate: string;
      amount: number;
      category: string;
    }) => {
      const account = payInvoiceModal.account;
      if (!account || !user) return;

      const selectedCard = payInvoiceModal.competenceCards.find(
        (c) => c.referenceMonth === referenceMonth
      );

      try {
        await addTransaction({
          Data: paymentDate,
          Data_Pagamento: paymentDate,
          ID_Conta: account.id,
          Nome_Fantasia: 'Pagamento de Fatura',
          Categoria: category,
          Tipo: 'Renda',
          Valor: amount,
          Fonte: 'Manual',
          Descricao_Original: buildDirectedPaymentDescription(referenceMonth),
        });
      } catch (error) {
        console.error('[TransactionsView] Registrar pagamento manual:', error);
        await appAlert(
          'Não foi possível registrar o pagamento. Tente novamente.',
          'Pagamento',
          'danger'
        );
        return;
      }

      try {
        await updateUserPreferences({ creditCardPaymentCategory: category });
      } catch (prefErr) {
        console.warn('[TransactionsView] Não foi possível salvar categoria preferida de pagamento:', prefErr);
      }

      if (isCreditCardEngineEnabled(user)) {
        try {
          const statements = await getCardStatements(account.id);
          const target = selectedCard
            ? statements.find(
                (s) =>
                  Number(s.due_year) === selectedCard.dueYear &&
                  Number(s.due_month) === selectedCard.dueMonth
              )
            : statements.find(
                (s) => (s.purchase_reference_label || '').trim() === referenceMonth
              );

          if (target) {
            await payStatement(target.id, {
              paymentDate,
              amount,
              paymentAccountId: account.linked_payment_account_id || undefined,
              notes: `Pagamento direcionado à competência ${referenceMonth}`,
            });
          }
        } catch (error) {
          console.error('[TransactionsView] Pagamento no motor (competência escolhida):', error);
        }
        bumpCreditCardEngineRevision();
      }

      setCompetenceConfirmRevision((v) => v + 1);
      await appAlert('Pagamento registrado com sucesso.', 'Pagamento', 'success');
    },
    [
      payInvoiceModal.account,
      payInvoiceModal.competenceCards,
      user,
      addTransaction,
      updateUserPreferences,
      getCardStatements,
      payStatement,
      bumpCreditCardEngineRevision,
    ]
  );

  const openStatementHistory = async (account: Account) => {
    setStatementHistoryModalOpen(true);
    setIsSyncingHistory(true);
    setStatementHistoryError(null);
    setStatementHistoryAccount(account);
    setExpandedStatementId(null);

    try {
      const { data: accountTxData, error: accountTxError } = await supabase
        .from('transactions')
        .select('ID_Transacao, Origem, Data, ID_Conta, Valor, Tipo, Nome_Fantasia, Descricao_Original')
        .eq('ID_Conta', account.id)
        .neq('Origem', 'manual')
        .not('Origem', 'is', null);
      if (accountTxError) throw accountTxError;

      const byOriginKey = new Map<string, { count: number; maxDate: Date | null; origins: Set<string> }>();
      (accountTxData || []).forEach((tx: any) => {
        const origin = tx.Origem as string;
        const originKey = normalizeOriginKey(origin);
        if (!originKey) return;
        const current = byOriginKey.get(originKey) || { count: 0, maxDate: null, origins: new Set<string>() };
        if (origin) current.origins.add(origin);
        const txDate = tx.Data ? new Date(tx.Data) : null;
        const nextMax = (!current.maxDate || (txDate && txDate > current.maxDate)) ? txDate : current.maxDate;
        byOriginKey.set(originKey, { count: current.count + 1, maxDate: nextMax || current.maxDate, origins: current.origins });
      });

      const { data: logsData, error: logsError } = await supabase
        .from('import_logs')
        .select('file_name, import_date, imported_details')
        .order('import_date', { ascending: false });
      if (logsError) throw logsError;

      const logsByOriginKey = new Map<string, any>();
      const metadataByOriginKey = new Map<string, {
        referenceLabel: string;
        dueDate: string;
        classified: boolean;
        paymentIds: string[];
        refundIds: string[];
      }>();

      (logsData || []).forEach((log: any) => {
        const originKey = normalizeOriginKey(log?.file_name);
        if (!originKey) return;
        const details = Array.isArray(log?.imported_details) ? log.imported_details : [];
        const accountRows = details.filter((d: any) => d?.ID_Conta === account.id);
        if (accountRows.length > 0 || byOriginKey.has(originKey)) {
          if (!logsByOriginKey.has(originKey)) logsByOriginKey.set(originKey, log);
          const current = byOriginKey.get(originKey) || { count: 0, maxDate: null, origins: new Set<string>() };
          if (log?.file_name) current.origins.add(log.file_name);
          byOriginKey.set(originKey, current);
        }

        if (accountRows.length > 0) {
          const metaWithRef = accountRows.find((d: any) => /^\d{4}-(0[1-9]|1[0-2])$/.test(d?.Card_Reference_Label || ''));
          const paymentIds = accountRows.flatMap((d: any) => Array.isArray(d?.Card_Payment_Tx_Ids) ? d.Card_Payment_Tx_Ids : []).filter(Boolean);
          const refundIds = accountRows.flatMap((d: any) => Array.isArray(d?.Card_Refund_Tx_Ids) ? d.Card_Refund_Tx_Ids : []).filter(Boolean);
          metadataByOriginKey.set(originKey, {
            referenceLabel: metaWithRef?.Card_Reference_Label || '',
            dueDate: metaWithRef?.Card_Due_Date || '',
            classified: !!metaWithRef,
            paymentIds,
            refundIds,
          });
        }
      });

      const originKeys = Array.from(byOriginKey.keys());
      if (originKeys.length === 0) {
        setStatementHistoryRows([]);
        setCardImportLots([]);
        return;
      }

      const txDataByOriginAll: any[] = [];
      if (originKeys.length > 0 && user?.id) {
        const { data, error } = await supabase
          .from('transactions')
          .select('ID_Transacao, Origem, Data, ID_Conta, Valor, Tipo, Nome_Fantasia, Descricao_Original, user_id')
          .eq('user_id', user.id)
          .neq('Origem', 'manual')
          .not('Origem', 'is', null);
        if (error) throw error;
        txDataByOriginAll.push(...(data || []));
      }

      const originKeysByBase = new Map<string, Set<string>>();
      byOriginKey.forEach((info, originKey) => {
        const candidates = [originKey, ...Array.from(info.origins)];
        candidates.forEach((origin) => {
          const baseKey = normalizeOriginBaseKey(origin);
          if (!baseKey) return;
          const current = originKeysByBase.get(baseKey) || new Set<string>();
          current.add(originKey);
          originKeysByBase.set(baseKey, current);
        });
      });

      const sourceRowsByOrigin = new Map<string, any[]>();
      (txDataByOriginAll || []).forEach((tx: any) => {
        const rawOriginKey = normalizeOriginKey(tx.Origem);
        const baseOriginKey = normalizeOriginBaseKey(tx.Origem);

        if (rawOriginKey && byOriginKey.has(rawOriginKey)) {
          const current = sourceRowsByOrigin.get(rawOriginKey) || [];
          current.push(tx);
          sourceRowsByOrigin.set(rawOriginKey, current);
          return;
        }

        if (!baseOriginKey) return;
        const candidateOriginKeys = Array.from(originKeysByBase.get(baseOriginKey) || []);
        if (candidateOriginKeys.length === 0) return;
        candidateOriginKeys.forEach((candidateKey) => {
          const current = sourceRowsByOrigin.get(candidateKey) || [];
          current.push(tx);
          sourceRowsByOrigin.set(candidateKey, current);
        });
      });
      if (import.meta.env.DEV) {
        const debugTargetRows = (txDataByOriginAll || []).filter((tx: any) => isDebugTargetTx(tx.Origem, tx.Valor));
        console.log('[CardV2][debug][Cassio Jan/2025 R$49.76][sourceRowsByOrigin]', {
          found: debugTargetRows.length > 0,
          rows: debugTargetRows.map((tx: any) => ({
            transactionId: tx.ID_Transacao,
            origin: tx.Origem,
            accountId: tx.ID_Conta,
            date: tx.Data,
            amount: tx.Valor,
            tipo: tx.Tipo,
            description: `${tx.Descricao_Original || ''} ${tx.Nome_Fantasia || ''}`.trim(),
          })),
        });
      }
      originKeys.forEach((originKey) => {
        if (!sourceRowsByOrigin.has(originKey)) sourceRowsByOrigin.set(originKey, []);
      });

      const paymentKeywords = parseKeywordList(
        user?.user_metadata?.cardPaymentKeywords,
        DEFAULT_CARD_PAYMENT_KEYWORDS
      );
      const creditKeywords = parseKeywordList(
        user?.user_metadata?.cardCreditKeywords,
        DEFAULT_CARD_CREDIT_KEYWORDS
      );
      const hasPaymentKeyword = (text: string) => {
        const normalizedText = normalizeRuleText(text || '');
        return paymentKeywords.some((keyword) => normalizedText.includes(normalizeRuleText(keyword)));
      };
      const hasCreditKeyword = (text: string) => {
        const normalizedText = normalizeRuleText(text || '');
        return creditKeywords.some((keyword) => normalizedText.includes(normalizeRuleText(keyword)));
      };
      const classifyTx = (tx: any, originKey: string): 'charge' | 'refund' | 'payment' => {
        const txId = tx?.ID_Transacao as string | undefined;
        const metadata = metadataByOriginKey.get(originKey);
        if (txId && metadata?.paymentIds.includes(txId)) return 'payment';
        if (txId && metadata?.refundIds.includes(txId)) return 'refund';

        const rawText = `${tx.Descricao_Original || ''} ${tx.Nome_Fantasia || ''}`;
        const isPositiveCardEntry = tx.Tipo === 'Renda' || Number(tx.Valor || 0) > 0;
        if (hasPaymentKeyword(rawText) && isPositiveCardEntry) return 'payment';
        if (tx.Tipo === 'Renda' && hasCreditKeyword(rawText)) return 'refund';
        if (hasCreditKeyword(rawText)) return 'refund';
        if (import.meta.env.DEV && isPositiveCardEntry) {
          console.warn('[CardV2][guardrail] Positive card entry without payment/refund classification kept as charge', {
            transactionId: tx.ID_Transacao,
            origin: tx.Origem,
            amount: tx.Valor,
            description: rawText,
          });
        }
        const finalType: 'charge' | 'refund' | 'payment' = 'charge';
        if (import.meta.env.DEV && isDebugTargetTx(tx.Origem, tx.Valor)) {
          console.log('[CardV2][debug][Cassio Jan/2025 R$49.76][classifyTx]', {
            transactionId: tx.ID_Transacao,
            origin: tx.Origem,
            originKey,
            amount: tx.Valor,
            tipo: tx.Tipo,
            rawText,
            finalType,
            metadataOverridePayment: !!(tx.ID_Transacao && metadata?.paymentIds.includes(tx.ID_Transacao)),
            metadataOverrideRefund: !!(tx.ID_Transacao && metadata?.refundIds.includes(tx.ID_Transacao)),
          });
        }
        return finalType;
      };

      const inferReference = (maxDate: Date | null) => {
        if (!maxDate || Number.isNaN(maxDate.getTime())) return '';
        return `${maxDate.getFullYear()}-${String(maxDate.getMonth() + 1).padStart(2, '0')}`;
      };
      const inferDueDate = (referenceLabel: string) => {
        if (!referenceLabel) return '';
        const [y, m] = referenceLabel.split('-').map(Number);
        const safeDay = Math.min(Math.max(account.dia_vencimento || 10, 1), 28);
        const due = new Date(y, m, safeDay);
        return `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
      };

      type HydratedStatement = CreditCardStatement & {
        items: CreditCardStatementItem[];
        invoiceSourceFiles: string[];
        paymentSourceFiles: string[];
        paymentFromOwnFiles: number;
        expectedChargesFromFiles: number;
        expectedCreditsFromFiles: number;
        chargeDiffFromFiles: number;
        unmatchedFileItems: Array<{ id: string; description: string; amount: number; postedDate: string; sourceFile: string }>;
      };

      const statementBuckets = new Map<string, HydratedStatement>();
      originKeys.forEach((originKey) => {
        const stats = byOriginKey.get(originKey)!;
        const metadata = metadataByOriginKey.get(originKey);
        const rows = sourceRowsByOrigin.get(originKey) || [];
        const originCandidates = Array.from(stats.origins).sort((a, b) => a.localeCompare(b));
        const parsedFromFilename = parseInvoicePeriodFromOrigin(originCandidates[0]);
        const referenceLabel = metadata?.referenceLabel || parsedFromFilename?.referenceLabel || inferReference(stats.maxDate);
        const dueDate = metadata?.dueDate || (
          parsedFromFilename
            ? `${parsedFromFilename.dueYear}-${String(parsedFromFilename.dueMonth).padStart(2, '0')}-${String(Math.min(Math.max(account.dia_vencimento || 10, 1), 28)).padStart(2, '0')}`
            : inferDueDate(referenceLabel)
        );
        if (!referenceLabel) return;

        const bucketKey = `${referenceLabel}|${dueDate || ''}`;
        const invoiceSource = originCandidates;

        if (!statementBuckets.has(bucketKey)) {
          statementBuckets.set(bucketKey, {
            id: bucketKey,
            user_id: user?.id || '',
            account_id: account.id,
            reference_label: referenceLabel,
            due_date: dueDate || null,
            close_date: null,
            total_charges: 0,
            total_credits: 0,
            total_payments: 0,
            open_amount: 0,
            source_origin: invoiceSource.join(' | '),
            status: 'open',
            items: [],
            invoiceSourceFiles: [],
            paymentSourceFiles: [],
            paymentFromOwnFiles: 0,
            expectedChargesFromFiles: 0,
            expectedCreditsFromFiles: 0,
            chargeDiffFromFiles: 0,
            unmatchedFileItems: [],
          });
        }

        const statement = statementBuckets.get(bucketKey)!;
        const invoiceFileSet = new Set(statement.invoiceSourceFiles);
        invoiceSource.forEach((origin) => invoiceFileSet.add(origin));
        statement.invoiceSourceFiles = Array.from(invoiceFileSet).sort((a, b) => a.localeCompare(b));

        let charges = 0;
        let refunds = 0;
        let payments = 0;

        rows.forEach((tx: any) => {
          const txType = classifyTx(tx, originKey);
          const amount = Math.abs(Number(tx.Valor || 0));
          if (txType === 'charge') charges += amount;
          if (txType === 'refund') refunds += amount;
          if (txType === 'payment') payments += amount;

          statement.items.push({
            id: tx.ID_Transacao || `${originKey}-${tx.Data}-${tx.Valor}-${tx.Nome_Fantasia || ''}`,
            user_id: user?.id || '',
            account_id: account.id,
            statement_id: bucketKey,
            transaction_id: tx.ID_Transacao || null,
            item_type: txType,
            amount,
            posted_date: tx.Data ? new Date(tx.Data).toISOString().slice(0, 10) : null,
          });
          if (import.meta.env.DEV && isDebugTargetTx(tx.Origem, tx.Valor)) {
            console.log('[CardV2][debug][Cassio Jan/2025 R$49.76][statementBucket]', {
              transactionId: tx.ID_Transacao,
              origin: tx.Origem,
              amount: tx.Valor,
              txType,
              bucketKey,
              referenceLabel,
              dueDate,
              foundInBucket: true,
            });
          }
        });

        statement.total_charges = roundCurrency(statement.total_charges + charges);
        statement.total_credits = roundCurrency(statement.total_credits + refunds);
        statement.total_payments = roundCurrency(statement.total_payments + payments);
        statement.expectedChargesFromFiles = statement.total_charges;
        statement.expectedCreditsFromFiles = statement.total_credits;
        statement.paymentFromOwnFiles = statement.total_payments;
        if (payments > 0) {
          const paymentSourceSet = new Set(statement.paymentSourceFiles);
          invoiceSource.forEach((origin) => paymentSourceSet.add(origin));
          statement.paymentSourceFiles = Array.from(paymentSourceSet).sort((a, b) => a.localeCompare(b));
        }
      });

      const hydratedRows = Array.from(statementBuckets.values())
        .map((row) => ({
          ...row,
          items: row.items.sort((a, b) => {
            const aTime = a.posted_date ? new Date(`${a.posted_date}T00:00:00`).getTime() : 0;
            const bTime = b.posted_date ? new Date(`${b.posted_date}T00:00:00`).getTime() : 0;
            return aTime - bTime;
          }),
        }))
        .sort((a, b) => {
          const aDate = a.due_date ? new Date(`${a.due_date}T00:00:00`).getTime() : 0;
          const bDate = b.due_date ? new Date(`${b.due_date}T00:00:00`).getTime() : 0;
          return bDate - aDate;
        });

      const visibleRows = hydratedRows.filter((row) =>
        row.invoiceSourceFiles.length > 0 || Number(row.total_charges || 0) > 0 || Number(row.total_credits || 0) > 0
      );

      visibleRows.forEach((row, index, rows) => {
        const net = Math.max(Number(row.total_charges || 0) - Number(row.total_credits || 0), 0);
        const paymentFromNext = index > 0 ? Number(rows[index - 1]?.paymentFromOwnFiles || 0) : Number(row.paymentFromOwnFiles || 0);
        const rawOpen = roundCurrency(net - paymentFromNext);
        const adjustment = roundCurrency(paymentFromNext - net);
        const adjustedOpen = Math.abs(adjustment) > 0 && Math.abs(adjustment) <= 1 ? 0 : Math.max(rawOpen, 0);
        row.open_amount = adjustedOpen;
        row.status = adjustedOpen <= 0 ? 'paid' : paymentFromNext > 0 ? 'partial' : 'open';
      });

      setStatementHistoryRows(visibleRows);

      if (import.meta.env.DEV) {
        visibleRows.forEach((row) => {
          const diagnostics = row.invoiceSourceFiles.map((origin) => {
            const originKey = normalizeOriginKey(origin);
            const sourceRows = sourceRowsByOrigin.get(originKey) || [];
            let charges = 0;
            let refunds = 0;
            let payments = 0;
            sourceRows.forEach((tx: any) => {
              const txType = classifyTx(tx, originKey);
              const amount = Math.abs(Number(tx.Valor || 0));
              if (txType === 'charge') charges += amount;
              if (txType === 'refund') refunds += amount;
              if (txType === 'payment') payments += amount;
            });
            return {
              origin,
              originKey,
              txCount: sourceRows.length,
              charges: roundCurrency(charges),
              refunds: roundCurrency(refunds),
              payments: roundCurrency(payments),
            };
          });
          console.log('[CardV2][debug][openStatementHistory]', {
            statementId: row.id,
            reference: row.reference_label,
            dueDate: row.due_date,
            invoiceSourceFiles: row.invoiceSourceFiles,
            diagnostics,
          });
        });
      }

      const lotRows = originKeys.map((originKey) => {
        const stats = byOriginKey.get(originKey)!;
        const metadata = metadataByOriginKey.get(originKey);
        const log = logsByOriginKey.get(originKey);
        const origins = Array.from(stats.origins).sort((a, b) => a.localeCompare(b));
        const parsedFromFilename = parseInvoicePeriodFromOrigin(origins[0]);
        const referenceLabel = metadata?.referenceLabel || parsedFromFilename?.referenceLabel || inferReference(stats.maxDate);
        const dueDate = metadata?.dueDate || (
          parsedFromFilename
            ? `${parsedFromFilename.dueYear}-${String(parsedFromFilename.dueMonth).padStart(2, '0')}-${String(Math.min(Math.max(account.dia_vencimento || 10, 1), 28)).padStart(2, '0')}`
            : inferDueDate(referenceLabel)
        );
        return {
          originKey,
          origins,
          origin: log?.file_name || origins[0] || originKey,
          count: Number(stats.count || sourceRowsByOrigin.get(originKey)?.length || 0),
          referenceLabel,
          dueDate,
          classified: !!metadata?.classified,
          paymentTransactionIds: metadata?.paymentIds || [],
          refundTransactionIds: metadata?.refundIds || [],
        };
      }).sort((a, b) => b.referenceLabel.localeCompare(a.referenceLabel));

      setCardImportLots(lotRows);
    } catch (error: any) {
      console.error('[CardV2][UI] Erro ao carregar histórico de faturas:', error);
      setStatementHistoryError(error?.message || 'Não foi possível carregar o histórico de faturas.');
    } finally {
      setIsSyncingHistory(false);
    }
  };

  const handleSyncCardHistory = async () => {
    if (!statementHistoryAccount) return;
    setStatementHistoryLoading(true);
    setStatementHistoryError(null);
    try {
      const result = await syncCreditCardHistoryFromAccount(statementHistoryAccount.id);
      await openStatementHistory(statementHistoryAccount);
      const pendingLots = cardImportLots.filter((l) => !l.classified).length;
      await appAlert(
        pendingLots > 0
          ? `${result.message} (${result.processed} itens processados). Ainda existem ${pendingLots} lote(s) pendente(s) de classificação.`
          : `${result.message} (${result.processed} itens processados).`,
        'Sincronização concluída',
        'success'
      );
    } catch (error: any) {
      console.error('[CardV2][UI] Erro ao sincronizar histórico de faturas:', error);
      setStatementHistoryError(error?.message || 'Não foi possível sincronizar o histórico de faturas.');
    } finally {
      setStatementHistoryLoading(false);
    }
  };

  const handleResetCardHistoryRead = async () => {
    if (!statementHistoryAccount) return;

    const confirmed = await appConfirm(
      `Isso vai limpar competência, vencimento e classificações manuais dos lotes deste cartão (${statementHistoryAccount.Nome_Conta}). Deseja continuar?`,
      'Resetar leitura dos cards',
      'Resetar',
      'danger',
      'Cancelar'
    );
    if (!confirmed) return;

    setStatementHistoryLoading(true);
    setStatementHistoryError(null);

    try {
      const { data: logs, error: logsError } = await supabase
        .from('import_logs')
        .select('id, imported_details');
      if (logsError) throw logsError;

      for (const log of logs || []) {
        const details = Array.isArray(log.imported_details) ? log.imported_details : [];
        let changed = false;
        const nextDetails = details.map((row: any) => {
          if (row?.ID_Conta !== statementHistoryAccount.id) return row;
          changed = true;
          const cleaned = { ...row };
          delete cleaned.Card_Reference_Label;
          delete cleaned.Card_Due_Date;
          delete cleaned.Card_Payment_Tx_Ids;
          delete cleaned.Card_Refund_Tx_Ids;
          return cleaned;
        });

        if (!changed) continue;

        const { error: updateError } = await supabase
          .from('import_logs')
          .update({ imported_details: nextDetails })
          .eq('id', log.id);
        if (updateError) throw updateError;
      }

      await openStatementHistory(statementHistoryAccount);
      await appAlert(
        'Leitura do histórico resetada com sucesso. Agora os cards foram recalculados sem classificações persistidas.',
        'Reset concluído',
        'success'
      );
    } catch (error: any) {
      console.error('[CardV2][UI] Erro ao resetar leitura do histórico:', error);
      setStatementHistoryError(error?.message || 'Não foi possível resetar a leitura dos cards.');
    } finally {
      setStatementHistoryLoading(false);
    }
  };

  const openLotClassification = (lot: {
    originKey: string;
    origins: string[];
    origin: string;
    referenceLabel: string;
    dueDate: string;
    classified: boolean;
    paymentTransactionIds: string[];
    refundTransactionIds: string[];
  }) => {
    setSelectedLot(lot);
    setLotReferenceMonth(lot.referenceLabel || '');
    setLotDueDate(lot.dueDate || '');
    const paymentSet = new Set(lot.paymentTransactionIds || []);
    const refundSet = new Set(lot.refundTransactionIds || []);
    const lotTxRows = transactions
      .filter((tx) => normalizeOriginKey(tx.Origem) === lot.originKey)
      .map((tx) => {
        const rawText = `${tx.Descricao_Original || ''} ${tx.Nome_Fantasia || ''}`;
        let selectedType: 'charge' | 'payment' | 'refund' = 'charge';
        if (tx.ID_Transacao && paymentSet.has(tx.ID_Transacao)) selectedType = 'payment';
        else if (tx.ID_Transacao && refundSet.has(tx.ID_Transacao)) selectedType = 'refund';
        else if (classifyDescriptionWithRules(rawText, currentPaymentKeywords, currentCreditKeywords) === 'payment') selectedType = 'payment';
        else if (classifyDescriptionWithRules(rawText, currentPaymentKeywords, currentCreditKeywords) === 'refund') selectedType = 'refund';

        const isEntryCandidate =
          tx.Tipo === 'Renda' ||
          selectedType === 'payment' ||
          selectedType === 'refund';

        if (!isEntryCandidate) return null;

        return {
          id: tx.ID_Transacao || `${lot.originKey}-${tx.Data}-${tx.Valor}-${tx.Nome_Fantasia}`,
          transactionId: tx.ID_Transacao || null,
          date: tx.Data ? new Date(tx.Data).toISOString().slice(0, 10) : '',
          description: tx.Nome_Fantasia || tx.Descricao_Original || 'Sem descrição',
          amount: Number(tx.Valor || 0),
          selectedType,
        };
      })
      .filter((row): row is NonNullable<typeof row> => !!row)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    setLotTransactionRows(lotTxRows);
    setLotModalOpen(true);
  };

  const handleSaveLotClassification = async () => {
    if (!selectedLot || !statementHistoryAccount) return;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(lotReferenceMonth)) {
      await appAlert('Competência inválida. Use MM/AAAA no campo de mês.', 'Aviso', 'warning');
      return;
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(lotDueDate)) {
      await appAlert('Vencimento inválido. Use DD/MM/AAAA no campo de data.', 'Aviso', 'warning');
      return;
    }

    setIsSavingLot(true);
    try {
      const paymentTransactionIds = lotTransactionRows
        .filter((row) => row.selectedType === 'payment' && !!row.transactionId)
        .map((row) => row.transactionId as string);
      const refundTransactionIds = lotTransactionRows
        .filter((row) => row.selectedType === 'refund' && !!row.transactionId)
        .map((row) => row.transactionId as string);

      const targetOrigins = selectedLot.origins.length > 0 ? selectedLot.origins : [selectedLot.origin];
      let updatedLogs = 0;

      for (const origin of targetOrigins) {
        const result = await saveCardImportLotClassification(
          origin,
          statementHistoryAccount.id,
          lotReferenceMonth,
          lotDueDate,
          {
            paymentTransactionIds,
            refundTransactionIds,
          }
        );
        updatedLogs += Number(result.updatedLogs || 0);
      }

      if (updatedLogs > 0) {
        setCardImportLots((prev) =>
          prev.map((lot) =>
            lot.originKey === selectedLot.originKey
              ? {
                  ...lot,
                  referenceLabel: lotReferenceMonth,
                  dueDate: lotDueDate,
                  classified: true,
                  paymentTransactionIds,
                  refundTransactionIds,
                }
              : lot
          )
        );
        setSelectedLot(null);
        setLotTransactionRows([]);
        await appAlert('Lote classificado com sucesso. Continue classificando outros lotes e depois clique em "Sincronizar histórico".', 'Sucesso', 'success');
      } else {
        await appAlert('Nenhum lote foi atualizado. Verifique se os arquivos de origem ainda existem no histórico de importações.', 'Aviso', 'warning');
      }
    } finally {
      setIsSavingLot(false);
    }
  };

  const openClassifierModal = () => {
    setPaymentKeywordsInput(currentPaymentKeywords.join('\n'));
    setCreditKeywordsInput(currentCreditKeywords.join('\n'));
    setClassifierModalOpen(true);
  };

  const handleSaveClassifierRules = async () => {
    const paymentKeywords = parseInputKeywords(paymentKeywordsInput, DEFAULT_CARD_PAYMENT_KEYWORDS);
    const creditKeywords = parseInputKeywords(creditKeywordsInput, DEFAULT_CARD_CREDIT_KEYWORDS);

    setIsSavingClassifier(true);
    try {
      await updateUserPreferences({
        cardPaymentKeywords: paymentKeywords,
        cardCreditKeywords: creditKeywords,
      });
      setClassifierModalOpen(false);
      await appAlert(
        'Regras salvas. Para aplicar em todas as faturas históricas, clique em "Sincronizar histórico".',
        'Classificação atualizada',
        'success'
      );
    } catch (error: any) {
      console.error('[CardV2][Rules] Erro ao salvar regras de classificação:', error);
      await appAlert('Não foi possível salvar as regras agora. Tente novamente.', 'Erro', 'danger');
    } finally {
      setIsSavingClassifier(false);
    }
  };

  const formatStatementReferencePtBr = (
    statement: CreditCardStatement,
    items: CreditCardStatementItem[],
    account?: Account | null
  ): string => {
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    const maxItemDate = items
      .map((i) => i.posted_date ? new Date(`${i.posted_date}T00:00:00`) : null)
      .filter((d): d is Date => !!d && !Number.isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0];

    const dueDateFromItems = (() => {
      if (!maxItemDate || !account?.dia_vencimento) return null;
      const day = Math.min(Math.max(account.dia_vencimento, 1), 28);
      return new Date(maxItemDate.getFullYear(), maxItemDate.getMonth() + 1, day);
    })();

    // Regra bancária: compras de março pertencem à fatura de abril (mês do vencimento).
    const refDateFromItems = maxItemDate
      ? new Date(maxItemDate.getFullYear(), maxItemDate.getMonth() + 1, 1)
      : null;

    const buildRefDateFromDueDate = (dueDateStr?: string | null): Date | null => {
      if (!dueDateStr) return null;
      const due = new Date(`${dueDateStr}T00:00:00`);
      if (Number.isNaN(due.getTime())) return null;
      return new Date(due.getFullYear(), due.getMonth(), 1);
    };

    const buildRefDateFromReference = (reference?: string | null): Date | null => {
      if (!reference) return null;
      const match = reference.match(/^(\d{4})-(\d{2})$/);
      if (!match) return null;
      const year = Number(match[1]);
      const month = Number(match[2]);
      return new Date(year, month - 1, 1);
    };

    const purchaseRefDate =
      buildRefDateFromReference(statement.reference_label) ||
      refDateFromItems;
    const invoiceRefDate =
      buildRefDateFromDueDate(statement.due_date) ||
      (purchaseRefDate ? new Date(purchaseRefDate.getFullYear(), purchaseRefDate.getMonth() + 1, 1) : null);

    if (!purchaseRefDate || Number.isNaN(purchaseRefDate.getTime()) || !invoiceRefDate || Number.isNaN(invoiceRefDate.getTime())) {
      return `Fatura ${statement.reference_label || '—'}`;
    }

    const monthLabel = monthNames[invoiceRefDate.getMonth()];
    const yearLabel = invoiceRefDate.getFullYear();
    const purchaseMonthLabel = monthNames[purchaseRefDate.getMonth()];
    const purchaseYearLabel = purchaseRefDate.getFullYear();
    const dueDate = (statement.due_date ? new Date(`${statement.due_date}T00:00:00`) : null) || dueDateFromItems;
    const dueLabel = dueDate ? dueDate.toLocaleDateString('pt-BR') : null;

    return dueLabel
      ? `Compras de ${purchaseMonthLabel} de ${purchaseYearLabel} | Fatura de ${monthLabel}/${yearLabel} (venc. ${dueLabel})`
      : `Compras de ${purchaseMonthLabel} de ${purchaseYearLabel} | Fatura de ${monthLabel}/${yearLabel}`;
  };

  const statusToPtBr = (status?: string): string => {
    switch (status) {
      case 'open':
        return 'Em aberto';
      case 'partial':
        return 'Parcial';
      case 'paid':
        return 'Paga';
      case 'closed':
        return 'Fechada';
      case 'overdue':
        return 'Vencida';
      default:
        return status || '—';
    }
  };

  /**
   * Competência da fatura em MM/AAAA para o usuário.
   * Usa `due_month`/`due_year` da tabela (alinhados ao `reference_label` / ciclo definido nas importações).
   * Não usar `purchase_reference_label`: no motor ele é derivado por `calcReferenceLabelFromDue` como mês de compras
   * (ex.: fatura de dezembro/2024 → "2024-11"), o que confunde na UI.
   */
  const formatMotorStatementCompetenceMmYyyy = (s: CreditCardStatementV2): string => {
    const dm = Number(s.due_month);
    const dy = Number(s.due_year);
    if (dm >= 1 && dm <= 12 && dy > 0) {
      return `${String(dm).padStart(2, '0')}/${dy}`;
    }
    const ref = (s.purchase_reference_label || '').trim();
    const ym = ref.match(/^(\d{4})-(\d{2})$/);
    if (ym) {
      const y = Number(ym[1]);
      const m = Number(ym[2]);
      if (m >= 1 && m <= 12 && y > 0) return `${String(m).padStart(2, '0')}/${y}`;
    }
    if (s.due_date) {
      const d = new Date(`${s.due_date}T12:00:00`);
      if (!Number.isNaN(d.getTime())) {
        return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      }
    }
    return '—';
  };

  const itemTypeToPtBr = (itemType?: string): string => {
    switch (itemType) {
      case 'charge':
        return 'Compra';
      case 'refund':
        return 'Estorno';
      case 'payment':
        return 'Pagamento';
      default:
        return itemType || 'Item';
    }
  };

  const [isMappingRuleModalOpen, setMappingRuleModalOpen] = useState(false);
  const [transactionForRule, setTransactionForRule] = useState<Transaction | null>(null);
  const [isStatementHistoryModalOpen, setStatementHistoryModalOpen] = useState(false);
  const [statementHistoryLoading, setStatementHistoryLoading] = useState(false);
  const [statementHistoryError, setStatementHistoryError] = useState<string | null>(null);
  const [statementHistoryAccount, setStatementHistoryAccount] = useState<Account | null>(null);
  const [statementHistoryRows, setStatementHistoryRows] = useState<Array<CreditCardStatement & {
    items: CreditCardStatementItem[];
    invoiceSourceFiles: string[];
    paymentSourceFiles: string[];
    paymentFromOwnFiles: number;
    expectedChargesFromFiles: number;
    expectedCreditsFromFiles: number;
    chargeDiffFromFiles: number;
    unmatchedFileItems: Array<{ id: string; description: string; amount: number; postedDate: string; sourceFile: string }>;
  }>>([]);
  const [expandedStatementId, setExpandedStatementId] = useState<string | null>(null);
  const [isSyncingHistory, setIsSyncingHistory] = useState(false);
  const [paymentInfoOpenFor, setPaymentInfoOpenFor] = useState<string | null>(null);
  const [cardImportLots, setCardImportLots] = useState<Array<{
    originKey: string;
    origins: string[];
    origin: string;
    count: number;
    referenceLabel: string;
    dueDate: string;
    classified: boolean;
    paymentTransactionIds: string[];
    refundTransactionIds: string[];
  }>>([]);
  const [isLotModalOpen, setLotModalOpen] = useState(false);
  const [selectedLot, setSelectedLot] = useState<{
    originKey: string;
    origins: string[];
    origin: string;
    referenceLabel: string;
    dueDate: string;
    classified: boolean;
    paymentTransactionIds: string[];
    refundTransactionIds: string[];
  } | null>(null);
  const [lotReferenceMonth, setLotReferenceMonth] = useState('');
  const [lotDueDate, setLotDueDate] = useState('');
  const [isSavingLot, setIsSavingLot] = useState(false);
  const [lotTransactionRows, setLotTransactionRows] = useState<Array<{
    id: string;
    transactionId: string | null;
    date: string;
    description: string;
    amount: number;
    selectedType: 'charge' | 'payment' | 'refund';
  }>>([]);
  const [isClassifierModalOpen, setClassifierModalOpen] = useState(false);
  const [isSavingClassifier, setIsSavingClassifier] = useState(false);
  const [paymentKeywordsInput, setPaymentKeywordsInput] = useState('');
  const [creditKeywordsInput, setCreditKeywordsInput] = useState('');

  // New Modals State
  const [isAccountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [lastCreatedAccount, setLastCreatedAccount] = useState<string | null>(null);
  const [lastCreatedCategory, setLastCreatedCategory] = useState<string | null>(null);

  const categories = getSortedCategories();
  const accountsWithMissingBank = useMemo(() => accounts.filter(acc => !acc.bank_id && !acc.is_archived), [accounts]);
  const cardEngineEnabled = isCreditCardEngineEnabled(user);
  const cardV2Enabled = isCardV2Enabled(user);
  const cardSnapshotPipelineEnabled = cardV2Enabled || cardEngineEnabled;

  /** Competências por arquivo: qualquer cartão com extrato importado (não só flag do motor). */
  const showAdjustCompetenceByFile = useMemo(() => {
    const acc = motorInvoiceHistoryAccount;
    if (!acc) return false;
    const hasImportedTx = transactions.some(
      (t) =>
        t.ID_Conta === acc.id &&
        t.Origem &&
        String(t.Origem).trim().toLowerCase() !== 'manual'
    );
    if (hasImportedTx) return true;
    return importLogs.some((log) => {
      const det = log.imported_details as Array<{ ID_Conta?: string }> | undefined;
      return Array.isArray(det) && det.some((d) => d?.ID_Conta === acc.id);
    });
  }, [motorInvoiceHistoryAccount, transactions, importLogs]);

  const { regularBalanceAccounts, creditBalanceAccounts } = useMemo(() => {
    const active = getAccountsWithCalculatedBalance().filter((a) => !a.is_archived);
    return {
      regularBalanceAccounts: active.filter((a) => a.Tipo_Conta !== 'Cartão de Crédito'),
      creditBalanceAccounts: active.filter((a) => a.Tipo_Conta === 'Cartão de Crédito'),
    };
  }, [accounts, transactions, getAccountsWithCalculatedBalance]);

  useEffect(() => {
    if (creditBalanceAccounts.length === 0) {
      setPaymentConfirmationsByAccount(new Map());
      return;
    }

    const byOwner = new Map<string, Account[]>();
    creditBalanceAccounts.forEach((acc) => {
      if (!acc.user_id) return;
      const list = byOwner.get(acc.user_id) || [];
      list.push(acc);
      byOwner.set(acc.user_id, list);
    });

    let cancelled = false;

    void (async () => {
      try {
        const map = new Map<string, CompetencePaymentConfirmation[]>();
        for (const [ownerId, accs] of byOwner) {
          const rows = await listCompetencePaymentConfirmationsForUser(
            ownerId,
            accs.map((a) => a.id)
          );
          accs.forEach((acc) => {
            map.set(
              acc.id,
              rows.filter((r) => r.accountId === acc.id)
            );
          });
        }
        if (!cancelled) setPaymentConfirmationsByAccount(map);
      } catch (e) {
        console.warn('[TransactionsView] Falha ao carregar confirmações de fatura:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [creditBalanceAccounts, competenceConfirmRevision]);

  const [cardV2SnapshotByAccount, setCardV2SnapshotByAccount] = useState<Map<string, CreditCardMotorStatementSnap>>(
    new Map()
  );

  /** Evita re-fetch do snapshot só porque `accounts` ganhou nova referência no Zustand com os mesmos cartões. */
  const creditCardAccountIdsKey = useMemo(
    () =>
      accounts
        .filter((a) => a.Tipo_Conta === 'Cartão de Crédito' && !a.is_archived)
        .map((a) => a.id)
        .slice()
        .sort()
        .join('|'),
    [accounts]
  );

  const currentPaymentKeywords = useMemo(
    () => parseKeywordList(user?.user_metadata?.cardPaymentKeywords, DEFAULT_CARD_PAYMENT_KEYWORDS),
    [user?.user_metadata?.cardPaymentKeywords]
  );

  const currentCreditKeywords = useMemo(
    () => parseKeywordList(user?.user_metadata?.cardCreditKeywords, DEFAULT_CARD_CREDIT_KEYWORDS),
    [user?.user_metadata?.cardCreditKeywords]
  );

  const parseInputKeywords = useCallback((input: string, fallback: string[]) => {
    const values = input
      .split(/\r?\n|,/g)
      .map((line) => line.trim())
      .filter(Boolean);
    return values.length > 0 ? values : fallback;
  }, []);

  const classifyDescriptionWithRules = useCallback((description: string, paymentKeywords: string[], creditKeywords: string[]) => {
    const text = normalizeRuleText(description || '');
    const isPayment = paymentKeywords.some((keyword) => text.includes(normalizeRuleText(keyword)));
    if (isPayment) return 'payment';
    const isCredit = creditKeywords.some((keyword) => text.includes(normalizeRuleText(keyword)));
    if (isCredit) return 'refund';
    return 'charge';
  }, []);

  const classifierPreview = useMemo(() => {
    const paymentDraft = parseInputKeywords(paymentKeywordsInput, currentPaymentKeywords);
    const creditDraft = parseInputKeywords(creditKeywordsInput, currentCreditKeywords);
    const targetRows = statementHistoryRows.slice(0, 2);

    return targetRows.map((row) => {
      let changed = 0;
      row.items.forEach((item: any) => {
        const description = item.description || item.description_raw || '';
        const before = classifyDescriptionWithRules(description, currentPaymentKeywords, currentCreditKeywords);
        const after = classifyDescriptionWithRules(description, paymentDraft, creditDraft);
        if (before !== after) changed += 1;
      });
      return {
        statementId: row.id,
        label: formatStatementReferencePtBr(row, row.items, statementHistoryAccount),
        changed,
        total: row.items.length,
      };
    });
  }, [
    classifyDescriptionWithRules,
    parseInputKeywords,
    paymentKeywordsInput,
    creditKeywordsInput,
    currentPaymentKeywords,
    currentCreditKeywords,
    statementHistoryRows,
    statementHistoryAccount,
  ]);

  // Efeito para buscar as transações do Supabase na montagem do componente
  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  useEffect(() => {
    let cancelled = false;

    const loadCardV2Snapshots = async () => {
      if (!cardSnapshotPipelineEnabled || !user?.id) {
        if (!cancelled) setCardV2SnapshotByAccount(new Map());
        return;
      }

      const { accounts: accountsNow } = useAppStore.getState();
      const creditAccounts = accountsNow.filter((a) => a.Tipo_Conta === 'Cartão de Crédito' && !a.is_archived);
      const creditAccountIds = creditAccounts.map((a) => a.id);

      if (creditAccountIds.length === 0) {
        if (!cancelled) setCardV2SnapshotByAccount(new Map());
        return;
      }

      if (!cancelled) {
        setCardV2SnapshotByAccount((prev) => {
          let changed = false;
          const next = new Map(prev);
          for (const id of creditAccountIds) {
            const cur = next.get(id);
            if (cur?.fetchCompleted) {
              next.set(id, {
                currentOpenAmount: cur.currentOpenAmount,
                hasData: cur.hasData,
                fetchCompleted: false,
              });
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }

      type CardLink = { accountId: string; cardId: string };
      const links: CardLink[] = [];
      for (const acc of creditAccounts) {
        try {
          const ensured = await creditCardEngineService.ensureCreditCardForAccount(user.id, acc);
          links.push({ accountId: acc.id, cardId: ensured.id });
        } catch (e) {
          console.warn('[CardV2][UI] Não foi possível resolver credit_cards para snapshot:', acc.id, e);
        }
      }

      const cardIds = links.map((l) => l.cardId);
      const cardIdToAccountId = new Map(links.map((l) => [l.cardId, l.accountId] as const));

      if (cardIds.length === 0) {
        if (!cancelled) setCardV2SnapshotByAccount(buildCreditCardSnapshotPlaceholderMap(creditAccountIds));
        return;
      }

      const statementSelect =
        'account_id, card_id, open_amount, open_balance, statement_total, due_date, due_year, due_month, status';

      const { data, error } = await supabase
        .from('credit_card_statements')
        .select(statementSelect)
        .in('card_id', cardIds)
        .order('due_year', { ascending: false })
        .order('due_month', { ascending: false });

      let rowsOut = data;

      if (error) {
        const legacy = await supabase
          .from('credit_card_statements')
          .select(statementSelect)
          .in('card_id', cardIds)
          .order('due_date', { ascending: false });
        if (legacy.error) {
          console.error('[CardV2][UI] Falha ao buscar snapshots de cartão:', legacy.error);
          if (!cancelled) setCardV2SnapshotByAccount(buildCreditCardSnapshotPlaceholderMap(creditAccountIds));
          return;
        }
        rowsOut = legacy.data;
      }

      if (cancelled) return;

      const sortedRows = [...(rowsOut || [])].sort((a: any, b: any) => {
        const dy = (Number(b.due_year) || 0) - (Number(a.due_year) || 0);
        if (dy !== 0) return dy;
        return (Number(b.due_month) || 0) - (Number(a.due_month) || 0);
      });

      const grouped = new Map<string, any[]>();
      sortedRows.forEach((row: any) => {
        const accountKey = row.account_id || cardIdToAccountId.get(row.card_id);
        if (!accountKey) return;
        const current = grouped.get(accountKey) || [];
        current.push(row);
        grouped.set(accountKey, current);
      });

      const snapshotMap = new Map<string, CreditCardMotorStatementSnap>();

      creditAccountIds.forEach((accountId) => {
        const rows = grouped.get(accountId) || [];
        if (rows.length === 0) {
          snapshotMap.set(accountId, {
            currentOpenAmount: 0,
            hasData: false,
            fetchCompleted: true,
          });
          return;
        }

        const openField = (r: any) =>
          Number((cardEngineEnabled ? r.open_balance ?? r.open_amount : r.open_amount) || 0);

        const currentStatement =
          rows.find((r) => r.status === 'open' || r.status === 'partial' || r.status === 'overdue') ||
          rows.find((r) => openField(r) > 0.009) ||
          rows[0];

        const displayTotal = cardEngineEnabled
          ? (() => {
              const EPS = 0.02;
              const statementNet = Math.max(Number(currentStatement?.statement_total ?? 0), 0);
              let amountDue = Math.max(
                Number(currentStatement?.open_balance ?? currentStatement?.open_amount ?? 0),
                0
              );
              if (statementNet > EPS && amountDue > statementNet + EPS) {
                amountDue = statementNet;
              }
              let out: number;
              if (amountDue <= EPS && statementNet > EPS) {
                out = 0;
              } else if (amountDue > EPS) {
                out = Math.min(amountDue, statementNet > EPS ? statementNet : amountDue);
              } else {
                out = statementNet;
              }
              return roundCurrency(out);
            })()
          : Math.max(Number(currentStatement?.open_amount || 0), 0);

        const faturaOpenRounded = roundCurrency(displayTotal);
        const account = creditAccounts.find((a) => a.id === accountId);
        const {
          transactions: txsNow,
          importLogs: logsNow,
          accounts: allAccountsNow,
        } = useAppStore.getState();
        const confs = paymentConfirmationsByAccount.get(accountId)?.map((c) => ({
          referenceMonth: c.referenceMonth,
          settledAmount: c.settledAmount,
          confirmedAt: c.confirmedAt,
        }));
        const mergedSnap = account
          ? mergeMotorSnapshotWithManualLedger({
              accountId,
              account,
              accounts: allAccountsNow,
              transactions: txsNow,
              importLogs: logsNow,
              userPaymentConfirmations: confs,
              snapshot: { currentOpenAmount: faturaOpenRounded, hasData: true },
            })
          : { currentOpenAmount: faturaOpenRounded, hasData: true };

        snapshotMap.set(accountId, {
          currentOpenAmount: mergedSnap.currentOpenAmount,
          hasData: mergedSnap.hasData,
          fetchCompleted: true,
        });
      });

      if (!cancelled) {
        setCardV2SnapshotByAccount(snapshotMap);
      }
    };

    loadCardV2Snapshots();
    return () => {
      cancelled = true;
    };
    // Não dependemos de `accounts` nem de `transactions`: o primeiro define os IDs via `creditCardAccountIdsKey`;
    // evita re-fetch quando o Zustand substitui o array com os mesmos cartões (ex.: ao voltar à aba Transações).
  }, [
    cardSnapshotPipelineEnabled,
    user?.id,
    creditCardAccountIdsKey,
    cardEngineEnabled,
    creditCardEngineRevision,
    paymentConfirmationsByAccount,
  ]);

  const renderBalanceAccountCard = useCallback(
    (account: Account) => {
      const bankConfig = NATIVE_BANK_CONFIGS.find((b) => b.id === account.bank_id);
      const paymentConfs = paymentConfirmationsByAccount.get(account.id)?.map((c) => ({
        referenceMonth: c.referenceMonth,
        settledAmount: c.settledAmount,
        confirmedAt: c.confirmedAt,
      }));
      const display = computeAccountCardDisplay(account, {
        transactions,
        accounts,
        importLogs,
        userPaymentConfirmations: paymentConfs,
        cardV2Snapshot: cardV2SnapshotByAccount.get(account.id),
        cardV2Enabled,
        cardEngineEnabled,
        cardSnapshotPipelineEnabled,
      });
      const isCredit = display.isCreditCard;
      return (
        <AccountBalanceCard
          key={account.id}
          account={account}
          bankConfig={bankConfig}
          display={display}
          onEdit={() => {
            setEditingAccount(account);
            setAccountModalOpen(true);
          }}
          onOpenHistory={
            isCredit ? () => void openMotorInvoiceHistoryModal(account) : undefined
          }
          onPayInvoice={
            isCredit && display.faturaAtual > 0
              ? () => handlePayInvoice(account, display.faturaAtual)
              : undefined
          }
        />
      );
    },
    [
      transactions,
      accounts,
      importLogs,
      paymentConfirmationsByAccount,
      cardV2SnapshotByAccount,
      cardV2Enabled,
      cardEngineEnabled,
      cardSnapshotPipelineEnabled,
      openMotorInvoiceHistoryModal,
      handlePayInvoice,
    ]
  );

  const accountsMap = useMemo(() => {
    const map = new Map<string, string>();
    accounts.forEach(acc => map.set(acc.id, acc.Nome_Conta));
    return map;
  }, [accounts]);

  const processDataForExport = (dataToExport: Transaction[]) => {
    return dataToExport.map(t => ({
      'Data': new Date(t.Data).toLocaleDateString('pt-BR'),
      'Descrição Personalizada (Usuário)': t.Nome_Fantasia || '',
      'Descrição Original (Banco)': t.Descricao_Original || '',
      'Categoria': t.Categoria || '',
      'Tipo': t.Tipo || '',
      'Valor': t.Valor,
      'Conta': accountsMap.get(t.ID_Conta) || 'N/A',
      'Parcelas': t.Parcela_Atual ? `${t.Parcela_Atual}/${t.Total_Parcelas || 1}` : '',
      'Tags': t.Tags ? t.Tags.join(', ') : '',
      'Observações': t.Observacoes || ''
    }));
  };

  const handleExportCSV = () => {
    const data = processDataForExport(filteredTransactions);
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `transacoes_filtradas_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportExcel = () => {
    const data = processDataForExport(filteredTransactions);
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Transações");
    XLSX.writeFile(workbook, `transacoes_filtradas_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleExportChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === 'csv') handleExportCSV();
    if (value === 'excel') handleExportExcel();
    // Reset select value
    e.target.value = '';
  };

  const filteredTransactions = useMemo(() => {
    let sortableItems = [...transactions];

    sortableItems.sort((a, b) => {
      const aValue = a[sortConfig.key as keyof Transaction];
      const bValue = b[sortConfig.key as keyof Transaction];

      if (aValue === undefined || aValue === null) return 1;
      if (bValue === undefined || bValue === null) return -1;

      let comparison = 0;
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        comparison = aValue - bValue;
      } else if (aValue instanceof Date && bValue instanceof Date) {
        comparison = aValue.getTime() - bValue.getTime();
      } else {
        comparison = String(aValue).localeCompare(String(bValue));
      }

      return sortConfig.direction === 'ascending' ? comparison : -comparison;
    });

    return sortableItems
      .filter(t => {
        // Adicionando +1 dia ao final para incluir o dia inteiro
        const transactionDate = new Date(t.Data).setHours(0, 0, 0, 0);
        const startDate = transactionFilters.startDate ? new Date(transactionFilters.startDate).getTime() : null;
        const endDate = transactionFilters.endDate ? new Date(new Date(transactionFilters.endDate).setDate(new Date(transactionFilters.endDate).getDate() + 1)).getTime() : null;

        const searchQuery = transactionFilters.text.trim().toLowerCase();
        const matchesText =
          searchQuery === '' ||
          (t.Nome_Fantasia || '').toLowerCase().includes(searchQuery) ||
          (t.Descricao_Original || '').toLowerCase().includes(searchQuery) ||
          t.Valor.toString().includes(transactionFilters.text) ||
          t.Valor.toFixed(2).includes(transactionFilters.text) ||
          t.Valor.toString().replace('.', ',').includes(transactionFilters.text) ||
          t.Valor.toFixed(2).replace('.', ',').includes(transactionFilters.text);

        return (
          matchesText &&
          (!startDate || transactionDate >= startDate) &&
          (!endDate || transactionDate < endDate) &&
          (transactionFilters.category.length === 0 || transactionFilters.category.includes(t.Categoria)) &&
          (transactionFilters.accountId.length === 0 || (t.ID_Conta && transactionFilters.accountId.includes(t.ID_Conta))) && // Filtro de Conta
          (transactionFilters.type === '' || t.Tipo === transactionFilters.type)
        );
      });
  }, [transactions, transactionFilters, sortConfig]);

  const paginatedTransactions = useMemo(() => {
    if (itemsPerPage === -1) return filteredTransactions; // -1 para "Todos"
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredTransactions.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredTransactions, currentPage, itemsPerPage]);

  const totalPages = useMemo(() => {
    if (itemsPerPage === -1) return 1;
    const total = Math.ceil(filteredTransactions.length / itemsPerPage);
    return total > 0 ? total : 1; // Garante que seja no mínimo 1
  }, [filteredTransactions.length, itemsPerPage]);

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setTransactionFilters({ ...transactionFilters, [e.target.name]: e.target.value });
    setCurrentPage(1); // Reseta para a primeira página ao mudar o filtro
  };

  const handleCategoryFilterChange = (selectedCategories: string[]) => {
    setTransactionFilters({ ...transactionFilters, category: selectedCategories });
    setCurrentPage(1);
  };

  const handleItemsPerPageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setItemsPerPage(Number(e.target.value));
    setCurrentPage(1); // Reset to first page
  };

  const handleAccountFilterChange = (selectedAccounts: string[]) => {
    setTransactionFilters({ ...transactionFilters, accountId: selectedAccounts });
    setCurrentPage(1);
  };

  const handleSaveCategory = async (categoryData: Omit<Category, 'id'>) => {
    const result = await addCategory(categoryData);
    if (result.status === 'created') {
      // Find the newly created category ID (or just use the name as we know it)
      setLastCreatedCategory(categoryData.Nome_Categoria);
      setCategoryModalOpen(false);
      await appAlert(result.message, 'Sucesso', 'success');
    } else {
      await appAlert(result.message, 'Sucesso', 'success');
    }
  };

  const handleSaveAccount = async (accountData: Omit<Account, 'id' | 'user_id'>) => {
    if (editingAccount) {
      await updateAccount({ id: editingAccount.id, ...accountData });
      setAccountModalOpen(false);
      setEditingAccount(null);
    } else {
      const newAccount = await addAccount(accountData);
      if (newAccount) {
        setLastCreatedAccount(newAccount.id);
        setAccountModalOpen(false);
        await appAlert(`Conta "${newAccount.Nome_Conta}" criada com sucesso!`, 'Sucesso', 'success');
      }
    }
  };

  const clearFilters = () => {
    setTransactionFilters({
      text: '',
      startDate: '',
      endDate: '',
      category: [],
      type: '',
      accountId: [],
    });
    setCurrentPage(1); // Reseta também ao limpar os filtros
  };

  const handleNewSave = async (newTransactions: Omit<Transaction, 'ID_Transacao' | 'Origem'>[]) => {
    try {
      const payloads = newTransactions.map((t) => ({
        Data: t.Data,
        ID_Conta: t.ID_Conta,
        Data_Pagamento: t.Data_Pagamento,
        Nome_Fantasia: t.Nome_Fantasia,
        Categoria: t.Categoria,
        Tipo: t.Tipo,
        Valor: t.Valor,
        Parcela_Atual: t.Parcela_Atual,
        Total_Parcelas: t.Total_Parcelas,
        Fonte: t.Fonte,
        Origem: 'manual' as const,
        Descricao_Original: t.Nome_Fantasia,
      }));
      await addTransaction(payloads.length === 1 ? payloads[0] : payloads);
      setNewTransactionModalOpen(false);
    } catch (err) {
      console.error('Erro ao salvar lançamento manual:', err);
      await appAlert(
        'Não foi possível salvar o lançamento. Tente novamente.',
        'Erro ao salvar',
        'error'
      );
    }
  };

  const openNewMappingRuleModal = (transaction: Transaction) => {
    // Apenas transações importadas podem gerar regras
    if (transaction.Origem !== 'manual') {
      setTransactionForRule(transaction);
      setMappingRuleModalOpen(true);
    }
  };

  const handleSaveMappingRule = (ruleData: Omit<MappingRule, 'id'>) => {
    addMappingRule(ruleData);
    setMappingRuleModalOpen(false);
    setTransactionForRule(null);
  };

  const requestSort = useCallback((key: keyof Transaction) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  }, [sortConfig]);

  const getSortIndicator = (key: string) => sortConfig.key === key ? (sortConfig.direction === 'ascending' ? ' ▲' : ' ▼') : null;

  const getValueColor = (value: number) => {
    if (value < 0) return 'text-danger';
    if (value > 0) return 'text-accent';
    return 'text-light';
  }

  const handleInlineUpdate = <K extends keyof Transaction>(
    transaction: Transaction,
    field: K,
    value: Transaction[K]
  ) => {
    // SOLUÇÃO FINAL:
    // Criamos um objeto que corresponde exatamente à assinatura da função no store:
    // um objeto que tem o ID_Transacao obrigatório e as outras propriedades atualizadas.
    const updatedTransaction = { ...transaction, [field]: value, ID_Transacao: transaction.ID_Transacao };
    updateTransaction(updatedTransaction);
  };

  // Campos que não podem ser editados em transações importadas
  const nonEditableImportedFields: (keyof Transaction)[] = ['Data', 'Valor', 'Parcela_Atual', 'Total_Parcelas', 'ID_Conta'];

  const formatDate = (date: Date | undefined) => date ? new Date(date).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—';

  const categoryTypeMap = useMemo(() =>
    new Map(categories.map(c => [c.Nome_Categoria, c.Tipo]))
    , [categories]);

  const categoryTypeColorMap: Record<Category['Tipo'], string> = { Renda: 'text-accent', Despesa: 'text-danger', Ambos: 'text-highlight' };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold text-light">Transações</h1>
          <TourButton currentView="transactions" />
        </div>
        <div id="transactions-actions" className="flex gap-2 w-full sm:w-auto">
          <div className="w-40">
            <Select value="" onChange={handleExportChange}>
              <option value="" disabled>Exportar...</option>
              <option value="csv">CSV</option>
              <option value="excel">Excel</option>
            </Select>
          </div>
          <Button onClick={() => setNewTransactionModalOpen(true)}>
            Adicionar Lançamento
          </Button>
        </div>
      </div>

      {accountsWithMissingBank.length > 0 && (
        <div className="bg-gradient-to-r from-highlight/20 to-accent/10 border border-highlight/30 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-highlight/20 p-2 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-highlight" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Identifique seus bancos</p>
              <p className="text-xs text-gray-400">Personalize seus cards com os logos oficiais para uma visualização mais rápida.</p>
            </div>
          </div>
          <button 
            onClick={() => {
              const firstAccount = accountsWithMissingBank[0];
              setEditingTransaction(null);
              setEditingAccount(firstAccount);
              setAccountModalOpen(true);
            }}
            className="px-4 py-1.5 bg-highlight hover:bg-highlight/80 text-white text-xs font-bold rounded-lg transition-all"
          >
            Configurar Agora
          </button>
        </div>
      )}

      <div id="transactions-filters">
        <Card title="Filtros" className="!overflow-visible z-40 relative">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 items-end">
            <Input label="Buscar por descrição ou valor" name="text" value={transactionFilters.text} onChange={handleFilterChange} placeholder="Ex: Shopee, iFood, 50,00… (nome ou descrição do banco)" className="xl:col-span-2" />
            <Input label="Data de Início" type="date" name="startDate" value={transactionFilters.startDate} onChange={handleFilterChange} />
            <Input label="Data de Fim" type="date" name="endDate" value={transactionFilters.endDate} onChange={handleFilterChange} />
            <div className="xl:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <MultiSelect
                label="Conta"
                options={accounts.map(a => ({ label: a.is_archived ? `${a.Nome_Conta} (Arquivada)` : a.Nome_Conta, value: a.id }))}
                value={transactionFilters.accountId}
                onChange={handleAccountFilterChange}
                placeholder="Todas"
              />
              <MultiSelect
                label="Categoria"
                options={[
                  { label: 'Sem Categoria (-)', value: '-' },
                  ...categories.map(c => ({ label: c.Nome_Categoria, value: c.Nome_Categoria }))
                ]}
                value={transactionFilters.category}
                onChange={handleCategoryFilterChange}
                placeholder="Todas"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 xl:col-span-2">
              <Select label="Tipo" name="type" value={transactionFilters.type} onChange={handleFilterChange}>
                <option value="">Todos</option>
                <option value="Renda">Entrada</option>
                <option value="Despesa">Saída</option>
              </Select>
              <div className="flex items-end">
                <Button variant="secondary" onClick={clearFilters} className="w-full">Limpar Filtros</Button>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div id="transactions-balances" className="space-y-8 mb-6">
        {regularBalanceAccounts.length > 0 && (
          <section aria-labelledby="accounts-regular-heading">
            <div className="flex items-center gap-3 mb-4">
              <h2
                id="accounts-regular-heading"
                className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 shrink-0"
              >
                Contas e cartões benefício
              </h2>
              <div className="flex-1 h-px bg-gradient-to-r from-white/10 to-transparent" />
              <span className="text-[10px] text-slate-600 font-bold tabular-nums">{regularBalanceAccounts.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {regularBalanceAccounts.map(renderBalanceAccountCard)}
            </div>
          </section>
        )}
        {creditBalanceAccounts.length > 0 && (
          <section aria-labelledby="accounts-credit-heading">
            <div className="flex items-center gap-3 mb-4">
              <h2
                id="accounts-credit-heading"
                className="text-[11px] font-black uppercase tracking-[0.2em] text-indigo-300/80 shrink-0"
              >
                Cartões de crédito
              </h2>
              <div className="flex-1 h-px bg-gradient-to-r from-indigo-500/20 to-transparent" />
              <span className="text-[10px] text-slate-600 font-bold tabular-nums">{creditBalanceAccounts.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 justify-items-start">
              {creditBalanceAccounts.map(renderBalanceAccountCard)}
            </div>
          </section>
        )}
      </div>
      <PaginationControls
        itemsPerPage={itemsPerPage}
        setItemsPerPage={setItemsPerPage}
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        totalPages={totalPages}
        totalRecords={filteredTransactions.length}
      />

      <div id="transactions-cards" className="block lg:hidden space-y-3 mb-6">

        {/* Mobile Sort Controls */}
        <div className="flex justify-between items-center bg-secondary p-3 rounded-lg border border-slate-700/50 mb-4 gap-2">
          <span className="text-sm text-gray-400 font-medium whitespace-nowrap">Ordenar por:</span>
          <div className="flex items-center gap-2 w-full justify-end">
            <select
              value={sortConfig.key}
              onChange={(e) => requestSort(e.target.value as keyof Transaction)}
              className="bg-primary/50 border border-slate-700 rounded text-white text-sm px-3 py-1.5 outline-none focus:border-highlight focus:ring-1 focus:ring-highlight appearance-none pr-8 cursor-pointer max-w-[170px]"
              style={{ backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '1em' }}
            >
              <option value="Data">Data da Compra</option>
              <option value="Data_Pagamento">Data Pagamento</option>
              <option value="Valor">Valor</option>
              <option value="Nome_Fantasia">Nome/Estabelec.</option>
              <option value="Categoria">Categoria</option>
            </select>
            <button
              onClick={() => setSortConfig(prev => ({ ...prev, direction: prev.direction === 'ascending' ? 'descending' : 'ascending' }))}
              className="p-1.5 bg-primary/50 border border-slate-700 rounded text-gray-400 hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 transform transition-transform ${sortConfig.direction === 'descending' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
              </svg>
            </button>
          </div>
        </div>

        {paginatedTransactions.map(t => (
          <SwipeableItem
            key={t.ID_Transacao}
            className="rounded-xl shadow-md border border-slate-700/50 bg-[#1e293b]" // The background beneath the swipe uses a neutral dark slate color to blend since both sides have different actions
            leftActions={[
              {
                label: 'Editar',
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                ),
                colorClass: 'bg-highlight',
                onClick: () => {
                  setEditingTransaction(t);
                  setNewTransactionModalOpen(true);
                }
              }
            ]}
            rightActions={[
              {
                label: 'Excluir',
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                ),
                colorClass: 'bg-red-500',
                onClick: async () => {
                  if (t.Origem === 'manual') {
                    if (await appConfirm('Excluir este lançamento manual?', 'Excluir Transação', 'Excluir', 'danger')) deleteTransaction(t.ID_Transacao);
                  } else {
                    const batchCount = transactions.filter(tx => tx.Origem === t.Origem).length;
                    setDeleteConfirmation({ transactionId: t.ID_Transacao, origin: t.Origem, count: batchCount });
                  }
                }
              }
            ]}
          >
            <div className="bg-secondary p-4 flex flex-col gap-3 relative overflow-hidden h-full">
              {/* Category Sidebar Accent */}
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${t.Tipo === 'Renda' ? 'bg-accent' : t.Tipo === 'Despesa' ? 'bg-danger' : 'bg-highlight'}`}></div>

              <div className="flex justify-between items-start pl-2 pr-6">
                <div className="flex flex-col gap-1 overflow-hidden pr-2">
                  <span className="font-semibold text-white truncate text-base leading-tight">
                    {t.Nome_Fantasia || t.Descricao || "Sem Nome"}
                  </span>
                  <span className="text-xs text-gray-400 truncate flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A1 1 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
                    {t.Categoria}
                  </span>
                  <span className="text-xs text-gray-500 truncate flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
                    {accountsMap.get(t.ID_Conta) || 'Conta Desconhecida'}
                  </span>
                </div>

                <div className="flex flex-col items-end z-10 shrink-0">
                  <span className={`font-bold text-lg leading-none ${getValueColor(t.Valor)}`}>
                    {formatCurrency(t.Valor)}
                  </span>
                  <div className="flex flex-col items-end gap-0.5 mt-1">
                    <span className="text-[9px] text-gray-500 uppercase font-medium tracking-wide">
                      Compra: {t.Data ? t.Data.split('T')[0].split('-').reverse().join('/') : '-'}
                    </span>
                    <span className="text-[9px] text-gray-500 uppercase font-medium tracking-wide">
                      Pgto: {t.Data_Pagamento ? t.Data_Pagamento.split('T')[0].split('-').reverse().join('/') : '-'}
                    </span>
                  </div>
                  {t.Total_Parcelas && t.Total_Parcelas > 1 && (
                    <span className="text-[9px] bg-slate-800 text-highlight px-1.5 py-0.5 rounded-full mt-1 border border-highlight/30">
                      {t.Parcela_Atual || 1}/{t.Total_Parcelas}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </SwipeableItem>
        ))}
        {isLoading && (
          <div className="flex flex-col gap-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}
        {!isLoading && paginatedTransactions.length === 0 && (
          <div className="bg-secondary p-8 rounded-xl text-center border border-slate-700/50">
            <p className="text-gray-400">Nenhuma transação encontrada.</p>
          </div>
        )}
      </div>

      <div id="transactions-table" className="hidden lg:block bg-secondary rounded-lg shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[800px] sm:min-w-full divide-y divide-primary table-fixed">
            <thead className="bg-slate-700">
              <tr>{[
                { key: 'Data', label: 'Data', width: 'w-24' },
                { key: 'Data_Pagamento', label: 'Pagamento', width: 'w-24' },
                { key: 'ID_Conta', label: 'Conta', width: 'w-28' },
                { key: 'Nome_Fantasia', label: 'Descrição', width: 'w-auto' },
                { key: 'Parcelas', label: 'Parc.', align: 'center', width: 'w-16' },
                { key: 'Categoria', label: 'Categoria', width: 'w-28' },
                { key: 'linked_asset_id', label: 'Vínculo', width: 'w-28' },
                { key: 'Valor', label: 'Valor', align: 'right', width: 'w-28' },
                { key: 'Acoes', label: 'Ações', align: 'right', width: 'w-20' },
              ].map(({ key, label, align, width }) => (
                <th key={key} scope="col" className={`px-2 py-3 text-${align || 'left'} text-xs font-medium text-gray-300 uppercase tracking-wider ${width}`}>
                  {key !== 'Acoes' && key !== 'Parcelas' && key !== 'ID_Conta' ? <button className={`w-full h-full flex items-center ${align === 'right' ? 'justify-end' : 'justify-start'}`} onClick={() => requestSort(key as keyof Transaction)}>
                    {label}{getSortIndicator(key)}
                  </button> : <span className={`flex ${align === 'right' ? 'justify-end' : (align === 'center' ? 'justify-center' : 'justify-start')}`}>{label}</span>}
                </th>
              ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-primary relative">
              {paginatedTransactions.map(t => (
                <tr key={t.ID_Transacao} className="hover:bg-primary">
                  <EditableCell key={`${t.ID_Transacao}-Data-${t.Data}`} transaction={t} field="Data" onUpdate={handleInlineUpdate} nonEditableFields={nonEditableImportedFields} type="date" className="w-24 text-xs" />
                  <EditableCell key={`${t.ID_Transacao}-Data_Pagamento-${t.Data_Pagamento}`} transaction={t} field="Data_Pagamento" onUpdate={handleInlineUpdate} nonEditableFields={nonEditableImportedFields} type="date" className="w-24 text-xs" />
                  <EditableCell key={`${t.ID_Transacao}-ID_Conta-${t.ID_Conta}`} transaction={t} field="ID_Conta" onUpdate={handleInlineUpdate} nonEditableFields={nonEditableImportedFields} type="select" options={accounts.filter(a => !a.is_archived || a.id === t.ID_Conta).map(a => a.id)} displayMap={accountsMap} className="w-28 text-xs truncate" />
                  <EditableCell key={`${t.ID_Transacao}-Nome_Fantasia-${t.Nome_Fantasia}`} transaction={t} field="Nome_Fantasia" onUpdate={handleInlineUpdate} nonEditableFields={nonEditableImportedFields} className="w-auto text-sm" onRuleCreation={openNewMappingRuleModal} />
                  <EditableCell key={`${t.ID_Transacao}-Parcela_Atual-${t.Parcela_Atual}`} transaction={t} field="Parcela_Atual" onUpdate={handleInlineUpdate} nonEditableFields={nonEditableImportedFields} type="installments" className="w-16 text-center text-xs" />
                  <EditableCell 
                    key={`${t.ID_Transacao}-Categoria-${t.Categoria}`} 
                    transaction={t} 
                    field="Categoria" 
                    onUpdate={handleInlineUpdate} 
                    nonEditableFields={nonEditableImportedFields} 
                    type="select" 
                    options={categories.filter(c => c.Tipo === 'Ambos' || c.Tipo === t.Tipo).map(c => c.Nome_Categoria).sort()} 
                    onOpenCreateCategory={() => setCategoryModalOpen(true)}
                    className="w-28 text-xs truncate" 
                  />
                  <EditableCell 
                        key={`${t.ID_Transacao}-linked_asset_id-${t.linked_asset_id}`} 
                        transaction={t} 
                        field="linked_asset_id" 
                        onUpdate={handleInlineUpdate} 
                        nonEditableFields={[]} 
                        type="select" 
                        options={assets.filter(a => a.is_financed).map(a => a.id)} 
                        displayMap={new Map(assets.map(a => [a.id, a.name] as [string, string]))}
                        className="w-28 text-[10px] truncate" 
                  />
                  <EditableCell key={`${t.ID_Transacao}-Valor-${t.Valor}`} transaction={t} field="Valor" onUpdate={handleInlineUpdate} nonEditableFields={nonEditableImportedFields} type="number" className="w-28 text-sm" />
                  <td className="px-2 py-4 whitespace-nowrap text-right text-sm font-medium w-20">
                    <div className="flex items-center justify-end gap-2">
                      {t.Origem === 'manual' && (
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                              setEditingTransaction(t);
                              setNewTransactionModalOpen(true);
                            }} 
                            className="text-accent hover:text-sky-400"
                            title="Editar Transação"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button 
                            onClick={async () => { if (await appConfirm('Tem certeza que deseja excluir este lançamento manual?', 'Excluir Transação', 'Excluir', 'danger')) deleteTransaction(t.ID_Transacao) }} 
                            className="text-danger hover:text-red-400"
                            title="Excluir Transação"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                      {t.Origem !== 'manual' && (
                        <button
                          onClick={() => {
                            const batchCount = transactions.filter(tx => tx.Origem === t.Origem).length;
                            setDeleteConfirmation({ transactionId: t.ID_Transacao, origin: t.Origem, count: batchCount });
                          }}
                          className="text-gray-500 hover:text-red-400"
                          title={`Excluir lote de importação: ${t.Origem}`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isLoading && (
            <div className="absolute inset-0 bg-primary/80 backdrop-blur-sm flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-slate-700 border-t-highlight rounded-full animate-spin"></div>
                <p className="text-sm text-highlight font-medium tracking-widest uppercase">Carregando...</p>
              </div>
            </div>
          )}
          {!isLoading && paginatedTransactions.length === 0 && (
            <p className="text-center text-gray-400 py-8">Nenhuma transação encontrada.</p>
          )}
        </div>
      </div>

      <div className="bg-slate-800 p-4 rounded-lg shadow-inner mb-4 flex flex-col sm:flex-row justify-between items-center gap-4 text-sm border border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-gray-400 uppercase tracking-wider font-semibold text-xs">Calculadora da Página</span>
          <span className="text-gray-600">|</span>
          <span className="text-gray-500 text-xs">Somando {paginatedTransactions.length} itens visíveis</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-[10px] text-gray-500 uppercase">Entradas</p>
            <p className="text-accent font-bold">
              {formatCurrency(paginatedTransactions.reduce((acc, t) => acc + (t.Valor > 0 ? t.Valor : 0), 0))}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-gray-500 uppercase">Saídas</p>
            <p className="text-danger font-bold">
              {formatCurrency(Math.abs(paginatedTransactions.reduce((acc, t) => acc + (t.Valor < 0 ? t.Valor : 0), 0)))}
            </p>
          </div>
          <div className="h-8 w-px bg-slate-600 mx-2"></div>
          <div className="text-right">
            <p className="text-[10px] text-gray-500 uppercase">Líquido (Sobra)</p>
            <p className={`font-bold text-lg ${getValueColor(paginatedTransactions.reduce((acc, t) => acc + t.Valor, 0))}`}>
              {formatCurrency(paginatedTransactions.reduce((acc, t) => acc + t.Valor, 0))}
            </p>
          </div>
        </div>
      </div>

      <PaginationControls
        itemsPerPage={itemsPerPage}
        setItemsPerPage={setItemsPerPage}
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        totalPages={totalPages}
        totalRecords={filteredTransactions.length}
      />

      {false && isStatementHistoryModalOpen && (
        <Modal
          isOpen={isStatementHistoryModalOpen}
          onClose={() => setStatementHistoryModalOpen(false)}
          title={`Histórico de Faturas${statementHistoryAccount ? ` - ${statementHistoryAccount.Nome_Conta}` : ''}`}
          className="max-w-4xl"
        >
          <div className="mb-3 space-y-2 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-sky-200">
                O histórico é montado automaticamente com base nas importações já feitas deste cartão.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-[11px] font-bold px-2 py-1 rounded border border-red-500/30 text-red-200 hover:bg-red-500/15 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={statementHistoryLoading || isSyncingHistory || !statementHistoryAccount}
                  onClick={handleResetCardHistoryRead}
                >
                  Resetar leitura
                </button>
                <button
                  type="button"
                  className="text-[11px] font-bold px-2 py-1 rounded border border-amber-500/30 text-amber-200 hover:bg-amber-500/15 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={statementHistoryLoading || isSyncingHistory || cardImportLots.length === 0}
                  onClick={() => setLotModalOpen(true)}
                >
                  Classificar lotes ({cardImportLots.filter((l) => !l.classified).length})
                </button>
                <button
                  type="button"
                  className="text-[11px] font-bold px-2 py-1 rounded border border-sky-500/30 text-sky-200 hover:bg-sky-500/15 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                  disabled={statementHistoryLoading || isSyncingHistory || !statementHistoryAccount}
                  onClick={handleSyncCardHistory}
                >
                  {isSyncingHistory && (
                    <span className="h-3 w-3 rounded-full border-2 border-sky-200/80 border-t-transparent animate-spin" />
                  )}
                  {isSyncingHistory ? 'Sincronizando...' : 'Sincronizar histórico'}
                </button>
              </div>
            </div>
            {isSyncingHistory && (
              <p className="text-[11px] text-sky-300/90 animate-pulse">
                Atualizando suas faturas agora. Isso pode levar alguns segundos.
              </p>
            )}
            {!isSyncingHistory && cardImportLots.filter((l) => !l.classified).length > 0 && (
              <p className="text-[11px] text-amber-300/90">
                Existem lotes pendentes de classificação. Para máxima precisão, classifique-os em DD/MM/AAAA.
              </p>
            )}
          </div>
          {statementHistoryLoading ? (
            <div className="py-10 text-center text-gray-400">
              <div className="inline-flex items-center gap-2">
                <span className="h-4 w-4 rounded-full border-2 border-gray-300/70 border-t-transparent animate-spin" />
                <span className="animate-pulse">Carregando histórico...</span>
              </div>
            </div>
          ) : statementHistoryError ? (
            <div className="py-6 text-center text-red-300">{statementHistoryError}</div>
          ) : statementHistoryRows.length === 0 ? (
            <div className="py-8 text-center text-gray-400">Nenhuma fatura encontrada para esta conta.</div>
          ) : (
            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
              {statementHistoryRows.map((statement, index, rows) => {
                const isExpanded = expandedStatementId === statement.id;
                const totalSourceFiles = statement.invoiceSourceFiles || [];
                const netInvoiceTotal = totalSourceFiles.length > 0
                  ? Number(statement.expectedChargesFromFiles || 0)
                  : Number(statement.total_charges || 0);
                const creditsForInvoice = totalSourceFiles.length > 0
                  ? Number(statement.expectedCreditsFromFiles || 0)
                  : Number(statement.total_credits || 0);
                // Regra funcional validada com o usuário:
                // - "Pagamento da Fatura Anterior" = pagamento oriundo dos mesmos arquivos do card.
                // - "Saldo aberto" = usa o pagamento que virá no próximo card (acima).
                const paymentPreviousDisplay = Number(statement.paymentFromOwnFiles || 0);
                const paymentFromNextCard = index > 0
                  ? Number(rows[index - 1]?.paymentFromOwnFiles || 0)
                  : 0;
                const totalSourceOrigin = totalSourceFiles.length > 0 ? totalSourceFiles.join(' | ') : 'Origem não identificada';
                const paymentSourceFiles = statement.paymentSourceFiles || [];
                const paymentSourceOrigin = paymentSourceFiles.length > 0 ? paymentSourceFiles.join(' | ') : 'Origem não identificada';
                const hasSourceInconsistency = paymentSourceFiles.some((origin) => !totalSourceFiles.includes(origin));
                const effectiveInvoiceTotal = Math.max(netInvoiceTotal - creditsForInvoice, 0);
                const derivedOpenRaw = Math.round((effectiveInvoiceTotal - paymentFromNextCard) * 100) / 100;
                const adjustmentDelta = Math.round((paymentFromNextCard - effectiveInvoiceTotal) * 100) / 100;
                const isSmallClosingAdjustment = index > 0 && Math.abs(adjustmentDelta) > 0 && Math.abs(adjustmentDelta) <= 1;
                const displayOpenAmount = index > 0
                  ? (isSmallClosingAdjustment ? 0 : Math.max(derivedOpenRaw, 0))
                  : Number(statement.open_amount || 0);
                const displayStatus: 'paid' | 'partial' | 'open' = index > 0
                  ? (displayOpenAmount <= 0
                    ? 'paid'
                    : paymentFromNextCard > 0
                      ? 'partial'
                      : 'open')
                  : (statement.status === 'paid' || statement.status === 'partial' || statement.status === 'open'
                    ? statement.status
                    : 'open');
                const statusColor =
                  displayStatus === 'paid'
                    ? 'text-emerald-300 bg-emerald-500/15 border-emerald-500/25'
                    : displayStatus === 'partial'
                      ? 'text-amber-300 bg-amber-500/15 border-amber-500/25'
                      : 'text-sky-300 bg-sky-500/15 border-sky-500/25';
                return (
                  <div key={statement.id} className="border border-slate-700 rounded-xl bg-slate-900/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-white font-semibold">
                          {formatStatementReferencePtBr(statement, statement.items, statementHistoryAccount)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${statusColor}`}>
                          {statusToPtBr(displayStatus)}
                        </span>
                        <button
                          type="button"
                          className="text-xs text-sky-300 hover:text-sky-200 font-bold"
                          onClick={() => setExpandedStatementId((prev) => (prev === statement.id ? null : statement.id))}
                        >
                          {isExpanded ? 'Ocultar itens' : 'Ver itens'}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-xs">
                      <div>
                        <p className="text-gray-500">Total da Fatura</p>
                        <p className="text-white font-semibold">{formatCurrency(netInvoiceTotal)}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Créditos</p>
                        <p className="text-emerald-300 font-semibold">{formatCurrency(Number(statement.total_credits || 0))}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 inline-flex items-center gap-1">
                          Pagamento da Fatura Anterior
                          <button
                            type="button"
                            className="text-[10px] text-gray-400 border border-slate-600 rounded-full w-3.5 h-3.5 inline-flex items-center justify-center leading-none hover:text-white hover:border-slate-400"
                            onClick={() => setPaymentInfoOpenFor((prev) => (prev === statement.id ? null : statement.id))}
                            aria-label="Mostrar explicação do pagamento da fatura anterior"
                          >
                            ?
                          </button>
                        </p>
                        {paymentInfoOpenFor === statement.id && (
                          <p className="mt-1 text-[11px] text-sky-200 bg-slate-900/80 border border-slate-700 rounded px-2 py-1 max-w-[320px]">
                            Esse valor representa o pagamento do Total da Fatura do card abaixo.
                          </p>
                        )}
                        <p className="text-amber-300 font-semibold">{formatCurrency(paymentPreviousDisplay)}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Saldo aberto</p>
                        <p className="text-rose-300 font-semibold">{formatCurrency(displayOpenAmount)}</p>
                      </div>
                    </div>
                    {isSmallClosingAdjustment && (
                      <p className="mt-2 text-[11px] text-amber-300">
                        Ajuste de fechamento do emissor: {formatCurrencySigned(adjustmentDelta, { showPlusForPositive: true })}.
                      </p>
                    )}
                    {statement.chargeDiffFromFiles !== 0 && (
                      <p className="mt-1 text-[11px] text-amber-300">
                        Auditoria de arquivos: diferença de {formatCurrency(Math.abs(statement.chargeDiffFromFiles))} no Total da Fatura
                        ({statement.chargeDiffFromFiles > 0 ? 'faltando no card' : 'excedente no card'}).
                      </p>
                    )}
                    <div className="mt-2 rounded border border-slate-700/70 bg-slate-900/40 px-2 py-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">Auditoria por lote</p>
                      <p className="text-[11px] text-gray-300">
                        Total da Fatura: <span className="text-sky-200">{totalSourceOrigin}</span>
                      </p>
                      <p className="text-[11px] text-gray-300">
                        Arquivo(s) da Fatura: <span className="text-sky-200">{totalSourceFiles.length > 0 ? totalSourceFiles.join(' | ') : 'Não identificado'}</span>
                      </p>
                      <p className="text-[11px] text-gray-300">
                        Pagamento da Fatura Anterior: <span className="text-amber-200">{paymentSourceOrigin}</span>
                      </p>
                      <p className="text-[11px] text-gray-300">
                        Arquivo(s) do Pagamento: <span className="text-amber-200">{paymentSourceFiles.length > 0 ? paymentSourceFiles.join(' | ') : 'Não identificado'}</span>
                      </p>
                      {hasSourceInconsistency && (
                        <p className="text-[11px] text-amber-300 mt-1">
                          Inconsistência confirmada: esta auditoria encontrou múltiplos arquivos vinculados no mesmo cálculo.
                        </p>
                      )}
                      {statement.unmatchedFileItems.length > 0 && (
                        <p className="text-[11px] text-amber-300 mt-1">
                          Itens do(s) arquivo(s) não vinculados ao card: {statement.unmatchedFileItems.length}.
                        </p>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="mt-3 border-t border-slate-800 pt-3">
                        {statement.items.length === 0 ? (
                          <p className="text-xs text-gray-500">Sem itens detalhados nesta fatura.</p>
                        ) : (
                          <div className="space-y-1">
                            {statement.unmatchedFileItems.length > 0 && (
                              <div className="mb-2 rounded border border-amber-500/20 bg-amber-500/5 px-2 py-2">
                                <p className="text-[11px] font-semibold text-amber-300 mb-1">
                                  Auditoria detalhada: itens do arquivo que não entraram neste card
                                </p>
                                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                                  {statement.unmatchedFileItems.slice(0, 30).map((item) => (
                                    <div key={`unmatched-${item.id}`} className="text-[11px] text-amber-100 flex items-center justify-between gap-2">
                                      <span className="truncate">
                                        {item.postedDate ? new Date(`${item.postedDate}T00:00:00`).toLocaleDateString('pt-BR') : '—'} • {item.description} • {item.sourceFile}
                                      </span>
                                      <span className="font-semibold whitespace-nowrap">{formatCurrency(item.amount)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {statement.items.map((item: any) => {
                              const isCreditItem = item.item_type === 'refund' || item.item_type === 'payment';
                              const typeColor = isCreditItem ? 'text-emerald-300' : 'text-rose-300';
                              const amountColor = isCreditItem ? 'text-emerald-300' : 'text-rose-300';
                              return (
                              <div key={item.id} className="flex items-center justify-between text-xs bg-slate-800/50 rounded px-2 py-1">
                                <div className="flex flex-col">
                                  <span className={`font-semibold ${typeColor}`}>{item.description || 'Sem descrição'}</span>
                                  <span className="text-[11px] text-gray-500">
                                    {item.posted_date ? new Date(`${item.posted_date}T00:00:00`).toLocaleDateString('pt-BR') : '—'} • {itemTypeToPtBr(item.item_type)}
                                  </span>
                                </div>
                                <span className={`font-semibold ${amountColor}`}>{formatCurrency(Number(item.amount || 0))}</span>
                              </div>
                            )})}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}

      {false && isLotModalOpen && statementHistoryAccount && (
        <Modal
          isOpen={isLotModalOpen}
          onClose={() => { if (!isSavingLot) { setLotModalOpen(false); setSelectedLot(null); } }}
          title={`Classificar Lotes - ${statementHistoryAccount.Nome_Conta}`}
          className="max-w-3xl"
          footer={
            selectedLot ? (
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setSelectedLot(null)} disabled={isSavingLot}>
                  Voltar
                </Button>
                <Button onClick={handleSaveLotClassification} disabled={isSavingLot || !lotReferenceMonth || !lotDueDate}>
                  {isSavingLot ? 'Salvando...' : 'Salvar classificação'}
                </Button>
              </div>
            ) : null
          }
        >
          {!selectedLot ? (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {cardImportLots.length === 0 ? (
                <p className="text-sm text-gray-400">Nenhum lote encontrado para classificação.</p>
              ) : (
                cardImportLots.map((lot) => (
                  <div key={lot.originKey} className="rounded-lg border border-slate-700 bg-slate-900/40 p-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{lot.origin}</p>
                      <p className="text-xs text-gray-400">
                        Competência: {lot.referenceLabel || '—'} • Vencimento: {lot.dueDate ? new Date(`${lot.dueDate}T00:00:00`).toLocaleDateString('pt-BR') : '—'} • Itens: {lot.count}
                      </p>
                      {lot.origins.length > 1 && (
                        <p className="text-[11px] text-gray-500">
                          Variações de origem consolidadas: {lot.origins.length}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      className={`text-xs font-bold px-2 py-1 rounded border ${lot.classified
                        ? 'border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/10'
                        : 'border-amber-500/30 text-amber-200 hover:bg-amber-500/10'
                        }`}
                      onClick={() => openLotClassification(lot)}
                    >
                      {lot.classified ? 'Revisar' : 'Classificar'}
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                <p className="text-sm text-white font-semibold">{selectedLot.origin}</p>
                <p className="text-xs text-gray-400">Preencha os dados do lote no padrão brasileiro (DD/MM/AAAA).</p>
              </div>
              <Input
                label="Mês de referência da fatura"
                type="month"
                value={lotReferenceMonth}
                onChange={(e) => setLotReferenceMonth(e.target.value)}
                helpText="Exibido como competência da fatura (MM/AAAA)."
              />
              <Input
                label="Data de vencimento"
                type="date"
                value={lotDueDate}
                onChange={(e) => setLotDueDate(e.target.value)}
                helpText="Será exibida no histórico como DD/MM/AAAA."
              />
              <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                <p className="text-sm font-semibold text-white mb-2">Classificação manual dos lançamentos deste lote</p>
                <p className="text-xs text-gray-400 mb-3">
                  Classifique somente as entradas do cartão. Use Pagamento de Fatura ou Estorno/Reembolso.
                </p>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {lotTransactionRows.length === 0 ? (
                    <p className="text-xs text-gray-500">Nenhuma entrada identificada neste lote para classificação manual.</p>
                  ) : (
                    lotTransactionRows.map((row, idx) => (
                      <div key={row.id} className="grid grid-cols-12 gap-2 items-center text-xs bg-slate-800/60 rounded px-2 py-1.5">
                        <div className="col-span-3 text-gray-300">{row.date ? new Date(`${row.date}T00:00:00`).toLocaleDateString('pt-BR') : '—'}</div>
                        <div className="col-span-5 text-gray-100 truncate">{row.description}</div>
                        <div className={`col-span-2 font-semibold ${row.amount < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                          {formatCurrency(Math.abs(row.amount))}
                        </div>
                        <div className="col-span-2">
                          <Select
                            value={row.selectedType === 'refund' ? 'refund' : 'payment'}
                            onChange={(e) => {
                              const nextType = e.target.value as 'payment' | 'refund';
                              setLotTransactionRows((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, selectedType: nextType } : item))
                              );
                            }}
                          >
                            <option value="payment">Pagamento de Fatura</option>
                            <option value="refund">Estorno/Reembolso</option>
                          </Select>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}

      {false && isClassifierModalOpen && (
        <Modal
          isOpen={isClassifierModalOpen}
          onClose={() => { if (!isSavingClassifier) setClassifierModalOpen(false); }}
          title="Classificação de Lançamentos"
          className="max-w-3xl"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setClassifierModalOpen(false)} disabled={isSavingClassifier}>
                Cancelar
              </Button>
              <Button onClick={handleSaveClassifierRules} disabled={isSavingClassifier}>
                {isSavingClassifier ? 'Salvando...' : 'Salvar regras'}
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-gray-300">
              Defina os termos que identificam automaticamente o que é pagamento da fatura anterior e o que é crédito/estorno.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                <p className="text-sm font-semibold text-white mb-2">Termos de pagamento da fatura anterior</p>
                <textarea
                  value={paymentKeywordsInput}
                  onChange={(e) => setPaymentKeywordsInput(e.target.value)}
                  rows={7}
                  className="w-full rounded bg-slate-950/70 border border-slate-700 px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Um termo por linha (ex.: pagamentos válidos normais)"
                />
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                <p className="text-sm font-semibold text-white mb-2">Termos de crédito/estorno</p>
                <textarea
                  value={creditKeywordsInput}
                  onChange={(e) => setCreditKeywordsInput(e.target.value)}
                  rows={7}
                  className="w-full rounded bg-slate-950/70 border border-slate-700 px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Um termo por linha (ex.: estorno)"
                />
              </div>
            </div>

            <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-200 mb-2">
                Preview de impacto (1-2 faturas)
              </p>
              {classifierPreview.length === 0 ? (
                <p className="text-xs text-gray-400">Abra o histórico de um cartão para visualizar o impacto antes de sincronizar.</p>
              ) : (
                <div className="space-y-2">
                  {classifierPreview.map((row) => (
                    <div key={row.statementId} className="text-xs text-gray-200 rounded border border-slate-700/70 bg-slate-900/40 px-2 py-1.5">
                      <p className="font-semibold text-white">{row.label}</p>
                      <p>
                        Reclassificações potenciais: <span className="text-amber-300 font-semibold">{row.changed}</span> de {row.total} lançamento(s).
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-[11px] text-amber-300">
              Após salvar, clique em "Sincronizar histórico" para recalcular as faturas com as novas regras.
            </p>
          </div>
        </Modal>
      )}

      {isNewTransactionModalOpen && (
        <NewTransactionModal
          onClose={() => {
            setNewTransactionModalOpen(false);
            setEditingTransaction(null);
            setPredefinedTransaction(null);
          }}
          onSave={async (newTransactions) => {
            if (editingTransaction) {
              // It's an update. We expect only one item in data[0]
              await updateTransaction({ ID_Transacao: editingTransaction.ID_Transacao, ...newTransactions[0] });
            } else {
              // It's a new transaction (or batch)
              await handleNewSave(newTransactions);
            }
            setNewTransactionModalOpen(false);
            setEditingTransaction(null);
            setPredefinedTransaction(null);
          }}
          accounts={accounts.filter(a => !a.is_archived)}
          categories={categories}
          assets={assets}
          onOpenCreateAccount={() => setAccountModalOpen(true)}
          onOpenCreateCategory={() => setCategoryModalOpen(true)}
          lastCreatedAccount={lastCreatedAccount}
          lastCreatedCategory={lastCreatedCategory}
          transaction={predefinedTransaction || editingTransaction}
          onPayCreditCardInvoice={(account, suggestedAmount) => {
            setNewTransactionModalOpen(false);
            setEditingTransaction(null);
            setPredefinedTransaction(null);
            handlePayInvoice(account, suggestedAmount);
          }}
          loadCompetenceCards={loadImportHistoryCompetenceCards}
          cardPaymentKeywords={currentPaymentKeywords}
          cardCreditKeywords={currentCreditKeywords}
        />
      )}

      {isAccountModalOpen && (
        <AccountModal
          account={editingAccount}
          onClose={() => {
            setAccountModalOpen(false);
            setEditingAccount(null);
          }}
          onSave={handleSaveAccount}
        />
      )}

      {isCategoryModalOpen && (
        <CategoryModal
          category={null}
          onClose={() => setCategoryModalOpen(false)}
          onSave={handleSaveCategory}
        />
      )}

      <CreditCardInvoiceCyclesModal
        isOpen={creditInvoiceCyclesAccountId !== null}
        onClose={() => setCreditInvoiceCyclesAccountId(null)}
        filterAccountId={creditInvoiceCyclesAccountId}
      />

      <Modal
        isOpen={motorInvoiceHistoryOpen}
        onClose={() => {
          setMotorInvoiceHistoryOpen(false);
          setMotorInvoiceHistoryAccount(null);
          setMotorInvoiceCompetenceCards([]);
          setMotorInvoiceError(null);
        }}
        title={`Histórico de faturas${motorInvoiceHistoryAccount ? ` — ${motorInvoiceHistoryAccount.Nome_Conta}` : ''}`}
        className="max-w-lg"
      >
        <p className="text-xs text-gray-400 mb-3 leading-relaxed">
          Cada card é uma <span className="text-gray-300 font-medium">competência</span> (mês da fatura). Mostramos{' '}
          <span className="text-gray-300 font-medium">compras</span>, <span className="text-gray-300 font-medium">estornos</span>{' '}
          e o <span className="text-gray-300 font-medium">total líquido</span>, por extrato importado e por lançamentos manuais.
          Pagamentos do extrato aparecem no detalhe da fonte; para abater esta fatura use{' '}
          <span className="text-gray-300 font-medium">Pagar fatura</span> ou confirme saldo residual.
          Cada extrato CSV com competência configurada vira um card; use{' '}
          <span className="text-gray-300 font-medium">Ajustar competências por arquivo</span> se faltar algum mês.
        </p>
        {motorInvoiceHistoryAccount && showAdjustCompetenceByFile ? (
          <div className="mb-4">
            <Button
              type="button"
              variant="outline"
              className="w-full text-xs"
              onClick={() => setCreditInvoiceCyclesAccountId(motorInvoiceHistoryAccount.id)}
            >
              Ajustar competências por arquivo
            </Button>
            {!cardEngineEnabled ? (
              <p className="text-[10px] text-gray-500 mt-1.5 leading-relaxed">
                Define o mês de cada extrato no histórico (competência e vencimento). Necessário quando o import não
                gravou competência automaticamente.
              </p>
            ) : null}
          </div>
        ) : null}
        {motorInvoiceError ? (
          <div className="py-6 text-center text-red-300 text-sm">{motorInvoiceError}</div>
        ) : motorInvoiceLoading && motorInvoiceCompetenceCards.length === 0 ? (
          <div className="py-10 flex items-center justify-center gap-2 text-gray-400">
            <span className="h-4 w-4 rounded-full border-2 border-gray-400/70 border-t-transparent animate-spin" />
            <span>Carregando faturas…</span>
          </div>
        ) : motorInvoiceCompetenceCards.length === 0 ? (
          <div className="py-8 text-center text-gray-400 text-sm">
            Nenhuma fatura encontrada para este cartão. Importe um extrato, lance compras manualmente (com data de
            pagamento/vencimento) ou ajuste competências por arquivo.
          </div>
        ) : (
          <div className="relative">
            {motorInvoiceLoading ? (
              <div
                className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-[#0d0d12]/80 backdrop-blur-[1px]"
                role="status"
                aria-live="polite"
                aria-busy="true"
              >
                <span className="h-5 w-5 rounded-full border-2 border-violet-400/80 border-t-transparent animate-spin" />
                <span className="text-xs text-gray-300">Atualizando histórico…</span>
              </div>
            ) : null}
            <ul className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {motorInvoiceCompetenceCards.map((card) => (
              <li
                key={card.referenceMonth}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 flex flex-col gap-1"
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[9px] text-gray-500 uppercase font-semibold tracking-wide">Competência</span>
                    <span className="text-sm font-bold text-white leading-tight tabular-nums">
                      {card.competenceBR}
                    </span>
                    <span className="text-[10px] text-gray-500 tabular-nums">Venc.: {card.vencimentoBR}</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 shrink-0">
                    {competenceCardStatusLabel(card)}
                  </span>
                </div>
                {(card.totalRefunds > 0.005 ||
                  card.totalDebits > card.statementTotal + 0.005 ||
                  (card.directedManualRefundTotal ?? 0) > 0.005) && (
                  <div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2 space-y-1">
                    <p className="text-[9px] text-gray-500 uppercase font-semibold tracking-wide">
                      Composição da fatura
                    </p>
                    {card.totalDebits > 0.005 ? (
                      <div className="flex justify-between items-baseline gap-2 text-[11px]">
                        <span className="text-gray-400">Compras e encargos</span>
                        <span className="text-gray-200 tabular-nums font-medium">
                          {formatCurrency(card.totalDebits)}
                        </span>
                      </div>
                    ) : null}
                    {card.totalRefunds > 0.005 ? (
                      <div className="flex justify-between items-baseline gap-2 text-[11px]">
                        <span className="text-gray-400">Estornos e créditos</span>
                        <span className="text-emerald-300/95 tabular-nums font-medium">
                          − {formatCurrency(card.totalRefunds)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                )}
                {(card.directedManualRefundTotal ?? 0) > 0.005 ? (
                  <p className="text-[10px] text-violet-200/90 leading-snug rounded-lg border border-violet-500/25 bg-violet-500/10 px-2.5 py-2">
                    <span className="font-semibold text-violet-100">Estorno manual</span> de{' '}
                    <span className="tabular-nums font-semibold text-violet-50">
                      {formatCurrency(card.directedManualRefundTotal ?? 0)}
                    </span>{' '}
                    nesta competência — já descontado do total da fatura (não consta no extrato importado).
                  </p>
                ) : null}
                <div className="flex justify-between items-baseline gap-2 flex-wrap">
                  <span className="text-[10px] text-gray-500 uppercase font-semibold">Total da fatura</span>
                  <span className="text-base font-black text-rose-300 tabular-nums">
                    {formatCurrency(card.statementTotal)}
                  </span>
                </div>
                <div className="flex justify-between items-baseline gap-2 flex-wrap border-t border-white/5 pt-1.5 mt-0.5">
                  <span className="text-[10px] text-gray-500 uppercase font-semibold">Pagamentos</span>
                  <span className="text-sm font-bold text-emerald-400/90 tabular-nums">
                    {formatCurrency(card.totalPayments)}
                  </span>
                </div>
                {(card.paymentsOnExtracts ?? 0) > 0.005 ? (
                  <p className="text-[10px] text-gray-500 leading-snug -mt-0.5">
                    No extrato:{' '}
                    <span className="tabular-nums text-gray-400">
                      {formatCurrency(card.paymentsOnExtracts ?? 0)}
                    </span>{' '}
                    em linha de pagamento de fatura (informativo; não abate automaticamente o saldo acima).
                  </p>
                ) : null}
                <div className="flex justify-between items-baseline gap-2 flex-wrap">
                  <span className="text-[10px] text-gray-500 uppercase font-semibold">Saldo em aberto</span>
                  <span
                    className={`text-sm font-bold tabular-nums ${
                      card.openBalance <= 0.005 ? 'text-gray-400' : 'text-amber-300'
                    }`}
                  >
                    {formatCurrency(card.openBalance)}
                  </span>
                </div>
                {card.openBalance > 0.005 && !card.userConfirmedPaid ? (
                  <div className="mt-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 space-y-2">
                    <p className="text-[10px] text-amber-100/95 leading-snug">
                      O fechamento automático pode não refletir o banco neste valor residual (
                      <span className="tabular-nums font-semibold">{formatCurrency(card.openBalance)}</span>
                      ). Esse saldo já foi quitado na fatura (ajuste, crédito ou arredondamento)?
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        className="text-[10px] py-1 px-2 h-auto"
                        onClick={() => handleConfirmCompetenceResidualPaid(card)}
                      >
                        Sim, está pago
                      </Button>
                    </div>
                  </div>
                ) : null}
                {card.userConfirmedPaid && (card.userConfirmedAmount ?? 0) > 0.005 ? (
                  <p className="text-[10px] text-emerald-200/90 leading-snug">
                    Você confirmou que{' '}
                    <span className="tabular-nums font-semibold text-emerald-100">
                      {formatCurrency(card.userConfirmedAmount ?? 0)}
                    </span>{' '}
                    já estava quitado no banco
                    {card.userConfirmedAt
                      ? ` (${new Date(card.userConfirmedAt).toLocaleDateString('pt-BR')})`
                      : ''}
                    .{' '}
                    <button
                      type="button"
                      className="underline text-emerald-300/90 hover:text-emerald-200"
                      onClick={() => handleUndoCompetenceResidualPaid(card)}
                    >
                      Desfazer
                    </button>
                  </p>
                ) : null}
                {card.priorCreditApplied > 0.005 ? (
                  <p className="text-[10px] text-violet-200/85 leading-snug">
                    Abatimento automático com crédito da competência anterior:{' '}
                    <span className="tabular-nums font-semibold text-violet-100">
                      {formatCurrency(card.priorCreditApplied)}
                    </span>
                    {card.openBalanceBeforeCarry > card.openBalance + 0.005 ? (
                      <>
                        {' '}
                        (saldo antes do abatimento:{' '}
                        <span className="tabular-nums">{formatCurrency(card.openBalanceBeforeCarry)}</span>)
                      </>
                    ) : null}
                  </p>
                ) : null}
                {card.creditCarriedForward > 0.005 ? (
                  <p className="text-[10px] text-emerald-200/80 leading-snug">
                    Crédito remanescente para competências seguintes:{' '}
                    <span className="tabular-nums font-semibold text-emerald-100">
                      {formatCurrency(card.creditCarriedForward)}
                    </span>
                  </p>
                ) : null}
                {card.files.length === 0 && card.totalPayments > 0.005 ? (
                  <p className="text-[10px] text-gray-500 leading-snug">
                    Pagamento vindo do extrato do mês seguinte (competência anterior). Sem CSV neste mês, não há
                    total de fatura para calcular crédito — o valor não é repassado automaticamente.
                  </p>
                ) : null}
                {card.files.length > 0 ? (
                  <details className="mt-1 text-[10px] text-gray-500" open={card.files.length <= 2}>
                    <summary className="cursor-pointer hover:text-gray-400">
                      {card.files.length === 1 ? 'Detalhe da fonte' : `${card.files.length} fontes nesta competência`}
                    </summary>
                    <ul className="mt-1.5 space-y-1.5 pl-1 border-l border-white/10">
                      {card.files.map((f) => (
                        <li key={f.fileName} className="pl-2">
                          <span
                            className={`break-all font-medium ${
                              f.fileName === MANUAL_COMPETENCE_FILE_LABEL
                                ? 'text-violet-300/90'
                                : 'text-gray-400'
                            }`}
                          >
                            {f.fileName === MANUAL_COMPETENCE_FILE_LABEL ? 'Lançamentos manuais' : f.fileName}
                          </span>
                          <p className="text-gray-600 leading-snug mt-0.5">{formatHistoryFileAudit(f)}</p>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                <p className="text-[9px] text-gray-600 leading-snug">
                  Total = compras − estornos; pagamentos abatem saldo (extrato pode quitarem competência anterior).
                </p>
              </li>
            ))}
            </ul>
          </div>
        )}
      </Modal>

      {payInvoiceModal.open && payInvoiceModal.loading && payInvoiceModal.account && (
        <Modal isOpen={true} onClose={closePayInvoiceModal} title="Pagar fatura do cartão" className="max-w-lg">
          <p className="text-sm text-gray-400 text-center py-6">Carregando faturas em aberto…</p>
        </Modal>
      )}

      <PayCreditCardInvoiceModal
        isOpen={payInvoiceModal.open && !payInvoiceModal.loading && !!payInvoiceModal.account}
        account={payInvoiceModal.account}
        competenceCards={payInvoiceModal.competenceCards}
        categories={categories}
        savedPaymentCategory={
          typeof user?.user_metadata?.creditCardPaymentCategory === 'string'
            ? user.user_metadata.creditCardPaymentCategory
            : null
        }
        lastCreatedCategory={lastCreatedCategory}
        initialAmount={payInvoiceModal.suggestedAmount}
        onClose={closePayInvoiceModal}
        onOpenCreateCategory={() => setCategoryModalOpen(true)}
        onSubmit={submitPayCreditCardInvoice}
      />

      {deleteConfirmation && (
        <Modal
          isOpen={true}
          onClose={() => setDeleteConfirmation(null)}
          title="Confirmar Exclusão"
          className="max-w-lg"
        >
          <div className="space-y-4">
            <p className="text-gray-300">Você está tentando excluir uma transação que faz parte de um lote importado. O que você gostaria de fazer?</p>
            <div className="flex flex-col space-y-2">
              <Button variant="secondary" onClick={() => { deleteTransaction(deleteConfirmation.transactionId); setDeleteConfirmation(null); }}>
                Excluir Apenas Esta Transação
              </Button>
              <Button variant="danger" onClick={() => { deleteTransactionsByOrigin(deleteConfirmation.origin); setDeleteConfirmation(null); }}>
                Excluir o Lote Inteiro ({deleteConfirmation.count} transações de "{deleteConfirmation.origin}")
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {isMappingRuleModalOpen && transactionForRule && (
        <MappingRuleModal
          transaction={transactionForRule}
          categories={categories}
          assets={assets}
          onClose={() => { setMappingRuleModalOpen(false); setTransactionForRule(null); }}
          onSave={handleSaveMappingRule}
        />
      )}

      {/* Mobile Floating Action Button (FAB) relative to the screen */}
      <button
        onClick={() => {
          setEditingTransaction(null);
          setPredefinedTransaction(null);
          setNewTransactionModalOpen(true);
        }}
        className="fixed lg:hidden bottom-24 landscape:max-lg:bottom-10 right-6 sm:right-10 w-14 h-14 bg-highlight hover:bg-sky-400 text-white rounded-full shadow-[0_4px_14px_rgba(56,189,248,0.5)] flex items-center justify-center transition-transform active:scale-95 z-40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-primary focus:ring-highlight"
        aria-label="Nova Transação"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
  );
};

// Componente para Célula Editável
interface EditableCellProps {
  transaction: Transaction;
  field: keyof Transaction;
  onUpdate: (transaction: Transaction, field: keyof Transaction, value: any) => void;
  nonEditableFields: (keyof Transaction)[];
  type?: 'text' | 'date' | 'select' | 'number' | 'installments';
  options?: string[];
  displayMap?: Map<string, string>; // Mapa para exibir nomes em vez de IDs
  className?: string;
  onRuleCreation?: (transaction: Transaction) => void;
  onOpenCreateCategory?: () => void;
}
const EditableCell: React.FC<EditableCellProps> = ({
  transaction,
  field,
  onUpdate,
  nonEditableFields,
  type = 'text',
  options = [],
  displayMap,
  className = '',
  onRuleCreation,
  onOpenCreateCategory
}) => {
  const { categories } = useAppStore();
  const [isEditing, setIsEditing] = useState(false);
  const initialValue = transaction[field];
  const [value, setValue] = useState(initialValue);

  // Sync local state with prop changes
  useEffect(() => {
    // console.log(`EditableCell useEffect [${field}]:`, transaction[field]);
    setValue(transaction[field]);
  }, [transaction, field]);

  // Regras de edição
  const isEditable = field !== 'Fonte' && (transaction.Origem === 'manual' || !nonEditableFields.includes(field));

  const categoryTypeMap = useMemo(() => new Map(categories.map(c => [c.Nome_Categoria, c.Tipo])), [categories]);
  const categoryTypeColorMap: Record<Category['Tipo'], string> = { Renda: 'text-accent', Despesa: 'text-danger', Ambos: 'text-highlight' };

  const handleSave = () => {
    if (value === initialValue) {
      setIsEditing(false);
      return;
    }

    if (type === 'installments') {
      const parts = (value as string).split('/');
      const current = parseInt(parts[0], 10) || undefined;
      const total = parseInt(parts[1], 10) || undefined;
      if (current !== transaction.Parcela_Atual) onUpdate(transaction, 'Parcela_Atual', current);
      if (total !== transaction.Total_Parcelas) onUpdate(transaction, 'Total_Parcelas', total);
    } else if (type === 'date' && (field === 'Data' || field === 'Data_Pagamento')) {
      const newValue = value ? new Date(value as string) : undefined;
      onUpdate(transaction, field, newValue);
    } else if (type === 'number' && field === 'Valor') {
      const newValue = parseFloat(value as string || '0');
      onUpdate(transaction, field, newValue);
    } else if (field === 'Nome_Fantasia' || field === 'Categoria' || field === 'ID_Conta' || field === 'linked_asset_id') {
      onUpdate(transaction, field, value as string);
    }

    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setValue(initialValue);
      setIsEditing(false);
    }
  };

  const cellContent = () => {
    if (displayMap && value) {
      return displayMap.get(value as string) || String(value);
    }
    if (type === 'date') return new Date(value as Date).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    if (type === 'number') return formatCurrency(value as number);
    if (type === 'installments') return `${transaction.Parcela_Atual || 1}/${transaction.Total_Parcelas || 1}`;
    return String(value || '-');
  };

  const getValueColor = (val: number) => {
    if (val < 0) return 'text-danger';
    if (val > 0) return 'text-accent';
    return 'text-light';
  }

  if (!isEditable) {
    const isValueColumn = field === 'Valor';
    const valueColor = isValueColumn ? getValueColor(transaction.Valor) : (field === 'Parcela_Atual' ? 'text-light' : 'text-gray-400');
    const align = isValueColumn ? 'text-right' : 'text-left';
    // Usa break-word para quebrar entre palavras, não no meio delas.
    const whitespaceClass = (field === 'Nome_Fantasia' || field === 'Categoria') ? 'whitespace-normal break-word' : 'whitespace-nowrap';
    return <td className={`px-2 py-3 text-sm font-semibold border-r border-slate-800 last:border-r-0 ${valueColor} ${align} ${whitespaceClass} ${className}`}>{cellContent()}</td>;
  }

  if (isEditing) {
    if (type === 'select') {
      return (
        <td className="p-0 border-r border-slate-800 last:border-r-0">
          <Select 
            value={value as string} 
            onChange={e => {
              if (e.target.value === 'ADD_NEW_CATEGORY') {
                onOpenCreateCategory?.();
                setIsEditing(false);
              } else {
                setValue(e.target.value);
              }
            }} 
            onBlur={handleSave} 
            onKeyDown={handleKeyDown} 
            autoFocus 
            className="w-full h-full bg-slate-800 border-highlight !rounded-none"
          >
            <option value="">-</option>
            {options
              .filter(opt => opt !== '' && opt !== '-')
              .map(opt => <option key={opt} value={opt}>{displayMap ? displayMap.get(opt) : opt}</option>)
            }
            {field === 'Categoria' && (
              <option value="ADD_NEW_CATEGORY" className="text-highlight font-bold">+ Adicionar Categoria</option>
            )}
          </Select>
        </td>
      );
    }
    // Correção: Garante que 'value' é uma data válida antes de chamar toISOString()
    const dateValue = value ? new Date(value as Date) : null;
    const inputValue = type === 'date' && dateValue && !isNaN(dateValue.getTime()) ? dateValue.toISOString().split('T')[0]
      : type === 'installments' ? `${transaction.Parcela_Atual || ''}/${transaction.Total_Parcelas || ''}`
        : value as string;

    return <td className="p-0 border-r border-slate-800 last:border-r-0"><Input type={type === 'date' ? 'date' : 'text'} value={inputValue} onChange={e => setValue(e.target.value)} onBlur={handleSave} onKeyDown={handleKeyDown} autoFocus className="w-full h-full bg-slate-800 border-highlight !rounded-none text-center" /></td>;
  }

  const categoryColor = field === 'Categoria' && categoryTypeMap.has(value as string) ? categoryTypeColorMap[categoryTypeMap.get(value as string)!] : '';
  const valueColor = field === 'Valor' ? getValueColor(value as number) : '';
  const align = field === 'Valor' ? 'text-right' : (field === 'Parcela_Atual' ? 'text-center' : 'text-left');

  return (
    <td
      className="p-0 cursor-pointer border-r border-slate-800 last:border-r-0"
      onClick={() => setIsEditing(true)}
    >
      <div
        className={`relative group px-2 py-3 text-sm font-semibold border-b border-dotted ${isEditable ? 'border-slate-600 hover:border-highlight' : 'border-transparent'} ${align} ${categoryColor} ${valueColor} ${className} ${(field === 'Nome_Fantasia' || field === 'Categoria') ? 'whitespace-normal break-word' : 'whitespace-nowrap'}`}
        title={
          field === 'Nome_Fantasia' &&
          transaction.Descricao_Original &&
          transaction.Descricao_Original.trim() !== (transaction.Nome_Fantasia || '').trim()
            ? `Original (banco): ${transaction.Descricao_Original}`
            : undefined
        }
      >
        <span>{cellContent()}</span>
        {field === 'Nome_Fantasia' && transaction.Origem !== 'manual' && onRuleCreation && (
          <button
            onClick={(e) => { e.stopPropagation(); onRuleCreation(transaction); }}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-full bg-slate-700 text-slate-400 hover:bg-highlight hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
            title="Criar regra de mapeamento"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
              <path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>
    </td>
  );
};



interface PaginationControlsProps {
  itemsPerPage: number;
  setItemsPerPage: (value: number) => void;
  currentPage: number;
  setCurrentPage: (updater: (prev: number) => number) => void;
  totalPages: number;
  totalRecords: number;
}

const PaginationControls: React.FC<PaginationControlsProps> = ({
  itemsPerPage,
  setItemsPerPage,
  currentPage,
  setCurrentPage,
  totalPages,
  totalRecords,
}) => {
  return (
    <div className="flex flex-col md:flex-row justify-between items-center mt-4 text-sm text-gray-400 px-4 py-3 bg-secondary rounded-lg gap-4">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span>Mostrar</span>
        <select
          value={itemsPerPage}
          onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(p => 1); }}
          className="bg-primary/50 border border-slate-700 rounded text-white px-2 py-1 outline-none focus:border-highlight focus:ring-1 focus:ring-highlight appearance-none pr-8 cursor-pointer"
          style={{ backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '1em' }}
        >
          <option value="20">20</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="200">200</option>
          <option value="500">500</option>
          <option value="1000">1000</option>
          <option value="2000">2000</option>
          <option value="5000">5000</option>
          <option value="10000">10000</option>
          <option value="20000">20000</option>
          <option value="50000">50000</option>
          <option value="100000">100000</option>
          <option value="500000">500000</option>
          <option value="-1">Todos</option>
        </select>
        <span>registros de {totalRecords}</span>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <span>Página {currentPage} de {totalPages}</span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>Anterior</Button>
          <Button variant="secondary" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Próximo</Button>
        </div>
      </div>
    </div>
  );
};

export default TransactionsView;
