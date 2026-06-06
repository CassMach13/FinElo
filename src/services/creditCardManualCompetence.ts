import type { ClassificationRules } from '../domain/credit-card/classifiers';
import {
  computeImportLedgerTotals,
  type ImportLedgerLineInput,
} from '../domain/credit-card/importLedgerTotals';
import { Account, Transaction } from '../types';
import type {
  CompetenceHistoryCard,
  CompetenceHistoryFileLine,
} from './creditCardRebuildFromImportHistoryService';
import { reconcileCardStatementTotalFromFiles } from './creditCardRebuildFromImportHistoryService';
import {
  isDirectedManualInvoicePayment,
  isDirectedManualRefund,
  isManualCardRefund,
  isManualInvoicePayment,
  parseDirectedCompetenceFromPayment,
  referenceMonthFromIsoDate,
} from './creditCardDirectedPayment';

export const MANUAL_COMPETENCE_FILE_LABEL = 'Lançamentos manuais';

const round2 = (n: number) => Math.round(n * 100) / 100;

export function toLocalDateIso(date: Date | string | undefined): string {
  if (!date) return '';
  if (typeof date === 'string') return date.split('T')[0];
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Data_Pagamento no lançamento manual de cartão = data de vencimento da fatura.
 * Competência (AAAA-MM) = mês anterior ao vencimento (mesma regra do parseDueFromReference inverso).
 */
export function referenceMonthFromPaymentDueDate(paymentDueIso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(paymentDueIso.trim());
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

/** Data_Pagamento no dia de vencimento do cartão (ex.: dia 10) = vencimento da fatura. */
export function paymentIsoLooksLikeCardDueDate(paymentIso: string, account: Account): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(paymentIso.trim());
  if (!m) return false;
  const dueDay = Number(account.dia_vencimento) || 10;
  return Number(m[3]) === dueDay;
}

/**
 * Competência do estorno manual: marcador finelo_competence → vencimento (dia do cartão) → mês da Data.
 * Evita que Data_Pagamento = data do lançamento (ex. 21/05) caia no mês anterior (04/2026).
 */
export function inferManualRefundReferenceMonth(tx: Transaction, account: Account): string | null {
  const directed = parseDirectedCompetenceFromPayment(tx);
  if (directed) return directed;
  if (!isManualCardRefund(tx)) return null;
  const payIso = tx.Data_Pagamento ? toLocalDateIso(tx.Data_Pagamento) : '';
  if (payIso && paymentIsoLooksLikeCardDueDate(payIso, account)) {
    return referenceMonthFromPaymentDueDate(payIso);
  }
  return referenceMonthFromIsoDate(toLocalDateIso(tx.Data));
}

/** Compra: vencimento (Data_Pagamento). Estorno: regra em inferManualRefundReferenceMonth. */
export function referenceMonthFromTransaction(t: Transaction, account: Account): string {
  const directed = parseDirectedCompetenceFromPayment(t);
  if (directed) return directed;
  if (isManualCardRefund(t)) {
    return inferManualRefundReferenceMonth(t, account) || '';
  }
  const paymentIso = t.Data_Pagamento ? toLocalDateIso(t.Data_Pagamento) : '';
  if (paymentIso) {
    const fromDue = referenceMonthFromPaymentDueDate(paymentIso);
    if (fromDue) return fromDue;
  }
  const dataIso = toLocalDateIso(t.Data);
  const parts = dataIso.split('-');
  if (parts.length >= 2) return `${parts[0]}-${parts[1]}`;
  return '';
}

const normDesc = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/**
 * Convenção do ledger de cartão: negativo = compra/débito; positivo = crédito na fatura.
 * Lançamento manual de compra (Despesa com Valor negativo) mantém o sinal — não vira estorno.
 */
export function manualTransactionLedgerAmount(tx: Transaction): number {
  const raw = Number(tx.Valor || 0);
  const tipo = String(tx.Tipo || '');
  if (tipo === 'Renda') return Math.abs(raw);
  if (tipo === 'Despesa') {
    if (raw < 0) return raw;
    if (raw > 0) return -Math.abs(raw);
    return 0;
  }
  return raw;
}

export function manualTransactionsToLedgerLines(txs: Transaction[]): ImportLedgerLineInput[] {
  return txs.map((tx) => {
    const amount = manualTransactionLedgerAmount(tx);
    let description = tx.Descricao_Original || tx.Nome_Fantasia || '';
    if (isManualInvoicePayment(tx)) {
      description = [tx.Nome_Fantasia, tx.Descricao_Original, tx.Categoria].filter(Boolean).join(' ');
    }
    const isRefundLine =
      (parseDirectedCompetenceFromPayment(tx) && isDirectedManualRefund(tx)) || isManualCardRefund(tx);
    if (isRefundLine && !normDesc(description).includes('estorno')) {
      description = `${description} estorno`.trim();
    }
    return {
      postedDate: toLocalDateIso(tx.Data),
      description,
      amount,
      installmentTotal: tx.Total_Parcelas || undefined,
      fineloTipo: String(tx.Tipo || '').trim() || undefined,
    };
  });
}

/**
 * Soma lançamentos manuais por competência e mescla nos cards (import + manual).
 */
export function appendManualCompetenceTotals(params: {
  accountId: string;
  account: Account;
  transactions: Transaction[];
  rules?: ClassificationRules;
  byCompetence: Map<string, CompetenceHistoryCard>;
  ensureCompetenceCard: (ref: string, dueDateIso?: string) => CompetenceHistoryCard;
  previousReferenceMonth: (ref: string) => string | null;
}): void {
  const { accountId, account, transactions, rules, byCompetence, ensureCompetenceCard, previousReferenceMonth } =
    params;

  const manualTx = transactions.filter(
    (t) => t.ID_Conta === accountId && String(t.Origem || 'manual').trim().toLowerCase() === 'manual'
  );
  if (manualTx.length === 0) return;

  const directedPaymentsByRef = new Map<string, number>();
  const directedRefundsByRef = new Map<string, number>();
  const byRef = new Map<string, Transaction[]>();

  manualTx.forEach((t) => {
    const directedRef = parseDirectedCompetenceFromPayment(t);
    if (directedRef && isDirectedManualInvoicePayment(t)) {
      directedPaymentsByRef.set(
        directedRef,
        round2((directedPaymentsByRef.get(directedRef) || 0) + Math.abs(Number(t.Valor || 0)))
      );
      return;
    }
    if (isManualInvoicePayment(t)) {
      const ref = (directedRef || referenceMonthFromTransaction(t, account)).trim();
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(ref)) {
        directedPaymentsByRef.set(
          ref,
          round2((directedPaymentsByRef.get(ref) || 0) + Math.abs(Number(t.Valor || 0)))
        );
      }
      return;
    }
    if (directedRef && !isDirectedManualInvoicePayment(t)) {
      directedRefundsByRef.set(
        directedRef,
        round2((directedRefundsByRef.get(directedRef) || 0) + Math.abs(Number(t.Valor || 0)))
      );
      return;
    }
    if (isManualCardRefund(t)) {
      const refundRef = inferManualRefundReferenceMonth(t, account);
      if (refundRef && /^\d{4}-(0[1-9]|1[0-2])$/.test(refundRef)) {
        directedRefundsByRef.set(
          refundRef,
          round2((directedRefundsByRef.get(refundRef) || 0) + Math.abs(Number(t.Valor || 0)))
        );
        return;
      }
    }
    const ref = referenceMonthFromTransaction(t, account).trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ref)) return;
    const list = byRef.get(ref) || [];
    list.push(t);
    byRef.set(ref, list);
  });

  for (const [ref, txs] of byRef) {
    const ledgerTxs = txs.filter((t) => !parseDirectedCompetenceFromPayment(t));
    const totals = computeImportLedgerTotals(manualTransactionsToLedgerLines(ledgerTxs), rules);
    const card = ensureCompetenceCard(ref);
    const hasImportedFile = card.files.some((f) => f.fileName !== MANUAL_COMPETENCE_FILE_LABEL);

    const manualDebits = round2(totals.totalDebits);
    const manualRefunds = round2(totals.totalRefunds + totals.totalOtherCredits);
    const manualPayments = round2(totals.totalInvoicePayments);

    if (!hasImportedFile && manualDebits < 0.005 && manualRefunds > 0.005) {
      continue;
    }

    const existingManual = card.files.find((f) => f.fileName === MANUAL_COMPETENCE_FILE_LABEL);
    const prevDebits =
      existingManual?.totalDebits != null
        ? existingManual.totalDebits
        : existingManual?.statementTotal ?? 0;
    const prevRefunds = existingManual?.totalRefunds ?? 0;
    const prevPayments = existingManual?.totalPayments ?? 0;

    const manualLine: CompetenceHistoryFileLine = {
      fileName: MANUAL_COMPETENCE_FILE_LABEL,
      transactionCount: totals.lineCount,
      totalDebits: manualDebits,
      statementTotal: round2(Math.max(0, manualDebits - manualRefunds)),
      totalRefunds: manualRefunds,
      totalPayments: manualPayments,
    };

    const prevNet = round2(prevDebits - prevRefunds);
    const manualNet = round2(manualDebits - manualRefunds);
    card.statementTotal = round2(Math.max(0, card.statementTotal - prevNet + manualNet));

    if (existingManual) {
      Object.assign(existingManual, manualLine);
    } else {
      card.files.push(manualLine);
    }
    reconcileCardStatementTotalFromFiles(card);

  }

  for (const [ref, amount] of directedPaymentsByRef) {
    if (amount < 0.005) continue;
    const card = ensureCompetenceCard(ref);
    card.directedManualPaymentTotal = round2((card.directedManualPaymentTotal ?? 0) + amount);
    card.totalPayments = round2(card.totalPayments + amount);
  }

  for (const [ref, amount] of directedRefundsByRef) {
    if (amount < 0.005) continue;
    const card = ensureCompetenceCard(ref);
    card.directedManualRefundTotal = round2((card.directedManualRefundTotal ?? 0) + amount);
    const existingManual = card.files.find((f) => f.fileName === MANUAL_COMPETENCE_FILE_LABEL);
    if (existingManual) {
      existingManual.totalRefunds = round2((existingManual.totalRefunds ?? 0) + amount);
      existingManual.transactionCount = (existingManual.transactionCount || 0) + 1;
      existingManual.totalDebits = existingManual.totalDebits ?? 0;
      existingManual.statementTotal = round2(
        Math.max(0, existingManual.totalDebits - (existingManual.totalRefunds ?? 0))
      );
    } else {
      card.files.push({
        fileName: MANUAL_COMPETENCE_FILE_LABEL,
        transactionCount: 1,
        totalDebits: 0,
        statementTotal: 0,
        totalRefunds: amount,
        totalPayments: 0,
      });
    }
    reconcileCardStatementTotalFromFiles(card);
  }
}

const hasOpenBalance = (c: CompetenceHistoryCard) =>
  c.openBalance > 0.005 || c.statementTotal - c.totalPayments > 0.005;

/** Saldo em aberto real (após pagamentos e crédito repassado de outros meses). */
export function competenceAmountDue(card: CompetenceHistoryCard): number {
  return round2(Math.max(card.openBalance, 0));
}

/**
 * Valor da fatura vigente no card — total deste ciclo antes de crédito vindo de outra competência.
 * Corresponde ao que o banco cobra no vencimento (ex.: R$ 6.260,26 em 10/06).
 */
export function competenceFaturaAtualDisplayAmount(card: CompetenceHistoryCard): number {
  const beforeCarry = round2(
    card.openBalanceBeforeCarry ?? Math.max(0, card.statementTotal - card.totalPayments)
  );
  if (beforeCarry > 0.005) return beforeCarry;
  return competenceAmountDue(card);
}

/**
 * Competência exibida no card como «Fatura Atual».
 * Prioriza o ciclo vigente (próximo vencimento) com saldo real; ignora resíduos contábeis
 * de meses já quitados (openBalance ≈ 0, mas statement − pagamentos > 0 por arredondamento).
 */
export function pickFaturaAtualCompetenceCard(
  cards: CompetenceHistoryCard[],
  todayIso: string
): CompetenceHistoryCard | undefined {
  const hasRealOpenBalance = (c: CompetenceHistoryCard) =>
    c.openBalance > 0.005 ||
    (c.openBalanceBeforeCarry ?? Math.max(0, c.statementTotal - c.totalPayments)) > 0.005;

  const upcomingOpen = cards
    .filter((c) => c.dueDate && c.dueDate >= todayIso && hasRealOpenBalance(c))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (upcomingOpen.length > 0) return upcomingOpen[0];

  const overdueOpen = cards
    .filter((c) => c.dueDate && c.dueDate < todayIso && hasRealOpenBalance(c))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (overdueOpen.length > 0) return overdueOpen[0];

  return undefined;
}

/**
 * Fatura vigente: prioriza a mais antiga vencida em aberto; senão a próxima a vencer com saldo;
 * evita que lançamentos manuais futuros (ex. 2027) ocultem extrato importado vencido.
 */
export function pickCurrentCompetenceCard(
  cards: CompetenceHistoryCard[],
  todayIso: string
): CompetenceHistoryCard | undefined {
  if (cards.length === 0) return undefined;

  const overdueOpen = cards
    .filter((c) => c.dueDate && c.dueDate < todayIso && hasOpenBalance(c))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (overdueOpen.length > 0) return overdueOpen[0];

  const upcomingOpen = cards
    .filter((c) => c.dueDate && c.dueDate >= todayIso && hasOpenBalance(c))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (upcomingOpen.length > 0) return upcomingOpen[0];

  const upcoming = cards
    .filter((c) => c.dueDate && c.dueDate >= todayIso)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (upcoming.length > 0) return upcoming[0];

  return [...cards].sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0];
}
