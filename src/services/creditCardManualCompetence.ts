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
import {
  isManualInvoicePayment,
  parseDirectedCompetenceFromPayment,
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

/** Competência da compra: vencimento (Data_Pagamento) ou mês da Data de competência. */
export function referenceMonthFromTransaction(t: Transaction, _account: Account): string {
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

export function manualTransactionsToLedgerLines(txs: Transaction[]): ImportLedgerLineInput[] {
  return txs.map((tx) => ({
    postedDate: toLocalDateIso(tx.Data),
    description: tx.Descricao_Original || tx.Nome_Fantasia || '',
    amount: Number(tx.Valor || 0),
    installmentTotal: tx.Total_Parcelas || undefined,
  }));
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
  const byRef = new Map<string, Transaction[]>();

  manualTx.forEach((t) => {
    const directedRef = parseDirectedCompetenceFromPayment(t);
    if (directedRef && isManualInvoicePayment(t)) {
      directedPaymentsByRef.set(
        directedRef,
        round2((directedPaymentsByRef.get(directedRef) || 0) + Math.abs(Number(t.Valor || 0)))
      );
      return;
    }
    const ref = referenceMonthFromTransaction(t, account).trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ref)) return;
    const list = byRef.get(ref) || [];
    list.push(t);
    byRef.set(ref, list);
  });

  for (const [ref, txs] of byRef) {
    const ledgerTxs = txs.filter(
      (t) => !(parseDirectedCompetenceFromPayment(t) && isManualInvoicePayment(t))
    );
    const totals = computeImportLedgerTotals(manualTransactionsToLedgerLines(ledgerTxs), rules);
    const card = ensureCompetenceCard(ref);

    const existingManual = card.files.find((f) => f.fileName === MANUAL_COMPETENCE_FILE_LABEL);
    const manualLine: CompetenceHistoryFileLine = {
      fileName: MANUAL_COMPETENCE_FILE_LABEL,
      transactionCount: totals.lineCount,
      statementTotal: totals.statementTotal,
      totalPayments: totals.totalPayments,
    };

    if (existingManual) {
      card.statementTotal = round2(
        card.statementTotal - existingManual.statementTotal + manualLine.statementTotal
      );
      Object.assign(existingManual, manualLine);
    } else {
      card.files.push(manualLine);
      card.statementTotal = round2(card.statementTotal + manualLine.statementTotal);
    }

    const paymentForPrior = round2(totals.totalInvoicePayments);
    const priorRef = previousReferenceMonth(ref);
    if (priorRef && paymentForPrior > 0) {
      const priorCard = ensureCompetenceCard(priorRef);
      priorCard.totalPayments = round2(priorCard.totalPayments + paymentForPrior);
    }
  }

  for (const [ref, amount] of directedPaymentsByRef) {
    if (amount < 0.005) continue;
    const card = ensureCompetenceCard(ref);
    card.totalPayments = round2(card.totalPayments + amount);
  }
}

const hasOpenBalance = (c: CompetenceHistoryCard) =>
  c.openBalance > 0.005 || c.statementTotal - c.totalPayments > 0.005;

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
