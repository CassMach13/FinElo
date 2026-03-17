import React from 'react';
import { Transaction } from '../../types';

interface ChartProps {
  data: Transaction[];
}

const IncomeExpenseChart: React.FC<ChartProps> = ({ data }) => {
  const income = data.filter(t => t.Tipo === 'Renda').reduce((acc, t) => acc + t.Valor, 0);
  const expense = data.filter(t => t.Tipo === 'Despesa').reduce((acc, t) => acc + Math.abs(t.Valor), 0);

  const total = income + expense;
  const incomePercent = total > 0 ? (income / total) * 100 : 50;
  const expensePercent = total > 0 ? (expense / total) * 100 : 50;

  const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  return (
    <div className="w-full flex justify-center items-center h-[300px]">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-between items-center text-sm font-medium">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
            <span className="text-gray-300">Receitas</span>
          </div>
          <span className="text-emerald-400 font-bold">{formatCurrency(income)}</span>
        </div>

        <div className="w-full h-8 bg-slate-800/80 rounded-full overflow-hidden flex shadow-inner border border-slate-700/50">
          <div style={{ width: `${incomePercent}%` }} className="h-full bg-emerald-500/80 transition-all duration-700 ease-out hover:bg-emerald-400" title={`Receita: ${incomePercent.toFixed(1)}%`}></div>
          <div style={{ width: `${expensePercent}%` }} className="h-full bg-rose-500/80 transition-all duration-700 ease-out hover:bg-rose-400" title={`Despesa: ${expensePercent.toFixed(1)}%`}></div>
        </div>

        <div className="flex justify-between items-center text-sm font-medium">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]"></div>
            <span className="text-gray-300">Despesas</span>
          </div>
          <span className="text-rose-400 font-bold">{formatCurrency(expense)}</span>
        </div>
      </div>
    </div>
  );
};

export default IncomeExpenseChart;
