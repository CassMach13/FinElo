import type { ImportLog } from '../types';
import { comparableImportOriginKey } from './importOriginKey';

export type ImportLogAlertLevel = 'ok' | 'warn' | 'error';

export interface ImportLogAlertResult {
  level: ImportLogAlertLevel;
  badges: string[];
}

/** Contexto opcional para distinguir fragilidades do motor de cartão vs. extratos de conta corrente. */
export interface ImportLogAlertContext {
  accounts?: Array<{ id: string; Tipo_Conta?: string }>;
  transactions?: Array<{ Origem?: string | null; ID_Conta?: string | null; ID_Transacao?: string | null }>;
}

export function isImportedDetailRowsIncomplete(rows: unknown[]): boolean {
  if (!Array.isArray(rows) || rows.length === 0) return true;
  if (rows.length > 1) return false;
  const row = rows[0] as Record<string, unknown> | undefined;
  return !Boolean(row?.Data || row?.Descricao || row?.Descricao_Original || row?.Nome_Fantasia || row?.Valor);
}

export function importedDetailsHasTransactionIds(rows: unknown[]): boolean {
  if (!Array.isArray(rows)) return false;
  return rows.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const o = item as Record<string, unknown>;
    const tid = o.ID_Transacao ?? o.transaction_id ?? o.transactionId;
    return tid !== undefined && tid !== null && `${tid}` !== '';
  });
}

function importedDetailsSuggestCardCycle(rows: unknown[]): boolean {
  if (!Array.isArray(rows)) return false;
  return rows.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const o = item as Record<string, unknown>;
    return Boolean(o.Card_Reference_Label || o.Card_Due_Date || o.Card_Cycle_Mode);
  });
}

function inferDominantAccountIdForImportLog(log: ImportLog, ctx?: ImportLogAlertContext): string | undefined {
  const txs = ctx?.transactions;
  if (!txs?.length) return undefined;
  const key = comparableImportOriginKey(log.file_name);
  if (!key) return undefined;
  const freq = new Map<string, number>();
  for (const t of txs) {
    const o = t.Origem;
    const cid = t.ID_Conta;
    if (!cid || !o || o === 'manual') continue;
    if (comparableImportOriginKey(o) !== key) continue;
    freq.set(cid, (freq.get(cid) || 0) + 1);
  }
  if (freq.size === 0) return undefined;
  return [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Nome de arquivo já normalizado (equivalente a comparableImportOriginKey). */
export function comparableFileNameLikelyCreditCardInvoice(comparableBase: string): boolean {
  if (!comparableBase) return false;
  return comparableBase.includes('fatura') && comparableBase.includes('cart');
}

/** Avisos de rastreio/IDs só importam onde «Reprocessar fatura» / motor de cartão fazem sentido. */
function appliesCardOrientedTraceabilityAlerts(log: ImportLog, ctx?: ImportLogAlertContext): boolean {
  const det = Array.isArray(log.imported_details) ? log.imported_details : [];
  if (importedDetailsSuggestCardCycle(det)) return true;

  const compact = comparableImportOriginKey(log.file_name);
  if (comparableFileNameLikelyCreditCardInvoice(compact)) return true;

  if (!ctx?.accounts?.length || !ctx?.transactions?.length) {
    return false;
  }

  const accountId = inferDominantAccountIdForImportLog(log, ctx);
  if (!accountId) return false;

  const account = ctx.accounts.find((a) => a.id === accountId);
  return account?.Tipo_Conta === 'Cartão de Crédito';
}

/**
 * O reprocessamento no motor não reescreve necessariamente `import_logs.imported_details` com IDs.
 * Se todas as transações desta origem (chave comparável) têm ID e cobrem os importados, o rastro existe no ledger.
 */
function importLedgerRowsForComparableKey(log: ImportLog, ctx?: ImportLogAlertContext) {
  if (!ctx?.transactions?.length) return [];
  const key = comparableImportOriginKey(log.file_name);
  if (!key) return [];
  return ctx.transactions.filter(
    (t) => t.Origem && t.Origem !== 'manual' && comparableImportOriginKey(t.Origem) === key
  );
}

/**
 * Ledger tem quantidade suficiente de lançamentos com esta origem (chave comparável),
 * mesmo que `imported_details` esteja truncado ou vazio (`syncLegacyImportLogs`,
 * apenas metadados de classificação de cartão etc.).
 */
function importLedgerFullyTraceableInStore(log: ImportLog, ctx?: ImportLogAlertContext): boolean {
  if (!ctx?.transactions?.length || log.imported_count <= 0) return false;
  const rows = importLedgerRowsForComparableKey(log, ctx);
  if (rows.length < log.imported_count) return false;
  return rows.every((t) => Boolean(t.ID_Transacao && `${t.ID_Transacao}`.trim().length > 0));
}

/**
 * Se o JSON do log não reflete as linhas (contagem ou stub), mas o ledger cobre `imported_count`
 * com IDs, não é falha que deva bloquear o trabalho com o motor de cartão.
 */
export function importCountMatchesDetailsOrLedger(log: ImportLog, ctx?: ImportLogAlertContext): boolean {
  const det = Array.isArray(log.imported_details) ? log.imported_details : [];
  if (log.imported_count === det.length) return true;
  return importLedgerFullyTraceableInStore(log, ctx);
}

/** Heurísticas para sinalizar se o log está frágil ou inconsistente (ex.: reprocessar fatura / corrigir conta). */
export function buildImportLogAlerts(log: ImportLog, ctx?: ImportLogAlertContext): ImportLogAlertResult {
  const badges: string[] = [];
  let level: ImportLogAlertLevel = 'ok';
  const bumpWarn = () => {
    if (level === 'ok') level = 'warn';
  };
  const bumpErr = () => {
    level = 'error';
  };

  const det = Array.isArray(log.imported_details) ? log.imported_details : [];
  const accounted = log.imported_count + log.ignored_count;

  if (!importCountMatchesDetailsOrLedger(log, ctx)) {
    badges.push(`imported_count (${log.imported_count}) ≠ linhas em imported_details (${det.length})`);
    bumpErr();
  }

  if (log.total_transactions > 0 && log.imported_count === 0) {
    badges.push('Nada persistido');
    bumpErr();
  }

  const ledgerTraceable = importLedgerFullyTraceableInStore(log, ctx);
  if (
    log.total_transactions > 0 &&
    accounted !== log.total_transactions &&
    !ledgerTraceable
  ) {
    badges.push(`Contagem inconsistente (${accounted}/${log.total_transactions})`);
    bumpWarn();
  }

  const cardTraceability = appliesCardOrientedTraceabilityAlerts(log, ctx);

  if (log.imported_count > 0) {
    if (cardTraceability && isImportedDetailRowsIncomplete(det) && !ledgerTraceable) {
      badges.push('Log sem rastreio de linhas');
      bumpWarn();
    } else if (cardTraceability && !importedDetailsHasTransactionIds(det) && !ledgerTraceable) {
      badges.push('Sem IDs no log');
      bumpWarn();
    }
  }

  if (badges.length === 0) {
    return { level: 'ok', badges: [] };
  }
  return { level, badges };
}

/**
 * Para depuração no DevTools (`__finEloDebug` em DEV): explica por que uma linha do histórico recebe cada alerta.
 */
export function diagnoseImportLogAlertsDebug(log: ImportLog, ctx?: ImportLogAlertContext) {
  const det = Array.isArray(log.imported_details) ? log.imported_details : [];
  const key = comparableImportOriginKey(log.file_name);
  const rows =
    ctx?.transactions?.filter(
      (t) => t.Origem && t.Origem !== 'manual' && comparableImportOriginKey(t.Origem) === key
    ) ?? [];
  const accounted = log.imported_count + log.ignored_count;
  const cardTraceability = appliesCardOrientedTraceabilityAlerts(log, ctx);
  const ledgerTraceable = importLedgerFullyTraceableInStore(log, ctx);
  const incomplete = isImportedDetailRowsIncomplete(det);
  const hasIdsInLog = importedDetailsHasTransactionIds(det);

  return {
    file_name: log.file_name,
    comparableKey: key,
    imported_count: log.imported_count,
    ignored_count: log.ignored_count,
    total_transactions: log.total_transactions,
    accountedVsTotal:
      log.total_transactions > 0 ? `${accounted}/${log.total_transactions}` : null,
    countMismatchBadge:
      log.total_transactions > 0 && accounted !== log.total_transactions ? 'Contagem inconsistente' : null,
    imported_details_rowCount: det.length,
    imported_details_firstRowSample:
      det[0] && typeof det[0] === 'object' ? Object.keys(det[0] as object).slice(0, 24) : [],
    isImportedDetailRowsIncomplete: incomplete,
    importedDetailsHasTransactionIds: hasIdsInLog,
    cardTraceability_appliesMotorWarnings: cardTraceability,
    ledger_rowsMatchingOrigin: rows.length,
    ledger_rowsMissing_ID_Transacao: rows.filter((t) => !t.ID_Transacao || !String(t.ID_Transacao).trim()).length,
    ledger_fully_traceable_byHeuristic: ledgerTraceable,
    buildImportLogAlerts: buildImportLogAlerts(log, ctx),
    triggers: {
      logSemRastreioLinhas:
        Boolean(log.imported_count > 0 && cardTraceability && incomplete && !ledgerTraceable),
      semIDsnoLog:
        Boolean(
          log.imported_count > 0 &&
            cardTraceability &&
            !incomplete &&
            !hasIdsInLog &&
            !ledgerTraceable
        ),
    },
  };
}

export function summarizeImportLogsHealth(logs: ImportLog[], ctx?: ImportLogAlertContext): {
  errorCount: number;
  warnCount: number;
  sampleFileNames: string[];
} {
  let errorCount = 0;
  let warnCount = 0;
  const errorFiles: string[] = [];
  const warnFiles: string[] = [];

  for (const log of logs) {
    const { level } = buildImportLogAlerts(log, ctx);
    if (level === 'error') {
      errorCount += 1;
      if (errorFiles.length < 4) errorFiles.push(log.file_name);
    } else if (level === 'warn') {
      warnCount += 1;
      if (warnFiles.length < 4) warnFiles.push(log.file_name);
    }
  }

  return {
    errorCount,
    warnCount,
    sampleFileNames: errorCount > 0 ? errorFiles : warnFiles,
  };
}
