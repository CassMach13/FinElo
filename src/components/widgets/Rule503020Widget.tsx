import React, { useMemo } from 'react';
import ProgressBar from '../ui/ProgressBar';
import { Transaction, Category } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import { formatPercentOfIncome, hasValidIncomeBase, percentOfIncome } from '../../utils/rule503020Percentages';

interface Rule503020CompareInput {
  label: string;
  income: number;
  operationalExpenses: Transaction[];
  savings: number;
}

interface Rule503020WidgetProps {
  income: number;
  operationalExpenses: Transaction[];
  savings: number;
  categories: Category[];
  compare?: Rule503020CompareInput;
  primaryLabel?: string;
  compareLabel?: string;
}

function compute503020Split(
  operationalExpenses: Transaction[],
  savings: number,
  categoryMap: Map<string, Category>
) {
  let essentials = 0;
  let lifestyle = 0;

  operationalExpenses.forEach((t) => {
    if (t.Tipo === 'Despesa') {
      const cat = categoryMap.get(t.Categoria);
      const val = Math.abs(t.Valor);
      if (cat?.is_essential) essentials += val;
      else lifestyle += val;
    }
  });

  return { essentials, lifestyle, savings };
}

const Rule503020Widget: React.FC<Rule503020WidgetProps> = ({
  income,
  operationalExpenses,
  savings,
  categories,
  compare,
  primaryLabel = 'Atual',
  compareLabel = 'Comparado',
}) => {
  const categoryMap = useMemo(() => {
    if (!categories) return new Map();
    return new Map(categories.map((c) => [c.Nome_Categoria, c]));
  }, [categories]);

  const data = useMemo(
    () => compute503020Split(operationalExpenses, savings, categoryMap),
    [operationalExpenses, savings, categoryMap]
  );

  const compareData = useMemo(() => {
    if (!compare) return null;
    return compute503020Split(compare.operationalExpenses, compare.savings, categoryMap);
  }, [compare, categoryMap]);

  // Sem renda positiva não há proporção a calcular: percentual indisponível (null), sem base fabricada.
  const hasBase = hasValidIncomeBase(income);
  const pctEssentials = percentOfIncome(data.essentials, income);
  const pctLifestyle = percentOfIncome(data.lifestyle, income);
  const pctSavings = percentOfIncome(data.savings, income);

  const comparePctEssentials = compareData ? percentOfIncome(compareData.essentials, compare?.income) : null;
  const comparePctLifestyle = compareData ? percentOfIncome(compareData.lifestyle, compare?.income) : null;
  const comparePctSavings = compareData ? percentOfIncome(compareData.savings, compare?.income) : null;

  const renderDeltaLine = (currentPct: number | null, previousPct: number | null, lowerIsBetter = false) => {
    if (currentPct === null || previousPct === null) return null;
    const delta = currentPct - previousPct;
    const improved = lowerIsBetter ? delta < 0 : delta > 0;
    const tone = delta === 0 ? 'text-gray-500' : improved ? 'text-accent' : 'text-danger';
    const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '•';
    return (
      <p className={`text-[10px] font-semibold mt-1.5 ${tone}`}>
        {arrow} {delta > 0 ? '+' : ''}
        {delta.toFixed(1)} p.p.
      </p>
    );
  };

  const renderValueColumn = (
    label: string,
    amount: number,
    pct: number | null,
    targetPct: number,
    variant: 'primary' | 'compare',
    higherIsBad = true,
    deltaLine?: React.ReactNode
  ) => {
    const pctClass =
      pct === null
        ? 'text-gray-500'
        : variant === 'primary'
        ? higherIsBad
          ? pct > targetPct
            ? 'text-danger'
            : 'text-gray-400'
          : pct < targetPct
            ? 'text-yellow-500'
            : 'text-green-400'
        : 'text-slate-400';

    return (
      <div
        className={`rounded-lg px-3 py-2.5 text-right min-w-0 ${
          variant === 'primary' ? 'bg-accent/[0.06] border border-accent/20' : 'bg-black/25 border border-white/8'
        }`}
      >
        <p
          className={`text-[9px] font-bold uppercase tracking-wide mb-1 truncate ${
            variant === 'primary' ? 'text-accent' : 'text-slate-400'
          }`}
        >
          {label}
        </p>
        <p className="font-semibold text-light text-sm tabular-nums">{formatCurrency(amount)}</p>
        <p className={`text-xs ${pctClass}`}>{formatPercentOfIncome(pct)}</p>
        {deltaLine}
      </div>
    );
  };

  const renderRow = (
    title: string,
    meta: string,
    titleColor: string,
    barColor: string,
    value: number,
    pct: number | null,
    targetPct: number,
    compareValue: number,
    comparePct: number | null,
    lowerIsBetter: boolean
  ) => (
    <div
      className={`grid gap-3 items-center ${
        compareData
          ? 'grid-cols-1 md:grid-cols-[minmax(0,140px)_minmax(0,1fr)_minmax(0,200px)_minmax(0,160px)]'
          : 'grid-cols-1 sm:grid-cols-4'
      }`}
    >
      <div>
        <span className={`font-bold ${titleColor}`}>{title}</span>
        <span className="block text-xs text-gray-500">{meta}</span>
      </div>
      <div className={compareData ? '' : 'col-span-2'}>
        <ProgressBar value={hasBase ? value : 0} max={hasBase ? income * (targetPct / 100) : 1} color={barColor} />
      </div>
      {compareData ? (
        <>
          {renderValueColumn(
            primaryLabel,
            value,
            pct,
            targetPct,
            'primary',
            lowerIsBetter,
            renderDeltaLine(pct, comparePct, lowerIsBetter)
          )}
          {renderValueColumn(compareLabel, compareValue, comparePct, targetPct, 'compare', lowerIsBetter)}
        </>
      ) : (
        <div className="text-right flex flex-col justify-center">
          <span className="font-semibold text-light">{formatCurrency(value)}</span>
          <span className={`text-xs ${pct !== null && pct > targetPct && lowerIsBetter ? 'text-danger' : 'text-gray-400'}`}>
            {formatPercentOfIncome(pct)}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {renderRow(
        'Necessidades',
        'Meta: 50%',
        'text-blue-400',
        'bg-blue-500',
        data.essentials,
        pctEssentials,
        50,
        compareData?.essentials ?? 0,
        comparePctEssentials,
        true
      )}

      {renderRow(
        'Estilo de Vida',
        'Meta: 30%',
        'text-purple-400',
        'bg-purple-500',
        data.lifestyle,
        pctLifestyle,
        30,
        compareData?.lifestyle ?? 0,
        comparePctLifestyle,
        true
      )}

      {renderRow(
        'Investimentos',
        'Meta: 20%',
        'text-green-400',
        'bg-green-500',
        data.savings,
        pctSavings,
        20,
        compareData?.savings ?? 0,
        comparePctSavings,
        false
      )}

      {!hasBase && (
        <p className="text-center text-xs text-gray-500 mt-2">
          Sem renda no período para calcular os percentuais do método 50-30-20.
        </p>
      )}

      {hasBase && ((pctEssentials ?? 0) + (pctLifestyle ?? 0) + (pctSavings ?? 0)) > 100.5 && (
        <div className="mt-4 p-3 bg-slate-800/50 rounded-lg border border-slate-700">
          <div className="flex items-center gap-2 mb-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 text-yellow-500"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-sm font-bold text-yellow-500">
              Total Utilizado: {((pctEssentials ?? 0) + (pctLifestyle ?? 0) + (pctSavings ?? 0)).toFixed(1)}%
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
