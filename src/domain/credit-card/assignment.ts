import { CreditCardImportEntry } from './types';

export interface AssignStatementInput {
  dueYear: number;
  dueMonth: number;
  statementId: string;
  cardClosingDay?: number | null;
  cardDueDay?: number | null;
}

export const formatReferenceLabel = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, '0')}`;

export const getPreviousReferenceLabel = (referenceLabel: string): string => {
  const [yearStr, monthStr] = referenceLabel.split('-');
  const base = new Date(Number(yearStr), Number(monthStr) - 1, 1);
  base.setMonth(base.getMonth() - 1);
  return formatReferenceLabel(base.getFullYear(), base.getMonth() + 1);
};

export const getNextReferenceLabel = (referenceLabel: string): string => {
  const [yearStr, monthStr] = referenceLabel.split('-');
  const base = new Date(Number(yearStr), Number(monthStr) - 1, 1);
  base.setMonth(base.getMonth() + 1);
  return formatReferenceLabel(base.getFullYear(), base.getMonth() + 1);
};

export const assignEntriesToStatement = (
  entries: CreditCardImportEntry[],
  input: AssignStatementInput
): CreditCardImportEntry[] => {
  return entries.map((entry) => ({
    ...entry,
    statementId: input.statementId,
  }));
};

export const inferManualPurchaseReference = (
  postedDateIso: string,
  closingDay: number,
  dueDay: number
): { dueYear: number; dueMonth: number; dueDate: string; referenceLabel: string } => {
  const postedDate = new Date(postedDateIso);
  const postedDay = postedDate.getDate();

  const dueBase = new Date(postedDate.getFullYear(), postedDate.getMonth(), 1);
  if (postedDay > closingDay) {
    dueBase.setMonth(dueBase.getMonth() + 2);
  } else {
    dueBase.setMonth(dueBase.getMonth() + 1);
  }

  const dueYear = dueBase.getFullYear();
  const dueMonth = dueBase.getMonth() + 1;
  const safeDueDay = Math.max(1, Math.min(28, dueDay));
  const dueDate = `${dueYear}-${String(dueMonth).padStart(2, '0')}-${String(safeDueDay).padStart(2, '0')}`;
  return {
    dueYear,
    dueMonth,
    dueDate,
    referenceLabel: formatReferenceLabel(dueYear, dueMonth),
  };
};

