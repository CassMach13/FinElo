import type { ClassificationRules } from '../domain/credit-card/classifiers.ts';
import {
  computeImportLedgerTotals,
  type ImportLedgerLineInput,
} from '../domain/credit-card/importLedgerTotals.ts';
import { Account, Transaction } from '../types.ts';
import type {
  CompetenceHistoryCard,
  CompetenceHistoryFileLine,
} from './creditCardRebuildFromImportHistoryService.ts';
import { reconcileCardStatementTotalFromFiles } from './creditCardRebuildFromImportHistoryService.ts';
import {
  isDirectedManualInvoicePayment,
  isDirectedManualRefund,
  isManualCardRefund,
  isManualInvoicePayment,
  parseDirectedCompetenceFromPayment,
  referenceMonthFromIsoDate,
  stripCompetenceMarker,
  upsertCompetenceMarkerInTransaction,
} from './creditCardDirectedPayment.ts';
import { toDateOnlyIso } from '../utils/dateOnly.ts';

export function parseDueFromReferenceMonth(referenceMonth: string, dueDay: number): string {
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

function competenceMonthToBR(referenceMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(referenceMonth.trim());
  if (!m) return referenceMonth;
  return `${m[2]}/${m[1]}`;
}

function isoDateToBR(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Garante opção da competência do mês da data (ex. maio) no seletor de estorno. */
export function ensureRefundCompetenceCardOptions(
  cards: CompetenceHistoryCard[],
  account: Account,
  dataIso: string
): CompetenceHistoryCard[] {
  const dataMonth = referenceMonthFromIsoDate(toLocalDateIso(dataIso));
  if (!dataMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(dataMonth)) return cards;
  if (cards.some((c) => c.referenceMonth === dataMonth)) return cards;

  const dueDay = Number(account.dia_vencimento) || 10;
  const dueDate = parseDueFromReferenceMonth(dataMonth, dueDay);
  const dueParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate.trim());

  const placeholder: CompetenceHistoryCard = {
    referenceMonth: dataMonth,
    competenceBR: competenceMonthToBR(dataMonth),
    dueDate,
    vencimentoBR: isoDateToBR(dueDate),
    dueYear: dueParts ? Number(dueParts[1]) : 0,
    dueMonth: dueParts ? Number(dueParts[2]) : 0,
    files: [],
    totalDebits: 0,
    totalRefunds: 0,
    statementTotal: 0,
    totalPayments: 0,
    openBalanceBeforeCarry: 0,
    priorCreditApplied: 0,
    openBalance: 0,
    creditCarriedForward: 0,
  };

  return [...cards, placeholder].sort((a, b) => b.referenceMonth.localeCompare(a.referenceMonth));
}

/**
 * Reinfere competência do estorno na edição, ignorando marcador finelo incorreto
 * (ex. 04/2026 gravado quando a data do lançamento é maio).
 */
export function resolveRefundCompetenceMonthForEdit(tx: Transaction, account: Account): string {
  const stripped: Transaction = {
    ...tx,
    Observacoes: stripCompetenceMarker(tx.Observacoes),
    Descricao_Original: stripCompetenceMarker(tx.Descricao_Original),
  };
  return inferManualRefundReferenceMonth(stripped, account) || '';
}

/**
 * Na aba Transações, ao editar Data_Pagamento o usuário indica a fatura desejada.
 * Compra e vencimento no mesmo mês → competência desse mês; compra anterior → mês do vencimento.
 */
export function inferUserTargetCompetenceOnPaymentEdit(
  paymentIso: string,
  purchaseIso: string,
  account: Account
): string | null {
  const paymentMonth = referenceMonthFromIsoDate(paymentIso);
  const purchaseMonth = referenceMonthFromIsoDate(purchaseIso);
  if (!paymentMonth) return null;
  if (purchaseMonth === paymentMonth) return paymentMonth;

  if (paymentIsoLooksLikeCardDueDate(paymentIso, account)) {
    const fromDue = referenceMonthFromPaymentDueDate(paymentIso);
    if (fromDue && paymentMonth !== fromDue && purchaseMonth && purchaseMonth < fromDue) {
      return paymentMonth;
    }
    if (fromDue) return fromDue;
  }

  if (purchaseMonth && purchaseMonth < paymentMonth) return paymentMonth;
  return paymentMonth;
}

export const MANUAL_COMPETENCE_FILE_LABEL = 'Lançamentos manuais';

const round2 = (n: number) => Math.round(n * 100) / 100;

export function toLocalDateIso(date: Date | string | undefined): string {
  return toDateOnlyIso(date);
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

/** Competência a partir de Data + Data_Pagamento no dia de vencimento do cartão. */
export function competenceMonthFromManualPaymentDate(
  dataIso: string,
  paymentIso: string,
  account: Account,
  opts?: { treatAsRefund?: boolean }
): string | null {
  const normalizedData = toLocalDateIso(dataIso);
  const normalizedPay = toLocalDateIso(paymentIso);
  const dataMonth = referenceMonthFromIsoDate(normalizedData);
  const paymentMonth = referenceMonthFromIsoDate(normalizedPay);

  if (paymentIsoLooksLikeCardDueDate(normalizedPay, account)) {
    // Estorno/cashback: vencimento no mês M → fatura M (intenção na aba Transações).
    if (opts?.treatAsRefund && paymentMonth) return paymentMonth;
    if (dataMonth && paymentMonth && dataMonth === paymentMonth) return dataMonth;
    const fromDue = referenceMonthFromPaymentDueDate(normalizedPay);
    if (fromDue) return fromDue;
  }
  return paymentMonth || dataMonth;
}

/** Crédito manual positivo no cartão (cashback, estorno) — não é pagamento de fatura. */
export function isManualCardPositiveCredit(tx: Transaction): boolean {
  if (String(tx.Origem || 'manual').trim().toLowerCase() !== 'manual') return false;
  if (String(tx.Tipo) !== 'Renda') return false;
  if (isManualInvoicePayment(tx)) return false;
  return Number(tx.Valor || 0) > 0.005;
}

/**
 * Competência do estorno manual: marcador finelo_competence → vencimento (dia do cartão) → mês da Data.
 * Evita que Data_Pagamento = data do lançamento (ex. 21/05) caia no mês anterior (04/2026).
 */
export function inferManualRefundReferenceMonth(tx: Transaction, account: Account): string | null {
  const directed = parseDirectedCompetenceFromPayment(tx);
  if (directed) return directed;
  if (!isManualCardRefund(tx) && !isManualCardPositiveCredit(tx)) return null;
  const dataIso = toLocalDateIso(tx.Data);
  const payIso = tx.Data_Pagamento ? toLocalDateIso(tx.Data_Pagamento) : '';
  if (payIso) {
    const fromPayment = competenceMonthFromManualPaymentDate(dataIso, payIso, account, {
      treatAsRefund: true,
    });
    if (fromPayment) return fromPayment;
  }
  return referenceMonthFromIsoDate(dataIso);
}

/**
 * Ao editar Data_Pagamento de lançamento manual no cartão, grava finelo_competence quando a
 * fatura desejada (mês da data) diverge do cálculo automático (vencimento − 1 mês).
 */
export function prepareManualPurchaseCompetenceOnPaymentDateEdit(
  oldTx: Transaction,
  fields: Partial<Transaction>,
  account: Account
): Partial<Transaction> {
  if (fields.Data_Pagamento === undefined) return fields;
  if (String(oldTx.Origem || 'manual').trim().toLowerCase() !== 'manual') return fields;
  const isPurchase = String(oldTx.Tipo) === 'Despesa';
  const isRefund = isManualCardRefund(oldTx);
  if (!isPurchase && !isRefund) return fields;
  if (account.Tipo_Conta !== 'Cartão de Crédito') return fields;

  const newPay = toLocalDateIso(fields.Data_Pagamento as string | Date);
  const oldPay = oldTx.Data_Pagamento ? toLocalDateIso(oldTx.Data_Pagamento) : '';
  if (!newPay || newPay === oldPay) return fields;

  const directed = inferUserTargetCompetenceOnPaymentEdit(newPay, toLocalDateIso(oldTx.Data), account);
  if (!directed) return fields;

  const withoutMarker: Transaction = {
    ...oldTx,
    ...fields,
    Observacoes: stripCompetenceMarker(oldTx.Observacoes),
    Descricao_Original: stripCompetenceMarker(oldTx.Descricao_Original),
  };
  const autoCompetence = referenceMonthFromTransaction(withoutMarker, account);
  if (autoCompetence === directed) return fields;

  return { ...fields, ...upsertCompetenceMarkerInTransaction(oldTx, directed) };
}

/** Compra: vencimento (Data_Pagamento). Estorno: regra em inferManualRefundReferenceMonth. */
export function referenceMonthFromTransaction(t: Transaction, account: Account): string {
  const directed = parseDirectedCompetenceFromPayment(t);
  if (directed) return directed;
  if (isManualCardRefund(t) || isManualCardPositiveCredit(t)) {
    return inferManualRefundReferenceMonth(t, account) || '';
  }
  const paymentIso = t.Data_Pagamento ? toLocalDateIso(t.Data_Pagamento) : '';
  if (paymentIso) {
    const dataIso = toLocalDateIso(t.Data);
    const fromPayment = competenceMonthFromManualPaymentDate(dataIso, paymentIso, account);
    if (fromPayment) return fromPayment;
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

  /**
   * Os dois caminhos precisam COBRIR o conjunto, não só não se sobrepor.
   *
   * `transactionsForFile` recusa duas classes de linha: as de origem manual e
   * as que carregam marcador de competência dirigida. A segunda recusa não
   * tinha contrapartida aqui — este filtro exigia origem manual —, e uma linha
   * com marcador vinda de ARQUIVO caía entre os dois e sumia do ledger sem
   * ruído. Foi o caso de um estorno de R$ 30,36 dirigido a 2026-07: importado
   * de CSV, marcado pelo modal, e invisível para as duas superfícies.
   *
   * A união agora é total e a interseção continua vazia — cada lançamento da
   * conta é somado por exatamente um caminho.
   */
  const manualTx = transactions.filter(
    (t) =>
      t.ID_Conta === accountId &&
      (String(t.Origem || 'manual').trim().toLowerCase() === 'manual' ||
        parseDirectedCompetenceFromPayment(t) != null)
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
    if (directedRef && String(t.Tipo) === 'Despesa') {
      const list = byRef.get(directedRef) || [];
      list.push(t);
      byRef.set(directedRef, list);
      return;
    }
    if (directedRef && !isDirectedManualInvoicePayment(t)) {
      directedRefundsByRef.set(
        directedRef,
        round2((directedRefundsByRef.get(directedRef) || 0) + Math.abs(Number(t.Valor || 0)))
      );
      return;
    }
    if (isManualCardRefund(t) || isManualCardPositiveCredit(t)) {
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
    const ledgerTxs = txs.filter(
      (t) => !parseDirectedCompetenceFromPayment(t) || String(t.Tipo) === 'Despesa'
    );
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
 * Valor da fatura vigente no card — alinhado ao «Total da fatura» do histórico.
 */
export function competenceFaturaAtualDisplayAmount(card: CompetenceHistoryCard): number {
  if (card.statementTotal > 0.005) return round2(card.statementTotal);
  return competenceAmountDue(card);
}

/** Resíduos pequenos (< 5% do maior saldo em aberto) não representam a fatura vigente. */
function isSignificantOpenBalance(card: CompetenceHistoryCard, maxOpen: number): boolean {
  if (card.openBalance <= 0.005) return false;
  if (maxOpen < 1) return true;
  return card.openBalance >= maxOpen * 0.05;
}

/**
 * Competência exibida no card como «Fatura Atual».
 * Prioriza o ciclo vigente (competência mais recente com saldo relevante).
 */
export function pickFaturaAtualCompetenceCard(
  cards: CompetenceHistoryCard[],
  todayIso: string
): CompetenceHistoryCard | undefined {
  const maxOpen = cards.reduce((max, c) => Math.max(max, c.openBalance), 0);

  const upcomingOpen = cards
    .filter(
      (c) => c.dueDate && c.dueDate >= todayIso && isSignificantOpenBalance(c, maxOpen)
    )
    .sort((a, b) => b.referenceMonth.localeCompare(a.referenceMonth));
  if (upcomingOpen.length > 0) return upcomingOpen[0];

  const overdueOpen = cards
    .filter((c) => c.dueDate && c.dueDate < todayIso && isSignificantOpenBalance(c, maxOpen))
    .sort((a, b) => b.referenceMonth.localeCompare(a.referenceMonth));
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
