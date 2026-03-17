import React, { useMemo } from 'react';
import Card from '../ui/Card';
import ProgressBar from '../ui/ProgressBar';
import { Transaction, Category } from '../../types';

interface Rule503020WidgetProps {
    income: number;
    operationalExpenses: Transaction[]; // From chartData (No Ambos, No Investments)
    savings: number; // Net Investment Flow
    categories: Category[]; // To lookup is_essential
}

const Rule503020Widget: React.FC<Rule503020WidgetProps> = ({ income, operationalExpenses, savings, categories }) => {
    // 1. Map Category ID/Name to details for fast lookup
    const categoryMap = useMemo(() => {
        if (!categories) return new Map();
        return new Map(categories.map(c => [c.Nome_Categoria, c]));
    }, [categories]);

    // 2. Calculate Splits
    const data = useMemo(() => {
        let essentials = 0;
        let lifestyle = 0;

        operationalExpenses.forEach(t => {
            if (t.Tipo === 'Despesa') {
                const cat = categoryMap.get(t.Categoria);
                const val = Math.abs(t.Valor);
                if (cat?.is_essential) {
                    essentials += val;
                } else {
                    lifestyle += val;
                }
            }
            // Renda in operationalExpenses (e.g. Cashback?) usually counts as income offset or extra income. 
            // summary.income already filters Renda. summary.expense filters Despesa.
            // Here we iterate all chartData which contains both Renda and Despesa (Operational).
            // We only care about Despesa for the allocation of 50/30.
        });

        return { essentials, lifestyle, savings };
    }, [operationalExpenses, savings, categoryMap]);

    // 3. Totals and Percentages
    // The base for the percentage is usually the Total Net Income on the period.
    // If Income is 0, avoid division by zero.
    const base = income > 0 ? income : 1;

    // If expenses exceed income, total > 100%, bars will show overflow or full.
    // 50-30-20 is a BUDGET rule (Planning), but here we show ACTUALS.

    const pctEssentials = (data.essentials / base) * 100;
    const pctLifestyle = (data.lifestyle / base) * 100;
    const pctSavings = (data.savings / base) * 100;

    const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    return (
        <div className="space-y-6">
            {/* 50% - Necessidades */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 sm:gap-4 items-center">
                <div className="col-span-1">
                    <span className="font-bold text-blue-400">Necessidades</span>
                    <span className="block text-xs text-gray-500">Meta: 50%</span>
                </div>
                <div className="col-span-2">
                    <ProgressBar
                        value={data.essentials}
                        max={base * 0.50} // Max is the target amount
                        color="bg-blue-500"
                        showPercentage={false} // Custom percentage below/aside
                    />
                </div>
                <div className="col-span-1 text-right flex flex-col justify-center">
                    <span className="font-semibold text-light">{formatCurrency(data.essentials)}</span>
                    <span className={`text-xs ${pctEssentials > 50 ? 'text-danger' : 'text-gray-400'}`}>
                        {pctEssentials.toFixed(1)}% da Renda
                    </span>
                </div>
            </div>

            {/* 30% - Desejos / Estilo de Vida */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 sm:gap-4 items-center">
                <div className="col-span-1">
                    <span className="font-bold text-purple-400">Estilo de Vida</span>
                    <span className="block text-xs text-gray-500">Meta: 30%</span>
                </div>
                <div className="col-span-2">
                    <ProgressBar
                        value={data.lifestyle}
                        max={base * 0.30}
                        color="bg-purple-500"
                    />
                </div>
                <div className="col-span-1 text-right flex flex-col justify-center">
                    <span className="font-semibold text-light">{formatCurrency(data.lifestyle)}</span>
                    <span className={`text-xs ${pctLifestyle > 30 ? 'text-danger' : 'text-gray-400'}`}>
                        {pctLifestyle.toFixed(1)}% da Renda
                    </span>
                </div>
            </div>

            {/* 20% - Investimentos / Poupança */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 sm:gap-4 items-center">
                <div className="col-span-1">
                    <span className="font-bold text-green-400">Investimentos</span>
                    <span className="block text-xs text-gray-500">Meta: 20%</span>
                </div>
                <div className="col-span-2">
                    <ProgressBar
                        value={data.savings}
                        max={base * 0.20}
                        color="bg-green-500"
                    />
                </div>
                <div className="col-span-1 text-right flex flex-col justify-center">
                    <span className="font-semibold text-light">{formatCurrency(data.savings)}</span>
                    <span className={`text-xs ${pctSavings < 20 ? 'text-yellow-500' : 'text-green-400'}`}>
                        {pctSavings.toFixed(1)}% da Renda
                    </span>
                </div>
            </div>

            {income === 0 && (
                <p className="text-center text-xs text-gray-500 mt-2">
                    Sem renda registrada no período para calcular as porcentagens.
                </p>
            )}

            {(pctEssentials + pctLifestyle + pctSavings) > 100.5 && income > 0 && (
                <div className="mt-4 p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                    <div className="flex items-center gap-2 mb-1">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-500" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                        <span className="text-sm font-bold text-yellow-500">
                            Total Utilizado: {(pctEssentials + pctLifestyle + pctSavings).toFixed(1)}%
                        </span>
                    </div>
                    <p className="text-xs text-gray-400">
                        A soma ultrapassa 100% porque seus gastos + investimentos superaram a renda deste período.
                        Isso indica que você utilizou saldo acumulado de meses anteriores.
                    </p>
                </div>
            )}
        </div>
    );
};

export default Rule503020Widget;
