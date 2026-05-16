import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { useAppStore } from '../../hooks/useAppStore';
import { appAlert, appConfirm } from '../../hooks/useDialogStore';
import { comparableImportOriginKey } from '../../utils/importOriginKey';
import { isCreditCardEngineEnabled } from '../../services/featureFlagService';
import type { Account, ImportLog, Transaction } from '../../types';

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

  rows.sort((a, b) => {
    const ac = a.accountName.localeCompare(b.accountName, 'pt-BR');
    if (ac !== 0) return ac;
    if (b.sortUploadMs !== a.sortUploadMs) return b.sortUploadMs - a.sortUploadMs;
    return a.displayOrigin.localeCompare(b.displayOrigin, 'pt-BR');
  });

  return rows;
}

/** Mantém edição local; se o usuário não digitou competência, usa o valor vindo do histórico (persistido). */
function mergeRowsPreserveInputs(
  fresh: CreditCardInvoiceCycleRow[],
  prev: CreditCardInvoiceCycleRow[],
  invoiceDueDayStr: string,
  accounts: Account[]
): CreditCardInvoiceCycleRow[] {
  const prevByKey = new Map(prev.map((r) => [r.key, r]));
  return fresh.map((r) => {
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
  const reprocessCreditCardImportByOrigin = useAppStore((s) => s.reprocessCreditCardImportByOrigin);
  const saveCardImportLotClassification = useAppStore((s) => s.saveCardImportLotClassification);
  const fetchTransactions = useAppStore((s) => s.fetchTransactions);
  const fetchImportLogs = useAppStore((s) => s.fetchImportLogs);

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

    const filterSig = filterAccountId ?? '';
    const filterChanged =
      prevFilterSigRef.current !== undefined && prevFilterSigRef.current !== filterSig;
    prevFilterSigRef.current = filterSig;

    // Durante «Aplicar», saveCardImportLotClassification dispara fetchImportLogs — não pode resetar a tabela.
    if (busy) return;

    const s = useAppStore.getState();
    const fresh = buildRowsFromStore({
      accounts: s.accounts,
      transactions: s.transactions,
      importLogs: s.importLogs,
      filterAccountId,
    });

    if (openedNow || filterChanged) {
      setRows(fresh);
      if (filterAccountId) {
        const acc = accounts.find((a) => a.id === filterAccountId);
        const dAcc = Number(acc?.dia_vencimento);
        const dayFromVen = fresh
          .filter((row) => row.accountId === filterAccountId)
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
  }, [isOpen, busy, filterAccountId, accounts, transactions, importLogs, invoiceDueDayStr]);

  const engineOn = user ? isCreditCardEngineEnabled(user) : false;

  const filteredAccountName = useMemo(
    () => (filterAccountId ? accounts.find((a) => a.id === filterAccountId)?.Nome_Conta ?? null : null),
    [filterAccountId, accounts]
  );

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
        'Ative o motor de cartão nas preferências para recalcular faturas a partir das importações.',
        'Motor de cartão',
        'warning'
      );
      return;
    }
    if (rows.length === 0) {
      await appAlert('Não há arquivos de cartão para processar.', 'Histórico', 'warning');
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
      `Reprocessar ${rows.length} arquivo(s) no motor com os valores informados?`,
      'Recalcular faturas',
      'Aplicar',
      'warning'
    );
    if (!confirmed) return;

    setBusy(true);
    setApplyProgress('Preparando…');
    const lines: string[] = [];
    let successes = 0;
    let rowErrors = 0;

    try {
      let index = 0;
      for (const r of rows) {
        index += 1;
        setApplyProgress(`Processando ${index}/${rows.length}: ${r.displayOrigin}`);
        const { referenceMonth: ref, dueDate: due } = rowIsoValues(r);
        const cardCycle = { mode: 'manual' as const, referenceLabel: ref, dueDate: due };
        try {
          const result = await reprocessCreditCardImportByOrigin(r.displayOrigin, { cardCycle });
          const logsSnapshot = useAppStore.getState().importLogs;
          const namesToSync = new Set<string>([r.displayOrigin]);
          logsSnapshot.forEach((log) => {
            if (comparableImportOriginKey(log.file_name) === r.originComparable) {
              namesToSync.add(log.file_name);
            }
          });
          for (const fileName of namesToSync) {
            await saveCardImportLotClassification(fileName, r.accountId, ref, due);
          }
          if (result.processed > 0) successes += 1;
          lines.push(
            `${result.processed > 0 ? '✓' : '—'} ${r.displayOrigin}: ${result.message} (${r.accountName})`
          );
        } catch (e: unknown) {
          rowErrors += 1;
          const msg = e instanceof Error ? e.message : 'erro';
          lines.push(`✗ ${r.displayOrigin}: ${msg}`);
        }
      }

      setApplyProgress('Atualizando transações e histórico…');
      await fetchTransactions();
      await fetchImportLogs();

      const head = `${successes}/${rows.length} origem(ns) atualizaram o motor com lançamentos processados.`;
      const body = lines.slice(0, 24).join('\n');
      const tail =
        lines.length > 24 ? `\n\n… (+${lines.length - 24} linhas — detalhe completo no console)` : '';
      console.log('[CreditCardInvoiceCyclesModal]', lines.join('\n'));

      const allRowsOk = rowErrors === 0;

      // Importante: liberar o botão antes do alerta — senão «Processando…» só some depois de clicar em «Entendi».
      setBusy(false);
      setApplyProgress(null);

      if (allRowsOk) {
        onClose();
      }

      await appAlert(
        allRowsOk
          ? `${head}\n\n${body}${tail}\n\n` +
              'Este aviso resume o que foi feito. Os cards e a lista de transações já refletem o recálculo.'
          : `${head}\n\n${body}${tail}\n\n` +
              `Houve falha em ${rowErrors} arquivo(s). Corrija os itens marcados com ✗ e tente de novo.`,
        allRowsOk ? 'Faturas recalculadas' : 'Recálculo com erros',
        allRowsOk ? (successes > 0 ? 'success' : 'warning') : 'danger'
      );
    } catch (e: unknown) {
      console.error('[CreditCardInvoiceCyclesModal]', e);
      setBusy(false);
      setApplyProgress(null);
      await appAlert(
        e instanceof Error ? e.message : 'Falha ao atualizar dados após o processamento. Veja o console (F12).',
        'Erro',
        'danger'
      );
    }
  }, [
    user,
    engineOn,
    rows,
    validateRow,
    rowIsoValues,
    reprocessCreditCardImportByOrigin,
    saveCardImportLotClassification,
    fetchTransactions,
    fetchImportLogs,
    invoiceDueDayStr,
    accounts,
    onClose,
  ]);

  const handleInvoiceDueDayChange = useCallback(
    (value: string) => {
      const sanitized = sanitizeInvoiceDueDayInput(value);
      setInvoiceDueDayStr(sanitized);
      setRows((prev) =>
        prev.map((r) => {
          const iso = parseMMAAAAToIsoMonth(r.competenciaBR.trim());
          const day = effectiveDueDayForAccount(r.accountId, sanitized, accounts);
          const ven = iso && day != null ? computeVencimentoBRFromCompetenceIsoMonth(iso, day) : '';
          return { ...r, vencimentoBR: ven };
        })
      );
    },
    [accounts]
  );

  const handleCompetenciaChange = useCallback(
    (key: string, value: string) => {
      setRows((prev) =>
        prev.map((r) => {
          if (r.key !== key) return r;
          const iso = parseMMAAAAToIsoMonth(value.trim());
          const day = effectiveDueDayForAccount(r.accountId, invoiceDueDayStr, accounts);
          const ven = iso && day != null ? computeVencimentoBRFromCompetenceIsoMonth(iso, day) : '';
          return { ...r, competenciaBR: value, vencimentoBR: ven };
        })
      );
    },
    [invoiceDueDayStr, accounts]
  );

  const summaryHint = useMemo(() => {
    if (!engineOn) return 'Motor de cartão desativado para este usuário.';
    if (rows.length === 0) return 'Nenhuma origem de cartão encontrada nas transações.';
    if (filteredAccountName) return `${rows.length} arquivo(s) neste cartão.`;
    return `Encontrado(s) ${rows.length} arquivo(s) distinto(s) vinculado(s) a cartões.`;
  }, [engineOn, rows.length, filteredAccountName]);

  const modalTitle = filteredAccountName
    ? `Competências — ${filteredAccountName}`
    : 'Competência e vencimento por arquivo';

  const showAccountColumn = !filterAccountId;

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
          <Button disabled={busy || !engineOn || rows.length === 0} onClick={handleApplyWithConfirm}>
            {busy ? 'Processando…' : 'Aplicar e recalcular faturas'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-300 leading-relaxed">
          Informe o <strong className="text-white">dia de vencimento</strong> da fatura (apenas o dia, 1–31). Para cada arquivo, digite só a{' '}
          <strong className="text-white">competência</strong> em <strong className="text-white">MM/AAAA</strong> (ex.:{' '}
          <span className="text-slate-400">03/2026</span>): o <strong className="text-white">vencimento</strong> é calculado automaticamente nesse dia no{' '}
          <strong className="text-white">mês seguinte</strong> à competência (março/2026 + dia 15 → 15/04/2026; meses com menos dias são ajustados ao último dia do mês).
          Valores já gravados no histórico de importações após «Aplicar» são <strong className="text-white">carregados de novo</strong> ao abrir este modal.
          Nada é inferido só pelo nome do arquivo. Ao aplicar, o motor recalcula os totais; em caso de sucesso o modal fecha e um resumo é exibido.
        </p>
        <p className="text-xs text-gray-500">{summaryHint}</p>
        <p className="text-[11px] text-slate-600">
          Lista ordenada pela data/hora em que cada arquivo entrou no histórico de importações (mais novo em cima); se não houver log,
          usa-se a data mais recente das transações daquele arquivo.
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
                    <th className="px-3 py-2 font-semibold">Vencimento (calculado)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {rows.map((r) => (
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-[11px] text-gray-500 leading-snug">
          Após recalcular, «Disponível» e «Fatura atual» no card passam a seguir o motor quando ele está ativo.
        </p>
      </div>
    </Modal>
  );
};

export default CreditCardInvoiceCyclesModal;
