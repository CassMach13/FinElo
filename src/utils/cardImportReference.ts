export interface CardImportReferenceTransaction {
  Data?: string | Date;
  Valor?: number;
  Tipo?: string;
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
  transactions: CardImportReferenceTransaction[]
): string | null => {
  const purchaseRows = transactions.filter((transaction) => {
    const value = Number(transaction.Valor);
    return transaction.Tipo === 'Despesa' || (Number.isFinite(value) && value < 0);
  });
  const candidates = purchaseRows.length > 0 ? purchaseRows : transactions;
  const months = getDistinctCardImportReferenceMonths(candidates);
  return months.at(-1) || null;
};
