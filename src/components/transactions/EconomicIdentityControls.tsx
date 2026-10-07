import React from 'react';
import { MARK_ACTION_LABEL, UNDO_ACTION_LABEL } from '../../domain/economics/manualEconomicIdentity';

export type InternalMovementMode = 'mark' | 'undo';

const SwapIcon: React.FC<{ className?: string }> = ({ className = 'h-3 w-3' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={`${className} shrink-0`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7h11m0 0-3-3m3 3-3 3" />
    <path d="M16 13H5m0 0 3-3m-3 3 3 3" />
  </svg>
);

/** Selo discreto de identidade econômica (informativo; não é alerta nem erro). */
export const EconomicIdentityBadge: React.FC<{ label: string; className?: string }> = ({ label, className = '' }) => (
  <span
    data-economic-badge=""
    className={`inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border border-teal-300/20 bg-teal-300/10 px-2 py-0.5 text-[10px] font-medium leading-none text-teal-100 ${className}`}
  >
    <SwapIcon />
    <span className="truncate">{label}</span>
  </span>
);

export const internalMovementActionLabel = (mode: InternalMovementMode) => (mode === 'mark' ? MARK_ACTION_LABEL : UNDO_ACTION_LABEL);

/**
 * Ação do DONO. `icon` (tabela): botão compacto com title/aria-label exatos. `text` (card mobile): botão textual
 * visível, sem depender de gesto.
 */
export const InternalMovementActionButton: React.FC<{
  mode: InternalMovementMode;
  variant: 'icon' | 'text';
  onClick: () => void;
  disabled?: boolean;
}> = ({ mode, variant, onClick, disabled }) => {
  const label = internalMovementActionLabel(mode);
  if (variant === 'icon') {
    return (
      <button
        type="button"
        data-internal-movement-action={mode}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        disabled={disabled}
        title={label}
        aria-label={label}
        className="text-teal-300 hover:text-teal-100 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
      >
        <SwapIcon className="h-5 w-5" />
      </button>
    );
  }
  return (
    <button
      type="button"
      data-internal-movement-action={mode}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      aria-label={label}
      className="inline-flex items-center gap-1.5 rounded-lg border border-teal-300/20 px-2.5 py-1.5 text-xs font-medium text-teal-100 hover:bg-teal-300/10 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <SwapIcon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
};
