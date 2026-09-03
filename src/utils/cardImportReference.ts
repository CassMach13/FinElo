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

/**
 * Ano/mês/dia sem deslocamento de fuso — mesma cautela de `referenceMonthFromDate`,
 * mas preservando o dia, que o ciclo de fechamento precisa.
 */
const dateComponentsIsoSafe = (
  value: string | Date | undefined
): { year: number; month: number; day: number } | null => {
  if (!value) return null;

  if (typeof value === 'string') {
    const isoMatch = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/.exec(value.trim());
    if (isoMatch) {
      return { year: Number(isoMatch[1]), month: Number(isoMatch[2]), day: Number(isoMatch[3]) };
    }
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
};

/**
 * A competência de UMA data, dado o dia de fechamento do cartão — não o mês
 * civil dela.
 *
 * Todo ciclo que fecha no meio do mês atravessa a virada do mês civil por
 * definição. Um lançamento no dia do fechamento (ou depois) já pertence ao
 * ciclo que fecha no mês SEGUINTE — a fatura do mês corrente, não a do
 * anterior. Provado contra os 5 arquivos reais de uma conta Nubank real
 * (fechamento dia 11): a primeira e a última data de cada arquivo, aplicadas
 * a esta regra, sempre concordam na mesma competência — mesmo o arquivo
 * inteiro cruzando a virada do mês.
 */
const closingCycleReferenceMonth = (
  value: string | Date | undefined,
  closingDay: number
): string | null => {
  const parts = dateComponentsIsoSafe(value);
  if (!parts) return null;
  if (parts.day >= closingDay) return `${parts.year}-${String(parts.month).padStart(2, '0')}`;
  return previousMonth(parts.year, parts.month);
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
 * A competência da fatura — não o mês civil da última linha.
 * Créditos (pagamentos/estornos) não podem empurrar a fatura para outro mês.
 *
 * Duas fontes, nesta ordem de autoridade:
 *
 *   1. `dueDate` — um vencimento CONHECIDO (do arquivo, do rodapé, de onde
 *      for). Não é inferência: a competência é só `mês do vencimento − 1`.
 *
 *   2. `closingDay` — o dia de fechamento do cartão. Sem um vencimento
 *      conhecido, cada lançamento é classificado pelo CICLO em que caiu
 *      (`closingCycleReferenceMonth`), e vence a competência que mais
 *      lançamentos tiver — nunca "o mês da linha mais recente", que erra
 *      toda vez que o ciclo atravessa a virada do mês civil (o caso comum,
 *      não a exceção, para fechamento em qualquer dia que não seja o
 *      último do mês).
 *
 * Sem nenhuma das duas, cai no mês civil mais recente — o único
 * comportamento que os arquivos sem informação de ciclo permitem.
 */
export const resolveAutomaticCardReferenceMonth = (
  transactions: CardImportReferenceTransaction[],
  dueDate?: string | null,
  closingDay?: number | null
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

  if (closingDay != null && Number.isFinite(closingDay) && closingDay > 0) {
    const votos = new Map<string, number>();
    for (const t of candidates) {
      const ref = closingCycleReferenceMonth(t.Data, closingDay);
      if (ref) votos.set(ref, (votos.get(ref) ?? 0) + 1);
    }
    if (votos.size > 0) {
      return [...votos.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
  }

  const months = getDistinctCardImportReferenceMonths(candidates);
  return months.at(-1) || null;
};
