import { comparableImportOriginKey } from '../utils/importOriginKey.ts';
import { creditCardRebuildFromImportHistoryService } from './creditCardRebuildFromImportHistoryService.ts';
import type { ImportHistoryRebuildCycle } from './creditCardRebuildFromImportHistoryService.ts';
import type { Account, ImportLog, Transaction } from '../types.ts';

/** DD/MM/AAAA → YYYY-MM-DD ou null */
export function parseBRDateToIso(value: string): string | null {
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
export function parseMMAAAAToIsoMonth(value: string): string | null {
  const s = value.trim().replace(/\s/g, '');
  const m = /^(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const mm = Number(m[1]);
  const yyyy = Number(m[2]);
  if (mm < 1 || mm > 12 || yyyy < 1900 || yyyy > 2100) return null;
  return `${yyyy}-${String(mm).padStart(2, '0')}`;
}

export function parseInvoiceDueDay(value: string): number | null {
  const n = Number(String(value).trim().replace(/\D/g, '') || NaN);
  if (!Number.isInteger(n) || n < 1 || n > 31) return null;
  return n;
}

export function sanitizeInvoiceDueDayInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits === '') return '';
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n) || n < 1) return '';
  return String(Math.min(31, Math.floor(n)));
}

/** Competência YYYY-MM → vencimento DD/MM/AAAA no mês civil seguinte. */
export function computeVencimentoBRFromCompetenceIsoMonth(isoMonth: string, dueDay: number): string {
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

export function effectiveDueDayForAccount(
  accountId: string,
  invoiceDueDayStr: string,
  accounts: Account[]
): number | null {
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
  competenciaBR: string;
  vencimentoBR: string;
  sortUploadMs: number;
}

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

/** Lê competência/vencimento persistidos no histórico de importações. */
export function cardCycleMetaFromImportedLog(
  log: ImportLog | undefined,
  accountId: string
): { competenciaBR: string; vencimentoBR: string } {
  if (!log) return { competenciaBR: '', vencimentoBR: '' };
  const det = Array.isArray(log.imported_details) ? log.imported_details : [];
  const accountRows = det.filter((d: any) => d?.ID_Conta === accountId);
  const pool = accountRows.length > 0 ? accountRows : det;
  const metaWithRef = pool.find((d: any) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(d?.Card_Reference_Label || '')));
  const metaWithDue = pool.find((d: any) =>
    /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(String(d?.Card_Due_Date || ''))
  );
  const ref = metaWithRef?.Card_Reference_Label ? String(metaWithRef.Card_Reference_Label) : '';
  const competenciaBR = ref ? `${ref.slice(5, 7)}/${ref.slice(0, 4)}` : '';
  let vencimentoBR = '';
  const due = metaWithRef?.Card_Due_Date || metaWithDue?.Card_Due_Date;
  if (typeof due === 'string' && /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(due)) {
    const [y, m, d] = due.split('-');
    vencimentoBR = `${d}/${m}/${y}`;
  }
  return { competenciaBR, vencimentoBR };
}

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

/**
 * Uma linha por arquivo/origem de importação — mesma fonte do modal «Faturas pelo histórico».
 */
export function buildInvoiceCycleRowsForAccount(params: {
  accounts: Account[];
  transactions: Transaction[];
  importLogs: ImportLog[];
  filterAccountId: string;
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
    if (t.ID_Conta !== filterAccountId) return;
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
    let competenciaBR = persisted.competenciaBR;
    if (!competenciaBR.trim()) {
      const suggested = creditCardRebuildFromImportHistoryService.suggestReferenceMonth(
        displayOrigin,
        logPick?.imported_details as unknown[] | undefined
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
      key: rowKey,
      accountId: agg.accountId,
      accountName: account.Nome_Conta,
      originComparable: agg.originComparable,
      displayOrigin,
      txCount: agg.txCount,
      competenciaBR,
      vencimentoBR,
      sortUploadMs,
    });
  });

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

  return sortRowsByVencimentoDesc(rows);
}

/** Converte linha do histórico para ciclo de prévia/reconstrução (igual ao modal de faturas). */
export function invoiceCycleRowToRebuildCycle(
  row: CreditCardInvoiceCycleRow,
  accounts: Account[],
  invoiceDueDayStr = ''
): ImportHistoryRebuildCycle {
  const refIso = parseMMAAAAToIsoMonth(row.competenciaBR.trim()) || '';
  const day = effectiveDueDayForAccount(row.accountId, invoiceDueDayStr, accounts);
  let dueDate = '';
  if (refIso && day != null) {
    const venBR = computeVencimentoBRFromCompetenceIsoMonth(refIso, day);
    dueDate = parseBRDateToIso(venBR) || '';
  } else {
    dueDate = parseBRDateToIso(row.vencimentoBR.trim()) || '';
  }
  return {
    fileName: row.displayOrigin,
    referenceMonth: refIso,
    dueDate,
  };
}
