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
