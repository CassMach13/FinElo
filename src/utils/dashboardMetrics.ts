import type { Category, Transaction } from '../types';
import type { DateRange } from './dashboardPeriod';
import { parseDateOnlyLocal } from './dateOnly';

export interface CategorySets {
  ambos: Set<string>;
  investment: Set<string>;
}

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

export function buildCategorySets(categories: Category[]): CategorySets {
  return {
    ambos: new Set(categories.filter((c) => c.Tipo === 'Ambos').map((c) => c.Nome_Categoria)),
    investment: new Set(
      categories.filter((c) => c.is_investment).map((c) => c.Nome_Categoria)
    ),
  };
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
  categorySets: CategorySets
): Transaction[] {
  return filtered.filter(
    (t) =>
      !categorySets.ambos.has(t.Categoria) && !categorySets.investment.has(t.Categoria)
  );
}

export function toInvestmentData(
  filtered: Transaction[],
  categorySets: CategorySets
): Transaction[] {
  return filtered.filter((t) => categorySets.investment.has(t.Categoria));
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
  range: DateRange
): DashboardPeriodMetrics {
  const categorySets = buildCategorySets(categories);
  const filtered = filterTransactionsByRange(transactions, range);
  const chartData = toOperationalChartData(filtered, categorySets);
  const investmentData = toInvestmentData(filtered, categorySets);

  return {
    operational: computeOperationalSummary(chartData),
    investment: computeInvestmentSummary(investmentData),
  };
}
