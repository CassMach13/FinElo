import '../appearance/dashboard.css';
import React from 'react';

interface PeriodCompareLegendProps {
  primaryLabel: string;
  compareLabel: string;
  className?: string;
  /** Exibe "vs" entre os períodos em uma única linha compacta */
  inline?: boolean;
}

const PeriodCompareLegend: React.FC<PeriodCompareLegendProps> = ({
  primaryLabel,
  compareLabel,
  className = '',
  inline = false,
}) => {
  if (inline) {
    return (
      <div data-finance="muted" className={`flex flex-wrap items-center gap-1.5 text-[10px] text-gray-400 ${className}`}>
        <span data-finance="positive" className="font-semibold text-accent">{primaryLabel}</span>
        <span data-finance="muted" className="text-gray-600">vs</span>
        <span data-finance="muted" className="font-semibold text-slate-300">{compareLabel}</span>
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] ${className}`}>
      <div className="flex items-center gap-1.5 min-w-0">
        <span data-finance="positive-line" className="w-2 h-2 rounded-full bg-accent/80 shrink-0" />
        <span data-finance="positive" className="font-semibold text-accent truncate">{primaryLabel}</span>
      </div>
      <div className="flex items-center gap-1.5 min-w-0">
        <span data-finance="divider inset" className="w-2 h-2 rounded-full bg-slate-500/80 border border-slate-400/50 shrink-0" />
        <span data-finance="muted" className="font-semibold text-slate-300 truncate">{compareLabel}</span>
      </div>
    </div>
  );
};

export default PeriodCompareLegend;
