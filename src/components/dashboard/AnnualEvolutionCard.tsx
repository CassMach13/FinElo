import React from 'react';
import Card from '../ui/Card';
import { InformationCircleIcon } from '../ui/icons';
import AnnualEvolutionChart, { MONTH_SHORT } from '../charts/AnnualEvolutionChart';
import type { AnnualEvolution } from '../../utils/annualEvolution';
import { MIN_PAIRED_MONTHS } from '../../utils/annualEvolution';
import { buildAnnualEvolutionReading } from '../../utils/annualEvolutionReading';
import { formatCurrency } from '../../utils/formatters';
import { formatPercentChange } from '../../utils/periodComparison';

export const ANNUAL_EVOLUTION_TITLE = 'Evolução anual';
export const ANNUAL_EVOLUTION_SUBTITLE =
  'Compare suas entradas e saídas registradas com o mesmo período do ano anterior.';
export const ANNUAL_EVOLUTION_DISCLAIMER =
  'Os valores refletem os lançamentos classificados no FinElo. Transferências ou pagamentos podem influenciar os totais quando registrados como renda ou despesa.';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const SummaryBlock: React.FC<{
  label: string;
  tone: 'text-accent' | 'text-danger';
  previousYear: number;
  currentYear: number;
  previous: number;
  current: number;
  percent: number | null;
}> = ({ label, tone, previousYear, currentYear, previous, current, percent }) => (
  <div className="min-w-0 rounded-xl border border-white/5 bg-black/20 p-3 sm:p-4">
    <p className={`text-[11px] font-bold uppercase tracking-wide ${tone}`}>{label}</p>
    <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums">
      <span className="text-sm text-gray-400" title={String(previousYear)}>
        {formatCurrency(previous)}
      </span>
      <span className="text-gray-500" aria-label="para">
        →
      </span>
      <span className="text-lg font-bold text-white" title={String(currentYear)}>
        {formatCurrency(current)}
      </span>
    </div>
    <p className="mt-1 text-xs text-gray-400">
      {previousYear} → {currentYear} ·{' '}
      <span className="font-semibold text-gray-200 tabular-nums">
        {percent === null ? '—' : formatPercentChange(percent)}
      </span>
      {percent === null && <span className="text-gray-500"> (sem base no ano anterior)</span>}
    </p>
  </div>
);

const AnnualEvolutionCard: React.FC<{ model: AnnualEvolution }> = ({ model }) => {
  if (model.status === 'ineligible') {
    if (model.reason === 'no_complete_month') return null;
    return (
      <Card title={ANNUAL_EVOLUTION_TITLE} id="dashboard-annual-evolution">
        <p className="-mt-3 text-sm text-gray-400">
          A comparação anual aparece quando há pelo menos {MIN_PAIRED_MONTHS} meses completos com lançamentos
          registrados nos dois anos. Por enquanto, {model.pairedMonths.length}{' '}
          {model.pairedMonths.length === 1 ? 'mês atende' : 'meses atendem'} a esse critério.
        </p>
      </Card>
    );
  }

  const first = MONTH_SHORT[0];
  const last = MONTH_SHORT[model.lastMonth - 1];
  const period = `${cap(first)}–${cap(last)} ${model.currentYear} vs. ${cap(first)}–${cap(last)} ${model.previousYear}`;
  const reading = buildAnnualEvolutionReading(model.incomeChangePercent, model.expenseChangePercent);
  const partialBasis = model.pairedMonths.length < model.lastMonth;

  return (
    <Card title={ANNUAL_EVOLUTION_TITLE} id="dashboard-annual-evolution">
      <div className="-mt-3 mb-5 space-y-1">
        <p className="text-sm text-gray-400">{ANNUAL_EVOLUTION_SUBTITLE}</p>
        <p className="text-sm font-semibold text-gray-200">{period}</p>
        {partialBasis && (
          <p className="text-xs text-gray-500">
            Os totais consideram os {model.pairedMonths.length} meses com lançamentos nos dois anos (
            {model.pairedMonths.map((m) => MONTH_SHORT[m - 1]).join(', ')}).
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryBlock
          label="Entradas"
          tone="text-accent"
          previousYear={model.previousYear}
          currentYear={model.currentYear}
          previous={model.totals.incomePrevious}
          current={model.totals.incomeCurrent}
          percent={model.incomeChangePercent}
        />
        <SummaryBlock
          label="Saídas"
          tone="text-danger"
          previousYear={model.previousYear}
          currentYear={model.currentYear}
          previous={model.totals.expensePrevious}
          current={model.totals.expenseCurrent}
          percent={model.expenseChangePercent}
        />
      </div>

      <div className="mt-5">
        <AnnualEvolutionChart months={model.months} currentYear={model.currentYear} previousYear={model.previousYear} />
      </div>

      <div className="mt-5 rounded-xl border border-white/5 bg-black/20 p-3 sm:p-4 print:break-inside-avoid">
        <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Leitura do FinElo</p>
        <p className="mt-1 break-words text-sm text-gray-200">{reading.text}</p>
      </div>

      <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-snug text-gray-500">
        <InformationCircleIcon className="mt-px h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 break-words">{ANNUAL_EVOLUTION_DISCLAIMER}</span>
      </p>
    </Card>
  );
};

export default AnnualEvolutionCard;
