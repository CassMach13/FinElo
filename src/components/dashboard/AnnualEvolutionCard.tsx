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
  'Movimentações internas e pagamentos de fatura identificados pelo FinElo não entram nos totais. Lançamentos ainda não identificados podem influenciá-los.';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const TrendIcon: React.FC<{ up: boolean }> = ({ up }) => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0">
    <path
      d={up ? 'M2 8.5 5 5.5l2 2L10 4M7.5 4H10v2.5' : 'M2 3.5 5 6.5l2-2L10 8M7.5 8H10V5.5'}
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Cor = natureza da métrica (a mesma do gráfico), nunca bom/ruim: é só variação quantitativa. */
const SummaryBlock: React.FC<{
  label: string;
  color: string;
  previousYear: number;
  currentYear: number;
  previous: number;
  current: number;
  percent: number | null;
}> = ({ label, color, previousYear, currentYear, previous, current, percent }) => (
  <div
    data-summary-metric=""
    className="relative grid min-w-0 grid-cols-1 gap-x-[18px] gap-y-[7px] overflow-hidden rounded-[13px] border border-slate-400/[0.12] bg-[rgba(12,18,29,.48)] px-[17px] pb-[14px] pt-[15px] sm:grid-cols-[minmax(0,1fr)_auto]"
  >
    <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5" style={{ backgroundColor: color }} />
    <p className="col-span-full flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-300">
      <span
        aria-hidden="true"
        className="h-[5px] w-[5px] rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 0 3px ${color}21` }}
      />
      {label}
    </p>
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-[clamp(14px,3vw,36px)] gap-y-2">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-gray-400 tabular-nums">{currentYear}</p>
        <p
          className="break-words text-[length:clamp(17px,1.55vw,21px)] font-bold leading-tight text-white tabular-nums"
          title={String(currentYear)}
        >
          {formatCurrency(current)}
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-gray-500 tabular-nums">vs. {previousYear}</p>
        <p className="break-words text-sm text-gray-300 tabular-nums" title={String(previousYear)}>
          {formatCurrency(previous)}
        </p>
      </div>
    </div>
    <p
      data-metric-change=""
      className="flex flex-wrap items-center gap-[5px] text-xs tabular-nums sm:self-end sm:justify-end"
      style={{ color: percent === null ? undefined : color }}
    >
      {percent === null ? (
        <>
          <span className="font-semibold text-gray-300">—</span>
          <span className="text-gray-500">(sem base no ano anterior)</span>
        </>
      ) : (
        <>
          <TrendIcon up={percent >= 0} />
          <span className="font-semibold">{formatPercentChange(percent)}</span>
          <span className="text-gray-500">no período</span>
        </>
      )}
    </p>
  </div>
);

const SparkIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1.5 9.6 6.4 14.5 8 9.6 9.6 8 14.5 6.4 9.6 1.5 8 6.4 6.4 8 1.5Z" fill="#49d2c7" />
  </svg>
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

      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">Resumo</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryBlock
          label="Entradas"
          color="#3bc6be"
          previousYear={model.previousYear}
          currentYear={model.currentYear}
          previous={model.totals.incomePrevious}
          current={model.totals.incomeCurrent}
          percent={model.incomeChangePercent}
        />
        <SummaryBlock
          label="Saídas"
          color="#ff6f6c"
          previousYear={model.previousYear}
          currentYear={model.currentYear}
          previous={model.totals.expensePrevious}
          current={model.totals.expenseCurrent}
          percent={model.expenseChangePercent}
        />
      </div>

      <div>
        <AnnualEvolutionChart months={model.months} currentYear={model.currentYear} previousYear={model.previousYear} />
      </div>

      <div
        className="mt-[13px] flex items-start gap-3 rounded-[2px_10px_10px_2px] border-l-2 px-3.5 py-3 print:break-inside-avoid"
        style={{
          borderLeftColor: '#3bc6be',
          background: 'linear-gradient(90deg, rgba(59,198,190,.075), rgba(12,18,29,.30) 55%)',
        }}
      >
        <span
          aria-hidden="true"
          className="flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: 'rgba(59,198,190,.10)' }}
        >
          <SparkIcon />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Leitura do FinElo</p>
          <p className="mt-1 break-words text-sm text-gray-200">{reading.text}</p>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-snug text-gray-500">
        <InformationCircleIcon className="mt-px h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 break-words">{ANNUAL_EVOLUTION_DISCLAIMER}</span>
      </p>
    </Card>
  );
};

export default AnnualEvolutionCard;
