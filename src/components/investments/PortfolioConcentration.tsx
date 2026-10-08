import React from 'react';
import { formatCurrency } from '../../utils/formatters';
import { formatAllocationPercent, type TopGroup } from '../../domain/investments/portfolioInsights';

interface Props {
  institution: TopGroup | null;
  type: TopGroup | null;
}

const Item: React.FC<{ label: string; top: TopGroup; kind: string }> = ({ label, top, kind }) => (
  <div data-concentration={kind} className="min-w-0 rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{label}</p>
    <p className="mt-1 truncate text-base font-semibold text-white" title={top.label}>{top.label}</p>
    <p className="mt-0.5 text-sm tabular-nums text-gray-300">
      {formatAllocationPercent(top.percent)} da carteira registrada · {formatCurrency(top.balance)}
    </p>
  </div>
);

/** Informação factual de participação. Sem avaliação de risco nem recomendação. */
const PortfolioConcentration: React.FC<Props> = ({ institution, type }) => (
  <section aria-label="Concentração" data-concentration-section="" className="min-w-0 rounded-2xl border border-slate-700/50 bg-secondary p-4 shadow-xl sm:p-6">
    <h2 className="text-lg font-semibold text-white">Concentração</h2>
    <p className="mb-4 text-xs text-gray-500">Maior participação no saldo registrado do mês. Informação descritiva, não é análise de risco.</p>
    {institution || type ? (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {institution && <Item label="Maior participação por instituição" top={institution} kind="institution" />}
        {type && <Item label="Maior participação por tipo" top={type} kind="type" />}
      </div>
    ) : (
      <p data-concentration-empty="" className="text-sm text-gray-400">Participações indisponíveis: não há saldo válido para calcular percentuais neste mês.</p>
    )}
  </section>
);

export default PortfolioConcentration;
