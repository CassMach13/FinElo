import React, { useEffect, useRef, useState } from 'react';
import type { FinancialGoal } from '../../types';
import { computeGoalProgress, formatDeadlineLabel } from '../../domain/goals/goalProgress';
import { formatCurrency } from '../../utils/formatters';
import ProgressBar from '../ui/ProgressBar';
import Button from '../ui/Button';

const formatPercent = (n: number) => `${n.toFixed(1).replace('.', ',')}%`;

const formatUpdatedAt = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

interface Props {
  goal: FinancialGoal;
  today: string;
  onUpdateValue: (goal: FinancialGoal) => void;
  onEdit: (goal: FinancialGoal) => void;
  onArchive: (goal: FinancialGoal) => void;
  onUnarchive: (goal: FinancialGoal) => void;
  onDelete: (goal: FinancialGoal) => void;
  /** Só para teste/SSR. */
  initialMenuOpen?: boolean;
}

const GoalCard: React.FC<Props> = ({
  goal,
  today,
  onUpdateValue,
  onEdit,
  onArchive,
  onUnarchive,
  onDelete,
  initialMenuOpen = false,
}) => {
  const [menuOpen, setMenuOpen] = useState(initialMenuOpen);
  const menuRef = useRef<HTMLDivElement>(null);
  const p = computeGoalProgress(goal, today);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [menuOpen]);

  const run = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  const deadlineLabel = formatDeadlineLabel(goal.target_date);
  const updated = formatUpdatedAt(goal.updated_at);
  const itemClass =
    'block w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-white/10 focus:bg-white/10 focus:outline-none';

  return (
    <article
      className={`min-w-0 rounded-2xl border border-white/5 bg-secondary/30 p-4 shadow-xl sm:p-5 ${
        p.isArchived ? 'opacity-80' : ''
      }`}
      aria-label={`Objetivo ${goal.name}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-base font-bold text-white">{goal.name}</h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {p.isReached && !p.isArchived && (
              <span className="rounded bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">
                ✓ Objetivo alcançado
              </span>
            )}
            {p.isExpired && !p.isArchived && (
              <span className="rounded bg-yellow-500/15 px-2 py-0.5 text-[11px] font-semibold text-yellow-300">
                Prazo encerrado
              </span>
            )}
            {p.isArchived && (
              <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-gray-300">Arquivado</span>
            )}
          </div>
        </div>

        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            aria-label={`Mais opções do objetivo ${goal.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-lg px-2 py-1 text-lg leading-none text-gray-300 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-white/10 bg-primary shadow-xl"
            >
              {p.isArchived ? (
                <>
                  <button type="button" role="menuitem" className={itemClass} onClick={run(() => onUnarchive(goal))}>
                    Restaurar
                  </button>
                  <button type="button" role="menuitem" className={`${itemClass} text-danger`} onClick={run(() => onDelete(goal))}>
                    Excluir
                  </button>
                </>
              ) : (
                <>
                  <button type="button" role="menuitem" className={itemClass} onClick={run(() => onEdit(goal))}>
                    Editar
                  </button>
                  <button type="button" role="menuitem" className={itemClass} onClick={run(() => onArchive(goal))}>
                    Arquivar
                  </button>
                  <button type="button" role="menuitem" className={`${itemClass} text-danger`} onClick={run(() => onDelete(goal))}>
                    Excluir
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 break-words text-sm tabular-nums text-gray-300">
          <span className="text-lg font-bold text-white">{formatCurrency(goal.current_amount)}</span> de{' '}
          {formatCurrency(goal.target_amount)}
        </p>
        <span className="text-sm font-semibold tabular-nums text-gray-200">{formatPercent(p.progressPercent)}</span>
      </div>

      <div
        className="mt-2"
        role="progressbar"
        aria-label={`Progresso do objetivo ${goal.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(p.progressBarPercent)}
        aria-valuetext={`${formatPercent(p.progressPercent)} de ${formatCurrency(goal.target_amount)}`}
      >
        <ProgressBar value={p.progressBarPercent} max={100} color={p.isReached ? 'bg-accent' : 'bg-highlight'} />
      </div>

      <div className="mt-3 space-y-0.5 text-sm text-gray-400">
        {p.isReached ? (
          <p>
            Você chegou lá.
            {p.exceededAmount > 0 && <> {formatCurrency(p.exceededAmount)} acima do objetivo.</>}
          </p>
        ) : (
          <p>
            Faltam <span className="font-semibold tabular-nums text-gray-200">{formatCurrency(p.remainingAmount)}</span>
            {deadlineLabel && <> · até {deadlineLabel}</>}
          </p>
        )}
        {p.isReached && deadlineLabel && <p>Prazo: {deadlineLabel}</p>}
        {!p.isReached && p.monthsRemaining === 0 && <p>Prazo neste mês</p>}
        {p.monthlyNeeded !== null && (
          <p>
            Para chegar lá: <span className="font-semibold tabular-nums text-gray-200">{formatCurrency(p.monthlyNeeded)}</span>/mês
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        {!p.isArchived ? (
          <Button variant="secondary" className="!px-4 !py-2 text-sm" onClick={() => onUpdateValue(goal)}>
            Atualizar valor
          </Button>
        ) : (
          <span />
        )}
        {updated && <span className="text-[11px] text-gray-500">Atualizado em {updated}</span>}
      </div>
    </article>
  );
};

export default GoalCard;
