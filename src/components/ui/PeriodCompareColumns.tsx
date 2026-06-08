import React from 'react';

interface PeriodCompareColumnsProps {
  primaryLabel: string;
  compareLabel: string;
  primary: React.ReactNode;
  compare: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  minHeight?: string;
}

export const PeriodCompareCell: React.FC<{
  label: string;
  children: React.ReactNode;
  variant?: 'primary' | 'compare';
}> = ({ label, children, variant = 'primary' }) => (
  <div
    className={`flex flex-col min-w-0 h-full rounded-xl px-4 py-3 ${
      variant === 'primary'
        ? 'bg-accent/[0.07] border border-accent/25'
        : 'bg-black/30 border border-white/10'
    }`}
  >
    <p
      className={`text-[10px] font-bold uppercase tracking-wide mb-2 truncate ${
        variant === 'primary' ? 'text-accent' : 'text-slate-400'
      }`}
    >
      {label}
    </p>
    <div className="flex-1 flex flex-col justify-center min-h-0">{children}</div>
  </div>
);

const PeriodCompareColumns: React.FC<PeriodCompareColumnsProps> = ({
  primaryLabel,
  compareLabel,
  primary,
  compare,
  footer,
  className = '',
  minHeight = 'min-h-[120px]',
}) => (
  <div className={className}>
    <div className={`grid grid-cols-2 gap-3 w-full ${minHeight}`}>
      <PeriodCompareCell label={primaryLabel} variant="primary">
        {primary}
      </PeriodCompareCell>
      <PeriodCompareCell label={compareLabel} variant="compare">
        {compare}
      </PeriodCompareCell>
    </div>
    {footer ? <div className="mt-3 pt-2 border-t border-white/5">{footer}</div> : null}
  </div>
);

export default PeriodCompareColumns;
