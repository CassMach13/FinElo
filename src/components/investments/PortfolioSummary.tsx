import React from 'react';
import { formatCurrency } from '../../utils/formatters';
import {
  NO_COMPARABLE_BASE_LABEL,
  NO_POSITION_LABEL,
  VARIATION_DISCLAIMER,
  formatMonthLabel,
  formatSignedPercent,
  type PortfolioSummary as Summary,
} from '../../domain/investments/portfolioOverview';

interface Props {
  summary: Summary;
}

const Card: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className = '' }) => (
  <div className={`min-w-0 rounded-2xl border border-slate-700/50 bg-secondary p-4 shadow-lg ${className}`}>
    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{label}</p>
    {children}
  </div>
);

/** Variação nominal com sinal explícito. Sem cor de "bom/ruim": é diferença de saldo, não desempenho. */
export function formatBalanceDelta(absolute: number): string {
  const body = formatCurrency(Math.abs(absolute));
  return absolute > 0 ? `+${body}` : absolute < 0 ? `−${body}` : body;
}

/** Quatro indicadores do mês selecionado. Saldo registrado ≠ patrimônio líquido consolidado ≠ rentabilidade. */
const PortfolioSummary: React.FC<Props> = ({ summary }) => {
  const { delta } = summary;
  return (
    <section aria-label="Resumo da carteira" data-portfolio-summary="" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Card label="Saldo investido registrado" className="col-span-2 lg:col-span-1">
        {summary.hasPositions && summary.balance !== null ? (
          <p data-summary="balance" className="mt-1 truncate text-2xl font-bold tabular-nums text-white">{formatCurrency(summary.balance)}</p>
        ) : (
          <p data-summary="balance" className="mt-1 text-base font-medium text-gray-400">{NO_POSITION_LABEL}</p>
        )}
        <p className="mt-1 text-xs text-gray-500">Posições de {formatMonthLabel(summary.monthKey)}</p>
      </Card>

      <Card label="Variação do saldo registrado" className="col-span-2 lg:col-span-1">
        {delta.status === 'ok' && delta.absolute !== null ? (
          <>
            <p data-summary="delta" className="mt-1 flex flex-wrap items-baseline gap-x-2 text-lg font-semibold tabular-nums text-gray-100">
              <span>{formatBalanceDelta(delta.absolute)}</span>
              {delta.percent !== null ? (
                <span data-summary="delta-percent" className="text-sm font-medium text-gray-300">{formatSignedPercent(delta.percent)}</span>
              ) : (
                <span className="text-xs font-normal text-gray-500">Sem base para percentual</span>
              )}
            </p>
            <p className="mt-1 text-xs text-gray-500">vs {formatMonthLabel(summary.previousMonthKey)}</p>
          </>
        ) : (
          <>
            <p data-summary="delta" className="mt-1 text-base font-medium text-gray-400">{NO_COMPARABLE_BASE_LABEL}</p>
            <p className="mt-1 text-xs text-gray-500">Sem posição registrada em {formatMonthLabel(summary.previousMonthKey)}</p>
          </>
        )}
        <p data-summary="disclaimer" className="mt-2 text-[11px] leading-snug text-gray-500">{VARIATION_DISCLAIMER}</p>
      </Card>

      <Card label="Instituições">
        <p data-summary="institutions" className="mt-1 text-2xl font-bold tabular-nums text-white">{summary.institutionCount}</p>
        <p className="mt-1 text-xs text-gray-500">{summary.institutionCount === 1 ? 'instituição distinta' : 'instituições distintas'}</p>
      </Card>

      <Card label="Posições">
        <p data-summary="positions" className="mt-1 text-2xl font-bold tabular-nums text-white">{summary.positionCount}</p>
        <p className="mt-1 text-xs text-gray-500">{summary.positionCount === 1 ? 'posição registrada' : 'posições registradas'}</p>
      </Card>
    </section>
  );
};

export default PortfolioSummary;
