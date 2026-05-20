import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { useAppStore } from '../../hooks/useAppStore';
import { appAlert, appConfirm } from '../../hooks/useDialogStore';
import { comparableImportOriginKey } from '../../utils/importOriginKey';
import { isCreditCardEngineEnabled } from '../../services/featureFlagService';
import { creditCardRebuildFromImportHistoryService } from '../../services/creditCardRebuildFromImportHistoryService';
import { formatCurrency } from '../../utils/formatters';
import type { Account, ImportLog, Transaction } from '../../types';
import Select from '../ui/Select';

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
    const iso = parseMMAAAAToIsoMonth(competenciaBR.trim());
    const day = effectiveDueDayForAccount(r.accountId, invoiceDueDayStr, accounts);

    let vencimentoBR = '';
    if (p.competenciaBR.trim() !== '') {
      vencimentoBR = iso && day != null ? computeVencimentoBRFromCompetenceIsoMonth(iso, day) : p.vencimentoBR;
    } else if (r.vencimentoBR.trim() !== '') {
      vencimentoBR = r.vencimentoBR;
    } else {
      vencimentoBR = iso && day != null ? computeVencimentoBRFromCompetenceIsoMonth(iso, day) : '';
    }

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
}

const CreditCardInvoiceCyclesModal: React.FC<Props> = ({ isOpen, onClose, filterAccountId }) => {
  const accounts = useAppStore((s) => s.accounts);
  const transactions = useAppStore((s) => s.transactions);
  const importLogs = useAppStore((s) => s.importLogs);
  const user = useAppStore((s) => s.user);
  const rebuildCreditCardFromImportHistory = useAppStore((s) => s.rebuildCreditCardFromImportHistory);

  const creditCardAccounts = useMemo(
    () => accounts.filter((a) => a.Tipo_Conta === 'Cartão de Crédito'),
    [accounts]
  );

  const [selectedCardAccountId, setSelectedCardAccountId] = useState('');
  const effectiveFilterAccountId = filterAccountId || selectedCardAccountId || null;

  const [rows, setRows] = useState<CreditCardInvoiceCycleRow[]>([]);
  const [invoiceDueDayStr, setInvoiceDueDayStr] = useState('');
  const [busy, setBusy] = useState(false);
  const [applyProgress, setApplyProgress] = useState<string | null>(null);
  const prevIsOpenRef = useRef(false);
  const prevFilterSigRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!isOpen) {
      prevIsOpenRef.current = false;
      prevFilterSigRef.current = undefined;
      setBusy(false);
      setApplyProgress(null);
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

  const engineOn = user ? isCreditCardEngineEnabled(user) : false;

  const filteredAccountName = useMemo(
    () =>
      effectiveFilterAccountId
        ? accounts.find((a) => a.id === effectiveFilterAccountId)?.Nome_Conta ?? null
        : null,
    [effectiveFilterAccountId, accounts]
  );

  const rowsSortedByVencimento = useMemo(() => sortRowsByVencimentoDesc(rows), [rows]);

  const previewByRowKey = useMemo(() => {
    const map = new Map<string, ReturnType<typeof creditCardRebuildFromImportHistoryService.previewCycles>[number]>();
    if (!effectiveFilterAccountId || rows.length === 0) return map;
    const previews = creditCardRebuildFromImportHistoryService.previewCycles(
      effectiveFilterAccountId,
      rowsSortedByVencimento.map((r) => {
        const refIso = parseMMAAAAToIsoMonth(r.competenciaBR.trim());
        const day = effectiveDueDayForAccount(r.accountId, invoiceDueDayStr, accounts);
        let dueDate = '';
        if (refIso && day != null) {
          const venBR = computeVencimentoBRFromCompetenceIsoMonth(refIso, day);
          dueDate = parseBRDateToIso(venBR) || '';
        } else {
          dueDate = parseBRDateToIso(r.vencimentoBR.trim()) || '';
        }
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
      const venIsoPersisted = parseBRDateToIso(r.vencimentoBR.trim());

      if (day != null) {
        const venBR = computeVencimentoBRFromCompetenceIsoMonth(refIso, day);
        const dueIso = parseBRDateToIso(venBR);
        if (!dueIso) {
          return `Não foi possível calcular o vencimento para "${r.displayOrigin}".`;
        }
        return null;
      }

      if (venIsoPersisted) {
        return null;
      }

      return `Informe o dia de vencimento (1–31) acima ou cadastre «dia de vencimento» na conta «${r.accountName}».`;
    },
    [invoiceDueDayStr, accounts]
  );

  const rowIsoValues = useCallback(
    (r: CreditCardInvoiceCycleRow) => {
      const referenceMonth = parseMMAAAAToIsoMonth(r.competenciaBR.trim())!;
      const day = effectiveDueDayForAccount(r.accountId, invoiceDueDayStr, accounts);
      let dueDate: string;
      if (day != null) {
        const venBR = computeVencimentoBRFromCompetenceIsoMonth(referenceMonth, day);
        const parsed = parseBRDateToIso(venBR);
        if (!parsed) {
          throw new Error(`Vencimento inválido para "${r.displayOrigin}".`);
        }
        dueDate = parsed;
      } else {
        const fromRow = parseBRDateToIso(r.vencimentoBR.trim());
        if (!fromRow) {
          throw new Error(`Defina o dia de vencimento ou complete o vencimento em "${r.displayOrigin}".`);
        }
        dueDate = fromRow;
      }
      return { referenceMonth, dueDate };
    },
    [invoiceDueDayStr, accounts]
  );

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

    for (const r of rows) {
      const err = validateRow(r);
      if (err) {
        await appAlert(err, 'Validação', 'warning');
        return;
      }
    }

    const confirmed = await appConfirm(
      `Reconstruir ${rows.length} fatura(s) somando as linhas de cada arquivo (compras/estornos na competência do arquivo; pagamentos de fatura abatem o mês anterior)?`,
      'Reconstruir pelo histórico',
      'Aplicar',
      'warning'
    );
    if (!confirmed) return;

    setBusy(true);
    setApplyProgress('Somando linhas por arquivo…');

    try {
      const cycles = rows.map((r) => {
        const { referenceMonth, dueDate } = rowIsoValues(r);
        return {
          fileName: r.displayOrigin,
          referenceMonth,
          dueDate,
        };
      });

      setApplyProgress(`Processando ${cycles.length} arquivo(s)…`);
      const result = await rebuildCreditCardFromImportHistory(effectiveFilterAccountId, cycles);

      const lines = result.previews.map((p) => {
        const t = p.totals;
        return `✓ ${p.fileName}: fatura ${formatCurrency(t.statementTotal)} · pagamentos ${formatCurrency(t.totalPayments)} · ${p.transactionCount} lanç.`;
      });

      setBusy(false);
      setApplyProgress(null);
      onClose();

      await appAlert(
        `${result.message}\n\n${lines.slice(0, 20).join('\n')}${lines.length > 20 ? `\n… (+${lines.length - 20})` : ''}`,
        result.processedFiles > 0 ? 'Faturas reconstruídas' : 'Nenhum arquivo processado',
        result.processedFiles > 0 ? 'success' : 'warning'
      );
    } catch (e: unknown) {
      console.error('[CreditCardInvoiceCyclesModal]', e);
      setBusy(false);
      setApplyProgress(null);
      const raw = e instanceof Error ? e.message : String(e);
      const isNetwork =
        /failed to fetch|network|connection closed|err_connection/i.test(raw) ||
        (e instanceof TypeError && raw.includes('fetch'));
      await appAlert(
        isNetwork
          ? 'Conexão com o servidor foi interrompida durante o recálculo (muitas requisições de uma vez). Verifique a internet, aguarde alguns segundos e tente novamente. Se persistir, reconstrua em lotes menores (menos arquivos por vez).'
          : raw || 'Falha ao reconstruir faturas. Veja o console (F12).',
        'Erro',
        'danger'
      );
    }
  }, [
    user,
    engineOn,
    effectiveFilterAccountId,
    rows,
    validateRow,
    rowIsoValues,
    rebuildCreditCardFromImportHistory,
    onClose,
  ]);

  const handleInvoiceDueDayChange = useCallback(
    (value: string) => {
      const sanitized = sanitizeInvoiceDueDayInput(value);
      setInvoiceDueDayStr(sanitized);
      setRows((prev) =>
        sortRowsByVencimentoDesc(
          prev.map((r) => {
            const iso = parseMMAAAAToIsoMonth(r.competenciaBR.trim());
            const day = effectiveDueDayForAccount(r.accountId, sanitized, accounts);
            const ven = iso && day != null ? computeVencimentoBRFromCompetenceIsoMonth(iso, day) : '';
            return { ...r, vencimentoBR: ven };
          })
        )
      );
    },
    [accounts]
  );

  const handleCompetenciaChange = useCallback(
    (key: string, value: string) => {
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
    if (rows.length === 0) return 'Nenhum arquivo deste cartão no histórico (nem transações vinculadas).';
    return `${rows.length} arquivo(s) em «${filteredAccountName}» — totais calculados pela soma das linhas de cada CSV.`;
  }, [engineOn, rows.length, filteredAccountName, effectiveFilterAccountId]);

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
      className="max-w-5xl"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => !busy && onClose()}>
            Fechar
          </Button>
          <Button
            disabled={busy || !engineOn || !effectiveFilterAccountId || rows.length === 0}
            onClick={handleApplyWithConfirm}
          >
            {busy ? 'Processando…' : 'Reconstruir faturas deste cartão'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-300 leading-relaxed">
          Lista os arquivos do <strong className="text-white">histórico de importações</strong> do cartão escolhido (ex.: Cartão XP).
          Para cada arquivo, confira ou informe a <strong className="text-white">competência</strong> (<strong className="text-white">MM/AAAA</strong>) e o{' '}
          <strong className="text-white">vencimento</strong> (calculado pelo dia informado no mês seguinte à competência).
          Ao aplicar, o sistema <strong className="text-white">soma as linhas de saída</strong> do extrato para o total da fatura e as{' '}
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
                          title="DD/MM/AAAA — mês seguinte à competência"
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
      </div>
    </Modal>
  );
};

export default CreditCardInvoiceCyclesModal;
