export interface CardImportReferenceTransaction {
  Data?: string | Date;
  Valor?: number;
  Tipo?: string;
}

export interface ResolvedCardImportCycleCoordinates {
  purchaseReferenceLabel?: string;
  dueYear?: number;
  dueMonth?: number;
  dueDate?: string;
}

const ISO_MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ISO_DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(\d{2})$/;

const previousMonth = (year: number, month: number): string => {
  const previousYear = month === 1 ? year - 1 : year;
  const previousMonthNumber = month === 1 ? 12 : month - 1;
  return `${previousYear}-${String(previousMonthNumber).padStart(2, '0')}`;
};

const validIsoDateMatch = (value?: string | null): RegExpExecArray | null => {
  const match = ISO_DATE_RE.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
    ? match
    : null;
};

/**
 * Mantém separados os dois eixos do ciclo:
 * - competência informada pelo usuário (`purchaseReferenceLabel`);
 * - competência técnica da fatura, identificada pelo mês do vencimento.
 */
export function resolveCardImportCycleCoordinates(input?: {
  referenceLabel?: string | null;
  dueDate?: string | null;
}): ResolvedCardImportCycleCoordinates {
  const referenceMatch = ISO_MONTH_RE.exec(String(input?.referenceLabel || '').trim());
  const dueMatch = validIsoDateMatch(input?.dueDate);
  const purchaseReferenceLabel = referenceMatch
    ? `${referenceMatch[1]}-${referenceMatch[2]}`
    : undefined;
  const dueDate = dueMatch
    ? `${dueMatch[1]}-${dueMatch[2]}-${dueMatch[3]}`
    : undefined;

  if (dueMatch) {
    return {
      purchaseReferenceLabel,
      dueYear: Number(dueMatch[1]),
      dueMonth: Number(dueMatch[2]),
      dueDate,
    };
  }
  if (referenceMatch) {
    return {
      purchaseReferenceLabel,
      dueYear: Number(referenceMatch[1]),
      dueMonth: Number(referenceMatch[2]),
    };
  }
  return {};
}

const referenceMonthFromDate = (value: string | Date | undefined): string | null => {
  if (!value) return null;

  if (typeof value === 'string') {
    const isoMatch = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?/.exec(value.trim());
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export const getDistinctCardImportReferenceMonths = (
  transactions: CardImportReferenceTransaction[]
): string[] => {
  const months = new Set<string>();
  transactions.forEach((transaction) => {
    const referenceMonth = referenceMonthFromDate(transaction.Data);
    if (referenceMonth) months.add(referenceMonth);
  });
  return Array.from(months).sort();
};

/**
 * No modo automático, a competência é a da compra mais recente.
 * Créditos (pagamentos/estornos) não podem empurrar a fatura para outro mês.
 */
export const resolveAutomaticCardReferenceMonth = (
  transactions: CardImportReferenceTransaction[],
  dueDate?: string | null
): string | null => {
  const dueMatch = validIsoDateMatch(dueDate);
  if (dueMatch) {
    return previousMonth(Number(dueMatch[1]), Number(dueMatch[2]));
  }

  const purchaseRows = transactions.filter((transaction) => {
    const value = Number(transaction.Valor);
    return transaction.Tipo === 'Despesa' || (Number.isFinite(value) && value < 0);
  });
  const candidates = purchaseRows.length > 0 ? purchaseRows : transactions;
  const months = getDistinctCardImportReferenceMonths(candidates);
  return months.at(-1) || null;
};
