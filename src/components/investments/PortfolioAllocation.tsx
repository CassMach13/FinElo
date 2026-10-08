import React from 'react';
import { formatCurrency } from '../../utils/formatters';
import { formatAllocationPercent, type Allocation } from '../../domain/investments/portfolioInsights';

interface Props {
  title: string;
  subtitle: string;
  allocation: Allocation;
  dataKey: 'institution' | 'type';
}

const UNRELIABLE_COPY: Record<'zero_total' | 'negative_or_invalid', string> = {
  zero_total: 'O saldo total registrado é R$ 0,00; não há distribuição percentual a mostrar.',
  negative_or_invalid: 'A distribuição percentual não pode ser calculada com confiança: há saldos negativos ou inválidos.',
};

/** Barras horizontais proporcionais ao saldo registrado. Só renderiza o que o domínio calculou. */
const PortfolioAllocation: React.FC<Props> = ({ title, subtitle, allocation, dataKey }) => (
  <section aria-label={title} data-allocation={dataKey} className="min-w-0 rounded-2xl border border-slate-700/50 bg-secondary p-4 shadow-xl sm:p-6">
    <h2 className="text-lg font-semibold text-white">{title}</h2>
    <p className="mb-4 text-xs text-gray-500">{subtitle}</p>

    {allocation.groups.length === 0 ? (
      <p data-allocation-empty="" className="text-sm text-gray-400">Sem posições registradas neste mês.</p>
    ) : (
      <>
        {!allocation.reliable && allocation.issue && (
          <p data-allocation-notice="" role="status" className="mb-3 rounded-lg border border-slate-600/50 bg-slate-800/50 px-3 py-2 text-xs text-gray-300">
            {UNRELIABLE_COPY[allocation.issue]}
          </p>
        )}
        <ul className="space-y-3">
          {allocation.groups.map((g) => (
            <li key={g.key || '__none'} data-allocation-row="" className="min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-gray-100" title={g.label}>{g.label}</span>
                <span className="shrink-0 text-sm tabular-nums text-gray-200">
                  {formatCurrency(g.balance)}
                  {g.percent !== null && <span data-allocation-percent="" className="ml-2 text-xs text-gray-400">{formatAllocationPercent(g.percent)}</span>}
                </span>
              </div>
              {g.percent !== null && (
                <div
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(g.percent * 10) / 10}
                  aria-valuetext={`${g.label}: ${formatCurrency(g.balance)}, ${formatAllocationPercent(g.percent)} do saldo registrado`}
                  aria-label={g.label}
                  className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-700/40"
                >
                  <div data-allocation-bar="" className="h-full rounded-full bg-teal-300/80" style={{ width: `${Math.min(100, Math.max(0, g.percent))}%` }} />
                </div>
              )}
              <p className="mt-0.5 text-[11px] text-gray-500">{g.positionCount} {g.positionCount === 1 ? 'posição' : 'posições'}</p>
            </li>
          ))}
        </ul>
      </>
    )}
  </section>
);

export default PortfolioAllocation;
