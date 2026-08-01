import React, { useMemo } from 'react';
import { Transaction } from '../../types';
import { formatCurrency, formatCurrencySigned } from '../../utils/formatters';
import PeriodCompareColumns from '../ui/PeriodCompareColumns';
import PeriodCompareLegend from '../ui/PeriodCompareLegend';
import { parseDateOnlyLocal } from '../../utils/dateOnly';

interface ChartProps {
  data: Transaction[];
  viewMode: 'monthly' | 'quarterly' | 'semiannual' | 'yearly' | 'custom';
  selectedDate: Date;
  compareData?: Transaction[];
  primaryPeriodData?: Transaction[];
  comparePeriodData?: Transaction[];
  compareSelectedDate?: Date;
  compareEnabled?: boolean;
  primaryLabel?: string;
  compareLabel?: string;
}

type MonthBucket = { name: string; Renda: number; Despesa: number; Saldo: number };

export function buildMonthBuckets(
  data: Transaction[],
  viewMode: ChartProps['viewMode'],
  selectedDate: Date
): MonthBucket[] {
  let startDate = new Date(selectedDate);
  let monthsToShow = 6;

  if (viewMode === 'yearly') {
    startDate = new Date(selectedDate.getFullYear(), 0, 1);
    monthsToShow = 12;
  } else if (viewMode === 'monthly') {
    startDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 5, 1);
    monthsToShow = 6;
  } else if (viewMode === 'quarterly') {
    const quarter = Math.floor(selectedDate.getMonth() / 3);
    startDate = new Date(selectedDate.getFullYear(), quarter * 3, 1);
    monthsToShow = 3;
  } else if (viewMode === 'semiannual') {
    const semester = Math.floor(selectedDate.getMonth() / 6);
    startDate = new Date(selectedDate.getFullYear(), semester * 6, 1);
    monthsToShow = 6;
  } else {
    startDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 5, 1);
    monthsToShow = 6;
  }

  const monthsMap = new Map<string, MonthBucket>();
  for (let i = 0; i < monthsToShow; i++) {
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + i);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const name = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    monthsMap.set(key, { name, Renda: 0, Despesa: 0, Saldo: 0 });
  }

  data.forEach((t) => {
    const effectiveDate = parseDateOnlyLocal(t.Data_Pagamento || t.Data);
    if (!effectiveDate) return;
    const key = `${effectiveDate.getFullYear()}-${effectiveDate.getMonth()}`;
    if (!monthsMap.has(key)) return;
    const entry = monthsMap.get(key)!;
    if (t.Tipo === 'Renda') entry.Renda += t.Valor;
    else if (t.Tipo === 'Despesa') entry.Despesa += Math.abs(t.Valor);
    entry.Saldo = entry.Renda - entry.Despesa;
  });

  return Array.from(monthsMap.values());
}

function summarizePeriod(data: Transaction[]) {
  const income = data
    .filter((t) => t.Tipo === 'Renda')
    .reduce((acc, t) => acc + t.Valor, 0);
  const expense = data
    .filter((t) => t.Tipo === 'Despesa')
    .reduce((acc, t) => acc + Math.abs(t.Valor), 0);
  return { income, expense, balance: income - expense };
}

const MonthlyEvolutionChart: React.FC<ChartProps> = ({
  data,
  viewMode,
  selectedDate,
  compareData,
  primaryPeriodData,
  comparePeriodData,
  compareSelectedDate,
  compareEnabled = false,
  primaryLabel = 'Atual',
  compareLabel = 'Comparado',
}) => {
  const chartData = useMemo(
    () => buildMonthBuckets(data, viewMode, selectedDate),
    [data, viewMode, selectedDate]
  );

  const compareChartData = useMemo(() => {
    if (!compareEnabled || !compareData || !compareSelectedDate) return null;
    if (viewMode === 'yearly') {
      return buildMonthBuckets(compareData, viewMode, compareSelectedDate);
    }
    return null;
  }, [compareEnabled, compareData, compareSelectedDate, viewMode]);

  const periodSummary = useMemo(
    () => (primaryPeriodData ? summarizePeriod(primaryPeriodData) : null),
    [primaryPeriodData]
  );
  const comparePeriodSummary = useMemo(
    () => (comparePeriodData ? summarizePeriod(comparePeriodData) : null),
    [comparePeriodData]
  );

  const useYearlyPaired = compareEnabled && viewMode === 'yearly' && compareChartData;
  const usePeriodCompare =
    compareEnabled && !useYearlyPaired && periodSummary && comparePeriodSummary;

  const maxVal = useYearlyPaired
    ? Math.max(
        ...chartData.flatMap((c, i) => [
          c.Renda,
          c.Despesa,
          compareChartData[i]?.Renda || 0,
          compareChartData[i]?.Despesa || 0,
        ])
      )
    : chartData.length > 0
      ? Math.max(...chartData.flatMap((c) => [c.Renda, c.Despesa]))
      : 0;

  if (chartData.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-gray-500">
        Nenhum dado encontrado para o período.
      </div>
    );
  }

  if (usePeriodCompare) {
    const summaryMax = Math.max(
      periodSummary.income,
      periodSummary.expense,
      comparePeriodSummary.income,
      comparePeriodSummary.expense,
      1
    );

    const renderBars = (
      income: number,
      expense: number,
      balance: number,
      tone: 'primary' | 'compare'
    ) => (
      <div className="flex flex-col h-full min-h-[120px]">
        <div className="flex items-end justify-center gap-2 flex-1 min-h-[80px]">
          <div
            className={`w-8 rounded-t ${
              tone === 'primary' ? 'bg-emerald-500/85' : 'bg-emerald-500/40 border border-emerald-500/20'
            }`}
            style={{ height: `${Math.max(8, (income / summaryMax) * 100)}%` }}
            title={`Receitas: ${formatCurrency(income)}`}
          />
          <div
            className={`w-8 rounded-t ${
              tone === 'primary' ? 'bg-rose-500/85' : 'bg-rose-500/40 border border-rose-500/20'
            }`}
            style={{ height: `${Math.max(8, (expense / summaryMax) * 100)}%` }}
            title={`Despesas: ${formatCurrency(expense)}`}
          />
        </div>
        <p
          className={`text-xs font-bold text-center mt-2 tabular-nums ${
            balance >= 0
              ? tone === 'primary'
                ? 'text-accent'
                : 'text-slate-300'
              : tone === 'primary'
                ? 'text-danger'
                : 'text-rose-300'
          }`}
        >
          {formatCurrencySigned(balance, { showPlusForPositive: true })}
        </p>
      </div>
    );

    return (
      <div className="w-full min-h-[260px] py-3 px-3">
        <PeriodCompareColumns
          primaryLabel={primaryLabel}
          compareLabel={compareLabel}
          minHeight="min-h-[160px]"
          primary={renderBars(
            periodSummary.income,
            periodSummary.expense,
            periodSummary.balance,
            'primary'
          )}
          compare={renderBars(
            comparePeriodSummary.income,
            comparePeriodSummary.expense,
            comparePeriodSummary.balance,
            'compare'
          )}
          footer={
            <div className="flex justify-center gap-6 text-[10px] text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" /> Receitas
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-500" /> Despesas
              </span>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="w-full min-h-[300px] flex flex-col gap-3 py-2">
      {useYearlyPaired && (
        <PeriodCompareLegend
          primaryLabel={primaryLabel}
          compareLabel={compareLabel}
          inline
          className="px-2 justify-center"
        />
      )}
      <div className="flex items-end justify-between pb-8 pt-4 px-2 sm:px-4 h-[280px]">
        {chartData.map((item, index) => {
          const compareItem = compareChartData?.[index];
          const incomeHeight = maxVal > 0 ? (item.Renda / maxVal) * 100 : 0;
          const expenseHeight = maxVal > 0 ? (item.Despesa / maxVal) * 100 : 0;
          const compareIncomeHeight =
            compareItem && maxVal > 0 ? (compareItem.Renda / maxVal) * 100 : 0;
          const compareExpenseHeight =
            compareItem && maxVal > 0 ? (compareItem.Despesa / maxVal) * 100 : 0;

          return (
            <div
              key={index}
              className="flex flex-col items-center justify-end h-full flex-1 max-w-[72px] group relative"
            >
              <div className="absolute -top-24 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-white text-xs p-3 rounded pointer-events-none whitespace-nowrap z-10 shadow-lg border border-slate-700 flex flex-col gap-1">
                <span className="font-bold border-b border-slate-700 pb-1 mb-1">{item.name}</span>
                <span className="text-emerald-400">R: {formatCurrency(item.Renda)}</span>
                <span className="text-rose-400">D: {formatCurrency(item.Despesa)}</span>
                {compareItem && (
                  <>
                    <span className="text-slate-400 border-t border-slate-700 pt-1 mt-1">{compareLabel}</span>
                    <span className="text-emerald-300/80">R: {formatCurrency(compareItem.Renda)}</span>
                    <span className="text-rose-300/80">D: {formatCurrency(compareItem.Despesa)}</span>
                  </>
                )}
              </div>

              <div className="flex items-end gap-0.5 w-full justify-center h-full">
                <div
                  className="w-full max-w-[14px] bg-emerald-500/80 hover:bg-emerald-400 rounded-t transition-all"
                  style={{ height: `${Math.max(2, incomeHeight)}%` }}
                />
                <div
                  className="w-full max-w-[14px] bg-rose-500/80 hover:bg-rose-400 rounded-t transition-all"
                  style={{ height: `${Math.max(2, expenseHeight)}%` }}
                />
                {useYearlyPaired && (
                  <>
                    <div className="w-px h-full bg-white/10 mx-0.5" />
                    <div
                      className="w-full max-w-[14px] bg-emerald-500/35 border border-emerald-500/25 rounded-t transition-all"
                      style={{ height: `${Math.max(2, compareIncomeHeight)}%` }}
                    />
                    <div
                      className="w-full max-w-[14px] bg-rose-500/35 border border-rose-500/25 rounded-t transition-all"
                      style={{ height: `${Math.max(2, compareExpenseHeight)}%` }}
                    />
                  </>
                )}
              </div>

              <div className="absolute -bottom-6 w-full text-center text-[10px] text-gray-400 truncate px-1">
                {item.name}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MonthlyEvolutionChart;
