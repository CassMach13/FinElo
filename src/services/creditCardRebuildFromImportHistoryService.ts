import { supabase } from '../supabaseClient';
import { computeImportLedgerTotals } from '../domain/credit-card/importLedgerTotals';
import type { ClassificationRules } from '../domain/credit-card/classifiers';
import { Account, ImportLog, Transaction } from '../types';
import type { LedgerTotalsOverride } from '../utils/creditCardStatementDisplay';
import { statementDueMonthKey } from '../utils/creditCardStatementDisplay';
import { comparableImportOriginKey } from '../utils/importOriginKey';
import {
  buildInvoiceCycleRowsForAccount,
  invoiceCycleRowToRebuildCycle,
  parseMMAAAAToIsoMonth,
} from './creditCardInvoiceCycleRows';
import { creditCardEngineService } from './creditCardEngineService';
import { parseCreditCardReferenceFromFileName } from './creditCardEngineService';
import { appendManualCompetenceTotals } from './creditCardManualCompetence';

export interface ImportHistoryRebuildCycle {
  /** Nome do arquivo como em import_logs.file_name */
  fileName: string;
  /** Competência da fatura (AAAA-MM) */
  referenceMonth: string;
  /** Vencimento (AAAA-MM-DD) */
  dueDate: string;
}

export interface ImportHistoryRebuildPreview {
  fileName: string;
  referenceMonth: string;
  dueDate: string;
  transactionCount: number;
  totals: ReturnType<typeof computeImportLedgerTotals>;
}

export interface ImportHistoryRebuildResult {
  processedFiles: number;
  message: string;
  previews: ImportHistoryRebuildPreview[];
}

export interface CompetenceHistoryFileLine {
  fileName: string;
  transactionCount: number;
  statementTotal: number;
  totalPayments: number;
}

/** Uma competência no histórico (pode reunir vários CSV/titulares). */
export interface CompetenceHistoryCard {
  referenceMonth: string;
  competenceBR: string;
  dueDate: string;
  vencimentoBR: string;
  dueYear: number;
  dueMonth: number;
  files: CompetenceHistoryFileLine[];
  statementTotal: number;
  totalPayments: number;
  /** Antes de aplicar crédito excedente de competências anteriores. */
  openBalanceBeforeCarry: number;
  /** Crédito de meses anteriores (pagamento a mais) aplicado nesta competência. */
  priorCreditApplied: number;
  openBalance: number;
  /** Crédito remanescente após esta competência (para meses seguintes). */
  creditCarriedForward: number;
  /** Usuário confirmou que o saldo residual foi pago no banco. */
  userConfirmedPaid?: boolean;
  userConfirmedAt?: string;
  userConfirmedAmount?: number;
}

function parseDueFromReference(referenceMonth: string, dueDay: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(referenceMonth.trim());
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
  const d = Math.min(Math.max(1, dueDay), last);
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function transactionsForFile(accountId: string, fileName: string, transactions: Transaction[]): Transaction[] {
  const key = comparableImportOriginKey(fileName);
  return transactions.filter(
    (t) =>
      t.ID_Conta === accountId &&
      t.Origem &&
      t.Origem !== 'manual' &&
      comparableImportOriginKey(String(t.Origem)) === key
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function referenceMonthToBR(referenceMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(referenceMonth.trim());
  if (!m) return referenceMonth;
  return `${m[2]}/${m[1]}`;
}

function isoDateToBR(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Competência com pelo menos um CSV importado (há base para total da fatura). */
export function competenceHasImportedStatement(card: CompetenceHistoryCard): boolean {
  return card.files.length > 0;
}

/**
 * Quando um mês foi pago a mais, o excedente reduz o saldo em aberto dos meses seguintes (ordem cronológica).
 * Só gera crédito se a competência tiver extrato importado — pagamento redirecionado sem arquivo não vira crédito.
 */
export function applySequentialCreditCarryForward(cards: CompetenceHistoryCard[]): void {
  if (cards.length === 0) return;

  const sorted = [...cards].sort((a, b) => a.referenceMonth.localeCompare(b.referenceMonth));
  let availableCredit = 0;

  sorted.forEach((card) => {
    const grossDeficit = round2(Math.max(0, card.statementTotal - card.totalPayments));
    const rawSurplus = round2(Math.max(0, card.totalPayments - card.statementTotal));
    const grossSurplus =
      competenceHasImportedStatement(card) && card.statementTotal > 0.005 ? rawSurplus : 0;

    card.openBalanceBeforeCarry = grossDeficit;
    card.priorCreditApplied = round2(Math.min(availableCredit, grossDeficit));
    card.openBalance = round2(Math.max(0, grossDeficit - card.priorCreditApplied));

    availableCredit = round2(availableCredit - card.priorCreditApplied + grossSurplus);
    card.creditCarriedForward = competenceHasImportedStatement(card) ? availableCredit : 0;
  });
}

export function previousReferenceMonth(referenceMonth: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(referenceMonth.trim());
  if (!m) return null;
  let y = Number(m[1]);
  let mo = Number(m[2]);
  mo -= 1;
  if (mo < 1) {
    mo = 12;
    y -= 1;
  }
  if (y < 1900) return null;
  return `${y}-${String(mo).padStart(2, '0')}`;
}

function suggestReferenceMonthFromLog(fileName: string, importedDetails?: unknown[]): string | null {
  const fromFile = parseCreditCardReferenceFromFileName(fileName);
  if (fromFile) return `${fromFile.dueYear}-${String(fromFile.dueMonth).padStart(2, '0')}`;
  const det = Array.isArray(importedDetails) ? importedDetails : [];
  const meta = det.find((d: any) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(d?.Card_Reference_Label || '')));
  if (meta?.Card_Reference_Label) return String(meta.Card_Reference_Label);
  return null;
}

function buildCyclesForAccount(input: {
  accountId: string;
  account: Account;
  transactions: Transaction[];
  importLogs: ImportLog[];
}): ImportHistoryRebuildCycle[] {
  const { accountId, account, transactions, importLogs } = input;
  const originKeys = new Map<string, { fileName: string; log?: ImportLog }>();

  transactions.forEach((tx) => {
    if (tx.ID_Conta !== accountId || !tx.Origem || tx.Origem === 'manual') return;
    const key = comparableImportOriginKey(String(tx.Origem));
    if (!key || originKeys.has(key)) return;
    const log = importLogs
      .filter((l) => comparableImportOriginKey(l.file_name) === key)
      .sort((a, b) => new Date(b.import_date || 0).getTime() - new Date(a.import_date || 0).getTime())[0];
    originKeys.set(key, { fileName: log?.file_name || String(tx.Origem), log });
  });

  importLogs.forEach((log) => {
    const key = comparableImportOriginKey(log.file_name);
    if (!key || originKeys.has(key)) return;
    const det = (log.imported_details as any[]) || [];
    if (det.some((d) => d?.ID_Conta === accountId) || det.length === 0) {
      originKeys.set(key, { fileName: log.file_name, log });
    }
  });

  const cycles: ImportHistoryRebuildCycle[] = [];
  originKeys.forEach(({ fileName, log }) => {
    const det = log?.imported_details as any[] | undefined;
    const meta = Array.isArray(det)
      ? det.find((d) => d?.ID_Conta === accountId && d?.Card_Reference_Label)
      : undefined;
    const referenceMonth =
      (meta?.Card_Reference_Label && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(meta.Card_Reference_Label))
        ? String(meta.Card_Reference_Label)
        : null) ||
      suggestReferenceMonthFromLog(fileName, det);
    if (!referenceMonth) return;
    const dueDate =
      (meta?.Card_Due_Date && /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(String(meta.Card_Due_Date))
        ? String(meta.Card_Due_Date)
        : null) || parseDueFromReference(referenceMonth, Number(account.dia_vencimento) || 10);
    if (!dueDate) return;
    cycles.push({ fileName, referenceMonth, dueDate });
  });

  return cycles;
}

function toImportLines(txs: Transaction[]): Array<{
  postedDate: string;
  description: string;
  amount: number;
  installmentTotal?: number;
}> {
  return txs.map((tx) => ({
    postedDate: new Date(tx.Data).toISOString().slice(0, 10),
    description: tx.Descricao_Original || tx.Nome_Fantasia || '',
    amount: Number(tx.Valor || 0),
    installmentTotal: tx.Total_Parcelas || undefined,
  }));
}

export const creditCardRebuildFromImportHistoryService = {
  previewCycles(
    accountId: string,
    cycles: ImportHistoryRebuildCycle[],
    transactions: Transaction[],
    rules?: ClassificationRules
  ): ImportHistoryRebuildPreview[] {
    return cycles.map((cycle) => {
      const txs = transactionsForFile(accountId, cycle.fileName, transactions);
      const totals = computeImportLedgerTotals(toImportLines(txs), rules);
      return {
        fileName: cycle.fileName,
        referenceMonth: cycle.referenceMonth,
        dueDate: cycle.dueDate,
        transactionCount: txs.length,
        totals,
      };
    });
  },

  async rebuildFromImportHistory(input: {
    userId: string;
    account: Account;
    cycles: ImportHistoryRebuildCycle[];
    transactions: Transaction[];
    rules?: ClassificationRules;
  }): Promise<ImportHistoryRebuildResult> {
    const { userId, account, cycles, transactions, rules } = input;
    const sorted = [...cycles].sort((a, b) => a.referenceMonth.localeCompare(b.referenceMonth));
    const previews: ImportHistoryRebuildPreview[] = [];
    let processedFiles = 0;

    await creditCardEngineService.ensureCreditCardForAccount(userId, account);

    for (const cycle of sorted) {
      const txs = transactionsForFile(account.id, cycle.fileName, transactions);
      if (txs.length === 0) continue;

      const accountId = account.id;
      const lines = toImportLines(txs);
      const totals = computeImportLedgerTotals(lines, rules);
      previews.push({
        fileName: cycle.fileName,
        referenceMonth: cycle.referenceMonth,
        dueDate: cycle.dueDate,
        transactionCount: txs.length,
        totals,
      });

      const dueParts = /^(\d{4})-(\d{2})-\d{2}$/.exec(cycle.dueDate.trim());
      if (!dueParts) {
        throw new Error(`Vencimento inválido para "${cycle.fileName}" — use AAAA-MM-DD.`);
      }
      const dueYear = Number(dueParts[1]);
      const dueMonth = Number(dueParts[2]);
      const rows = await creditCardEngineService.buildImportRowsFromTransactionsPreservingIndices({
        accountId,
        origin: cycle.fileName,
        transactions: txs,
      });

      await creditCardEngineService.normalizeAndPersistImportLot({
        userId,
        account,
        sourceFileName: cycle.fileName,
        rows,
        dueYear,
        dueMonth,
        dueDate: cycle.dueDate,
        rules,
        fileTotals: {
          statementTotal: totals.statementTotal,
          totalPayments: totals.totalPayments,
        },
        skipRecalculateAllStatements: true,
      });

      processedFiles += 1;
    }

    if (processedFiles > 0) {
      const card = await creditCardEngineService.ensureCreditCardForAccount(userId, account);
      await creditCardEngineService.recalculateAllStatementsForCard(card.id);
    }

    return {
      processedFiles,
      previews,
      message:
        processedFiles > 0
          ? `${processedFiles} arquivo(s) reconstruído(s). Total da fatura = compras/estornos do arquivo; pagamentos de fatura no CSV abatem a competência anterior.`
          : 'Nenhum lançamento encontrado para os arquivos selecionados neste cartão.',
    };
  },

  /** Sugere competência AAAA-MM a partir do nome do arquivo ou metadados do log. */
  suggestReferenceMonth(fileName: string, importedDetails?: unknown[]): string | null {
    return suggestReferenceMonthFromLog(fileName, importedDetails);
  },

  suggestDueDate(referenceMonth: string, account: Account): string {
    const day = Number(account.dia_vencimento) || 10;
    return parseDueFromReference(referenceMonth, day);
  },

  /**
   * Índice de totais por competência de vencimento (due_year/due_month), somando linhas de cada arquivo importado.
   * Alimenta o modal «Histórico» com os mesmos valores da reconstrução por histórico.
   */
  /**
   * Cards de histórico agrupados por competência (AAAA-MM), somando todos os arquivos do período.
   * Mesma base do modal «Faturas pelo histórico».
   */
  competenceHistoryCardsForAccount(input: {
    accountId: string;
    account: Account;
    accounts: Account[];
    transactions: Transaction[];
    importLogs: ImportLog[];
    rules?: ClassificationRules;
    invoiceDueDayStr?: string;
    /** Pagamento confirmado manualmente pelo usuário (saldo residual). */
    userPaymentConfirmations?: Array<{ referenceMonth: string; settledAmount: number; confirmedAt: string }>;
  }): CompetenceHistoryCard[] {
    const {
      accountId,
      account,
      accounts,
      transactions,
      importLogs,
      rules,
      invoiceDueDayStr = '',
      userPaymentConfirmations = [],
    } = input;

    const cycleRows = buildInvoiceCycleRowsForAccount({
      accounts,
      transactions,
      importLogs,
      filterAccountId: accountId,
    });

    const cyclesForPreview = cycleRows
      .filter((r) => parseMMAAAAToIsoMonth(r.competenciaBR.trim()))
      .map((r) => invoiceCycleRowToRebuildCycle(r, accounts, invoiceDueDayStr));

    const previews = this.previewCycles(accountId, cyclesForPreview, transactions, rules).filter((p) =>
      /^\d{4}-(0[1-9]|1[0-2])$/.test(p.referenceMonth.trim())
    );

    const byCompetence = new Map<string, CompetenceHistoryCard>();
    const dueDay = Number(account.dia_vencimento) || 10;

    const ensureCompetenceCard = (ref: string, dueDateIso?: string): CompetenceHistoryCard => {
      let card = byCompetence.get(ref);
      if (card) return card;

      const dueDate =
        dueDateIso && /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(dueDateIso)
          ? dueDateIso
          : parseDueFromReference(ref, dueDay);
      const dueParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate.trim());

      card = {
        referenceMonth: ref,
        competenceBR: referenceMonthToBR(ref),
        dueDate,
        vencimentoBR: isoDateToBR(dueDate),
        dueYear: dueParts ? Number(dueParts[1]) : 0,
        dueMonth: dueParts ? Number(dueParts[2]) : 0,
        files: [],
        statementTotal: 0,
        totalPayments: 0,
        openBalanceBeforeCarry: 0,
        priorCreditApplied: 0,
        openBalance: 0,
        creditCarriedForward: 0,
      };
      byCompetence.set(ref, card);
      return card;
    };

    previews.forEach((p) => {
      const ref = p.referenceMonth.trim();
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ref)) return;

      const fileLine: CompetenceHistoryFileLine = {
        fileName: p.fileName,
        transactionCount: p.transactionCount,
        statementTotal: p.totals.statementTotal,
        totalPayments: p.totals.totalPayments,
      };

      const card = ensureCompetenceCard(ref, p.dueDate);
      card.files.push(fileLine);
      card.statementTotal = round2(card.statementTotal + fileLine.statementTotal);

      if (p.dueDate > card.dueDate) {
        card.dueDate = p.dueDate;
        card.vencimentoBR = isoDateToBR(p.dueDate);
        const dueParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.dueDate.trim());
        if (dueParts) {
          card.dueYear = Number(dueParts[1]);
          card.dueMonth = Number(dueParts[2]);
        }
      }

      const paymentForPrior = round2(p.totals.totalInvoicePayments);
      const priorRef = previousReferenceMonth(ref);
      if (priorRef && paymentForPrior > 0) {
        const priorCard = ensureCompetenceCard(priorRef);
        priorCard.totalPayments = round2(priorCard.totalPayments + paymentForPrior);
      }
    });

    appendManualCompetenceTotals({
      accountId,
      account,
      transactions,
      rules,
      byCompetence,
      ensureCompetenceCard,
      previousReferenceMonth,
    });

    const cards = Array.from(byCompetence.values());

    const confirmByRef = new Map(
      userPaymentConfirmations.map((c) => [c.referenceMonth.trim(), c])
    );
    cards.forEach((card) => {
      const conf = confirmByRef.get(card.referenceMonth.trim());
      if (!conf || conf.settledAmount < 0.005) return;
      card.userConfirmedPaid = true;
      card.userConfirmedAt = conf.confirmedAt;
      card.userConfirmedAmount = round2(conf.settledAmount);
      card.totalPayments = round2(card.totalPayments + conf.settledAmount);
    });

    applySequentialCreditCarryForward(cards);

    return cards.sort((a, b) => {
      if (b.dueYear !== a.dueYear) return b.dueYear - a.dueYear;
      if (b.dueMonth !== a.dueMonth) return b.dueMonth - a.dueMonth;
      return b.referenceMonth.localeCompare(a.referenceMonth);
    });
  },

  ledgerTotalsIndexForAccount(input: {
    accountId: string;
    account: Account;
    accounts: Account[];
    transactions: Transaction[];
    importLogs: ImportLog[];
    rules?: ClassificationRules;
  }): Map<string, LedgerTotalsOverride> {
    const cards = this.competenceHistoryCardsForAccount(input);
    const index = new Map<string, LedgerTotalsOverride>();
    cards.forEach((c) => {
      if (c.dueYear < 1 || c.dueMonth < 1) return;
      const key = statementDueMonthKey(c.dueYear, c.dueMonth);
      const prev = index.get(key);
      if (prev) {
        index.set(key, {
          statementTotal: round2(prev.statementTotal + c.statementTotal),
          totalPayments: round2(prev.totalPayments + c.totalPayments),
        });
      } else {
        index.set(key, {
          statementTotal: c.statementTotal,
          totalPayments: c.totalPayments,
        });
      }
    });
    return index;
  },
};
