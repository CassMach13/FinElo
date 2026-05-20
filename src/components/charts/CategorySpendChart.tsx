import React from 'react';
import { Transaction } from '../../types';
import { formatCurrency } from '../../utils/formatters';

interface ChartProps {
  data: Transaction[];
}

const CategorySpendChart: React.FC<ChartProps> = ({ data }) => {
  const chartData = data
    .filter(t => t.Tipo === 'Despesa')
    .reduce((acc, t) => {
      const existing = acc.find(item => item.name === t.Categoria);
      if (existing) {
        existing.Gasto += Math.abs(t.Valor);
      } else {
        acc.push({ name: t.Categoria, Gasto: Math.abs(t.Valor) });
      }
      return acc;
    }, [] as { name: string; Gasto: number }[])
    .sort((a, b) => b.Gasto - a.Gasto);

  const totalExpenses = chartData.reduce((sum, item) => sum + item.Gasto, 0);
  const maxExpense = chartData.length > 0 ? Math.max(...chartData.map(c => c.Gasto)) : 0;

  if (chartData.length === 0) {
    return <div className="h-[300px] flex items-center justify-center text-gray-500">Nenhum gasto registrado.</div>;
  }

  return (
    <div className="w-full h-[300px] flex flex-col gap-3 py-2 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-slate-700 pr-2">
      {chartData.map((item, index) => {
        const widthPercentage = maxExpense > 0 ? (item.Gasto / maxExpense) * 100 : 0;
        const SharePercentage = totalExpenses > 0 ? (item.Gasto / totalExpenses) * 100 : 0;

        return (
          <div key={index} className="flex flex-col gap-1 w-full group">
            {/* Label and Value Row */}
            <div className="flex justify-between items-end w-full text-xs">
              <span className="font-semibold text-gray-300 truncate max-w-[60%]" title={item.name}>
                {item.name}
              </span>
              <div className="flex gap-2 items-center text-gray-400">
                <span className="font-medium text-white">{formatCurrency(item.Gasto)}</span>
                <span className="opacity-70 w-10 text-right">{SharePercentage.toFixed(1)}%</span>
              </div>
            </div>

            {/* Bar Container */}
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden flex">
              <div
                className="h-full bg-gradient-to-r from-red-500/80 to-red-400 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${Math.max(2, widthPercentage)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default CategorySpendChart;
