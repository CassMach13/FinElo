import React, { useEffect, useMemo, useRef } from 'react';
import type { CompetenceHistoryCard } from '../../services/creditCardRebuildFromImportHistoryService';
import { formatCurrency } from '../../utils/formatters';

interface CompetenceInvoiceBarChartProps {
  cards: CompetenceHistoryCard[];
  selectedReferenceMonth: string | null;
  onSelect: (referenceMonth: string) => void;
}

function shortCompetenceLabel(referenceMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(referenceMonth.trim());
  if (!m) return referenceMonth;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d
    .toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
    .replace(/\./g, '')
    .trim();
}

const CompetenceInvoiceBarChart: React.FC<CompetenceInvoiceBarChartProps> = ({
  cards,
  selectedReferenceMonth,
  onSelect,
}) => {
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  const chartCards = useMemo(
    () => [...cards].sort((a, b) => a.referenceMonth.localeCompare(b.referenceMonth)),
    [cards]
  );

  const maxTotal = useMemo(
    () => Math.max(0, ...chartCards.map((c) => Math.max(0, c.statementTotal))),
    [chartCards]
  );

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [selectedReferenceMonth, chartCards.length]);

  if (chartCards.length === 0) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-black/25 px-2 py-3 sm:px-3">
      <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 mb-2 px-1">
        Evolução das faturas
      </p>
      <div
        className="flex items-end gap-1.5 sm:gap-2 overflow-x-auto pb-1 pt-2 px-1 scrollbar-thin"
        role="tablist"
        aria-label="Competências do cartão"
      >
        {chartCards.map((card) => {
          const isSelected = card.referenceMonth === selectedReferenceMonth;
          const amount = Math.max(0, card.statementTotal);
          const heightPct = maxTotal > 0 ? (amount / maxTotal) * 100 : 0;
          const label = shortCompetenceLabel(card.referenceMonth);

          return (
            <button
              key={card.referenceMonth}
              ref={isSelected ? selectedRef : undefined}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-label={`Fatura ${card.competenceBR}, ${formatCurrency(amount)}`}
              onClick={() => onSelect(card.referenceMonth)}
              className={`group flex flex-col items-center justify-end shrink-0 w-11 sm:w-12 h-[120px] sm:h-[132px] rounded-lg transition-colors ${
                isSelected ? 'bg-white/5' : 'hover:bg-white/[0.03]'
              }`}
            >
              <span
                className={`shrink-0 text-[9px] tabular-nums opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none ${
                  isSelected ? 'text-slate-100 opacity-100' : 'text-slate-400'
                }`}
              >
                {amount > 0.005 ? formatCurrency(amount) : '—'}
              </span>
              <div className="flex-1 w-full flex items-end justify-center min-h-0 py-1">
                <span
                  className={`w-7 sm:w-8 rounded-t transition-all duration-300 ${
                    isSelected
                      ? 'bg-slate-100 shadow-[0_0_14px_rgba(226,232,240,0.45)]'
                      : 'bg-slate-600/55 group-hover:bg-slate-500/70'
                  }`}
                  style={{
                    height: `${Math.max(amount > 0.005 ? 10 : 6, heightPct)}%`,
                    minHeight: amount > 0.005 ? '6px' : '4px',
                  }}
                />
              </div>
              <span
                className={`mt-2 text-[10px] leading-none capitalize truncate w-full text-center ${
                  isSelected ? 'text-white font-bold' : 'text-slate-500'
                }`}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CompetenceInvoiceBarChart;
