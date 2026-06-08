import type { Budget, Transaction } from '../types';
import type { DashboardViewMode, DateRange } from './dashboardPeriod';

export interface BudgetStatusItem extends Budget {
  spent: number;
  adjustedLimit: number;
  pacingRatio: number;
}

export function monthsInDashboardPeriod(
  viewMode: DashboardViewMode,
  dateRange: DateRange
): number {
  if (viewMode === 'quarterly') return 3;
  if (viewMode === 'semiannual') return 6;
  if (viewMode === 'yearly') return 12;
  if (viewMode === 'custom') {
    const diffTime = Math.abs(dateRange.end.getTime() - dateRange.start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.round(diffDays / 30));
  }
  return 1;
}

export function computeBudgetStatus(
  budgets: Budget[],
  filteredTransactions: Transaction[],
  viewMode: DashboardViewMode,
  dateRange: DateRange,
  referenceDate: Date = new Date()
): BudgetStatusItem[] {
  const monthsInPeriod = monthsInDashboardPeriod(viewMode, dateRange);
  const budgetYear = dateRange.start.getFullYear();
  const relevantBudgets = budgets.filter((b) => b.ano === budgetYear);

  return relevantBudgets
    .map((budget) => {
      const spent = filteredTransactions
        .filter((t) => t.Categoria === budget.Categoria && t.Tipo === 'Despesa')
        .reduce((acc, t) => acc + Math.abs(t.Valor), 0);

      const adjustedLimit = budget.Valor_Limite_Mensal * monthsInPeriod;

      let pacingRatio = 1.0;
      if (referenceDate >= dateRange.start && referenceDate <= dateRange.end) {
        const totalDurationMs = dateRange.end.getTime() - dateRange.start.getTime();
        const elapsedDurationMs = referenceDate.getTime() - dateRange.start.getTime();
        pacingRatio = Math.max(0, Math.min(1, elapsedDurationMs / totalDurationMs));
      } else if (referenceDate < dateRange.start) {
        pacingRatio = 0.0;
      }

      return { ...budget, spent, adjustedLimit, pacingRatio };
    })
    .sort((a, b) => b.spent / b.adjustedLimit - a.spent / a.adjustedLimit);
}
