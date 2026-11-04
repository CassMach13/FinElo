import { computeImportLedgerTotals } from '../domain/credit-card/importLedgerTotals.ts';
import { effectiveDueDateIso } from '../domain/credit-card/dueDate.ts';
import type { ClassificationRules } from '../domain/credit-card/classifiers.ts';
import { Account, ImportLog, Transaction } from '../types.ts';
import type { LedgerTotalsOverride } from '../utils/creditCardStatementDisplay.ts';
import { statementDueMonthKey } from '../utils/creditCardStatementDisplay.ts';
import { comparableImportOriginKey } from '../utils/importOriginKey.ts';
import { resolveAutomaticCardReferenceMonth } from '../utils/cardImportReference.ts';
import { toDateOnlyIso } from '../utils/dateOnly.ts';
import {
  buildInvoiceCycleRowsForAccount,
  cardCycleMetaFromImportedLog,
  invoiceCycleRowToRebuildCycle,
  parseBRDateToIso,
  parseMMAAAAToIsoMonth,
} from './creditCardInvoiceCycleRows.ts';
import {
  parseCreditCardReferenceFromFileName,
  parseDueDateFromIsoFileName,
} from '../domain/credit-card/cardFileReference.ts';
import {
  appendManualCompetenceTotals,
  inferManualRefundReferenceMonth,
  isManualCardPositiveCredit,
  MANUAL_COMPETENCE_FILE_LABEL,
  referenceMonthFromTransaction,
} from './creditCardManualCompetence.ts';
import {
  isDirectedManualInvoicePayment,
  isImportedInvoicePayment,
  isManualCardRefund,
  isManualInvoicePayment,
  ledgerClassificationTextFromTransaction,
  looksLikeInvoicePaymentText,
  parseDirectedCompetenceFromPayment,
} from './creditCardDirectedPayment.ts';

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
  /**
   * Cada pagamento de fatura do arquivo, com a data de lançamento no extrato.
   * Soma = totals.totalInvoicePayments. Obrigatório: todo preview sai de
   * `buildImportHistoryPreview`, e nenhum caminho aloca pagamento pelo total
   * do arquivo.
   */
  paymentLines: ImportedInvoicePaymentLine[];
}

export interface ImportedInvoicePaymentLine {
  transactionId: string;
  postedDate: string;
  amount: number;
}

/**
 * Onde um pagamento importado foi abatido. Um mesmo pagamento pode ser dividido
 * entre a fatura anterior (o que faltava dela) e a do próprio arquivo.
 */
export interface ImportedPaymentAllocation {
  transactionId: string;
  postedDate: string;
  /** Competência do arquivo em que o pagamento aparece. */
  sourceReferenceMonth: string;
  /** Competência que recebeu o valor. */
  referenceMonth: string;
  amount: number;
}

export interface ImportHistoryRebuildResult {
  processedFiles: number;
  message: string;
  previews: ImportHistoryRebuildPreview[];
}

export interface CompetenceHistoryFileLine {
  fileName: string;
  transactionCount: number;
  /** Compras, taxas e juros (antes dos estornos). */
  totalDebits?: number;
  /** Estornos e créditos abatidos do total. */
  totalRefunds?: number;
  /** Líquido da fatura nesta fonte (débitos − estornos). */
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
  /** Soma de compras/encargos (todas as fontes). */
  totalDebits: number;
  /** Soma de estornos/créditos (todas as fontes). */
  totalRefunds: number;
  statementTotal: number;
  totalPayments: number;
  /** Antes de aplicar crédito excedente de competências anteriores. */
  openBalanceBeforeCarry: number;
  /** Crédito de meses anteriores (pagamento a mais) aplicado nesta competência. */
  priorCreditApplied: number;
  /**
   * Abatido com diferença de faturas anteriores (livro 2), preenchido pela
   * fonte canônica do histórico. Ver `withCanonicalEconomicBalances`.
   */
  priorDifferenceApplied?: number;
  openBalance: number;
  /** Crédito remanescente após esta competência (para meses seguintes). */
  creditCarriedForward: number;
  /** Usuário confirmou que o saldo residual foi pago no banco. */
  userConfirmedPaid?: boolean;
  userConfirmedAt?: string;
  /** Valor que o usuário confirmou, como gravado. */
  userConfirmedAmount?: number;
  /**
   * Parte da confirmação que entrou na fatura: só o que faltava pagar. O resto
   * já está nos pagamentos registrados. Ver `confirmedAmountToApply`.
   */
  userConfirmedAppliedAmount?: number;
  /** Estorno manual com competência explícita (modal / finelo_competence). */
  directedManualRefundTotal?: number;
  /** Pagamento manual com competência explícita (modal Pagar). */
  directedManualPaymentTotal?: number;
  /** Soma dos pagamentos de fatura nas linhas de extrato desta competência (antes do repasse XP N→N−1). */
  paymentsOnExtracts?: number;
  /** Pagamentos importados abatidos NESTA competência, de qualquer arquivo. */
  importedPaymentAllocations?: ImportedPaymentAllocation[];
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

/** Convenção Finelo no cartão importado: Despesa negativa = compra; Renda positiva = crédito. */
function cardImportLedgerAmount(tx: Transaction): number {
  const raw = round2(Number(tx.Valor || 0));
  const tipo = String(tx.Tipo || '').trim();
  if (tipo === 'Despesa') return raw <= 0 ? raw : -Math.abs(raw);
  if (tipo === 'Renda') return raw >= 0 ? raw : Math.abs(raw);
  return raw;
}

export function transactionsForFile(
  accountId: string,
  fileName: string,
  transactions: Transaction[]
): Transaction[] {
  const key = comparableImportOriginKey(fileName);
  return transactions.filter(
    (t) =>
      t.ID_Conta === accountId &&
      t.Origem &&
      t.Origem !== 'manual' &&
      !parseDirectedCompetenceFromPayment(t) &&
      comparableImportOriginKey(String(t.Origem)) === key
  );
}

export type CompetenceLedgerRole = 'compra' | 'estorno' | 'pagamento' | 'outro';

const normLedgerDesc = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Rótulo para auditoria no histórico de faturas. */
export function classifyCompetenceLedgerRole(tx: Transaction): CompetenceLedgerRole {
  if (parseDirectedCompetenceFromPayment(tx) && isDirectedManualInvoicePayment(tx)) {
    return 'pagamento';
  }
  if (isManualInvoicePayment(tx)) return 'pagamento';
  if (isImportedInvoicePayment(tx)) return 'pagamento';
  const desc = normLedgerDesc(ledgerClassificationTextFromTransaction(tx));
  const amt = Number(tx.Valor || 0);
  if (looksLikeInvoicePaymentText({
    categoria: tx.Categoria,
    nome: tx.Nome_Fantasia,
    descricao: tx.Descricao_Original,
  }) && amt > 0) {
    return 'pagamento';
  }
  if (desc.includes('pagamento') && amt > 0) return 'pagamento';
  if (amt > 0 || isManualCardRefund(tx)) return 'estorno';
  if (amt < 0) return 'compra';
  return 'outro';
}

/**
 * Pagamentos vindos de um extrato importado aparecem no arquivo da competência N
 * e, por convenção, quitam a competência anterior (N−1). Lançamentos manuais
 * direcionados já carregam sua competência de destino e não usam esta regra.
 *
 * É só a convenção, sem olhar data nem saldo. Para saber onde um pagamento foi
 * de fato abatido use `importedPaymentAllocationsByTransaction`.
 */
export function importedPaymentAppliedReferenceMonth(
  displayedReferenceMonth: string,
  tx: Transaction
): string | null {
  const origin = String(tx.Origem || '').trim().toLowerCase();
  if (!origin || origin === 'manual') return null;
  if (classifyCompetenceLedgerRole(tx) !== 'pagamento') return null;
  return previousReferenceMonth(displayedReferenceMonth);
}

/**
 * Onde cada pagamento importado foi abatido, pela MESMA alocação que calculou
 * os saldos. O histórico lê daqui para nunca contar uma história diferente da
 * do card: um pagamento pode ter ido inteiro para a fatura anterior, inteiro
 * para a própria fatura, ou ter sido dividido entre as duas.
 */
export function importedPaymentAllocationsByTransaction(
  cards: ReadonlyArray<CompetenceHistoryCard>
): Map<string, ImportedPaymentAllocation[]> {
  const index = new Map<string, ImportedPaymentAllocation[]>();
  cards.forEach((card) => {
    (card.importedPaymentAllocations ?? []).forEach((a) => {
      const list = index.get(a.transactionId) ?? [];
      list.push(a);
      index.set(a.transactionId, list);
    });
  });
  // Os cards chegam do mais novo para o mais antigo; a divisão se lê na ordem
  // em que foi feita: primeiro a fatura anterior, depois a própria.
  index.forEach((list) => list.sort((a, b) => a.referenceMonth.localeCompare(b.referenceMonth)));
  return index;
}

/**
 * Lançamentos que compõem uma competência (por arquivo importado + manuais daquele mês).
 * Usado no modal Histórico para auditar o que entrou na fatura.
 */
export function listTransactionsForCompetenceCard(input: {
  card: CompetenceHistoryCard;
  accountId: string;
  account: Account;
  transactions: Transaction[];
}): Transaction[] {
  const { card, accountId, account, transactions } = input;
  const ref = card.referenceMonth.trim();
  const seen = new Set<string>();
  const result: Transaction[] = [];

  const push = (tx: Transaction) => {
    const id = tx.ID_Transacao;
    if (!id || seen.has(id)) return;
    seen.add(id);
    result.push(tx);
  };

  card.files.forEach((f) => {
    if (f.fileName === MANUAL_COMPETENCE_FILE_LABEL) {
      transactions
        .filter(
          (t) =>
            t.ID_Conta === accountId && String(t.Origem || '').trim().toLowerCase() === 'manual'
        )
        .forEach((t) => {
          if (parseDirectedCompetenceFromPayment(t)) return;
          if (isManualCardRefund(t) || isManualCardPositiveCredit(t)) {
            const refundRef = inferManualRefundReferenceMonth(t, account);
            if (refundRef === ref) push(t);
            return;
          }
          if (referenceMonthFromTransaction(t, account).trim() === ref) push(t);
        });
      return;
    }
    transactionsForFile(accountId, f.fileName, transactions).forEach(push);
  });

  transactions
    .filter(
      (t) =>
        t.ID_Conta === accountId && String(t.Origem || '').trim().toLowerCase() === 'manual'
    )
    .forEach((t) => {
      const directed = parseDirectedCompetenceFromPayment(t);
      if (directed === ref) push(t);
    });

  return result.sort((a, b) => {
    const da = new Date(a.Data).getTime();
    const db = new Date(b.Data).getTime();
    if (db !== da) return db - da;
    return String(a.Nome_Fantasia || '').localeCompare(String(b.Nome_Fantasia || ''));
  });
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
  return card.files.some((f) => f.fileName !== MANUAL_COMPETENCE_FILE_LABEL);
}

/**
 * Só existe excedente quando existe fatura para pagar a mais.
 *
 * Não use `competenceHasImportedStatement` para isto. Aquele predicado responde
 * «veio de arquivo?», que é o que interessa para esconder competências-fantasma —
 * e usá-lo como proxy de «tem fatura?» já apagou, uma vez, o crédito de quem paga
 * a mais num cartão só com lançamentos manuais. O que protege contra crédito
 * inventado é exigir uma fatura real, não exigir um CSV.
 */
export function competenceCanGenerateSurplusCredit(card: CompetenceHistoryCard): boolean {
  return card.statementTotal > 0.005;
}

/**
 * Recalcula o total da fatura: soma compras de todas as fontes − soma estornos.
 * Não usa max(0, débitos−estornos) por arquivo — estorno manual em linha separada precisa abater o import.
 */
export function reconcileCardStatementTotalFromFiles(card: CompetenceHistoryCard): void {
  let debits = 0;
  let refunds = 0;
  let legacyNet = 0;

  card.files.forEach((f) => {
    const fileRefunds = round2(f.totalRefunds ?? 0);
    if (f.totalDebits != null && Number.isFinite(f.totalDebits)) {
      debits = round2(debits + f.totalDebits);
      refunds = round2(refunds + fileRefunds);
      return;
    }
    legacyNet = round2(legacyNet + f.statementTotal);
  });

  const fromBreakdown = round2(debits - refunds);
  card.statementTotal = round2(Math.max(0, fromBreakdown + legacyNet));
}

/**
 * Competência criada só para receber pagamento do extrato do mês seguinte (sem CSV neste mês).
 * Não deve aparecer como fatura R$ 0 no histórico.
 */
export function isPaymentOnlyGhostCompetenceCard(card: CompetenceHistoryCard): boolean {
  if (competenceHasImportedStatement(card)) return false;
  if ((card.directedManualRefundTotal ?? 0) > 0.005) return false;
  /**
   * Pagamento REGISTRADO PELO USUÁRIO nunca é fantasma.
   *
   * A competência fantasma que este filtro existe para esconder é a que nasce
   * da convenção de importação — o arquivo do mês N+1 empurra seu pagamento
   * para N, e sem CSV em N sobraria uma fatura R$ 0 que ninguém reconhece.
   *
   * Um pagamento manual dirigido é outra coisa: é dinheiro que o usuário
   * afirma ter pago. Ele caía aqui quando a competência apontada não tinha
   * fatura, e sumia de TODAS as superfícies sem erro nenhum — o saldo não
   * andava e não havia o que olhar. Esconder é o pior desfecho possível:
   * melhor a competência aparecer com a diferença a conciliar do que o valor
   * evaporar em silêncio.
   */
  if ((card.directedManualPaymentTotal ?? 0) > 0.005) return false;
  const manual = card.files.find((f) => f.fileName === MANUAL_COMPETENCE_FILE_LABEL);
  if (manual && ((manual.totalDebits ?? 0) > 0.005 || (manual.totalRefunds ?? 0) > 0.005)) return false;
  return card.files.length === 0 && card.totalPayments > 0.005 && card.statementTotal < 0.005;
}

/** Extrato importado sem compras, pagamentos nem ajuste manual útil — evita cards 01/2026 R$ 0 PAGA. */
export function isMeaninglessCompetenceHistoryCard(card: CompetenceHistoryCard): boolean {
  if (isPaymentOnlyGhostCompetenceCard(card)) return true;
  if ((card.directedManualRefundTotal ?? 0) > 0.005) return false;
  if ((card.directedManualPaymentTotal ?? 0) > 0.005) return false;
  const meaningful =
    card.statementTotal > 0.005 ||
    card.totalPayments > 0.005 ||
    card.totalDebits > 0.005 ||
    card.totalRefunds > 0.005 ||
    card.openBalance > 0.005;
  return !meaningful;
}

export function sumPaymentsOnExtractFiles(card: CompetenceHistoryCard): number {
  return round2(
    card.files.reduce((sum, f) => {
      if (f.fileName === MANUAL_COMPETENCE_FILE_LABEL) return sum;
      return sum + round2(f.totalPayments ?? 0);
    }, 0)
  );
}

function importLogBelongsToAccount(
  log: ImportLog,
  accountId: string,
  transactions: Transaction[]
): boolean {
  const det = Array.isArray(log.imported_details) ? log.imported_details : [];
  if (det.some((d: { ID_Conta?: string }) => d?.ID_Conta === accountId)) return true;
  const key = comparableImportOriginKey(log.file_name);
  if (!key) return false;
  return transactions.some(
    (t) =>
      t.ID_Conta === accountId &&
      t.Origem &&
      String(t.Origem).trim().toLowerCase() !== 'manual' &&
      comparableImportOriginKey(String(t.Origem)) === key
  );
}

/** Um ciclo por arquivo importado (log) + linhas do modal de competências — evita colapsar meses em um só card. */
export function buildImportHistoryCyclesForAccount(input: {
  accountId: string;
  account: Account;
  accounts: Account[];
  transactions: Transaction[];
  importLogs: ImportLog[];
  invoiceDueDayStr?: string;
}): ImportHistoryRebuildCycle[] {
  const { accountId, account, accounts, transactions, importLogs, invoiceDueDayStr = '' } = input;
  const seen = new Set<string>();
  const cycles: ImportHistoryRebuildCycle[] = [];
  const dueDay = Number(account.dia_vencimento) || 10;

  const add = (cycle: ImportHistoryRebuildCycle) => {
    const ref = cycle.referenceMonth.trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ref)) return;
    const dedupe = `${ref}::${comparableImportOriginKey(cycle.fileName)}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    const dueDate =
      cycle.dueDate && /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(cycle.dueDate)
        ? cycle.dueDate
        : parseDueFromReference(ref, dueDay);
    cycles.push({ fileName: cycle.fileName, referenceMonth: ref, dueDate });
  };

  importLogs.forEach((log) => {
    if (!importLogBelongsToAccount(log, accountId, transactions)) return;
    if (transactionsForFile(accountId, log.file_name, transactions).length === 0) return;
    const persisted = cardCycleMetaFromImportedLog(log, accountId);
    const referenceMonth =
      parseMMAAAAToIsoMonth(persisted.competenciaBR.trim()) ||
      suggestReferenceMonthFromLog(
        log.file_name,
        log.imported_details as unknown[] | undefined,
        Number(account.dia_fechamento) || undefined
      );
    if (!referenceMonth) return;
    const dueDate =
      parseBRDateToIso(persisted.vencimentoBR.trim()) ||
      parseDueFromReference(referenceMonth, dueDay);
    add({ fileName: log.file_name, referenceMonth, dueDate });
  });

  const cycleRows = buildInvoiceCycleRowsForAccount({
    accounts,
    transactions,
    importLogs,
    filterAccountId: accountId,
  });
  cycleRows
    .filter((r) => parseMMAAAAToIsoMonth(r.competenciaBR.trim()) && r.txCount > 0)
    .forEach((r) => add(invoiceCycleRowToRebuildCycle(r, accounts, invoiceDueDayStr)));

  return cycles;
}

/** Agrega compras e estornos por arquivo para exibição/auditoria no histórico. */
export function enrichCompetenceCardBreakdown(card: CompetenceHistoryCard): void {
  let debits = 0;
  let refunds = 0;
  card.files.forEach((f) => {
    const fileRefunds = round2(f.totalRefunds ?? 0);
    const fileDebits = round2(
      f.totalDebits != null && Number.isFinite(f.totalDebits)
        ? f.totalDebits
        : f.statementTotal
    );
    debits = round2(debits + fileDebits);
    refunds = round2(refunds + fileRefunds);
  });
  card.totalDebits = debits;
  card.totalRefunds = refunds;
}

/**
 * Excedente abaixo deste valor não vira crédito no mês seguinte (arredondamento extrato × pagamento).
 * Ex.: pagamento R$ 6.402,97 vs total R$ 6.402,03 → R$ 0,94 não deve abater a fatura de maio.
 */
export const MICRO_SURPLUS_CARRY_MAX = 1;

/**
 * Quanto de uma confirmação «está pago» entra na fatura.
 *
 * A confirmação diz que o saldo desta competência foi quitado no banco: ela
 * ZERA o saldo, não acrescenta dinheiro. Se os pagamentos registrados para a
 * competência já cobrem parte (ou tudo) do que foi confirmado, essa parte é o
 * mesmo dinheiro visto duas vezes. Somar as duas criaria pagamento acima da
 * fatura e tiraria o valor da competência seguinte.
 *
 * Por isso a confirmação entra até o saldo que ainda falta, nunca além. O valor
 * confirmado continua gravado e visível; só não é contado duas vezes.
 */
export function confirmedAmountToApply(
  settledAmount: number,
  statementTotal: number,
  paymentsAlreadyRecognized: number
): number {
  const faltando = round2(Math.max(0, statementTotal - paymentsAlreadyRecognized));
  return round2(Math.max(0, Math.min(settledAmount, faltando)));
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
      competenceCanGenerateSurplusCredit(card) && rawSurplus >= MICRO_SURPLUS_CARRY_MAX
        ? rawSurplus
        : 0;

    card.openBalanceBeforeCarry = grossDeficit;
    card.priorCreditApplied = round2(Math.min(availableCredit, grossDeficit));
    card.openBalance = round2(Math.max(0, grossDeficit - card.priorCreditApplied));

    availableCredit = round2(availableCredit - card.priorCreditApplied + grossSurplus);
    card.creditCarriedForward = availableCredit;
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

function suggestReferenceMonthFromLog(
  fileName: string,
  importedDetails?: unknown[],
  dueDayOfMonth?: number
): string | null {
  const det = Array.isArray(importedDetails) ? importedDetails : [];
  const meta = det.find((d: any) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(d?.Card_Reference_Label || '')));
  if (meta?.Card_Reference_Label) return String(meta.Card_Reference_Label);
  /**
   * Vencimento DECLARADO pelo nome do arquivo (ex. Nubank_2026-06-18.csv) —
   * autoritativo quando existe, testado antes do conteúdo. Não concorre com
   * `parseCreditCardReferenceFromFileName` abaixo, que lê OUTRA convenção
   * (mmm-aaaa/mm-aaaa).
   */
  const isoDueFromFile = parseDueDateFromIsoFileName(fileName);
  const fromImportedRows = resolveAutomaticCardReferenceMonth(
    det.map((detail: any) => ({
      Data: detail?.Data,
      Valor: detail?.Valor,
      Tipo: detail?.Tipo,
    })),
    isoDueFromFile,
    dueDayOfMonth
  );
  if (fromImportedRows) return fromImportedRows;
  const fromFile = parseCreditCardReferenceFromFileName(fileName);
  if (!fromFile) return null;
  /** Nome do arquivo costuma indicar vencimento (ex. Jan_2026); competência = mês anterior. */
  let y = fromFile.dueYear;
  let m = fromFile.dueMonth - 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
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
      ? det.find(
          (d) =>
            d?.ID_Conta === accountId &&
            (d?.Card_Reference_Label || d?.Card_Due_Date)
        )
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

export function toImportLines(txs: Transaction[]): Array<{
  postedDate: string;
  description: string;
  amount: number;
  installmentTotal?: number;
  fineloTipo?: string;
}> {
  return txs.map((tx) => ({
    postedDate: toDateOnlyIso(tx.Data),
    description: ledgerClassificationTextFromTransaction(tx),
    amount: cardImportLedgerAmount(tx),
    installmentTotal: tx.Total_Parcelas || undefined,
    fineloTipo: tx.Tipo ? String(tx.Tipo) : undefined,
  }));
}

/**
 * O preview de um arquivo importado: totais e cada pagamento de fatura, com
 * id, data de lançamento e valor.
 *
 * ÚNICA forma de montar um `ImportHistoryRebuildPreview`. Histórico, card,
 * Edge function e persistência de faturas passam por aqui. A persistência
 * montava o próprio preview sem as linhas de pagamento; qualquer cálculo feito
 * a partir dele cairia na convenção antiga (todo pagamento em N−1).
 */
export function buildImportHistoryPreview(
  accountId: string,
  cycle: ImportHistoryRebuildCycle,
  transactions: Transaction[],
  rules?: ClassificationRules
): ImportHistoryRebuildPreview {
  const txs = transactionsForFile(accountId, cycle.fileName, transactions);
  const lines = toImportLines(txs);
  const totals = computeImportLedgerTotals(lines, rules);
  return {
    fileName: cycle.fileName,
    referenceMonth: cycle.referenceMonth,
    dueDate: cycle.dueDate,
    transactionCount: txs.length,
    totals,
    paymentLines: totals.invoicePaymentLineIndexes.map((i) => ({
      transactionId: String(txs[i].ID_Transacao || ''),
      postedDate: lines[i].postedDate,
      amount: round2(Math.abs(lines[i].amount)),
    })),
  };
}

const toCentsInt = (value: number): number => Math.round((Number(value) || 0) * 100);

/**
 * Quanto da fatura anterior um pagamento ATRASADO ainda pode quitar.
 *
 * Não basta `total − pagamentos` da própria fatura. Se faturas anteriores
 * receberam a mais, esse dinheiro já reduziu a dívida acumulada, e é assim que
 * o emissor trata o pagamento: abate o que está de fato em aberto. Na conta
 * piloto, um crédito de R$ 0,94 numa fatura cobriu a seguinte; o pagamento da
 * fatura posterior, lançado depois daquele vencimento, ia completar uma fatura
 * já compensada, e a diferença reaparecia no livro 2.
 *
 * Só entram competências com fatura (total > 0): o pagamento de uma fatura não
 * importada não tem cobrança conhecida para comparar e não vira crédito. O
 * resultado é o menor entre o saldo da própria fatura e a dívida acumulada até
 * ela, nunca negativo. Não depende de resolução de conciliação: o destino do
 * pagamento é o mesmo em todas as rotas, com ou sem elas.
 */
export function lateImportedPaymentPriorCapacity(
  cards: ReadonlyArray<Pick<CompetenceHistoryCard, 'referenceMonth' | 'statementTotal' | 'totalPayments'>>,
  priorRef: string
): number {
  const prior = cards.find((c) => c.referenceMonth === priorRef);
  if (!prior || prior.statementTotal <= 0.005) return 0;
  const ownCents = Math.max(0, toCentsInt(prior.statementTotal) - toCentsInt(prior.totalPayments));
  const cumulativeCents = cards
    .filter((c) => c.statementTotal > 0.005 && c.referenceMonth <= priorRef)
    .reduce((acc, c) => acc + toCentsInt(c.statementTotal) - toCentsInt(c.totalPayments), 0);
  return Math.max(0, Math.min(ownCents, cumulativeCents)) / 100;
}

export const creditCardRebuildFromImportHistoryService = {
  previewCycles(
    accountId: string,
    cycles: ImportHistoryRebuildCycle[],
    transactions: Transaction[],
    rules?: ClassificationRules
  ): ImportHistoryRebuildPreview[] {
    return cycles.map((cycle) => buildImportHistoryPreview(accountId, cycle, transactions, rules));
  },

  /**
   * Sugere competência AAAA-MM a partir do nome do arquivo ou metadados do
   * log. `dueDayOfMonth` (dia_fechamento da conta) refina a competência pelo
   * CICLO real quando o arquivo não declara vencimento — sem ele, cai no mês
   * civil mais recente das linhas, que erra sempre que o ciclo atravessa a
   * virada do mês.
   */
  suggestReferenceMonth(
    fileName: string,
    importedDetails?: unknown[],
    dueDayOfMonth?: number
  ): string | null {
    return suggestReferenceMonthFromLog(fileName, importedDetails, dueDayOfMonth);
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

    const cyclesForPreview = buildImportHistoryCyclesForAccount({
      accountId,
      account,
      accounts,
      transactions,
      importLogs,
      invoiceDueDayStr,
    });

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
        totalDebits: 0,
        totalRefunds: 0,
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
        totalDebits: p.totals.totalDebits,
        totalRefunds: p.totals.totalRefunds,
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
    });

    // Primeiro materializa todas as competências reais. Assim, um pagamento do
    // arquivo N não cria a competência N-1 com um vencimento sintético antes de
    // o arquivo real dessa competência ser processado (a API retorna logs do mais
    // recente para o mais antigo).
    /**
     * Pagamento de fatura no CSV (ex. «Pagamentos Válidos») e a fatura que ele quita.
     *
     * O arquivo da competência N lista os pagamentos RECEBIDOS durante o ciclo
     * de N. O pagamento feito até o vencimento de N−1 é o pagamento de N−1 —
     * a convenção N → N−1 de sempre, e ela continua valendo inteira, inclusive
     * o excedente, que segue para o livro 2 como antes.
     *
     * O que a convenção não cobria é o pagamento feito DEPOIS do vencimento de
     * N−1. Ele não pode ser o pagamento em dia daquela fatura: ou é atraso
     * (cobre o que ainda falta de N−1), ou é antecipação da própria N. Jogá-lo
     * inteiro em N−1 produzia, numa conta real, R$ 4.145,49 «pagos a mais» numa
     * fatura e a falta do mesmo dinheiro na seguinte; e, no primeiro arquivo
     * importado, um pagamento antecipado ia para uma competência fantasma e
     * sumia, deixando quitada uma fatura que o app mostrava vencida.
     *
     * Esses pagamentos são abatidos depois, quando o saldo de N−1 já é
     * conhecido (manuais, dirigidos e confirmações incluídos): primeiro o que
     * de fato falta de N−1 (`lateImportedPaymentPriorCapacity`), o resto em N.
     * Nada é criado nem perdido — cada centavo do pagamento cai em N−1 ou em N.
     *
     * «Em dia» = lançado até o vencimento EFETIVO de N−1 (o próprio dia, ou a
     * segunda-feira de um vencimento de fim de semana). Não há folga por data:
     * um pagamento lançado um dia depois segue o caminho do atraso, que ainda
     * quita N−1 inteiro antes de tocar em N. A data decide só para onde vai a
     * SOBRA, nunca se a fatura anterior foi paga.
     */
    const afterPriorDue: Array<ImportedInvoicePaymentLine & { ref: string; priorRef: string | null }> = [];
    const allocations: ImportedPaymentAllocation[] = [];
    const allocate = (
      line: ImportedInvoicePaymentLine,
      sourceRef: string,
      targetRef: string,
      amount: number,
      dueIso?: string
    ) => {
      if (amount < 0.005) return;
      const card = ensureCompetenceCard(targetRef, dueIso);
      card.totalPayments = round2(card.totalPayments + amount);
      allocations.push({
        transactionId: line.transactionId,
        postedDate: line.postedDate,
        sourceReferenceMonth: sourceRef,
        referenceMonth: targetRef,
        amount: round2(amount),
      });
    };

    previews.forEach((p) => {
      const ref = p.referenceMonth.trim();
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ref)) return;

      const priorRef = previousReferenceMonth(ref);
      const priorDue = priorRef
        ? byCompetence.get(priorRef)?.dueDate || parseDueFromReference(priorRef, dueDay)
        : '';
      const priorEffectiveDue = priorDue ? effectiveDueDateIso(priorDue) : '';

      p.paymentLines.forEach((line) => {
        if (line.amount < 0.005) return;
        if (priorRef && (!line.postedDate || !priorEffectiveDue || line.postedDate <= priorEffectiveDue)) {
          allocate(line, ref, priorRef, line.amount, priorDue || undefined);
          return;
        }
        afterPriorDue.push({ ...line, ref, priorRef });
      });
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
    cards.forEach((card) => {
      reconcileCardStatementTotalFromFiles(card);
      enrichCompetenceCardBreakdown(card);
      card.paymentsOnExtracts = sumPaymentsOnExtractFiles(card);
    });

    const confirmByRef = new Map(
      userPaymentConfirmations.map((c) => [c.referenceMonth.trim(), c])
    );
    cards.forEach((card) => {
      const conf = confirmByRef.get(card.referenceMonth.trim());
      if (!conf || conf.settledAmount < 0.005) return;
      card.userConfirmedPaid = true;
      card.userConfirmedAt = conf.confirmedAt;
      card.userConfirmedAmount = round2(conf.settledAmount);
      // Primeira etapa, antes dos pagamentos atrasados: a confirmação é
      // declaração explícita do usuário e prevalece sobre a inferência por data.
      // Ela reserva a fatura, e um pagamento atrasado não é puxado para uma fatura
      // que o usuário declarou paga. Os pagamentos no prazo e os dirigidos a esta
      // fatura já estão somados aqui. A segunda etapa vem depois do laço.
      const aplicado = confirmedAmountToApply(conf.settledAmount, card.statementTotal, card.totalPayments);
      card.userConfirmedAppliedAmount = aplicado;
      card.totalPayments = round2(card.totalPayments + aplicado);
    });

    // Pagamentos feitos depois do vencimento de N−1, em ordem cronológica:
    // primeiro o que ainda falta de N−1, o resto na própria N.
    //
    // Sobra de centavos: se o pagamento completou N−1 e passou dela por menos
    // de MICRO_SURPLUS_CARRY_MAX, a sobra é diferença de N−1 (arredondamento,
    // IOF, linha que faltou no arquivo), não antecipação de N. Fica em N−1 e
    // vai para o livro 2 — a mesma política que impede micro-excedente de virar
    // crédito. Pagamento que não tocou N−1 vai inteiro para N, de qualquer valor.
    afterPriorDue
      .sort((a, b) =>
        a.postedDate !== b.postedDate
          ? a.postedDate.localeCompare(b.postedDate)
          : a.transactionId.localeCompare(b.transactionId)
      )
      .forEach((line) => {
        const prior = line.priorRef ? byCompetence.get(line.priorRef) : undefined;
        const capacity = prior ? lateImportedPaymentPriorCapacity(cards, prior.referenceMonth) : 0;
        let toPrior = round2(Math.min(capacity, line.amount));
        const rest = round2(line.amount - toPrior);
        if (toPrior > 0.005 && rest > 0.005 && rest < MICRO_SURPLUS_CARRY_MAX) toPrior = line.amount;
        if (prior && toPrior > 0.005) allocate(line, line.ref, prior.referenceMonth, toPrior);
        allocate(line, line.ref, line.ref, round2(line.amount - toPrior));
      });

    // Segunda etapa da confirmação: com todos os pagamentos já atribuídos, ela
    // cobre só o que ainda falta. Um pagamento atrasado que caiu na própria
    // fatura não é contado de novo pela confirmação. O valor aplicado só pode
    // diminuir em relação à reserva, e a fatura confirmada termina quitada.
    cards.forEach((card) => {
      if (card.userConfirmedAppliedAmount == null || card.userConfirmedAmount == null) return;
      const semConfirmacao = round2(card.totalPayments - card.userConfirmedAppliedAmount);
      const aplicado = confirmedAmountToApply(card.userConfirmedAmount, card.statementTotal, semConfirmacao);
      card.userConfirmedAppliedAmount = aplicado;
      card.totalPayments = round2(semConfirmacao + aplicado);
    });

    cards.forEach((card) => {
      const mine = allocations.filter((a) => a.referenceMonth === card.referenceMonth);
      if (mine.length > 0) card.importedPaymentAllocations = mine;
    });

    applySequentialCreditCarryForward(cards);

    return cards.filter((c) => !isPaymentOnlyGhostCompetenceCard(c)).sort((a, b) => {
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
