import React from 'react';
import Card from '../ui/Card';
import { InformationCircleIcon } from '../ui/icons';
import type { CategoryChange, MonthlyChange, MonthlyChangeSide } from '../../utils/monthlyChange';
import { buildMonthlyChangeReading } from '../../utils/monthlyChangeReading';
import { formatCurrency } from '../../utils/formatters';

export const MONTHLY_CHANGE_TITLE = 'O que mudou no seu mês?';
export const MONTHLY_CHANGE_SUBTITLE = 'Compare o último mês completo com o mês anterior.';
export const MONTHLY_CHANGE_EMPTY = 'Ainda não há dois meses completos de lançamentos para comparar.';
export const MONTHLY_CHANGE_NOTE =
  'Os valores refletem os lançamentos classificados no FinElo. Movimentos internos podem influenciar os totais quando registrados como renda ou despesa.';
export const MONTHLY_CHANGE_NO_CATEGORY_CHANGE =
  'Sem mudanças relevantes nas categorias de saída entre os dois meses.';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Percentual com 1 casa; zero (inclusive -0,0) sem sinal; sem base = "—". */
export function formatChangePercent(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return '—';
  const rounded = Math.round(percent * 10) / 10;
  if (rounded === 0) return '0,0%';
  const sign = rounded > 0 ? '+' : '−';
  return `${sign}${Math.abs(rounded).toFixed(1).replace('.', ',')}%`;
}

export function formatSignedCurrency(delta: number): string {
  if (delta === 0) return formatCurrency(0);
  return `${delta > 0 ? '+' : '−'}${formatCurrency(Math.abs(delta))}`;
}

const SummaryBlock: React.FC<{
  label: string;
  tone: 'text-accent' | 'text-danger';
  previousLabel: string;
  currentLabel: string;
  previous: number;
  current: number;
  change: MonthlyChangeSide;
}> = ({ label, tone, previousLabel, currentLabel, previous, current, change }) => (
  <div className="min-w-0 rounded-xl border border-white/5 bg-black/20 p-3 sm:p-4">
    <p className={`text-[11px] font-bold uppercase tracking-wide ${tone}`}>{label}</p>
    <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums">
      <span className="text-sm text-gray-400" title={previousLabel}>
        {formatCurrency(previous)}
      </span>
      <span className="text-gray-500" aria-label="para">
        →
      </span>
      <span className="text-lg font-bold text-white" title={currentLabel}>
        {formatCurrency(current)}
      </span>
    </div>
    <p className="mt-1 text-xs text-gray-400">
      {previousLabel} → {currentLabel} ·{' '}
      <span className="font-semibold tabular-nums text-gray-200">{formatChangePercent(change.percentage)}</span>
      {change.percentage === null && <span className="text-gray-500"> (sem base no mês anterior)</span>}
    </p>
  </div>
);

const CategoryRow: React.FC<{ change: CategoryChange; previousLabel: string; currentLabel: string }> = ({
  change,
  previousLabel,
  currentLabel,
}) => (
  <li className="flex items-start justify-between gap-3 py-2">
    <div className="min-w-0">
      <p className="break-words text-sm font-medium text-gray-100">{change.category || 'Sem categoria'}</p>
      <p className="mt-0.5 break-words text-xs tabular-nums text-gray-400">
        {previousLabel} {formatCurrency(change.previousAmount)} → {currentLabel} {formatCurrency(change.currentAmount)}
      </p>
    </div>
    <span
      className={`shrink-0 text-sm font-bold tabular-nums ${change.delta > 0 ? 'text-danger' : 'text-accent'}`}
      aria-label={`${change.delta > 0 ? 'Aumento' : 'Redução'} de ${formatCurrency(Math.abs(change.delta))}`}
    >
      {formatSignedCurrency(change.delta)}
    </span>
  </li>
);

const MonthlyChangeCard: React.FC<{ model: MonthlyChange }> = ({ model }) => {
  if (!model.eligible) {
    return (
      <Card title={MONTHLY_CHANGE_TITLE} id="dashboard-monthly-change">
        <p className="-mt-3 text-sm text-gray-400">{MONTHLY_CHANGE_EMPTY}</p>
      </Card>
    );
  }

  const cur = model.currentMonth;
  const prev = model.previousMonth;
  const curLabel = cap(cur.label);
  const prevLabel = cap(prev.label);
  const reading = buildMonthlyChangeReading(model.incomeChange.percentage, model.expenseChange.percentage, {
    current: cur.label,
    previous: prev.label,
  });

  return (
    <Card title={MONTHLY_CHANGE_TITLE} id="dashboard-monthly-change">
      <div className="-mt-3 mb-5 space-y-1">
        <p className="text-sm text-gray-400">{MONTHLY_CHANGE_SUBTITLE}</p>
        <p className="text-sm font-semibold text-gray-200">
          {curLabel} × {prevLabel}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryBlock
          label="Entradas registradas"
          tone="text-accent"
          previousLabel={prevLabel}
          currentLabel={curLabel}
          previous={prev.income}
          current={cur.income}
          change={model.incomeChange}
        />
        <SummaryBlock
          label="Saídas registradas"
          tone="text-danger"
          previousLabel={prevLabel}
          currentLabel={curLabel}
          previous={prev.expense}
          current={cur.expense}
          change={model.expenseChange}
        />
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-gray-200">O que mais mudou nas saídas</h3>
        {model.categoryChanges.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400">{MONTHLY_CHANGE_NO_CATEGORY_CHANGE}</p>
        ) : (
          <>
            <p className="text-xs text-gray-500">Categorias com maior variação registrada</p>
            <ul className="mt-1 divide-y divide-white/5">
              {model.categoryChanges.map((c) => (
                <CategoryRow key={c.category} change={c} previousLabel={prevLabel} currentLabel={curLabel} />
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="mt-5 rounded-xl border border-white/5 bg-black/20 p-3 sm:p-4 print:break-inside-avoid">
        <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Leitura do FinElo</p>
        <p className="mt-1 break-words text-sm text-gray-200">{reading.text}</p>
      </div>

      <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-snug text-gray-500">
        <InformationCircleIcon className="mt-px h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 break-words">{MONTHLY_CHANGE_NOTE}</span>
      </p>
    </Card>
  );
};

export default MonthlyChangeCard;
