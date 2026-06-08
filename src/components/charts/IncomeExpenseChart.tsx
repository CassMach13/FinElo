import React from 'react';
import { Transaction } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import {
  buildCompactComparisonDeltaLabel,
  computePeriodDelta,
} from '../../utils/periodComparison';
import PeriodCompareColumns from '../ui/PeriodCompareColumns';

interface ChartProps {
  data: Transaction[];
  compareData?: Transaction[];
  primaryLabel?: string;
  compareLabel?: string;
}

function summarize(data: Transaction[]) {
  const income = data.filter((t) => t.Tipo === 'Renda').reduce((acc, t) => acc + t.Valor, 0);
  const expense = data
    .filter((t) => t.Tipo === 'Despesa')
    .reduce((acc, t) => acc + Math.abs(t.Valor), 0);
  return { income, expense };
}

const toneClass = (tone: 'positive' | 'negative' | 'neutral') =>
  tone === 'positive' ? 'text-accent' : tone === 'negative' ? 'text-danger' : 'text-gray-500';

const IncomeExpenseBar: React.FC<{
  income: number;
  expense: number;
  tone?: 'primary' | 'compare';
}> = ({ income, expense, tone = 'primary' }) => {
  const total = income + expense;
  const incomePercent = total > 0 ? (income / total) * 100 : 50;
  const expensePercent = total > 0 ? (expense / total) * 100 : 50;
  const incomeClass =
    tone === 'primary' ? 'bg-emerald-500/85' : 'bg-emerald-500/40 border border-emerald-500/20';
  const expenseClass =
    tone === 'primary' ? 'bg-rose-500/85' : 'bg-rose-500/40 border border-rose-500/20';

  return (
    <div className="space-y-2.5">
      <div className="flex justify-between items-center text-xs">
        <span className="text-gray-400">Receitas</span>
        <span className="text-emerald-400 font-bold tabular-nums">{formatCurrency(income)}</span>
      </div>
      <div className="w-full h-6 bg-slate-800/80 rounded-full overflow-hidden flex border border-slate-700/40">
        <div style={{ width: `${incomePercent}%` }} className={`h-full ${incomeClass}`} />
        <div style={{ width: `${expensePercent}%` }} className={`h-full ${expenseClass}`} />
      </div>
      <div className="flex justify-between items-center text-xs">
        <span className="text-gray-400">Despesas</span>
        <span className="text-rose-400 font-bold tabular-nums">{formatCurrency(expense)}</span>
      </div>
    </div>
  );
};

const IncomeExpenseChart: React.FC<ChartProps> = ({
  data,
  compareData,
  primaryLabel = 'Atual',
  compareLabel = 'Comparado',
}) => {
  const primary = summarize(data);
  const compare = compareData ? summarize(compareData) : null;

  const incomeDelta = compare
    ? buildCompactComparisonDeltaLabel(
        computePeriodDelta(primary.income, compare.income),
        'higher_better'
      )
    : null;
  const expenseDelta = compare
    ? buildCompactComparisonDeltaLabel(
        computePeriodDelta(primary.expense, compare.expense),
        'lower_better'
      )
    : null;

  if (!compare) {
    return (
      <div className="w-full flex justify-center items-center min-h-[200px] py-2 px-2">
        <div className="w-full max-w-md">
          <IncomeExpenseBar income={primary.income} expense={primary.expense} />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-[200px] py-3 px-2 max-w-3xl mx-auto">
      <PeriodCompareColumns
        primaryLabel={primaryLabel}
        compareLabel={compareLabel}
        minHeight="min-h-[150px]"
        primary={
          <div className="space-y-2">
            <IncomeExpenseBar income={primary.income} expense={primary.expense} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] pt-1 border-t border-white/5">
              {incomeDelta && (
                <span className={`font-semibold ${toneClass(incomeDelta.tone)}`}>
                  Receitas {incomeDelta.label}
                </span>
              )}
              {expenseDelta && (
                <span className={`font-semibold ${toneClass(expenseDelta.tone)}`}>
                  Despesas {expenseDelta.label}
                </span>
              )}
            </div>
          </div>
        }
        compare={
          <IncomeExpenseBar income={compare.income} expense={compare.expense} tone="compare" />
        }
      />
    </div>
  );
};

export default IncomeExpenseChart;
