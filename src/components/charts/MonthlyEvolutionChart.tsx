import React, { useMemo } from 'react';
import { Transaction } from '../../types';

interface ChartProps {
    data: Transaction[];
    viewMode: 'monthly' | 'quarterly' | 'semiannual' | 'yearly' | 'custom';
    selectedDate: Date;
}

const MonthlyEvolutionChart: React.FC<ChartProps> = ({ data, viewMode, selectedDate }) => {
    const chartData = useMemo(() => {
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

        const monthsMap = new Map<string, { name: string; Renda: number; Despesa: number; Saldo: number }>();
        for (let i = 0; i < monthsToShow; i++) {
            const d = new Date(startDate);
            d.setMonth(d.getMonth() + i);
            const key = `${d.getFullYear()}-${d.getMonth()}`;
            const name = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
            monthsMap.set(key, { name, Renda: 0, Despesa: 0, Saldo: 0 });
        }

        data.forEach(t => {
            const effectiveDate = t.Data_Pagamento ? new Date(t.Data_Pagamento) : new Date(t.Data);
            const key = `${effectiveDate.getFullYear()}-${effectiveDate.getMonth()}`;

            if (monthsMap.has(key)) {
                const entry = monthsMap.get(key)!;
                if (t.Tipo === 'Renda') {
                    entry.Renda += t.Valor;
                } else if (t.Tipo === 'Despesa') {
                    entry.Despesa += Math.abs(t.Valor);
                }
                entry.Saldo = entry.Renda - entry.Despesa;
            }
        });

        return Array.from(monthsMap.values());
    }, [data, viewMode, selectedDate]);

    const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

    // Calc max val to scale bars
    const maxVal = chartData.length > 0 ? Math.max(...chartData.flatMap(c => [c.Renda, c.Despesa])) : 0;

    if (chartData.length === 0) {
        return <div className="h-[300px] flex items-center justify-center text-gray-500">Nenhum dado encontrado para o período.</div>;
    }

    return (
        <div className="w-full h-[300px] flex items-end justify-between pb-8 pt-6 px-2 sm:px-4">
            {chartData.map((item, index) => {
                const incomeHeight = maxVal > 0 ? (item.Renda / maxVal) * 100 : 0;
                const expenseHeight = maxVal > 0 ? (item.Despesa / maxVal) * 100 : 0;

                return (
                    <div key={index} className="flex flex-col items-center justify-end h-full flex-1 max-w-[60px] group relative">
                        {/* Tooltip on hover */}
                        <div className="absolute -top-20 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-white text-xs p-3 rounded pointer-events-none whitespace-nowrap z-10 shadow-lg border border-slate-700 flex flex-col gap-1">
                            <span className="font-bold border-b border-slate-700 pb-1 mb-1">{item.name}</span>
                            <span className="text-emerald-400">R: {formatCurrency(item.Renda)}</span>
                            <span className="text-rose-400">D: {formatCurrency(item.Despesa)}</span>
                        </div>

                        {/* Bars container */}
                        <div className="flex items-end gap-1 w-full justify-center h-full">
                            {/* Income Bar */}
                            <div
                                className="w-full max-w-[24px] bg-emerald-500/80 hover:bg-emerald-400 rounded-t transition-all"
                                style={{ height: `${Math.max(2, incomeHeight)}%` }}
                            />
                            {/* Expense Bar */}
                            <div
                                className="w-full max-w-[24px] bg-rose-500/80 hover:bg-rose-400 rounded-t transition-all"
                                style={{ height: `${Math.max(2, expenseHeight)}%` }}
                            />
                        </div>

                        {/* Label */}
                        <div className="absolute -bottom-6 w-full text-center text-[10px] text-gray-400 truncate px-1">
                            {item.name}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default MonthlyEvolutionChart;
