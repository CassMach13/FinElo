import type { Category, EconomicEventKind, Transaction } from '../types';
import type { DateRange } from './dashboardPeriod';
import { parseDateOnlyLocal } from './dateOnly';
import {
  buildCategorySets,
  classifyTransaction,
  isDashboardEconomicTransaction,
  isInvestmentSummaryTransaction,
  type CategorySets,
} from '../domain/economics/transactionSemantics';

export { buildCategorySets };
export type { CategorySets };

export interface OperationalSummary {
  income: number;
  expense: number;
  balance: number;
  savingsRate: number;
}

export interface InvestmentSummary {
  invested: number;
  withdrawn: number;
  netFlow: number;
}

export interface DashboardPeriodMetrics {
  operational: OperationalSummary;
  investment: InvestmentSummary;
}

export function getTransactionEffectiveDate(transaction: Transaction): Date {
  return (
    parseDateOnlyLocal(transaction.Data_Pagamento || transaction.Data) ??
    new Date(Number.NaN)
  );
}

export function filterTransactionsByRange(
  transactions: Transaction[],
  range: DateRange
): Transaction[] {
  const start = range.start.getTime();
  const end = range.end.getTime();

  return transactions.filter((t) => {
    const tDate = getTransactionEffectiveDate(t).getTime();
    return tDate >= start && tDate <= end;
  });
}

export function toOperationalChartData(
  filtered: Transaction[],
  categorySets: CategorySets,
  economicKindByEventId?: ReadonlyMap<string, EconomicEventKind>
): Transaction[] {
  return filtered.filter((t) => isDashboardEconomicTransaction(classifyTransaction(t, { categorySets, economicKindByEventId })));
}

export function toInvestmentData(
  filtered: Transaction[],
  categorySets: CategorySets
): Transaction[] {
  return filtered.filter((t) => isInvestmentSummaryTransaction(classifyTransaction(t, { categorySets })));
}

export function computeOperationalSummary(chartData: Transaction[]): OperationalSummary {
  const income = chartData
    .filter((t) => t.Tipo === 'Renda')
    .reduce((acc, t) => acc + t.Valor, 0);
  const expense = chartData
    .filter((t) => t.Tipo === 'Despesa')
    .reduce((acc, t) => acc + Math.abs(t.Valor), 0);
  const balance = income - expense;
  const savingsRate = income > 0 ? ((income - expense) / income) * 100 : 0;
  return { income, expense, balance, savingsRate };
}

export function computeInvestmentSummary(investmentData: Transaction[]): InvestmentSummary {
  const withdrawn = investmentData
    .filter((t) => t.Tipo === 'Renda')
    .reduce((acc, t) => acc + t.Valor, 0);
  const invested = investmentData
    .filter((t) => t.Tipo === 'Despesa')
    .reduce((acc, t) => acc + Math.abs(t.Valor), 0);
  const netFlow = invested - withdrawn;
  return { invested, withdrawn, netFlow };
}

export function computeDashboardPeriodMetrics(
  transactions: Transaction[],
  categories: Category[],
  range: DateRange,
  economicKindByEventId?: ReadonlyMap<string, EconomicEventKind>
): DashboardPeriodMetrics {
  const categorySets = buildCategorySets(categories);
  const filtered = filterTransactionsByRange(transactions, range);
  const chartData = toOperationalChartData(filtered, categorySets, economicKindByEventId);
  const investmentData = toInvestmentData(filtered, categorySets);

  return {
    operational: computeOperationalSummary(chartData),
    investment: computeInvestmentSummary(investmentData),
  };
}
