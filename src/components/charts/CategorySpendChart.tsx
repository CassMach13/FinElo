import React, { useMemo } from 'react';
import { Transaction } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import {
  buildCompactComparisonDeltaLabel,
  computePeriodDelta,
} from '../../utils/periodComparison';
import PeriodCompareLegend from '../ui/PeriodCompareLegend';

interface ChartProps {
  data: Transaction[];
  compareData?: Transaction[];
  primaryLabel?: string;
  compareLabel?: string;
}

function aggregateExpenses(data: Transaction[]): Map<string, number> {
  const map = new Map<string, number>();
  data
    .filter((t) => t.Tipo === 'Despesa')
    .forEach((t) => {
      const current = map.get(t.Categoria) || 0;
      map.set(t.Categoria, current + Math.abs(t.Valor));
    });
  return map;
}

const CategorySpendChart: React.FC<ChartProps> = ({
  data,
  compareData,
  primaryLabel = 'Período principal',
  compareLabel = 'Comparado',
}) => {
  const chartData = useMemo(() => {
    const primaryMap = aggregateExpenses(data);
    const compareMap = compareData ? aggregateExpenses(compareData) : null;
    const categories = new Set([...primaryMap.keys(), ...(compareMap ? compareMap.keys() : [])]);

    return Array.from(categories)
      .map((name) => ({
        name,
        gasto: primaryMap.get(name) || 0,
        compareGasto: compareMap?.get(name) || 0,
      }))
      .sort((a, b) => b.gasto - a.gasto || b.compareGasto - a.compareGasto);
  }, [data, compareData]);

  const totalExpenses = chartData.reduce((sum, item) => sum + item.gasto, 0);
  const maxExpense =
    chartData.length > 0
      ? Math.max(...chartData.map((c) => Math.max(c.gasto, c.compareGasto)))
      : 0;

  if (chartData.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-gray-500">
        Nenhum gasto registrado.
      </div>
    );
  }

  const renderBar = (value: number, tone: 'primary' | 'compare') => {
    const widthPercentage = maxExpense > 0 ? (value / maxExpense) * 100 : 0;
    const barClass =
      tone === 'primary'
        ? 'bg-gradient-to-r from-red-500/85 to-red-400'
        : 'bg-gradient-to-r from-red-500/35 to-red-400/25 border border-red-500/20';

    return (
      <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${barClass}`}
          style={{ width: `${Math.max(value > 0 ? 2 : 0, widthPercentage)}%` }}
        />
      </div>
    );
  };

  return (
    <div className="w-full min-h-[300px] flex flex-col gap-3 py-2">
      {compareData && (
        <PeriodCompareLegend
          primaryLabel={primaryLabel}
          compareLabel={compareLabel}
          inline
          className="px-1 mb-1"
        />
      )}
      <div className="flex-1 flex flex-col gap-3 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-slate-700 pr-2 max-h-[320px]">
        {chartData.map((item) => {
          const sharePercentage =
            totalExpenses > 0 ? (item.gasto / totalExpenses) * 100 : 0;
          const delta = compareData
            ? buildCompactComparisonDeltaLabel(
                computePeriodDelta(item.gasto, item.compareGasto),
                'lower_better'
              )
            : null;

          if (!compareData) {
            return (
              <div key={item.name} className="flex flex-col gap-1.5 w-full">
                <div className="flex justify-between items-end w-full text-xs gap-2">
                  <span className="font-semibold text-gray-300 truncate max-w-[45%]" title={item.name}>
                    {item.name}
                  </span>
                  <div className="flex flex-col items-end text-gray-400 shrink-0">
                    <span className="font-medium text-white">{formatCurrency(item.gasto)}</span>
                    <span className="opacity-70">{sharePercentage.toFixed(1)}%</span>
                  </div>
                </div>
                {renderBar(item.gasto, 'primary')}
              </div>
            );
          }

          return (
            <div
              key={item.name}
              className="rounded-xl border border-white/5 bg-slate-900/30 p-3 space-y-2.5"
            >
              <span className="font-semibold text-gray-200 text-sm truncate block" title={item.name}>
                {item.name}
              </span>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex justify-between items-baseline gap-1 text-[10px]">
                    <span className="text-accent font-bold uppercase truncate">{primaryLabel}</span>
                    <span className="text-white font-semibold tabular-nums shrink-0">
                      {formatCurrency(item.gasto)}
                    </span>
                  </div>
                  {renderBar(item.gasto, 'primary')}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[9px] text-gray-500">{sharePercentage.toFixed(1)}% do total</span>
                    {delta && (
                      <span
                        className={`text-[10px] font-semibold ${
                          delta.tone === 'positive'
                            ? 'text-accent'
                            : delta.tone === 'negative'
                              ? 'text-danger'
                              : 'text-gray-500'
                        }`}
                      >
                        {delta.label}
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5 min-w-0 border-l border-white/5 pl-4">
                  <div className="flex justify-between items-baseline gap-1 text-[10px]">
                    <span className="text-slate-400 font-bold uppercase truncate">{compareLabel}</span>
                    <span className="text-slate-300 font-semibold tabular-nums shrink-0">
                      {formatCurrency(item.compareGasto)}
                    </span>
                  </div>
                  {renderBar(item.compareGasto, 'compare')}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CategorySpendChart;
