import React from 'react';

/** Leitura determinística do FinElo: texto calculado dos dados, sem IA, sem recomendação. */
const PortfolioInsightsNarrative: React.FC<{ lines: string[] }> = ({ lines }) => (
  <section aria-label="Leitura do FinElo" data-narrative="" className="min-w-0 rounded-2xl border border-teal-300/20 bg-teal-300/[0.04] p-4 shadow-xl sm:p-6">
    <h2 className="text-lg font-semibold text-white">Leitura do FinElo</h2>
    <p className="mb-3 text-xs text-gray-500">Resumo automático dos dados registrados neste mês. Não é recomendação de investimento.</p>
    <ul className="space-y-2">
      {lines.map((line) => (
        <li key={line} data-narrative-line="" className="text-sm leading-relaxed text-gray-200">{line}</li>
      ))}
    </ul>
  </section>
);

export default PortfolioInsightsNarrative;
