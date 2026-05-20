/**
 * Extrai totais oficiais do rodapé/cabeçalho de faturas CSV (XP, Bradesco, etc.).
 * Valores positivos em reais; ignora linhas de movimentação normais.
 */

export interface CreditCardFileTotals {
  statementTotal?: number;
  totalPayments?: number;
}

const parseBrMoney = (raw: string): number | null => {
  const cleaned = raw
    .replace(/\s/g, '')
    .replace(/R\$/gi, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number(cleaned);
  if (Number.isNaN(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
};

const extractMoneyAfterLabel = (line: string, labelPattern: RegExp): number | null => {
  if (!labelPattern.test(line)) return null;
  const matches = line.match(/-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+\.\d{2}/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const value = parseBrMoney(last);
  return value !== null ? Math.abs(value) : null;
};

const STATEMENT_LABELS = [
  /total\s+da\s+fatura/i,
  /total\s+a\s+pagar/i,
  /total\s+para\s+pagamento/i,
  /valor\s+da\s+fatura/i,
  /total\s+de\s+d[eé]bitos/i,
];

const PAYMENT_LABELS = [
  /pagamentos?\s+efetuados?/i,
  /total\s+de\s+pagamentos?/i,
  /pagamento\s+da\s+fatura/i,
  /cr[eé]ditos?\s+aplicados?/i,
];

/**
 * Varre o conteúdo bruto do arquivo (antes de ignorar linhas de resumo no parser).
 */
export function parseCreditCardFileTotals(rawContent: string): CreditCardFileTotals {
  const out: CreditCardFileTotals = {};
  const lines = rawContent.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    for (const pattern of STATEMENT_LABELS) {
      if (out.statementTotal !== undefined) break;
      const v = extractMoneyAfterLabel(line, pattern);
      if (v !== null) out.statementTotal = v;
    }

    for (const pattern of PAYMENT_LABELS) {
      if (out.totalPayments !== undefined) break;
      const v = extractMoneyAfterLabel(line, pattern);
      if (v !== null) out.totalPayments = v;
    }
  }

  return out;
}

/** Soma linhas classificadas como pagamento de fatura no próprio lote (fallback quando o CSV não tem rodapé). */
export function sumInvoicePaymentsFromClassifiedEntries(
  entries: Array<{ entryType: string; amount: number }>
): number | null {
  const pay = entries
    .filter((e) => e.entryType === 'invoice_payment')
    .reduce((acc, e) => acc + Math.abs(Number(e.amount || 0)), 0);
  if (pay <= 0) return null;
  return Math.round(pay * 100) / 100;
}
