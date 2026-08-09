import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { useAppStore } from '../../hooks/useAppStore';
import { appAlert, appConfirm } from '../../hooks/useDialogStore';
import { comparableImportOriginKey } from '../../utils/importOriginKey';
import { isCreditCardEngineEnabled } from '../../services/featureFlagService';
import { creditCardRebuildFromImportHistoryService } from '../../services/creditCardRebuildFromImportHistoryService';
import type {
  AtomicCardPaymentRepairRollbackAvailability,
  AtomicCardRebuildAuditResult,
  AtomicCardRollbackAvailability,
} from '../../services/creditCardAtomicRebuildService';
import { formatCurrency } from '../../utils/formatters';
import type { Account, ImportLog, Transaction } from '../../types';
import Select from '../ui/Select';
import { unknownErrorMessage } from '../../utils/unknownError';
import {
  buildAtomicCardForensicReport,
  type AtomicCardDuplicateCohortCode,
  type AtomicCardForensicRecommendationCode,
} from '../../domain/credit-card/atomicRebuildForensics';
import {
  buildAtomicCardLineageReport,
  type AtomicCardLineageMatchCode,
  type AtomicCardLineageRecommendationCode,
  type AtomicCardLineageStatus,
} from '../../domain/credit-card/atomicRebuildLineage';

const FORENSIC_FIELD_LABELS: Record<string, string> = {
  statementKey: 'competência',
  postedDate: 'data',
  amountCents: 'valor',
  entryType: 'tipo',
  dueDate: 'vencimento',
  entryCount: 'quantidade de itens',
  statementTotalCents: 'total',
  totalPaymentsCents: 'pagamentos',
  openBalanceCents: 'saldo',
  paymentDate: 'data',
  source: 'origem',
};

const FORENSIC_DUPLICATE_LABELS: Record<AtomicCardDuplicateCohortCode, string> = {
  'deterministic-repair': 'reparo determinístico',
  'outside-shadow': 'fora da reconstrução',
  'no-canonical-match': 'sem linha canônica compatível',
  'missing-row-identity': 'linha sem identidade persistida',
  'ambiguous-row-set': 'conjunto de linhas ambíguo',
};

const FORENSIC_RECOMMENDATION_LABELS: Record<AtomicCardForensicRecommendationCode, string> = {
  'investigate-ambiguous-transaction-identities': 'Investigar identidades duplicadas antes de qualquer remoção.',
  'investigate-missing-projection-entries': 'Explicar itens ausentes da projeção atual antes de reconstruir.',
  'review-competence-assignment': 'Revisar a regra de competência que concentra as mudanças de itens.',
  'repair-payment-duplicates-with-snapshot': 'Reparar somente pagamentos inequivocamente duplicados, sempre com snapshot.',
  'preserve-protected-statement-metadata': 'Preservar totais oficiais e ajustes protegidos das faturas.',
  'activate-only-with-snapshot': 'Ativar apenas com snapshot individual e revisão imutável.',
  'observe-no-structural-change': 'Manter em observação; não há mudança estrutural pendente.',
};

const LINEAGE_STATUS_LABELS: Record<AtomicCardLineageStatus, string> = {
  clean: 'nenhuma quebra de identidade detectada',
  'explained-no-safe-repair': 'linhas conservadas; quebra de identidade explicada, mas sem reparo seguro',
  'partially-explained': 'quebra de identidade parcialmente explicada',
  unresolved: 'lacuna de identidade ainda não explicada',
};

const LINEAGE_MATCH_LABELS: Record<AtomicCardLineageMatchCode, string> = {
  'exact-content-unique': 'conteúdo integral com pareamento único',
  'exact-content-ambiguous': 'conteúdo integral repetido e ambíguo',
  'competence-shift-unique': 'mesmo conteúdo em outra competência',
  'competence-shift-ambiguous': 'mesmo conteúdo repetido em outra competência',
  'type-shift-unique': 'mesma data e valor com tipo diferente',
  'type-shift-ambiguous': 'mesma data e valor com tipos ambíguos',
  'date-amount-only': 'coincidência fraca de data e valor',
  unmatched: 'sem explicação por conteúdo',
};

const LINEAGE_RECOMMENDATION_LABELS: Record<AtomicCardLineageRecommendationCode, string> = {
  'row-count-conserved-not-deleted': 'A quantidade de linhas desta projeção foi conservada; não há indício de perda por redução de volume.',
  'identity-surplus-balances-missing': 'As identidades ausentes são numericamente compensadas por linhas excedentes em grupos duplicados.',
  'content-signatures-explain-missing': 'As assinaturas de conteúdo explicam todas as identidades ausentes, sem autorizar exclusão automática.',
  'restore-source-provenance-before-repair': 'Recuperar proveniência histórica antes de escolher qual linha representa cada identidade.',
  'review-competence-before-identity-repair': 'Resolver primeiro a regra de competência; ela altera a linha usada como referência.',
  'do-not-reimport': 'Não reimportar arquivos para tentar corrigir o histórico; isso pode ampliar as duplicidades.',
  'keep-activation-blocked': 'Manter ativação e reparos bloqueados enquanto houver identidade ambígua.',
  'deterministic-repair-path-available': 'Existem linhas com reparo determinístico separado, sempre condicionado a snapshot.',
  'unexplained-row-gap': 'Persistem linhas ou identidades sem explicação suficiente; aprofundar a auditoria antes de qualquer escrita.',
};

/** DD/MM/AAAA → YYYY-MM-DD ou null */
function parseBRDateToIso(value: string): string | null {
  const s = value.trim().replace(/\s/g, '');
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const d = new Date(yyyy, mm - 1, dd);
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** MM/AAAA → YYYY-MM */
function parseMMAAAAToIsoMonth(value: string): string | null {
  const s = value.trim().replace(/\s/g, '');
  const m = /^(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const mm = Number(m[1]);
  const yyyy = Number(m[2]);
  if (mm < 1 || mm > 12 || yyyy < 1900 || yyyy > 2100) return null;
  return `${yyyy}-${String(mm).padStart(2, '0')}`;
}

/** Extrai dia de vencimento (1–31) digitado pelo usuário. */
function parseInvoiceDueDay(value: string): number | null {
  const n = Number(String(value).trim().replace(/\D/g, '') || NaN);
  if (!Number.isInteger(n) || n < 1 || n > 31) return null;
  return n;
}

/** Só dígitos; valor final sempre '' ou inteiro 1–31 (cola «100000» vira «31»). */
function sanitizeInvoiceDueDayInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits === '') return '';
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n) || n < 1) return '';
  return String(Math.min(31, Math.floor(n)));
}

/** Competência YYYY-MM → vencimento DD/MM/AAAA no mês civil seguinte, respeitando último dia do mês. */
function computeVencimentoBRFromCompetenceIsoMonth(isoMonth: string, dueDay: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(isoMonth.trim());
  if (!m) return '';
  let y = Number(m[1]);
  let mo = Number(m[2]);
  if (mo === 12) {
    mo = 1;
    y += 1;
  } else {
    mo += 1;
  }
  const last = new Date(y, mo, 0).getDate();
  const d = Math.min(Math.max(1, Math.floor(dueDay)), last);
  return `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`;
}

function effectiveDueDayForAccount(accountId: string, invoiceDueDayStr: string, accounts: Account[]): number | null {
  const g = parseInvoiceDueDay(invoiceDueDayStr);
  if (g != null) return g;
  const acc = accounts.find((a) => a.id === accountId);
  const d = Number(acc?.dia_vencimento);
  if (Number.isInteger(d) && d >= 1 && d <= 31) return d;
  return null;
}

export interface CreditCardInvoiceCycleRow {
  key: string;
  accountId: string;
  accountName: string;
  originComparable: string;
  displayOrigin: string;
  txCount: number;
  /** Competência em MM/AAAA */
  competenciaBR: string;
  /** Vencimento em DD/MM/AAAA */
  vencimentoBR: string;
  /** Ordenação: instante do último registro em «Histórico de importações» para esta origem; fallback: transação mais recente. */
  sortUploadMs: number;
}

/**
 * O vencimento confirmado no histórico é a fonte de verdade. Há bases legítimas
 * em que competência e vencimento ficam no mesmo mês e bases em que o vencimento
 * está no mês seguinte; recalcular sempre deslocaria silenciosamente o primeiro caso.
 */
export function resolveCreditCardInvoiceCycleDueDateIso(
  row: Pick<CreditCardInvoiceCycleRow, 'competenciaBR' | 'vencimentoBR'>,
  dueDay: number | null
): string | null {
  const persistedDueDate = parseBRDateToIso(row.vencimentoBR.trim());
  if (persistedDueDate) return persistedDueDate;

  const referenceMonth = parseMMAAAAToIsoMonth(row.competenciaBR.trim());
  if (!referenceMonth || dueDay == null) return null;
  return parseBRDateToIso(computeVencimentoBRFromCompetenceIsoMonth(referenceMonth, dueDay));
}

function updateDueDayPreservingKnownMonth(
  row: Pick<CreditCardInvoiceCycleRow, 'competenciaBR' | 'vencimentoBR'>,
  dueDay: number | null
): string {
  if (dueDay == null) return '';
  const persistedDueDate = parseBRDateToIso(row.vencimentoBR.trim());
  if (!persistedDueDate) {
    const referenceMonth = parseMMAAAAToIsoMonth(row.competenciaBR.trim());
    return referenceMonth
      ? computeVencimentoBRFromCompetenceIsoMonth(referenceMonth, dueDay)
      : '';
  }

  const year = Number(persistedDueDate.slice(0, 4));
  const month = Number(persistedDueDate.slice(5, 7));
  const lastDay = new Date(year, month, 0).getDate();
  const safeDay = Math.min(Math.max(1, dueDay), lastDay);
  return `${String(safeDay).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

/** Infere a conta de cartão de um registro do histórico de importações. */
function resolveImportLogAccountId(
  log: ImportLog,
  transactions: Transaction[],
  accounts: Account[]
): string | null {
  const det = (log.imported_details as any[]) || [];
  const fromMeta = det.find((d) => d?.ID_Conta)?.ID_Conta;
  if (fromMeta) return String(fromMeta);

  const normalizeOrigin = (value?: string) =>
    (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  const targetOrigin = normalizeOrigin(log.file_name);
  const freq = new Map<string, number>();
  transactions
    .filter((t) => normalizeOrigin(t.Origem) === targetOrigin && t.ID_Conta)
    .forEach((t) => {
      const key = t.ID_Conta as string;
      freq.set(key, (freq.get(key) || 0) + 1);
    });
  if (freq.size === 1) return Array.from(freq.keys())[0];
  if (freq.size > 1) {
    return Array.from(freq.entries()).sort((a, b) => b[1] - a[1])[0][0];
  }

  const normalizeLoose = (value?: string) =>
    normalizeOrigin(value)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const fileTokens = normalizeLoose(log.file_name).split(' ').filter(Boolean);
  const cardAccounts = accounts.filter((a) => a.Tipo_Conta === 'Cartão de Crédito');
  const scored = cardAccounts
    .map((acc) => ({
      id: acc.id,
      score: normalizeLoose(acc.Nome_Conta)
        .split(' ')
        .filter((token) => fileTokens.includes(token)).length,
    }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].id : null;
}

function latestImportLogMsForComparable(importLogs: ImportLog[], originComparable: string): number {
  let max = 0;
  for (const log of importLogs) {
    if (comparableImportOriginKey(log.file_name) !== originComparable) continue;
    const ts = new Date(log.import_date || 0).getTime();
    if (!Number.isNaN(ts) && ts > max) max = ts;
  }
  return max;
}

function dominantOriginString(originWeights: Map<string, number>): string {
  const pairs = Array.from(originWeights.entries()).sort((a, b) => b[1] - a[1]);
  return pairs[0]?.[0] || '';
}

function latestLogForCardOrigin(
  importLogs: ImportLog[],
  accountId: string,
  originComparable: string
): ImportLog | undefined {
  const candidates = importLogs.filter((log) => comparableImportOriginKey(log.file_name) === originComparable);
  const ranked = candidates
    .map((log) => {
      const det = Array.isArray(log.imported_details) ? log.imported_details : [];
      const mentionsAccount = det.some((d: any) => d?.ID_Conta === accountId);
      const ts = new Date(log.import_date || 0).getTime();
      return { log, mentionsAccount, ts };
    })
    .sort((a, b) => {
      if (a.mentionsAccount !== b.mentionsAccount) return (b.mentionsAccount ? 1 : 0) - (a.mentionsAccount ? 1 : 0);
      return b.ts - a.ts;
    });
  return ranked[0]?.log;
}

/** Lê competência/vencimento já persistidos no histórico (saveCardImportLotClassification). */
function cardCycleMetaFromImportedLog(log: ImportLog | undefined, accountId: string): { competenciaBR: string; vencimentoBR: string } {
  if (!log) return { competenciaBR: '', vencimentoBR: '' };
  const det = Array.isArray(log.imported_details) ? log.imported_details : [];
  const accountRows = det.filter((d: any) => d?.ID_Conta === accountId);
  const pool = accountRows.length > 0 ? accountRows : det;
  const metaWithRef = pool.find((d: any) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(d?.Card_Reference_Label || '')));
  if (!metaWithRef?.Card_Reference_Label) return { competenciaBR: '', vencimentoBR: '' };
  const ref = String(metaWithRef.Card_Reference_Label);
  const yyyy = ref.slice(0, 4);
  const mm = ref.slice(5, 7);
  const competenciaBR = `${mm}/${yyyy}`;
  let vencimentoBR = '';
  const due = metaWithRef.Card_Due_Date;
  if (typeof due === 'string' && /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(due)) {
    const [y, m, d] = due.split('-');
    vencimentoBR = `${d}/${m}/${y}`;
  }
  return { competenciaBR, vencimentoBR };
}

function buildRowsFromStore(params: {
  accounts: Account[];
  transactions: Transaction[];
  importLogs: ImportLog[];
  filterAccountId?: string | null;
}): CreditCardInvoiceCycleRow[] {
  const { accounts, transactions, importLogs, filterAccountId } = params;
  const cardById = new Map(
    accounts.filter((a) => a.Tipo_Conta === 'Cartão de Crédito').map((a) => [a.id, a])
  );

  type Agg = {
    accountId: string;
    originComparable: string;
    originWeights: Map<string, number>;
    txCount: number;
    latestTxMs: number;
  };
  const map = new Map<string, Agg>();

  transactions.forEach((t) => {
    if (!t.ID_Conta || !t.Origem || t.Origem === 'manual') return;
    if (!cardById.has(t.ID_Conta)) return;
    if (filterAccountId && t.ID_Conta !== filterAccountId) return;
    const oc = comparableImportOriginKey(String(t.Origem));
    if (!oc) return;
    const aggKey = `${t.ID_Conta}__${oc}`;
    const origStr = String(t.Origem);
    let agg = map.get(aggKey);
    if (!agg) {
      agg = {
        accountId: t.ID_Conta,
        originComparable: oc,
        originWeights: new Map(),
        txCount: 0,
        latestTxMs: 0,
      };
      map.set(aggKey, agg);
    }
    agg.txCount += 1;
    agg.originWeights.set(origStr, (agg.originWeights.get(origStr) || 0) + 1);
    const txMs = new Date(t.Data as Date | string).getTime();
    if (!Number.isNaN(txMs)) agg.latestTxMs = Math.max(agg.latestTxMs, txMs);
  });

  const rows: CreditCardInvoiceCycleRow[] = [];

  map.forEach((agg, rowKey) => {
    const account = cardById.get(agg.accountId);
    if (!account) return;

    const dominant = dominantOriginString(agg.originWeights);
    const logPick = latestLogForCardOrigin(importLogs, agg.accountId, agg.originComparable);
    const displayOrigin = logPick?.file_name || dominant;

    const logMs = latestImportLogMsForComparable(importLogs, agg.originComparable);
    const sortUploadMs = logMs > 0 ? logMs : agg.latestTxMs;

    const persisted = cardCycleMetaFromImportedLog(logPick, agg.accountId);

    rows.push({
      key: rowKey,
      accountId: agg.accountId,
      accountName: account.Nome_Conta,
      originComparable: agg.originComparable,
      displayOrigin,
      txCount: agg.txCount,
      competenciaBR: persisted.competenciaBR,
      vencimentoBR: persisted.vencimentoBR,
      sortUploadMs,
    });
  });

  if (filterAccountId) {
    importLogs.forEach((log) => {
      const accountId = resolveImportLogAccountId(log, transactions, accounts);
      if (accountId !== filterAccountId) return;
      const oc = comparableImportOriginKey(log.file_name);
      if (!oc) return;
      const aggKey = `${accountId}__${oc}`;
      if (map.has(aggKey)) return;

      const account = cardById.get(accountId);
      if (!account) return;
      const logMs = new Date(log.import_date || 0).getTime();
      const persisted = cardCycleMetaFromImportedLog(log, accountId);
      let competenciaBR = persisted.competenciaBR;
      if (!competenciaBR.trim()) {
        const suggested = creditCardRebuildFromImportHistoryService.suggestReferenceMonth(
          log.file_name,
          log.imported_details as unknown[]
        );
        if (suggested) {
          competenciaBR = `${suggested.slice(5, 7)}/${suggested.slice(0, 4)}`;
        }
      }
      let vencimentoBR = persisted.vencimentoBR;
      if (!vencimentoBR.trim() && competenciaBR.trim()) {
        const iso = parseMMAAAAToIsoMonth(competenciaBR);
        const day = Number(account.dia_vencimento) || 10;
        if (iso) vencimentoBR = computeVencimentoBRFromCompetenceIsoMonth(iso, day);
      }

      rows.push({
        key: aggKey,
        accountId,
        accountName: account.Nome_Conta,
        originComparable: oc,
        displayOrigin: log.file_name,
        txCount: 0,
        competenciaBR,
        vencimentoBR,
        sortUploadMs: Number.isNaN(logMs) ? 0 : logMs,
      });
    });
  }

  return sortRowsByVencimentoDesc(rows);
}

/** Vencimento mais recente primeiro (auditoria); sem data válida vai ao final. */
function vencimentoSortKey(vencimentoBR: string): number {
  const iso = parseBRDateToIso(vencimentoBR.trim());
  if (!iso) return 0;
  const t = new Date(`${iso}T12:00:00`).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function sortRowsByVencimentoDesc(rows: CreditCardInvoiceCycleRow[]): CreditCardInvoiceCycleRow[] {
  return [...rows].sort((a, b) => {
    const kv = vencimentoSortKey(b.vencimentoBR) - vencimentoSortKey(a.vencimentoBR);
    if (kv !== 0) return kv;
    const ac = a.accountName.localeCompare(b.accountName, 'pt-BR');
    if (ac !== 0) return ac;
    return a.displayOrigin.localeCompare(b.displayOrigin, 'pt-BR');
  });
}

/** Mantém edição local; se o usuário não digitou competência, usa o valor vindo do histórico (persistido). */
function mergeRowsPreserveInputs(
  fresh: CreditCardInvoiceCycleRow[],
  prev: CreditCardInvoiceCycleRow[],
  invoiceDueDayStr: string,
  accounts: Account[]
): CreditCardInvoiceCycleRow[] {
  const prevByKey = new Map(prev.map((r) => [r.key, r]));
  const merged = fresh.map((r) => {
    const p = prevByKey.get(r.key);
    if (!p) return r;
    const competenciaBR = p.competenciaBR.trim() !== '' ? p.competenciaBR : r.competenciaBR;
    const day = effectiveDueDayForAccount(r.accountId, invoiceDueDayStr, accounts);
    const vencimentoBR =
      p.vencimentoBR.trim() !== ''
        ? p.vencimentoBR
        : r.vencimentoBR.trim() !== ''
          ? r.vencimentoBR
          : updateDueDayPreservingKnownMonth({ competenciaBR, vencimentoBR: '' }, day);

    return {
      ...r,
      competenciaBR,
      vencimentoBR,
    };
  });
  return sortRowsByVencimentoDesc(merged);
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Se definido, apenas importações desta conta de cartão. */
  filterAccountId?: string | null;
  /** Camada do overlay (acima do histórico de faturas quando aberto em sequência). */
  overlayClassName?: string;
}

const CreditCardInvoiceCyclesModal: React.FC<Props> = ({
  isOpen,
  onClose,
  filterAccountId,
  overlayClassName = 'z-[70]',
}) => {
  const accounts = useAppStore((s) => s.accounts);
  const transactions = useAppStore((s) => s.transactions);
  const importLogs = useAppStore((s) => s.importLogs);
  const user = useAppStore((s) => s.user);
  const saveCardImportLotClassification = useAppStore((s) => s.saveCardImportLotClassification);
  const auditCreditCardRebuildFromImportHistory = useAppStore((s) => s.auditCreditCardRebuildFromImportHistory);
  const activateCreditCardRebuildFromImportHistory = useAppStore(
    (s) => s.activateCreditCardRebuildFromImportHistory
  );
  const getLatestAtomicCardRollback = useAppStore((s) => s.getLatestAtomicCardRollback);
  const getAtomicCardRebuildFeatureState = useAppStore(
    (s) => s.getAtomicCardRebuildFeatureState
  );
  const rollbackAtomicCardRebuild = useAppStore((s) => s.rollbackAtomicCardRebuild);
  const repairAtomicCardPaymentDuplicates = useAppStore(
    (s) => s.repairAtomicCardPaymentDuplicates
  );
  const getLatestAtomicCardPaymentRepairRollback = useAppStore(
    (s) => s.getLatestAtomicCardPaymentRepairRollback
  );
  const rollbackAtomicCardPaymentRepair = useAppStore(
    (s) => s.rollbackAtomicCardPaymentRepair
  );

  const creditCardAccounts = useMemo(
    () => accounts.filter((a) => a.Tipo_Conta === 'Cartão de Crédito'),
    [accounts]
  );

  const [selectedCardAccountId, setSelectedCardAccountId] = useState('');
  const effectiveFilterAccountId = filterAccountId || selectedCardAccountId || null;

  const [rows, setRows] = useState<CreditCardInvoiceCycleRow[]>([]);
  const [invoiceDueDayStr, setInvoiceDueDayStr] = useState('');
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<
    'save' | 'audit' | 'repair' | 'repairRollback' | 'rebuild' | 'rollback' | null
  >(null);
  const [applyProgress, setApplyProgress] = useState<string | null>(null);
  const [shadowAudit, setShadowAudit] = useState<AtomicCardRebuildAuditResult | null>(null);
  const [latestRollback, setLatestRollback] = useState<AtomicCardRollbackAvailability | null>(null);
  const [latestPaymentRepairRollback, setLatestPaymentRepairRollback] =
    useState<AtomicCardPaymentRepairRollbackAvailability | null>(null);
  const [atomicActivationEnabled, setAtomicActivationEnabled] = useState(false);
  const prevIsOpenRef = useRef(false);
  const prevFilterSigRef = useRef<string | undefined>(undefined);

  const shadowAuditForensics = useMemo(
    () =>
      shadowAudit
        ? buildAtomicCardForensicReport(
            shadowAudit.shadow,
            shadowAudit.persisted,
            shadowAudit.comparison
          )
        : null,
    [shadowAudit]
  );

  const shadowAuditLineage = useMemo(
    () =>
      shadowAudit
        ? buildAtomicCardLineageReport(
            shadowAudit.shadow,
            shadowAudit.persisted,
            shadowAudit.comparison
          )
        : null,
    [shadowAudit]
  );

  const shadowAuditDiagnosticLines = useMemo(() => {
    if (!shadowAudit) return [];

    const { shadow, persisted, comparison } = shadowAudit;
    const transactionById = new Map(
      transactions
        .filter((transaction) => Boolean(transaction.ID_Transacao))
        .map((transaction) => [String(transaction.ID_Transacao), transaction])
    );
    const shortId = (value: string | null | undefined): string => {
      const normalized = String(value || '').trim();
      if (!normalized) return 'sem-id';
      return normalized.length > 12 ? `${normalized.slice(0, 8)}…${normalized.slice(-4)}` : normalized;
    };
    const transactionName = (transactionId: string): string => {
      const transaction = transactionById.get(transactionId);
      const description = transaction?.Descricao_Original || transaction?.Nome_Fantasia;
      return description ? `“${description}” (${shortId(transactionId)})` : shortId(transactionId);
    };
    const money = (amountCents: number): string => formatCurrency(amountCents / 100);
    const lines: string[] = [];

    shadow.issues.forEach((issue) => {
      lines.push(
        `${issue.severity === 'blocker' ? 'Bloqueio' : 'Alerta'} ${issue.code}: ${issue.message}`
      );
    });

    const repairableEntryRows = new Set(comparison.repairablePersistedEntryRowIds);
    comparison.duplicatePersistedTransactionIds.forEach((transactionId) => {
      const duplicatedRows = persisted.entries.filter(
        (entry) => entry.transactionId === transactionId
      );
      const repairableRows = duplicatedRows.filter(
        (entry) => entry.rowId && repairableEntryRows.has(entry.rowId)
      );
      const isConflicting = comparison.conflictingDuplicatePersistedTransactionIds.includes(
        transactionId
      );
      lines.push(
        isConflicting
          ? `Duplicidade ambígua de item: ${transactionName(transactionId)} aparece ${duplicatedRows.length} vezes e nenhuma linha canônica coincide de forma inequívoca com a fonte. Nenhuma remoção foi executada.`
          : `Plano de reparo somente leitura: ${transactionName(transactionId)} aparece ${duplicatedRows.length} vezes; ${repairableRows.length} linha(s) materializada(s) é(são) candidata(s) segura(s) à remoção, preservando a linha que coincide com a fonte. Nenhuma remoção foi executada.`
      );
    });

    comparison.changedTransactionIds.forEach((transactionId) => {
      const current = persisted.entries.find((entry) => entry.transactionId === transactionId);
      const expected = shadow.entries.find((entry) => entry.transactionId === transactionId);
      if (!current || !expected) return;
      lines.push(
        `Item ${transactionName(transactionId)}: atual [fatura ${current.statementKey}, data ${current.postedDate || '—'}, ${money(current.amountCents)}, ${current.entryType}] → sombra [fatura ${expected.statementKey}, data ${expected.postedDate}, ${money(expected.amountCents)}, ${expected.entryType}].`
      );
    });

    comparison.missingTransactionIds.forEach((transactionId) => {
      const expected = shadow.entries.find((entry) => entry.transactionId === transactionId);
      lines.push(
        `Item ausente na projeção atual: ${transactionName(transactionId)}${
          expected ? `; sombra em ${expected.statementKey}, ${expected.postedDate}, ${money(expected.amountCents)}, ${expected.entryType}` : ''
        }.`
      );
    });
    comparison.orphanTransactionIds.forEach((transactionId) => {
      const current = persisted.entries.find((entry) => entry.transactionId === transactionId);
      lines.push(
        `Item órfão na projeção atual: ${transactionName(transactionId)}${
          current ? `; atual em ${current.statementKey}, ${current.postedDate || '—'}, ${money(current.amountCents)}, ${current.entryType}` : ''
        }.`
      );
    });

    comparison.missingStatementKeys.forEach((statementKey) => {
      const expected = shadow.statements.find((statement) => statement.statementKey === statementKey);
      lines.push(
        `Fatura ausente na projeção atual: ${statementKey}${
          expected ? `; sombra com vencimento ${expected.dueDate}, ${expected.entryCount} itens, total ${money(expected.statementTotalCents)}, pagamentos ${money(expected.totalPaymentsCents)} e saldo ${money(expected.openBalanceCents)}` : ''
        }.`
      );
    });
    comparison.orphanStatementKeys.forEach((statementKey) => {
      const current = persisted.statements.find((statement) => statement.statementKey === statementKey);
      lines.push(
        `Fatura órfã na projeção atual: ${statementKey}${
          current ? `; vencimento ${current.dueDate || '—'}, ${current.entryCount} itens, total ${money(current.statementTotalCents)}, pagamentos ${money(current.totalPaymentsCents)} e saldo ${money(current.openBalanceCents)}` : ''
        }.`
      );
    });
    comparison.changedStatementKeys.forEach((statementKey) => {
      const current = persisted.statements.find((statement) => statement.statementKey === statementKey);
      const expected = shadow.statements.find((statement) => statement.statementKey === statementKey);
      if (!current || !expected) return;
      lines.push(
        `Fatura ${statementKey}: atual [venc. ${current.dueDate || '—'}, ${current.entryCount} itens, total ${money(current.statementTotalCents)}, pagamentos ${money(current.totalPaymentsCents)}, saldo ${money(current.openBalanceCents)}] → sombra [venc. ${expected.dueDate}, ${expected.entryCount} itens, total ${money(expected.statementTotalCents)}, pagamentos ${money(expected.totalPaymentsCents)}, saldo ${money(expected.openBalanceCents)}].`
      );
    });

    comparison.missingPaymentKeys.forEach((paymentKey) => {
      const expected = shadow.payments.find(
        (payment) => payment.transactionId === paymentKey || `shadow:${payment.sourceRowHash}` === paymentKey
      );
      lines.push(
        `Pagamento ausente na projeção atual: ${expected ? transactionName(expected.transactionId) : shortId(paymentKey)}${
          expected ? `; sombra quita ${expected.statementKey} em ${expected.paymentDate}, ${money(expected.amountCents)}, origem ${expected.source}` : ''
        }.`
      );
    });
    comparison.orphanPaymentKeys.forEach((paymentKey) => {
      const current = persisted.payments.find(
        (payment) => payment.transactionId === paymentKey || `row:${payment.rowId}` === paymentKey
      );
      lines.push(
        `Pagamento órfão na projeção atual: ${current?.transactionId ? transactionName(current.transactionId) : shortId(paymentKey)}${
          current ? `; atual quita ${current.statementKey} em ${current.paymentDate || '—'}, ${money(current.amountCents)}, origem ${current.source}` : ''
        }.`
      );
    });
    comparison.changedPaymentTransactionIds.forEach((transactionId) => {
      const current = persisted.payments.find((payment) => payment.transactionId === transactionId);
      const expected = shadow.payments.find((payment) => payment.transactionId === transactionId);
      if (!current || !expected) return;
      lines.push(
        `Pagamento ${transactionName(transactionId)}: atual [quita ${current.statementKey}, data ${current.paymentDate || '—'}, ${money(current.amountCents)}, ${current.source}] → sombra [quita ${expected.statementKey}, data ${expected.paymentDate}, ${money(expected.amountCents)}, ${expected.source}].`
      );
    });

    comparison.suspiciousPersistedPaymentEventKeys.forEach((eventKey) => {
      const matchingPayments = persisted.payments.filter(
        (payment) =>
          [
            payment.statementKey,
            payment.paymentDate || '',
            payment.amountCents,
            payment.source,
          ].join('|') === eventKey
      );
      const sample = matchingPayments[0];
      if (!sample) return;
      const identities = matchingPayments
        .map((payment) =>
          [
            payment.transactionId
              ? `transação ${shortId(payment.transactionId)}`
              : `linha sem transação ${shortId(payment.rowId)}`,
            payment.createdAt ? `criada em ${payment.createdAt}` : null,
            payment.notes ? `nota “${payment.notes}”` : null,
          ]
            .filter(Boolean)
            .join(', ')
        )
        .join(' + ');
      lines.push(
        `Possível pagamento duplicado: ${matchingPayments.length} linhas representam ${money(sample.amountCents)} em ${sample.paymentDate || '—'}, quitando ${sample.statementKey}, origem ${sample.source} (${identities}).`
      );
    });
    comparison.repairablePersistedPaymentRowIds.forEach((rowId) => {
      const obsolete = persisted.payments.find((payment) => payment.rowId === rowId);
      if (!obsolete) return;
      const replacement = persisted.payments.find(
        (payment) =>
          Boolean(payment.transactionId) &&
          payment.statementKey === obsolete.statementKey &&
          payment.paymentDate === obsolete.paymentDate &&
          payment.amountCents === obsolete.amountCents &&
          payment.source === obsolete.source
      );
      lines.push(
        `Plano de reparo somente leitura: a linha sem identidade ${shortId(rowId)} é candidata segura à remoção; preservar ${replacement?.transactionId ? `a linha vinculada à ${transactionName(replacement.transactionId)}` : 'a linha vinculada à transação'}. Nenhuma remoção foi executada.`
      );
    });

    if (comparison.protectedMetadataStatementKeys.length > 0) {
      comparison.protectedMetadataStatementKeys.forEach((statementKey) => {
        const statement = persisted.statements.find(
          (candidate) => candidate.statementKey === statementKey
        );
        const metadata = [
          statement?.statementTotalFromFileCents != null
            ? `total oficial do arquivo ${money(statement.statementTotalFromFileCents)}`
            : null,
          statement?.totalPaymentsFromFileCents != null
            ? `pagamentos encontrados no extrato ${money(statement.totalPaymentsFromFileCents)}`
            : null,
          statement?.manualTotalsPresent ? 'ajustes manuais presentes' : null,
        ].filter(Boolean);
        lines.push(
          `Metadados protegidos da fatura ${statementKey}: ${metadata.join(', ') || 'presente'}. Eles não podem ser descartados por uma futura troca.`
        );
      });
    }

    return lines;
  }, [shadowAudit, transactions]);

  useEffect(() => {
    if (!isOpen) {
      prevIsOpenRef.current = false;
      prevFilterSigRef.current = undefined;
      setBusy(false);
      setOperation(null);
      setApplyProgress(null);
      setShadowAudit(null);
      setLatestRollback(null);
      setLatestPaymentRepairRollback(null);
      setAtomicActivationEnabled(false);
      return;
    }

    const openedNow = !prevIsOpenRef.current;
    prevIsOpenRef.current = true;

    const filterSig = effectiveFilterAccountId ?? '';
    const filterChanged =
      prevFilterSigRef.current !== undefined && prevFilterSigRef.current !== filterSig;
    prevFilterSigRef.current = filterSig;

    // Durante «Aplicar», saveCardImportLotClassification dispara fetchImportLogs — não pode resetar a tabela.
    if (busy) return;

    if (!effectiveFilterAccountId) {
      if (openedNow) setRows([]);
      return;
    }

    const s = useAppStore.getState();
    const fresh = buildRowsFromStore({
      accounts: s.accounts,
      transactions: s.transactions,
      importLogs: s.importLogs,
      filterAccountId: effectiveFilterAccountId,
    });

    if (openedNow || filterChanged) {
      setRows(fresh);
      setShadowAudit(null);
      if (effectiveFilterAccountId) {
        const acc = accounts.find((a) => a.id === effectiveFilterAccountId);
        const dAcc = Number(acc?.dia_vencimento);
        const dayFromVen = fresh
          .filter((row) => row.accountId === effectiveFilterAccountId)
          .map((row) => {
            const isoDue = parseBRDateToIso(row.vencimentoBR.trim());
            if (!isoDue) return null;
            const dd = Number(isoDue.slice(8, 10));
            return dd >= 1 && dd <= 31 ? dd : null;
          })
          .find((x) => x != null);
        if (dayFromVen != null) {
          setInvoiceDueDayStr(String(dayFromVen));
        } else if (Number.isInteger(dAcc) && dAcc >= 1 && dAcc <= 31) {
          setInvoiceDueDayStr(String(dAcc));
        } else {
          setInvoiceDueDayStr('');
        }
      } else {
        setInvoiceDueDayStr('');
      }
      return;
    }

    setRows((prev) => mergeRowsPreserveInputs(fresh, prev, invoiceDueDayStr, accounts));
  }, [isOpen, busy, effectiveFilterAccountId, accounts, transactions, importLogs, invoiceDueDayStr]);

  useEffect(() => {
    if (!isOpen || filterAccountId) return;
    if (selectedCardAccountId) return;
    const first = creditCardAccounts[0]?.id;
    if (first) setSelectedCardAccountId(first);
  }, [isOpen, filterAccountId, selectedCardAccountId, creditCardAccounts]);

  useEffect(() => {
    let active = true;
    if (!isOpen || !effectiveFilterAccountId) {
      setLatestRollback(null);
      return () => {
        active = false;
      };
    }

    void getLatestAtomicCardRollback(effectiveFilterAccountId)
      .then((snapshot) => {
        if (active) setLatestRollback(snapshot);
      })
      .catch((error) => {
        console.error('[CreditCardInvoiceCyclesModal][LatestAtomicRollback]', error);
        if (active) setLatestRollback(null);
      });

    return () => {
      active = false;
    };
  }, [isOpen, effectiveFilterAccountId, getLatestAtomicCardRollback]);

  useEffect(() => {
    let active = true;
    if (!isOpen || !effectiveFilterAccountId) {
      setLatestPaymentRepairRollback(null);
      return () => {
        active = false;
      };
    }

    void getLatestAtomicCardPaymentRepairRollback(effectiveFilterAccountId)
      .then((snapshot) => {
        if (active) setLatestPaymentRepairRollback(snapshot);
      })
      .catch((error) => {
        console.error('[CreditCardInvoiceCyclesModal][LatestPaymentRepairRollback]', error);
        if (active) setLatestPaymentRepairRollback(null);
      });

    return () => {
      active = false;
    };
  }, [
    isOpen,
    effectiveFilterAccountId,
    getLatestAtomicCardPaymentRepairRollback,
  ]);

  useEffect(() => {
    let active = true;
    if (!isOpen || !user) {
      setAtomicActivationEnabled(false);
      return () => {
        active = false;
      };
    }
    void getAtomicCardRebuildFeatureState().then((enabled) => {
      if (active) setAtomicActivationEnabled(enabled);
    });
    return () => {
      active = false;
    };
  }, [isOpen, user, getAtomicCardRebuildFeatureState]);

  const engineOn = user ? isCreditCardEngineEnabled(user) : false;

  const filteredAccountName = useMemo(
    () =>
      effectiveFilterAccountId
        ? accounts.find((a) => a.id === effectiveFilterAccountId)?.Nome_Conta ?? null
        : null,
    [effectiveFilterAccountId, accounts]
  );

  const rowsSortedByVencimento = useMemo(() => sortRowsByVencimentoDesc(rows), [rows]);
  const manualCardTransactionCount = useMemo(
    () =>
      effectiveFilterAccountId
        ? transactions.filter(
            (transaction) =>
              transaction.ID_Conta === effectiveFilterAccountId &&
              String(transaction.Origem || 'manual').trim().toLowerCase() === 'manual'
          ).length
        : 0,
    [effectiveFilterAccountId, transactions]
  );
  const hasAuditSource = rows.length > 0 || manualCardTransactionCount > 0;

  const previewByRowKey = useMemo(() => {
    const map = new Map<string, ReturnType<typeof creditCardRebuildFromImportHistoryService.previewCycles>[number]>();
    if (!effectiveFilterAccountId || rows.length === 0) return map;
    const previews = creditCardRebuildFromImportHistoryService.previewCycles(
      effectiveFilterAccountId,
      rowsSortedByVencimento.map((r) => {
        const refIso = parseMMAAAAToIsoMonth(r.competenciaBR.trim());
        const day = effectiveDueDayForAccount(r.accountId, invoiceDueDayStr, accounts);
        const dueDate = resolveCreditCardInvoiceCycleDueDateIso(r, day) || '';
        return {
          fileName: r.displayOrigin,
          referenceMonth: refIso || '',
          dueDate,
        };
      }),
      transactions
    );
    rowsSortedByVencimento.forEach((r, i) => {
      if (previews[i]) map.set(r.key, previews[i]);
    });
    return map;
  }, [effectiveFilterAccountId, rowsSortedByVencimento, transactions, invoiceDueDayStr, accounts, user]);

  const validateRow = useCallback(
    (r: CreditCardInvoiceCycleRow): string | null => {
      const refIso = parseMMAAAAToIsoMonth(r.competenciaBR.trim());
      if (!refIso) {
        return `Competência inválida em "${r.displayOrigin}" — use MM/AAAA (ex.: 02/2026 para fevereiro de 2026).`;
      }
      const day = effectiveDueDayForAccount(r.accountId, invoiceDueDayStr, accounts);
      if (resolveCreditCardInvoiceCycleDueDateIso(r, day)) return null;

      return `Informe o dia de vencimento (1–31) acima ou cadastre «dia de vencimento» na conta «${r.accountName}».`;
    },
    [invoiceDueDayStr, accounts]
  );

  const rowIsoValues = useCallback(
    (r: CreditCardInvoiceCycleRow) => {
      const referenceMonth = parseMMAAAAToIsoMonth(r.competenciaBR.trim())!;
      const day = effectiveDueDayForAccount(r.accountId, invoiceDueDayStr, accounts);
      const dueDate = resolveCreditCardInvoiceCycleDueDateIso(r, day);
      if (!dueDate) {
        throw new Error(`Defina o dia de vencimento ou complete o vencimento em "${r.displayOrigin}".`);
      }
      return { referenceMonth, dueDate };
    },
    [invoiceDueDayStr, accounts]
  );

  const handleSaveCycleMetadata = useCallback(async () => {
    if (!user) {
      await appAlert('Faça login para continuar.', 'Sessão', 'warning');
      return;
    }
    if (!effectiveFilterAccountId) {
      await appAlert('Selecione o cartão de crédito.', 'Cartão', 'warning');
      return;
    }
    if (rows.length === 0) {
      await appAlert('Não há arquivos deste cartão no histórico de importações.', 'Histórico', 'warning');
      return;
    }

    for (const row of rows) {
      const error = validateRow(row);
      if (error) {
        await appAlert(error, 'Validação', 'warning');
        return;
      }
    }

    const stateBeforeSave = useAppStore.getState();
    const persistedRows = buildRowsFromStore({
      accounts: stateBeforeSave.accounts,
      transactions: stateBeforeSave.transactions,
      importLogs: stateBeforeSave.importLogs,
      filterAccountId: effectiveFilterAccountId,
    });
    const persistedByKey = new Map(persistedRows.map((row) => [row.key, row]));
    const changes = rows
      .map((row) => {
        const previousRow = persistedByKey.get(row.key);
        const next = rowIsoValues(row);
        let previous: ReturnType<typeof rowIsoValues> | null = null;
        if (previousRow) {
          try {
            previous = rowIsoValues(previousRow);
          } catch {
            previous = null;
          }
        }
        if (
          previous &&
          previous.referenceMonth === next.referenceMonth &&
          previous.dueDate === next.dueDate
        ) {
          return null;
        }
        return { row, previous, next };
      })
      .filter((change): change is NonNullable<typeof change> => change !== null);

    if (changes.length === 0) {
      await appAlert('Nenhuma competência ou vencimento foi alterado.', 'Histórico', 'warning');
      return;
    }

    const confirmed = await appConfirm(
      `Salvar ${changes.length} ajuste(s) de competência no histórico? Esta ação não move, exclui ou recria transações, itens, pagamentos ou faturas.`,
      'Salvar competências sem reconstruir',
      'Salvar ajustes',
      'warning'
    );
    if (!confirmed) return;

    setBusy(true);
    setOperation('save');
    setApplyProgress(`Salvando ${changes.length} ajuste(s) somente nos metadados do histórico…`);
    const attempted: typeof changes = [];

    try {
      for (const change of changes) {
        attempted.push(change);
        const result = await saveCardImportLotClassification(
          change.row.displayOrigin,
          effectiveFilterAccountId,
          change.next.referenceMonth,
          change.next.dueDate
        );
        if (result.updatedLogs < 1 || (result.errors?.length || 0) > 0) {
          throw new Error(result.errors?.join(' ') || result.message);
        }
      }

      const refreshed = useAppStore.getState();
      setRows(
        buildRowsFromStore({
          accounts: refreshed.accounts,
          transactions: refreshed.transactions,
          importLogs: refreshed.importLogs,
          filterAccountId: effectiveFilterAccountId,
        })
      );
      setShadowAudit(null);
      await appAlert(
        `${changes.length} ajuste(s) salvo(s). As transações, faturas e pagamentos permaneceram intactos. Execute a auditoria antes de qualquer reconstrução.`,
        'Competências salvas com segurança',
        'success'
      );
    } catch (error: unknown) {
      const rollbackFailures: string[] = [];
      for (const change of [...attempted].reverse()) {
        if (!change.previous) {
          rollbackFailures.push(`${change.row.displayOrigin}: não havia metadado anterior para restaurar.`);
          continue;
        }
        try {
          const rollback = await saveCardImportLotClassification(
            change.row.displayOrigin,
            effectiveFilterAccountId,
            change.previous.referenceMonth,
            change.previous.dueDate
          );
          if (rollback.updatedLogs < 1 || (rollback.errors?.length || 0) > 0) {
            rollbackFailures.push(
              rollback.errors?.join(' ') || `${change.row.displayOrigin}: ${rollback.message}`
            );
          }
        } catch (rollbackError: unknown) {
          rollbackFailures.push(
            `${change.row.displayOrigin}: ${unknownErrorMessage(rollbackError, 'falha ao restaurar')}`
          );
        }
      }

      const baseMessage = unknownErrorMessage(error, 'Falha ao salvar as competências.');
      await appAlert(
        rollbackFailures.length === 0
          ? `${baseMessage}\n\nOs metadados anteriores foram restaurados. Nenhuma transação, fatura ou pagamento foi alterado.`
          : `${baseMessage}\n\nA restauração dos metadados não foi concluída: ${rollbackFailures.join(' ')}`,
        rollbackFailures.length === 0 ? 'Ajustes não salvos' : 'Atenção: restauração incompleta',
        'danger'
      );
    } finally {
      setBusy(false);
      setOperation(null);
      setApplyProgress(null);
    }
  }, [
    user,
    effectiveFilterAccountId,
    rows,
    validateRow,
    rowIsoValues,
    saveCardImportLotClassification,
  ]);

  const handleApplyWithConfirm = useCallback(async () => {
    if (!user) {
      await appAlert('Faça login para continuar.', 'Sessão', 'warning');
      return;
    }
    if (!engineOn) {
      await appAlert(
        'Ative o motor de cartão nas preferências para reconstruir faturas a partir das importações.',
        'Motor de cartão',
        'warning'
      );
      return;
    }
    if (!effectiveFilterAccountId) {
      await appAlert('Selecione o cartão de crédito (conta escolhida na importação).', 'Cartão', 'warning');
      return;
    }
    if (rows.length === 0) {
      await appAlert('Não há arquivos deste cartão no histórico de importações.', 'Histórico', 'warning');
      return;
    }
    if (!atomicActivationEnabled) {
      await appAlert(
        'A ativação atômica permanece desligada para esta conta. A auditoria e o salvamento de competências continuam disponíveis sem alterar a conciliação.',
        'Sprint 2C em modo escuro',
        'warning'
      );
      return;
    }
    if (!shadowAudit?.comparison.safeToActivate) {
      await appAlert(
        'A reconstrução está bloqueada porque a auditoria atual ainda não declarou a troca segura. Salve apenas as competências e investigue as diferenças antes de reconstruir.',
        'Reconstrução protegida',
        'warning'
      );
      return;
    }

    for (const r of rows) {
      const err = validateRow(r);
      if (err) {
        await appAlert(err, 'Validação', 'warning');
        return;
      }
    }

    const confirmed = await appConfirm(
      `Ativar atomicamente a projeção auditada de ${rows.length} arquivo(s)? O banco repetirá todas as validações, atualizará apenas linhas já existentes e salvará um snapshot individual para desfazer.`,
      'Ativar projeção auditada',
      'Ativar com snapshot',
      'warning'
    );
    if (!confirmed) return;

    setBusy(true);
    setOperation('rebuild');
    setApplyProgress('Reauditando e bloqueando a projeção no banco…');

    try {
      const cycles = rows.map((r) => {
        const { referenceMonth, dueDate } = rowIsoValues(r);
        return {
          fileName: r.displayOrigin,
          referenceMonth,
          dueDate,
        };
      });

      setApplyProgress(`Aplicando ${cycles.length} arquivo(s) em uma única transação…`);
      const result = await activateCreditCardRebuildFromImportHistory(
        effectiveFilterAccountId,
        cycles,
        shadowAudit
      );

      setBusy(false);
      setOperation(null);
      setApplyProgress(null);
      setShadowAudit(result.postActivationAudit);
      setLatestRollback({
        snapshotId: result.snapshotId,
        accountId: effectiveFilterAccountId,
        shadowChecksum: result.shadowChecksum,
        appliedAt: new Date().toISOString(),
      });

      await appAlert(
        [
          'Projeção ativada e verificada em uma única transação.',
          `${result.statementsUpdated} fatura(s), ${result.entriesUpdated} item(ns) e ${result.paymentsUpdated} pagamento(s) atualizados.`,
          `Snapshot para rollback: ${result.snapshotId}.`,
          'Nenhum lançamento financeiro foi criado ou excluído.',
        ].join('\n'),
        'Ativação atômica concluída',
        'success'
      );
    } catch (e: unknown) {
      console.error('[CreditCardInvoiceCyclesModal]', e);
      setBusy(false);
      setOperation(null);
      setApplyProgress(null);
      const raw = unknownErrorMessage(e, 'Falha ao ativar a projeção.');
      const isNetwork =
        /failed to fetch|network|connection closed|err_connection/i.test(raw) ||
        (e instanceof TypeError && raw.includes('fetch'));
      await appAlert(
        isNetwork
          ? 'A conexão com o servidor foi interrompida. O banco confirma a ativação de forma indivisível; audite novamente para verificar o estado antes de repetir.'
          : raw || 'Falha ao ativar a projeção. Nenhuma alteração parcial é aceita pelo banco.',
        'Ativação não concluída',
        'danger'
      );
    }
  }, [
    user,
    engineOn,
    atomicActivationEnabled,
    effectiveFilterAccountId,
    rows,
    shadowAudit,
    validateRow,
    rowIsoValues,
    activateCreditCardRebuildFromImportHistory,
  ]);

  const handleDeterministicPaymentRepair = useCallback(async () => {
    if (!effectiveFilterAccountId || !shadowAudit) return;
    const repairRows = shadowAudit.comparison.repairablePersistedPaymentRowIds;
    if (repairRows.length === 0) return;

    const confirmed = await appConfirm(
      [
        `A auditoria encontrou ${repairRows.length} materialização(ões) antiga(s) de pagamento sem identidade.`,
        'O banco removera somente essas linhas redundantes, preservando as linhas vinculadas as transacoes originais.',
        'Nenhuma transacao, fatura, importacao ou metadado do extrato sera apagado.',
        'Um snapshot individual será criado antes da remoção para permitir rollback exato.',
      ].join('\n'),
      'Reparar pagamento duplicado',
      'Criar snapshot e reparar',
      'warning'
    );
    if (!confirmed) return;

    const cycles = rows.map((row) => {
      const { referenceMonth, dueDate } = rowIsoValues(row);
      return { fileName: row.displayOrigin, referenceMonth, dueDate };
    });

    setBusy(true);
    setOperation('repair');
    setApplyProgress('Reauditando, bloqueando a revisão e criando o snapshot do reparo...');
    try {
      const result = await repairAtomicCardPaymentDuplicates(
        effectiveFilterAccountId,
        cycles,
        shadowAudit
      );
      setShadowAudit(result.postRepairAudit);
      setLatestRollback(null);
      setLatestPaymentRepairRollback({
        snapshotId: result.snapshotId,
        accountId: effectiveFilterAccountId,
        appliedAt: new Date().toISOString(),
      });
      await appAlert(
        [
          `${result.deletedPayments} materialização(ões) redundante(s) removida(s).`,
          'As transacoes e as linhas canonicas foram preservadas.',
          `Snapshot para rollback: ${result.snapshotId}.`,
          'A auditoria foi executada novamente automaticamente; confira o novo resultado antes de qualquer ativacao.',
        ].join('\n'),
        'Reparo atômico concluído',
        'success'
      );
    } catch (error: unknown) {
      console.error('[CreditCardInvoiceCyclesModal][PaymentRepair]', error);
      await appAlert(
        unknownErrorMessage(
          error,
          'O reparo foi recusado. Nenhuma remoção parcial é aceita pelo banco.'
        ),
        'Reparo não concluído',
        'danger'
      );
    } finally {
      setBusy(false);
      setOperation(null);
      setApplyProgress(null);
    }
  }, [
    effectiveFilterAccountId,
    shadowAudit,
    rows,
    rowIsoValues,
    repairAtomicCardPaymentDuplicates,
  ]);

  const handlePaymentRepairRollback = useCallback(async () => {
    if (!latestPaymentRepairRollback) return;
    const confirmed = await appConfirm(
      'Restaurar exatamente as linhas removidas pelo último reparo? O banco recusará o rollback se a projeção tiver mudado depois dele.',
      'Desfazer reparo de pagamento',
      'Restaurar snapshot',
      'warning'
    );
    if (!confirmed) return;

    setBusy(true);
    setOperation('repairRollback');
    setApplyProgress('Validando a revisão e restaurando o snapshot do reparo...');
    try {
      const result = await rollbackAtomicCardPaymentRepair(
        latestPaymentRepairRollback.snapshotId
      );
      setLatestPaymentRepairRollback(null);
      setShadowAudit(null);
      await appAlert(
        `${result.restoredPayments} pagamento(s) materializado(s) restaurado(s). Execute uma nova auditoria para confirmar o estado.`,
        'Rollback do reparo concluido',
        'success'
      );
    } catch (error: unknown) {
      console.error('[CreditCardInvoiceCyclesModal][PaymentRepairRollback]', error);
      await appAlert(
        unknownErrorMessage(
          error,
          'O rollback foi recusado. Nenhuma restauracao parcial foi aceita.'
        ),
        'Rollback do reparo não concluído',
        'danger'
      );
    } finally {
      setBusy(false);
      setOperation(null);
      setApplyProgress(null);
    }
  }, [latestPaymentRepairRollback, rollbackAtomicCardPaymentRepair]);

  const handleRollback = useCallback(async () => {
    if (!latestRollback) return;
    const confirmed = await appConfirm(
      `Desfazer integralmente a ativação ${latestRollback.shadowChecksum}? O banco só permitirá o rollback se nenhuma linha da projeção tiver mudado depois da ativação.`,
      'Desfazer ativação atômica',
      'Restaurar snapshot',
      'warning'
    );
    if (!confirmed) return;

    setBusy(true);
    setOperation('rollback');
    setApplyProgress('Validando a revisão atual e restaurando o snapshot em uma única transação…');
    try {
      const result = await rollbackAtomicCardRebuild(latestRollback.snapshotId);
      setLatestRollback(null);
      setShadowAudit(null);
      await appAlert(
        `Snapshot ${result.snapshotId} restaurado com sucesso. A projeção voltou exatamente à revisão anterior.`,
        'Rollback concluído',
        'success'
      );
    } catch (error: unknown) {
      console.error('[CreditCardInvoiceCyclesModal][AtomicRollback]', error);
      await appAlert(
        unknownErrorMessage(
          error,
          'O rollback foi recusado. Nenhuma alteração parcial foi aceita pelo banco.'
        ),
        'Rollback não concluído',
        'danger'
      );
    } finally {
      setBusy(false);
      setOperation(null);
      setApplyProgress(null);
    }
  }, [latestRollback, rollbackAtomicCardRebuild]);

  const handleShadowAudit = useCallback(async () => {
    if (!user) {
      await appAlert('Faça login para continuar.', 'Sessão', 'warning');
      return;
    }
    if (!effectiveFilterAccountId) {
      await appAlert('Selecione o cartão de crédito.', 'Cartão', 'warning');
      return;
    }
    if (!hasAuditSource) {
      await appAlert('Não há lançamentos importados ou manuais deste cartão para auditar.', 'Histórico', 'warning');
      return;
    }

    for (const row of rows) {
      const error = validateRow(row);
      if (error) {
        await appAlert(error, 'Validação', 'warning');
        return;
      }
    }

    const cycles = rows.map((row) => {
      const { referenceMonth, dueDate } = rowIsoValues(row);
      return {
        fileName: row.displayOrigin,
        referenceMonth,
        dueDate,
      };
    });

    setBusy(true);
    setOperation('audit');
    setApplyProgress('Montando a projeção em memória e comparando com o banco, sem alterar dados…');
    try {
      const result = await auditCreditCardRebuildFromImportHistory(
        effectiveFilterAccountId,
        cycles
      );
      setShadowAudit(result);

      const { shadow, persisted, comparison } = result;
      const statusLabel =
        comparison.status === 'blocked'
          ? 'BLOQUEADA'
          : comparison.status === 'identical'
            ? 'IDÊNTICA'
            : comparison.status === 'informational'
              ? 'CONCILIADA — somente evidências protegidas permanecem'
            : comparison.safeToActivate
              ? 'DIFERENTE — apta para uma futura troca atômica'
              : 'DIFERENTE — requer investigação antes de qualquer troca';
      const issueLines = shadow.issues
        .slice(0, 5)
        .map((issue) => `• ${issue.message}`);
      await appAlert(
        [
          `Auditoria ${statusLabel}. Nenhum dado foi alterado.`,
          `Fonte atual: ${persisted.source}.`,
          `Sombra: ${shadow.sourceTransactionCount} transações, ${shadow.projectedEntryCount} itens, ${shadow.projectedPaymentCount} pagamentos e ${shadow.statements.length} faturas.`,
          `Diferenças: ${comparison.differenceCount}. Bloqueios: ${shadow.blockers.length}. Alertas: ${shadow.warnings.length}.`,
          `Duplicidades atuais: ${comparison.duplicatePersistedTransactionIds.length} transação(ões) (${comparison.repairablePersistedEntryRowIds.length} linha(s) com reparo determinístico; ${comparison.conflictingDuplicatePersistedTransactionIds.length} ID(s) ambíguo(s)), ${comparison.duplicatePersistedPaymentTransactionIds.length} pagamento(s) por ID, ${comparison.suspiciousPersistedPaymentEventKeys.length} evento(s) de pagamento sem identidade e ${comparison.duplicatePersistedStatementKeys.length} competência(s).`,
          `Ausentes na projeção atual: ${comparison.missingTransactionIds.length} transação(ões), ${comparison.missingPaymentKeys.length} pagamento(s) e ${comparison.missingStatementKeys.length} fatura(s).`,
          `Órfãos na projeção atual: ${comparison.orphanTransactionIds.length} transação(ões), ${comparison.orphanPaymentKeys.length} pagamento(s) e ${comparison.orphanStatementKeys.length} fatura(s).`,
          `Alterados: ${comparison.changedTransactionIds.length} transação(ões), ${comparison.changedPaymentTransactionIds.length} pagamento(s) e ${comparison.changedStatementKeys.length} fatura(s).`,
          `Faturas com metadados protegidos: ${comparison.protectedMetadataStatementKeys.length}.`,
          comparison.status === 'informational'
            ? 'Nova troca atômica necessária: não; a projeção estrutural já está conciliada.'
            : `Apta para futura troca atômica: ${comparison.safeToActivate ? 'sim' : 'não'}.`,
          `Checksum: ${shadow.checksum}.`,
          ...issueLines,
        ].join('\n'),
        comparison.status === 'blocked' ||
          (comparison.status === 'different' && !comparison.safeToActivate)
          ? 'Auditoria requer investigação'
          : comparison.status === 'informational'
            ? 'Auditoria conciliada'
            : 'Auditoria somente leitura',
        comparison.status === 'blocked' ||
          (comparison.status === 'different' && !comparison.safeToActivate)
          ? 'danger'
          : comparison.status === 'identical' || comparison.status === 'informational'
            ? 'success'
            : 'warning'
      );
    } catch (error: unknown) {
      console.error('[CreditCardInvoiceCyclesModal][ShadowAudit]', error);
      setShadowAudit(null);
      await appAlert(
        unknownErrorMessage(error, 'Falha ao auditar a projeção do cartão.'),
        'Auditoria não concluída',
        'danger'
      );
    } finally {
      setBusy(false);
      setOperation(null);
      setApplyProgress(null);
    }
  }, [
    user,
    effectiveFilterAccountId,
    hasAuditSource,
    rows,
    validateRow,
    rowIsoValues,
    auditCreditCardRebuildFromImportHistory,
  ]);

  const handleInvoiceDueDayChange = useCallback(
    (value: string) => {
      setShadowAudit(null);
      const sanitized = sanitizeInvoiceDueDayInput(value);
      setInvoiceDueDayStr(sanitized);
      setRows((prev) =>
        sortRowsByVencimentoDesc(
          prev.map((r) => {
            const day = effectiveDueDayForAccount(r.accountId, sanitized, accounts);
            const ven = updateDueDayPreservingKnownMonth(r, day);
            return { ...r, vencimentoBR: ven };
          })
        )
      );
    },
    [accounts]
  );

  const handleCompetenciaChange = useCallback(
    (key: string, value: string) => {
      setShadowAudit(null);
      setRows((prev) =>
        sortRowsByVencimentoDesc(
          prev.map((r) => {
            if (r.key !== key) return r;
            const iso = parseMMAAAAToIsoMonth(value.trim());
            const day = effectiveDueDayForAccount(r.accountId, invoiceDueDayStr, accounts);
            const ven = iso && day != null ? computeVencimentoBRFromCompetenceIsoMonth(iso, day) : '';
            return { ...r, competenciaBR: value, vencimentoBR: ven };
          })
        )
      );
    },
    [invoiceDueDayStr, accounts]
  );

  const summaryHint = useMemo(() => {
    if (!engineOn) return 'Motor de cartão desativado para este usuário.';
    if (!effectiveFilterAccountId) return 'Selecione o cartão para listar os arquivos do histórico de importações.';
    if (rows.length === 0 && manualCardTransactionCount > 0) {
      return `${manualCardTransactionCount} lançamento(s) manual(is) disponível(is) para auditoria somente leitura.`;
    }
    if (rows.length === 0) return 'Nenhum arquivo deste cartão no histórico (nem transações vinculadas).';
    return `${rows.length} arquivo(s) e ${manualCardTransactionCount} lançamento(s) manual(is) em «${filteredAccountName}».`;
  }, [engineOn, rows.length, manualCardTransactionCount, filteredAccountName, effectiveFilterAccountId]);

  const modalTitle = filteredAccountName
    ? `Faturas pelo histórico — ${filteredAccountName}`
    : 'Reconstruir faturas pelo histórico de importações';

  const showAccountColumn = !effectiveFilterAccountId;
  const showCardPicker = !filterAccountId;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !busy && onClose()}
      title={modalTitle}
      overlayClassName={overlayClassName}
      className="max-w-5xl"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => !busy && onClose()}>
            Fechar
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !effectiveFilterAccountId || rows.length === 0}
            onClick={handleSaveCycleMetadata}
          >
            {operation === 'save' ? 'Salvando…' : 'Salvar competências'}
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !effectiveFilterAccountId || !hasAuditSource}
            onClick={handleShadowAudit}
          >
            {operation === 'audit' ? 'Auditando…' : 'Auditar sem alterar dados'}
          </Button>
          {latestPaymentRepairRollback && (
            <Button variant="secondary" disabled={busy} onClick={handlePaymentRepairRollback}>
              {operation === 'repairRollback'
                ? 'Restaurando reparo...'
                : 'Desfazer último reparo'}
            </Button>
          )}
          {Boolean(shadowAudit?.comparison.repairablePersistedPaymentRowIds.length) && (
            <Button
              variant="secondary"
              disabled={busy || !atomicActivationEnabled || !effectiveFilterAccountId}
              onClick={handleDeterministicPaymentRepair}
              title={
                atomicActivationEnabled
                  ? 'Remove somente materializações antigas com contraparte canônica e cria snapshot para rollback.'
                  : 'Reparo desligado pelo kill switch individual da Sprint 2C.'
              }
            >
              {operation === 'repair'
                ? 'Reparando duplicidade...'
                : 'Reparar duplicidade com snapshot'}
            </Button>
          )}
          {latestRollback && (
            <Button variant="secondary" disabled={busy} onClick={handleRollback}>
              {operation === 'rollback' ? 'Restaurando…' : 'Desfazer última ativação'}
            </Button>
          )}
          <Button
            disabled={
              busy ||
              !engineOn ||
              !atomicActivationEnabled ||
              !effectiveFilterAccountId ||
              rows.length === 0 ||
              !shadowAudit?.comparison.safeToActivate
            }
            onClick={handleApplyWithConfirm}
            title={
              !atomicActivationEnabled
                ? 'Ativação desligada pelo kill switch individual da Sprint 2C.'
                : shadowAudit?.comparison.safeToActivate
                ? 'A auditoria atual permite atualizar as linhas existentes atomicamente.'
                : 'A ativação só é liberada após uma auditoria segura e sem criação ou exclusão de linhas.'
            }
          >
            {operation === 'rebuild' ? 'Ativando…' : 'Ativar projeção com snapshot'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-300 leading-relaxed">
          Lista os arquivos do <strong className="text-white">histórico de importações</strong> do cartão escolhido (ex.: Cartão XP).
          Para cada arquivo, confira ou informe a <strong className="text-white">competência</strong> (<strong className="text-white">MM/AAAA</strong>) e o{' '}
          <strong className="text-white">vencimento</strong> (o valor confirmado no histórico é preservado; o cálculo automático só preenche datas ausentes).
          Use <strong className="text-white">Salvar competências</strong> para registrar apenas esses metadados, sem alterar lançamentos ou conciliação.
          Uma ativação só é liberada depois de uma auditoria segura. A Sprint 2C atualiza apenas linhas que já existem, em uma única transação, e cria um snapshot individual para desfazer. A projeção <strong className="text-white">soma as linhas de saída</strong> do extrato para o total da fatura e os{' '}
          <strong className="text-white">estornos</strong> na competência do arquivo; <strong className="text-white">pagamentos de fatura</strong> no CSV quitam a competência <strong className="text-white">anterior</strong> (padrão N+1 do extrato).
        </p>

        {showCardPicker && (
          <Select
            label="Cartão (conta escolhida na importação)"
            value={selectedCardAccountId}
            onChange={(e) => setSelectedCardAccountId(e.target.value)}
            disabled={busy || creditCardAccounts.length === 0}
          >
            <option value="">Selecione o cartão…</option>
            {creditCardAccounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.Nome_Conta}
              </option>
            ))}
          </Select>
        )}
        <p className="text-xs text-gray-500">{summaryHint}</p>
        <p className="text-[11px] text-slate-600">
          Arquivos ordenados por <strong className="text-slate-400">vencimento</strong> (mais recente no topo) para facilitar a auditoria.
        </p>

        {busy && applyProgress && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-2.5 text-sm text-cyan-100"
          >
            <span className="font-medium text-white">Em andamento.</span> {applyProgress}
          </div>
        )}

        {shadowAudit && (
          <div
            className={`rounded-xl border px-3 py-3 text-xs ${
              shadowAudit.comparison.status === 'blocked' ||
              (shadowAudit.comparison.status === 'different' &&
                !shadowAudit.comparison.safeToActivate)
                ? 'border-red-500/40 bg-red-500/10 text-red-100'
                : shadowAudit.comparison.status === 'identical' ||
                    shadowAudit.comparison.status === 'informational'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-100'
            }`}
          >
            <p className="font-semibold text-white">
              Sprint 2C — auditoria e ativação atômica:{' '}
              {shadowAudit.comparison.status === 'blocked'
                ? 'bloqueada'
                : shadowAudit.comparison.status === 'identical'
                  ? 'projeção idêntica'
                  : shadowAudit.comparison.status === 'informational'
                    ? 'projeção conciliada; evidências preservadas'
                  : shadowAudit.comparison.safeToActivate
                    ? 'diferenças reparáveis encontradas'
                    : 'diferenças que exigem investigação'}
            </p>
            <p className="mt-1 leading-relaxed">
              {shadowAudit.shadow.sourceTransactionCount} transações ·{' '}
              {shadowAudit.shadow.projectedEntryCount} itens ·{' '}
              {shadowAudit.shadow.projectedPaymentCount} pagamentos ·{' '}
              {shadowAudit.shadow.statements.length} faturas ·{' '}
              {shadowAudit.comparison.differenceCount} diferenças ({shadowAudit.comparison.structuralDifferenceCount} estruturais) ·{' '}
              {shadowAudit.shadow.blockers.length} bloqueios ·{' '}
              {shadowAudit.comparison.status === 'informational'
                ? 'nenhuma nova troca atômica necessária'
                : `futura troca atômica ${shadowAudit.comparison.safeToActivate ? 'apta' : 'não apta'}`}. Nenhum dado foi gravado.
            </p>
            <p className="mt-1 font-mono text-[10px] opacity-75">{shadowAudit.shadow.checksum}</p>
            {shadowAuditForensics && (
              <div className="mt-3 rounded-lg border border-cyan-300/25 bg-slate-950/45 px-3 py-3 text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">Etapa forense — causas agregadas</p>
                  <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
                    somente leitura · sem identificadores
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-slate-300">
                  Ação recomendada:{' '}
                  <strong className="text-white">
                    {shadowAuditForensics.recommendedAction === 'investigate'
                      ? 'investigar antes de reparar'
                      : shadowAuditForensics.recommendedAction === 'repair-narrow'
                        ? 'reparo estreito com snapshot'
                        : shadowAuditForensics.recommendedAction === 'activate'
                          ? 'ativação individual com snapshot'
                          : 'observar sem alterar'}
                  </strong>
                  . O agrupamento abaixo não contém descrições, nomes de arquivos nem IDs de transações.
                </p>

                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Itens alterados por campo</p>
                    {shadowAuditForensics.entryChangeProfiles.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {shadowAuditForensics.entryChangeProfiles.slice(0, 6).map((profile) => (
                          <li key={profile.key} className="flex justify-between gap-2">
                            <span>{profile.fields.map((field) => FORENSIC_FIELD_LABELS[field] || field).join(' + ')}</span>
                            <strong className="text-white">{profile.count}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-400">Nenhuma alteração de item.</p>
                    )}
                  </div>

                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Faturas alteradas por campo</p>
                    {shadowAuditForensics.statementChangeProfiles.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {shadowAuditForensics.statementChangeProfiles.slice(0, 6).map((profile) => (
                          <li key={profile.key} className="flex justify-between gap-2">
                            <span>{profile.fields.map((field) => FORENSIC_FIELD_LABELS[field] || field).join(' + ')}</span>
                            <strong className="text-white">{profile.count}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-400">Nenhuma alteração de fatura.</p>
                    )}
                  </div>

                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Pagamentos alterados por campo</p>
                    {shadowAuditForensics.paymentChangeProfiles.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {shadowAuditForensics.paymentChangeProfiles.slice(0, 6).map((profile) => (
                          <li key={profile.key} className="flex justify-between gap-2">
                            <span>{profile.fields.map((field) => FORENSIC_FIELD_LABELS[field] || field).join(' + ')}</span>
                            <strong className="text-white">{profile.count}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-400">Nenhuma alteração de pagamento.</p>
                    )}
                  </div>
                </div>

                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Duplicidades de itens</p>
                    {shadowAuditForensics.duplicateTransactionCohorts.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {shadowAuditForensics.duplicateTransactionCohorts.map((cohort) => (
                          <li key={cohort.code} className="flex justify-between gap-2">
                            <span>{FORENSIC_DUPLICATE_LABELS[cohort.code]}</span>
                            <strong className="text-white">{cohort.count}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-400">Nenhuma duplicidade de item.</p>
                    )}
                  </div>

                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Itens ausentes por competência</p>
                    {shadowAuditForensics.missingTransactionsByStatement.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {shadowAuditForensics.missingTransactionsByStatement.slice(0, 8).map((cohort) => (
                          <li key={cohort.statementKey} className="flex justify-between gap-2">
                            <span>{cohort.statementKey === 'unknown' ? 'competência não identificada' : cohort.statementKey}</span>
                            <strong className="text-white">{cohort.count}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-400">Nenhum item ausente.</p>
                    )}
                  </div>
                </div>

                <div className="mt-2 rounded border border-white/10 bg-white/[0.03] p-2">
                  <p>
                    Pagamentos órfãos: <strong className="text-white">{shadowAuditForensics.orphanPaymentsWithIdentity}</strong> com identidade e{' '}
                    <strong className="text-white">{shadowAuditForensics.orphanPaymentsWithoutIdentity}</strong> sem identidade · candidatos determinísticos:{' '}
                    <strong className="text-white">{shadowAuditForensics.repairableEntryRows}</strong> item(ns) e{' '}
                    <strong className="text-white">{shadowAuditForensics.repairablePaymentRows}</strong> pagamento(s) · faturas protegidas:{' '}
                    <strong className="text-white">{shadowAuditForensics.protectedStatementCount}</strong>.
                  </p>
                  {shadowAuditForensics.recommendationCodes.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-300">
                      {shadowAuditForensics.recommendationCodes.map((code) => (
                        <li key={code}>{FORENSIC_RECOMMENDATION_LABELS[code]}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
            {shadowAuditLineage && (
              <div className="mt-3 rounded-lg border border-violet-300/25 bg-slate-950/45 px-3 py-3 text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">Etapa forense — conservação e linhagem</p>
                  <span className="rounded-full border border-violet-300/30 bg-violet-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-100">
                    explicativo · não autoriza reparo
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-slate-300">
                  Diagnóstico: <strong className="text-white">{LINEAGE_STATUS_LABELS[shadowAuditLineage.status]}</strong>.
                  O pareamento usa somente assinaturas de conteúdo em memória; nenhuma linha foi escolhida para exclusão ou atualização.
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Linhas projetadas / persistidas</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditLineage.conservation.projectedRowCount} / {shadowAuditLineage.conservation.persistedRowCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Identidades únicas projetadas / atuais</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditLineage.conservation.projectedUniqueIdentityCount} / {shadowAuditLineage.conservation.persistedUniqueIdentityCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Identidades ausentes / linhas excedentes</p>
                    <p className="mt-1 text-base font-semibold text-white">
                      {shadowAuditLineage.conservation.missingIdentityCount} / {shadowAuditLineage.conservation.duplicateExcessRowCount}
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-slate-400">Balanço de identidade</p>
                    <p className={`mt-1 text-base font-semibold ${shadowAuditLineage.conservation.missingBalancedByDuplicateSurplus ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {shadowAuditLineage.conservation.missingIdentityCount === 0 && shadowAuditLineage.conservation.duplicateExcessRowCount === 0
                        ? 'sem déficit'
                        : shadowAuditLineage.conservation.missingBalancedByDuplicateSurplus
                          ? 'compensado exatamente'
                          : 'ainda não compensado'}
                    </p>
                  </div>
                </div>

                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Explicação por assinatura de conteúdo</p>
                    {shadowAuditLineage.matchProfiles.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {shadowAuditLineage.matchProfiles.map((profile) => (
                          <li key={profile.code} className="flex justify-between gap-2">
                            <span>{LINEAGE_MATCH_LABELS[profile.code]}</span>
                            <strong className="text-white">{profile.count}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-400">Nenhuma quebra de identidade para explicar.</p>
                    )}
                    <p className="mt-2 border-t border-white/10 pt-2 text-slate-300">
                      Explicadas: <strong className="text-white">{shadowAuditLineage.matchedIdentityCount}</strong> · ainda sem explicação:{' '}
                      <strong className="text-white">{shadowAuditLineage.unexplainedMissingIdentityCount}</strong> · excedentes sem correspondência:{' '}
                      <strong className="text-white">{shadowAuditLineage.unexplainedSurplusRowCount}</strong>.
                    </p>
                  </div>

                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-semibold text-white">Coortes de origem afetadas</p>
                    {shadowAuditLineage.sourceCohorts.length > 0 ? (
                      <ul className="mt-1 space-y-1.5">
                        {shadowAuditLineage.sourceCohorts.slice(0, 8).map((cohort) => (
                          <li key={cohort.cohort} className="rounded border border-white/5 bg-black/10 px-2 py-1.5">
                            <div className="flex flex-wrap justify-between gap-2">
                              <strong className="text-white">{cohort.cohort}</strong>
                              <span>{cohort.statementKeys.join(', ') || 'competência não identificada'}</span>
                            </div>
                            <p className="mt-0.5 text-slate-400">
                              {cohort.projectedEntryCount} linha(s) · {cohort.missingIdentityCount} identidade(s) ausente(s) ·{' '}
                              {cohort.duplicateExcessRowCount} excedente(s) · {cohort.repeatedSourceRowSignatureCount} assinatura(s) de origem repetida(s)
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-slate-400">Nenhuma coorte de origem afetada.</p>
                    )}
                    {shadowAuditLineage.sourceCohorts.length > 8 && (
                      <p className="mt-1 text-slate-500">
                        Mais {shadowAuditLineage.sourceCohorts.length - 8} coorte(s) preservada(s) no resumo agregado.
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-2 rounded border border-white/10 bg-white/[0.03] p-2">
                  <p>
                    Grupos de identidade duplicada: <strong className="text-white">{shadowAuditLineage.conservation.duplicateIdentityGroupCount}</strong> ·{' '}
                    identidades órfãs: <strong className="text-white">{shadowAuditLineage.conservation.orphanIdentityCount}</strong> ·{' '}
                    linhas com reparo determinístico já comprovado: <strong className="text-white">{shadowAuditLineage.deterministicRepairRowCount}</strong>.
                  </p>
                  {shadowAuditLineage.recommendationCodes.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-300">
                      {shadowAuditLineage.recommendationCodes.map((code) => (
                        <li key={code}>{LINEAGE_RECOMMENDATION_LABELS[code]}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
            {shadowAuditDiagnosticLines.length > 0 && (
              <details className="mt-3 rounded-lg border border-white/15 bg-slate-950/35 px-3 py-2">
                <summary className="cursor-pointer select-none font-semibold text-white">
                  Ver diagnóstico detalhado ({shadowAuditDiagnosticLines.length} linhas)
                </summary>
                <ol className="mt-2 list-decimal space-y-1.5 pl-5 leading-relaxed">
                  {shadowAuditDiagnosticLines.map((line, index) => (
                    <li key={`${index}-${line}`}>{line}</li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        )}

        {rows.length > 0 && (
          <div className="rounded-xl border border-slate-700 bg-slate-900/30 p-3 space-y-2">
            <Input
              label="Dia de vencimento da fatura"
              type="text"
              inputMode="numeric"
              placeholder="ex.: 15"
              autoComplete="off"
              value={invoiceDueDayStr}
              onChange={(e) => handleInvoiceDueDayChange(e.target.value)}
              title="Dia do mês em que a fatura vence (1 a 31)"
              helpText={
                showAccountColumn
                  ? 'Opcional se cada cartão já tiver «dia de vencimento» cadastrado nas configurações da conta; nesse caso deixe em branco para usar o valor da conta.'
                  : 'Se estiver em branco, usa-se o dia cadastrado neste cartão (configurações da conta), quando existir.'
              }
              className="text-sm"
            />
          </div>
        )}

        {rows.length > 0 && (
          <div className="rounded-xl border border-slate-700 overflow-hidden">
            <div className="max-h-[min(52vh,520px)] overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-800/95 border-b border-slate-700">
                  <tr className="text-left text-[10px] uppercase tracking-wider text-gray-400">
                    <th className="px-3 py-2 font-semibold">Arquivo / origem</th>
                    {showAccountColumn && <th className="px-3 py-2 font-semibold">Cartão</th>}
                    <th className="px-3 py-2 font-semibold text-center">Lanç.</th>
                    <th className="px-3 py-2 font-semibold">Competência (MM/AAAA)</th>
                    <th className="px-3 py-2 font-semibold">Vencimento</th>
                    <th className="px-3 py-2 font-semibold text-right">Total fatura</th>
                    <th className="px-3 py-2 font-semibold text-right">Pagamentos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {rowsSortedByVencimento.map((r) => (
                    <tr key={r.key} className="bg-slate-900/40 hover:bg-slate-900/70">
                      <td className="px-3 py-2 align-top text-gray-200 max-w-[200px] break-all">{r.displayOrigin}</td>
                      {showAccountColumn && (
                        <td className="px-3 py-2 align-top text-gray-300 whitespace-nowrap">{r.accountName}</td>
                      )}
                      <td className="px-3 py-2 align-top text-center text-gray-400">{r.txCount}</td>
                      <td className="px-3 py-2 align-top min-w-[118px]">
                        <Input
                          label=""
                          type="text"
                          inputMode="numeric"
                          placeholder="MM/AAAA"
                          autoComplete="off"
                          value={r.competenciaBR}
                          onChange={(e) => handleCompetenciaChange(r.key, e.target.value)}
                          className="text-xs py-1"
                          title="Mês de competência — MM/AAAA"
                        />
                      </td>
                      <td className="px-3 py-2 align-top min-w-[118px]">
                        <span
                          className="inline-block font-mono text-[11px] text-gray-300 pt-1.5 min-h-[32px]"
                          title="DD/MM/AAAA — vencimento confirmado no histórico"
                        >
                          {r.vencimentoBR.trim() || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top text-right text-rose-300 font-mono text-[11px] whitespace-nowrap">
                        {previewByRowKey.get(r.key)
                          ? formatCurrency(previewByRowKey.get(r.key)!.totals.statementTotal)
                          : '—'}
                      </td>
                      <td className="px-3 py-2 align-top text-right text-emerald-300 font-mono text-[11px] whitespace-nowrap">
                        {previewByRowKey.get(r.key)
                          ? formatCurrency(previewByRowKey.get(r.key)!.totals.totalPayments)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-[11px] text-gray-500 leading-snug">
          A prévia usa as linhas já importadas (aba Transações). Por arquivo, a coluna Pagamentos mostra o valor do CSV; no histórico por competência, esse valor abate a fatura do mês anterior.
        </p>
        <p className="text-[11px] text-amber-300/80 leading-snug">
          <strong>Auditar sem alterar dados</strong> apenas lê e compara importações e lançamentos manuais. <strong>Reconstruir faturas deste cartão</strong> altera a projeção e permanece bloqueado até a auditoria declarar a troca segura.
        </p>
      </div>
    </Modal>
  );
};

export default CreditCardInvoiceCyclesModal;
