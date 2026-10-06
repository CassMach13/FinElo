import React, { useState } from 'react';
import Button from '../ui/Button';
import { InformationCircleIcon } from '../ui/icons';
import type { RecurrenceCandidate } from '../../domain/recurrences/detectRecurrences';
import { RECURRENCE_WINDOW_MONTHS } from '../../domain/recurrences/detectRecurrences';
import { formatCurrency } from '../../utils/formatters';

export const RECURRENCES_TITLE = 'Possíveis gastos recorrentes';
export const RECURRENCES_INTRO = 'O FinElo encontrou lançamentos que parecem se repetir mensalmente.';
export const RECURRENCES_DISCLAIMER =
  'São padrões detectados no seu histórico, não cobranças futuras confirmadas.';
export const RECURRENCES_EMPTY = 'Nenhuma possível recorrência mensal foi identificada nos últimos meses.';
export const RECURRENCES_EMPTY_HINT =
  'O FinElo precisa de pelo menos três meses de histórico semelhante para mostrar algo aqui.';
export const RECURRENCES_VISIBLE_COUNT = 5;

export function describeUsualDay(day: RecurrenceCandidate['usualDay']): string | null {
  if (!day) return null;
  return day.kind === 'exact' ? `Geralmente no dia ${day.day}` : `Geralmente entre os dias ${day.from} e ${day.to}`;
}

interface Props {
  candidates: RecurrenceCandidate[];
  /** Rótulo do dono, só quando o contexto familiar o resolve; senão nada é mostrado. */
  getOwnerLabel?: (ownerUserId: string) => string | undefined;
  onViewTransactions: (candidate: RecurrenceCandidate) => void;
  onClose: () => void;
  /** Só para teste/SSR. */
  initialShowAll?: boolean;
}

const RecurrencesPanel: React.FC<Props> = ({
  candidates,
  getOwnerLabel,
  onViewTransactions,
  onClose,
  initialShowAll = false,
}) => {
  const [showAll, setShowAll] = useState(initialShowAll);
  const visible = showAll ? candidates : candidates.slice(0, RECURRENCES_VISIBLE_COUNT);
  const hidden = candidates.length - RECURRENCES_VISIBLE_COUNT;

  return (
    <section
      id="transactions-recurrences"
      aria-labelledby="recurrences-heading"
      className="mb-6 min-w-0 rounded-2xl border border-white/5 bg-secondary/30 p-4 shadow-xl sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="recurrences-heading" className="text-lg font-bold text-white">
            {RECURRENCES_TITLE}
          </h2>
          <p className="mt-1 text-sm text-gray-400">{RECURRENCES_INTRO}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar recorrências"
          className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-gray-300 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          ×
        </button>
      </div>

      <p className="mt-2 flex items-start gap-1.5 text-xs leading-snug text-gray-500">
        <InformationCircleIcon className="mt-px h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 break-words">{RECURRENCES_DISCLAIMER}</span>
      </p>

      {candidates.length === 0 ? (
        <div className="mt-4 rounded-xl border border-white/5 bg-black/20 p-3">
          <p className="text-sm text-gray-200">{RECURRENCES_EMPTY}</p>
          <p className="mt-1 text-xs text-gray-500">{RECURRENCES_EMPTY_HINT}</p>
        </div>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-white/5" aria-label={RECURRENCES_TITLE}>
            {visible.map((c) => {
              const usual = describeUsualDay(c.usualDay);
              const owner = getOwnerLabel?.(c.ownerUserId);
              return (
                <li key={`${c.ownerUserId}|${c.normalizedName}`} className="min-w-0 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-gray-100">{c.displayName}</p>
                      <p className="text-xs text-gray-400">Possível recorrência mensal</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[11px] uppercase tracking-wide text-gray-500">Valor típico</p>
                      <p className="text-sm font-bold tabular-nums text-white">{formatCurrency(c.typicalAmount)}</p>
                    </div>
                  </div>

                  <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-400">
                    <li>
                      Presente em {c.monthCount} dos últimos {RECURRENCE_WINDOW_MONTHS} meses
                    </li>
                    <li>
                      {c.amountPattern === 'stable'
                        ? 'Valores semelhantes'
                        : `Valores variáveis · ${formatCurrency(c.minAmount)} – ${formatCurrency(c.maxAmount)}`}
                    </li>
                    {usual && <li>{usual}</li>}
                    {c.accountCount > 1 && <li>Em mais de uma conta</li>}
                    {owner && <li>{owner}</li>}
                  </ul>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {c.hasFutureRegistered && (
                      <span className="rounded bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">
                        Já registrada para os próximos meses
                      </span>
                    )}
                    <Button
                      variant="secondary"
                      className="!px-3 !py-1.5 text-xs"
                      onClick={() => onViewTransactions(c)}
                      aria-label={`Ver lançamentos de ${c.displayName}`}
                    >
                      Ver lançamentos
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {hidden > 0 && (
            <button
              type="button"
              aria-expanded={showAll}
              onClick={() => setShowAll((v) => !v)}
              className="mt-1 rounded text-sm font-semibold text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {showAll ? 'Mostrar menos' : `Mostrar mais (${hidden})`}
            </button>
          )}
        </>
      )}
    </section>
  );
};

export default RecurrencesPanel;
