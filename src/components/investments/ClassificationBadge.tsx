import React from 'react';

/** Situação de uma posição na estrutura de carteiras (V2-B1B). Apresentação pura. */
export interface ClassificationBadgeProps {
  /** Nome da carteira; `null` = "Sem carteira". */
  portfolioName: string | null;
  archived?: boolean;
  holdingName?: string | null;
  /** Ação de classificar/mover/desfazer, quando a tela a oferece. */
  onAction?: () => void;
}

const ClassificationBadge: React.FC<ClassificationBadgeProps> = ({ portfolioName, archived = false, holdingName, onAction }) => {
  const label = portfolioName ?? 'Sem carteira';
  const tone = portfolioName
    ? archived
      ? 'border-slate-600 bg-slate-700/60 text-gray-300'
      : 'border-highlight/40 bg-highlight/10 text-sky-200'
    : 'border-dashed border-slate-600 bg-transparent text-gray-400';
  const text = (
    <>
      <span className="truncate">{label}</span>
      {archived && <span className="shrink-0 text-[9px] uppercase tracking-wider text-gray-400">arquivada</span>}
      {holdingName && <span className="truncate text-gray-400">· {holdingName}</span>}
    </>
  );
  const base = `inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tone}`;
  if (!onAction) return <span data-classification-badge="" className={base}>{text}</span>;
  return (
    <button type="button" data-classification-badge="" onClick={onAction} title={portfolioName ? 'Mover ou remover da carteira' : 'Classificar em uma carteira'} className={`${base} hover:border-highlight hover:text-white`}>
      {text}
      <svg className="h-3 w-3 shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
    </button>
  );
};

export default ClassificationBadge;
