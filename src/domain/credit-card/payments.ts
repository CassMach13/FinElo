import { CreditCardImportEntry, CreditCardPayment, CreditCardStatement, CreditCardStatementStatus } from './types';
import { formatReferenceLabel, getPreviousReferenceLabel } from './assignment';
import { inferDirection } from './classifiers';

const round2 = (value: number): number => Math.round(value * 100) / 100;

export const sumPaymentsForStatement = (payments: CreditCardPayment[], statementId: string): number =>
  round2(
    payments
      .filter((p) => p.statementId === statementId)
      .reduce((acc, p) => acc + Math.abs(Number(p.amount || 0)), 0)
  );

const stmtOrder = (y: number, m: number) => y * 100 + m;

/** Evita contar duas vezes o mesmo lançamento importado (persistido + sintético do mês seguinte). */
export function creditCardPaymentMatchesImportEntry(
  payments: CreditCardPayment[],
  entry: Pick<CreditCardImportEntry, 'sourceRowHash' | 'transactionId' | 'postedDate'>
): boolean {
  const tid = entry.transactionId || undefined;
  const hash = entry.sourceRowHash;
  return payments.some((p) => {
    if (tid && p.paymentTransactionId && p.paymentTransactionId === tid) return true;
    if (hash && p.notes?.includes(hash)) return true;
    return false;
  });
}

function collectRowHashesFromPaymentNotes(notes?: string | null): string[] {
  if (!notes) return [];
  const out: string[] = [];
  const head = notes.split(' ·')[0]?.trim();
  if (head && /^h[0-9a-f]+$/i.test(head)) out.push(head);
  const syn = notes.match(/synthetic_next_statement_entry:(h[0-9a-f]+)/i);
  if (syn) out.push(syn[1]);
  const inv = notes.match(/invoice_payment_entry:(h[0-9a-f]+)/i);
  if (inv) out.push(inv[1]);
  return out;
}

/** Para remapeamento no histórico: evita duplicar linha já criada a partir da mesma entrada do CSV. */
export function creditCardPaymentDuplicatesInList(bucket: CreditCardPayment[], candidate: CreditCardPayment): boolean {
  const candTid = candidate.paymentTransactionId;
  if (candTid && bucket.some((p) => p.paymentTransactionId === candTid)) return true;
  const hashes = collectRowHashesFromPaymentNotes(candidate.notes);
  return hashes.some((h) => bucket.some((p) => p.notes?.includes(h)));
}

/** Fatura imediatamente anterior à competência do arquivo importado (cronológica). */
export function getPreviousStatementRow(
  sortedAsc: Pick<CreditCardStatement, 'id' | 'dueYear' | 'dueMonth'>[],
  importStatement: Pick<CreditCardStatement, 'dueYear' | 'dueMonth'>
): Pick<CreditCardStatement, 'id' | 'dueYear' | 'dueMonth'> | null {
  const ref = formatReferenceLabel(importStatement.dueYear, importStatement.dueMonth);
  const prevRef = getPreviousReferenceLabel(ref);
  const [y, m] = prevRef.split('-').map(Number);
  return sortedAsc.find((s) => s.dueYear === y && s.dueMonth === m) || null;
}

/** Cadeia de faturas anteriores à competência do arquivo (para saldo remanescente vs pagamento parcelado em CSVs diferentes). */
export function collectAncestorStatements(
  sortedAsc: Pick<CreditCardStatement, 'id' | 'dueYear' | 'dueMonth'>[],
  importStatement: Pick<CreditCardStatement, 'dueYear' | 'dueMonth'>,
  maxHops = 14
): Pick<CreditCardStatement, 'id' | 'dueYear' | 'dueMonth'>[] {
  const out: Pick<CreditCardStatement, 'id' | 'dueYear' | 'dueMonth'>[] = [];
  let cur: Pick<CreditCardStatement, 'dueYear' | 'dueMonth'> = importStatement;
  for (let i = 0; i < maxHops; i += 1) {
    const p = getPreviousStatementRow(sortedAsc, cur);
    if (!p) break;
    out.push(p);
    cur = p;
  }
  return out;
}

export function buildRemainingBalanceMapForAncestors(
  sortedAsc: Pick<CreditCardStatement, 'id' | 'dueYear' | 'dueMonth'>[],
  importStatement: Pick<CreditCardStatement, 'dueYear' | 'dueMonth'>,
  invoiceTotalsByStatementId: Map<string, number>,
  paymentsScratch: CreditCardPayment[],
  maxHops = 14
): Map<string, number> {
  const map = new Map<string, number>();
  for (const cand of collectAncestorStatements(sortedAsc, importStatement, maxHops)) {
    const inv = invoiceTotalsByStatementId.get(cand.id) ?? 0;
    const paid = sumPaymentsForStatement(paymentsScratch, cand.id);
    map.set(cand.id, round2(inv - paid));
  }
  return map;
}

/**
 * Vínculo do pagamento quando há **várias** linhas «Pagamento de fatura» no mesmo CSV:
 * usa mês/ano **calendário** da data do lançamento → competência (`due_year`/`due_month`) se existir no cartão
 * e estiver entre [fatura anterior ao arquivo, fatura do arquivo] (inclusive).
 *
 * Com **uma única** linha no arquivo:
 * - Lançamento no **mesmo** mês civil da competência do arquivo (ex.: CSV fev/2025 com data em fev) → convenção XP:
 *   quita a fatura do ciclo **anterior** (ex.: paga jan/2025).
 * - Lançamento em mês **anterior** ao da competência do arquivo (ex.: CSV mar/2025 com «Pagamentos válidos» em fev)
 *   → quita a **própria** fatura deste arquivo (pagamento antecipado no mesmo PDF). Sem isso, o valor ia para a
 *   competência errada e somava de novo com parcelas vindas do CSV seguinte.
 * - Demais casos → fallback N−1.
 *
 * Observação: CSV da competência seguinte com **uma única** linha datada no mês anterior pode precisar de segunda
 * linha no arquivo ou ajuste manual (cenário raro frente ao XP agregar vários pagamentos em abril).
 *
 * Quando `remainingBalanceByStatementId` está disponível (total da fatura menos pagamentos já “consumidos” na simulação),
 * entra **antes** do desempate por totais em `payOrd < impOrd`: escolhe a competência cujo saldo em aberto casa com o valor do
 * pagamento (tolerância R$ 1,00) — cobre pagamento que só aparece no CSV **N+2** liquidando saldo remanescente de **N**.
 *
 * Quando `statementTotalsById` está disponível (totais da fatura só com lançamentos, sem pagamentos),
 * desempata `payOrd < impOrd` pela **proximidade do valor do pagamento ao total** da competência anterior vs.
 * da competência do arquivo — evita atribuir ao mês errado (ex.: pagamento 10/11 no CSV de dezembro liquida
 * novembro quando o valor casa com novembro e não com dezembro).
 */
export function resolveImportedInvoicePaymentTarget(
  entry: Pick<CreditCardImportEntry, 'postedDate' | 'amount'>,
  invoicePaymentsOnSameImport: CreditCardImportEntry[],
  allStatementsSortedAsc: Pick<CreditCardStatement, 'id' | 'dueYear' | 'dueMonth'>[],
  importStatement: Pick<CreditCardStatement, 'dueYear' | 'dueMonth'>,
  opts?: {
    statementTotalsById?: Map<string, number>;
    /** Saldo em aberto (total − pagamentos) antes deste lançamento; permite vínculo N+2 (pagamento parcelado entre CSVs). */
    remainingBalanceByStatementId?: Map<string, number>;
  }
): Pick<CreditCardStatement, 'id'> | null {
  const siblings = invoicePaymentsOnSameImport.filter(
    (e) => e.entryType === 'invoice_payment' && inferDirection(e.amount) === 'credit'
  );
  const prev = getPreviousStatementRow(allStatementsSortedAsc, importStatement);
  const importRow = allStatementsSortedAsc.find(
    (s) => s.dueYear === importStatement.dueYear && s.dueMonth === importStatement.dueMonth
  );

  if (siblings.length < 2) {
    if (!importRow) return prev ?? null;
    const d = entry.postedDate ? new Date(`${entry.postedDate}T12:00:00`) : null;
    if (!d || Number.isNaN(d.getTime())) return prev ?? null;

    const payOrd = stmtOrder(d.getFullYear(), d.getMonth() + 1);
    const impOrd = stmtOrder(importStatement.dueYear, importStatement.dueMonth);

    if (payOrd === impOrd) {
      return prev ?? null;
    }
    if (payOrd < impOrd) {
      const amt = round2(Math.abs(Number(entry.amount ?? 0)));
      const remMap = opts?.remainingBalanceByStatementId;
      if (remMap && amt > 0.01) {
        let bestId: string | null = null;
        let bestDiff = Infinity;
        remMap.forEach((rem, sid) => {
          if (rem < -0.02) return;
          const diff = Math.abs(round2(rem - amt));
          if (diff < bestDiff - 0.005) {
            bestDiff = diff;
            bestId = sid;
          }
        });
        if (bestId && bestDiff <= 1.0) {
          const found = allStatementsSortedAsc.find((s) => s.id === bestId);
          if (found) return found;
        }
      }
      const totalsMap = opts?.statementTotalsById;
      if (totalsMap && prev && importRow) {
        if (amt > 0) {
          const tPrev = totalsMap.get(prev.id);
          const tImp = totalsMap.get(importRow.id);
          if (tPrev !== undefined && tImp !== undefined) {
            const dPrev = Math.abs(round2(tPrev - amt));
            const dImp = Math.abs(round2(tImp - amt));
            if (dPrev + 0.005 < dImp) return prev;
            if (dImp + 0.005 < dPrev) return importRow;
          }
        }
      }
      return importRow;
    }
    return prev ?? null;
  }

  const d = entry.postedDate ? new Date(`${entry.postedDate}T12:00:00`) : null;
  if (!d || Number.isNaN(d.getTime())) return prev ?? null;

  const cy = d.getFullYear();
  const cm = d.getMonth() + 1;
  const calMatch = allStatementsSortedAsc.find((s) => s.dueYear === cy && s.dueMonth === cm);
  if (!calMatch) return prev ?? null;

  const minOrd = prev ? stmtOrder(prev.dueYear, prev.dueMonth) : stmtOrder(importStatement.dueYear, importStatement.dueMonth);
  const maxOrd = importRow ? stmtOrder(importRow.dueYear, importRow.dueMonth) : minOrd;
  const mid = stmtOrder(calMatch.dueYear, calMatch.dueMonth);
  if (mid >= minOrd && mid <= maxOrd) return calMatch;
  return prev ?? null;
}

/**
 * Linhas `invoice_payment` da fatura seguinte (CSV) liquidam competência(ns) conforme `resolveImportedInvoicePaymentTarget`.
 * Alguns fluxos gravam só `credit_card_entries` e falham ao persistir em `credit_card_payments`; aqui
 * incorporamos esse crédito no recálculo sem duplicar quando o pagamento já foi persistido.
 */
export function mergePaymentsWithInvoiceLinesFromNextStatement(
  statement: Pick<CreditCardStatement, 'id' | 'cardId' | 'dueYear' | 'dueMonth'>,
  directPayments: CreditCardPayment[],
  nextStatementEntries: CreditCardImportEntry[],
  allStatementsSortedAsc: Pick<CreditCardStatement, 'id' | 'dueYear' | 'dueMonth'>[],
  nextStatement: Pick<CreditCardStatement, 'dueYear' | 'dueMonth'>,
  statementTotalsById?: Map<string, number>
): CreditCardPayment[] {
  const invoicePaymentsNext = nextStatementEntries.filter(
    (e) => e.entryType === 'invoice_payment' && inferDirection(e.amount) === 'credit'
  );
  const out: CreditCardPayment[] = [...directPayments];
  const resolveOpts = statementTotalsById ? { statementTotalsById } : undefined;
  for (const entry of invoicePaymentsNext) {
    const target = resolveImportedInvoicePaymentTarget(
      entry,
      invoicePaymentsNext,
      allStatementsSortedAsc,
      nextStatement,
      resolveOpts
    );
    if (!target || target.id !== statement.id) continue;

    if (creditCardPaymentMatchesImportEntry(out, entry)) continue;
    out.push({
      cardId: statement.cardId,
      statementId: statement.id,
      paymentDate: entry.postedDate,
      amount: Math.abs(entry.amount),
      source: 'imported_statement',
      notes: `synthetic_next_statement_entry:${entry.sourceRowHash}`,
      paymentTransactionId: entry.transactionId || undefined,
    });
  }
  return out;
}

/**
 * Para cada fatura recalculada, incorpora linhas `invoice_payment` de **todos** os extratos posteriores (N+1, N+2, …),
 * usando saldo remanescente por competência para casar pagamentos que só aparecem no terceiro arquivo em diante.
 */
export function mergePaymentsWithInvoiceLinesFromFutureStatements(
  statement: Pick<CreditCardStatement, 'id' | 'cardId' | 'dueYear' | 'dueMonth'>,
  directPaymentsForStatement: CreditCardPayment[],
  allPaymentsOnCard: CreditCardPayment[],
  futureImports: Array<{
    importStatement: Pick<CreditCardStatement, 'id' | 'dueYear' | 'dueMonth'>;
    entries: CreditCardImportEntry[];
  }>,
  allStatementsSortedAsc: Pick<CreditCardStatement, 'id' | 'dueYear' | 'dueMonth'>[],
  invoiceTotalsByStatementId: Map<string, number>
): CreditCardPayment[] {
  if (futureImports.length === 0) {
    return [...directPaymentsForStatement];
  }

  const scratch: CreditCardPayment[] = allPaymentsOnCard.map((p) => ({ ...p }));
  const collected: CreditCardPayment[] = [...directPaymentsForStatement];

  for (const pack of futureImports) {
    const invoicePayments = pack.entries
      .filter((e) => e.entryType === 'invoice_payment' && inferDirection(e.amount) === 'credit')
      .sort((a, b) => {
        const c = (a.postedDate || '').localeCompare(b.postedDate || '');
        if (c !== 0) return c;
        return a.sourceRowIndex - b.sourceRowIndex;
      });

    for (const entry of invoicePayments) {
      const remainingBalanceByStatementId = buildRemainingBalanceMapForAncestors(
        allStatementsSortedAsc,
        pack.importStatement,
        invoiceTotalsByStatementId,
        scratch
      );
      const target = resolveImportedInvoicePaymentTarget(
        entry,
        invoicePayments,
        allStatementsSortedAsc,
        pack.importStatement,
        {
          statementTotalsById: invoiceTotalsByStatementId,
          remainingBalanceByStatementId,
        }
      );
      if (!target || target.id !== statement.id) continue;
      if (creditCardPaymentMatchesImportEntry(scratch, entry)) continue;

      const synth: CreditCardPayment = {
        cardId: statement.cardId,
        statementId: statement.id,
        paymentDate: entry.postedDate,
        amount: Math.abs(entry.amount),
        source: 'imported_statement',
        notes: `synthetic_next_statement_entry:${entry.sourceRowHash}`,
        paymentTransactionId: entry.transactionId || undefined,
      };
      scratch.push(synth);
      collected.push(synth);
    }
  }

  return collected;
}

export const inferStatusFromTotals = (statementTotal: number, totalPayments: number, dueDate?: string | null): CreditCardStatementStatus => {
  const open = round2(Math.max(statementTotal - totalPayments, 0));
  if (open <= 0) return 'paid';
  if (totalPayments > 0) return 'partial';

  if (dueDate) {
    const today = new Date();
    const due = new Date(dueDate);
    if (!Number.isNaN(due.getTime()) && today.getTime() > due.getTime()) {
      return 'overdue';
    }
  }
  return 'open';
};

export const applyImportedPaymentFromNextStatement = (
  statementsByReference: Map<string, CreditCardStatement>,
  currentReferenceLabel: string
): CreditCardStatement | null => {
  const previousReference = getPreviousReferenceLabel(currentReferenceLabel);
  return statementsByReference.get(previousReference) || null;
};

