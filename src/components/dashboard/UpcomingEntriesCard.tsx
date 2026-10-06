import React, { useMemo, useState } from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { InformationCircleIcon } from '../ui/icons';
import type { Account, Category, Transaction } from '../../types';
import {
  UPCOMING_HORIZONS,
  DEFAULT_UPCOMING_HORIZON,
  computeUpcomingEntries,
  type UpcomingCardGroup,
  type UpcomingEntry,
  type UpcomingHorizon,
  type UpcomingItem,
} from '../../utils/upcomingEntries';
import { formatCurrency } from '../../utils/formatters';
import { formatDateOnlyPtBr } from '../../utils/dateOnly';

export const UPCOMING_TITLE = 'Próximos lançamentos';
export const UPCOMING_SUBTITLE = 'Veja entradas e saídas que já estão registradas para os próximos dias.';
export const UPCOMING_DISCLAIMER =
  'Esta visão mostra lançamentos já registrados no FinElo. Ela não é uma previsão do saldo da sua conta.';
export const UPCOMING_CARD_NOTE =
  'Este total reúne lançamentos registrados com esse vencimento e pode não corresponder ao valor da fatura do cartão.';
export const UPCOMING_EMPTY_HINT =
  'Parcelas, receitas e lançamentos recorrentes que você registrar para datas futuras aparecerão aqui.';
export const UPCOMING_VISIBLE_COUNT = 5;

const shortDate = (iso: string) => formatDateOnlyPtBr(iso).slice(0, 5);

const EntryMeta: React.FC<{ entry: UpcomingEntry; showAccount?: boolean }> = ({ entry, showAccount = true }) => (
  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-gray-400">
    {entry.category && entry.category !== '-' && <span className="min-w-0 break-words">{entry.category}</span>}
    {showAccount && entry.accountName && (
      <>
        <span aria-hidden="true">·</span>
        <span className="min-w-0 break-words">{entry.accountName}</span>
      </>
    )}
    {entry.installment && (
      <>
        <span aria-hidden="true">·</span>
        <span className="rounded bg-white/10 px-1.5 py-px text-[11px] text-gray-200">
          Parcela {entry.installment.current}/{entry.installment.total}
        </span>
      </>
    )}
  </p>
);

const KindBadge: React.FC<{ type: 'Renda' | 'Despesa' }> = ({ type }) => (
  <span
    className={`inline-block shrink-0 rounded px-1.5 py-px text-[11px] font-semibold ${
      type === 'Renda' ? 'bg-accent/15 text-accent' : 'bg-danger/15 text-danger'
    }`}
  >
    {type === 'Renda' ? 'Entrada' : 'Saída'}
  </span>
);

const EntryRow: React.FC<{ entry: UpcomingEntry }> = ({ entry }) => {
  const isIncome = entry.transactionType === 'Renda';
  return (
    <li className="flex items-start gap-3 py-2.5">
      <time dateTime={entry.effectiveDate} className="w-11 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-gray-300">
        {shortDate(entry.effectiveDate)}
      </time>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-words text-sm font-medium text-gray-100">{entry.description}</span>
          <KindBadge type={entry.transactionType} />
        </div>
        <EntryMeta entry={entry} />
      </div>
      <span
        className={`shrink-0 text-sm font-bold tabular-nums ${isIncome ? 'text-accent' : 'text-danger'}`}
        aria-label={`${isIncome ? 'Entrada' : 'Saída'} de ${formatCurrency(entry.amount)}`}
      >
        {isIncome ? '+' : '−'}
        {formatCurrency(entry.amount)}
      </span>
    </li>
  );
};

const CardGroupRow: React.FC<{ group: UpcomingCardGroup; expanded: boolean; onToggle: () => void }> = ({
  group,
  expanded,
  onToggle,
}) => {
  const panelId = `upcoming-group-${group.key.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <li className="py-2.5">
      <div className="flex items-start gap-3">
        <time dateTime={group.effectiveDate} className="w-11 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-gray-300">
          {shortDate(group.effectiveDate)}
        </time>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={panelId}
            className="w-full rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 break-words text-sm font-medium text-gray-100">{group.accountName}</span>
              <KindBadge type="Despesa" />
            </span>
            <span className="mt-0.5 block text-xs text-gray-400">
              Venc. {shortDate(group.effectiveDate)} · {group.count}{' '}
              {group.count === 1 ? 'lançamento registrado' : 'lançamentos registrados'}
              <span className="ml-1 text-gray-300 underline decoration-dotted">
                {expanded ? 'Ocultar lançamentos' : 'Ver lançamentos'}
              </span>
            </span>
          </button>
        </div>
        <span
          className="shrink-0 text-sm font-bold tabular-nums text-danger"
          aria-label={`Saída de ${formatCurrency(group.amount)}`}
        >
          −{formatCurrency(group.amount)}
        </span>
      </div>
      {expanded && (
        <div id={panelId} className="ml-14 mt-2 rounded-lg border border-white/5 bg-black/20 p-3">
          <ul className="divide-y divide-white/5">
            {group.entries.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 py-1.5">
                <div className="min-w-0">
                  <span className="min-w-0 break-words text-sm text-gray-200">{e.description}</span>
                  <EntryMeta entry={e} showAccount={false} />
                </div>
                <span className="shrink-0 text-sm tabular-nums text-gray-200">{formatCurrency(e.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-snug text-gray-500">{UPCOMING_CARD_NOTE}</p>
        </div>
      )}
    </li>
  );
};

interface Props {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  /** Data civil de hoje (AAAA-MM-DD). */
  today: string;
  /** Abre Transações no mesmo intervalo. */
  onViewInTransactions: (range: { startDate: string; endDate: string }) => void;
  /** Só para teste/SSR. */
  initialHorizon?: UpcomingHorizon;
  initialShowAll?: boolean;
  initialExpandedKeys?: string[];
}

const UpcomingEntriesCard: React.FC<Props> = ({
  transactions,
  categories,
  accounts,
  today,
  onViewInTransactions,
  initialHorizon = DEFAULT_UPCOMING_HORIZON,
  initialShowAll = false,
  initialExpandedKeys = [],
}) => {
  const [horizon, setHorizon] = useState<UpcomingHorizon>(initialHorizon);
  const [showAll, setShowAll] = useState(initialShowAll);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialExpandedKeys));

  const model = useMemo(
    () => computeUpcomingEntries({ transactions, categories, accounts, today, horizonDays: horizon }),
    [transactions, categories, accounts, today, horizon]
  );

  const visible: UpcomingItem[] = showAll ? model.items : model.items.slice(0, UPCOMING_VISIBLE_COUNT);
  const hiddenCount = model.items.length - UPCOMING_VISIBLE_COUNT;

  const toggleGroup = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Card id="dashboard-upcoming-entries" title={UPCOMING_TITLE}>
      <div className="-mt-3 mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-sm text-gray-400">{UPCOMING_SUBTITLE}</p>
        <div role="group" aria-label="Horizonte" className="flex shrink-0 gap-1.5 print:hidden">
          {UPCOMING_HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={horizon === h}
              onClick={() => setHorizon(h)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                horizon === h
                  ? 'border-accent/50 bg-accent/20 text-accent'
                  : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
              }`}
            >
              {h} dias
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-xl border border-white/5 bg-black/20 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-accent">Entradas registradas</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-white">{formatCurrency(model.incomeTotal)}</p>
        </div>
        <div className="min-w-0 rounded-xl border border-white/5 bg-black/20 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-danger">Saídas registradas</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-white">{formatCurrency(model.expenseTotal)}</p>
        </div>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {formatDateOnlyPtBr(model.startDate)} a {formatDateOnlyPtBr(model.endDate)}
      </p>

      {model.items.length === 0 ? (
        <div className="mt-3 rounded-xl border border-white/5 bg-black/20 p-3">
          <p className="text-sm text-gray-200">Nenhum lançamento registrado para os próximos {horizon} dias.</p>
          <p className="mt-1 text-xs text-gray-500">{UPCOMING_EMPTY_HINT}</p>
        </div>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-white/5" aria-label={`Lançamentos dos próximos ${horizon} dias`}>
            {visible.map((item) =>
              item.kind === 'entry' ? (
                <EntryRow key={item.id} entry={item} />
              ) : (
                <CardGroupRow
                  key={item.key}
                  group={item}
                  expanded={expanded.has(item.key)}
                  onToggle={() => toggleGroup(item.key)}
                />
              )
            )}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-3 print:hidden">
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                aria-expanded={showAll}
                className="rounded text-sm font-semibold text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {showAll ? 'Mostrar menos' : `Mostrar mais (${hiddenCount})`}
              </button>
            )}
            <Button
              variant="secondary"
              onClick={() => onViewInTransactions({ startDate: model.startDate, endDate: model.endDate })}
            >
              Ver em Transações
            </Button>
          </div>
        </>
      )}

      <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-snug text-gray-500">
        <InformationCircleIcon className="mt-px h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 break-words">{UPCOMING_DISCLAIMER}</span>
      </p>
    </Card>
  );
};

export default UpcomingEntriesCard;
