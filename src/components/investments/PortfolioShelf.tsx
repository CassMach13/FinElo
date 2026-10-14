import React from 'react';
import { formatCurrency } from '../../utils/formatters';
import { centsToAmount, type PortfolioFilter, type PortfolioGrouping } from '../../domain/investments/portfolioGrouping';
import type { StructureStatus } from '../../services/investmentStructureLoader';

/**
 * Faixa de carteiras do mês (V2-B1B): um cartão por carteira com o total do mês, o cartão fixo "Sem carteira" e o
 * filtro da lista. Apresentação pura: sem consulta, sem estado próprio.
 */
export interface PortfolioShelfProps {
  status: StructureStatus;
  grouping: PortfolioGrouping | null;
  monthLabel: string;
  /** Rótulo do proprietário consultado (ex.: "Você", "Ione"). */
  ownerLabel: string;
  filter: PortfolioFilter;
  onFilterChange: (filter: PortfolioFilter) => void;
  onRetry: () => void;
  onCreatePortfolio?: () => void;
  onManagePortfolio?: (portfolioId: string) => void;
  /** Arquivadas sem posições no mês consultado: ficam fora dos cartões, mas acessíveis para desarquivar. */
  hiddenArchived?: Array<{ id: string; name: string }>;
}

const card = 'min-w-[11rem] snap-start rounded-xl border px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-highlight';
const cardState = (selected: boolean) =>
  selected ? 'border-highlight/70 bg-highlight/10' : 'border-slate-700/50 bg-slate-800/40 hover:bg-slate-800/70';

const count = (n: number) => (n === 1 ? '1 posição' : `${n} posições`);

const PortfolioShelf: React.FC<PortfolioShelfProps> = ({
  status, grouping, monthLabel, ownerLabel, filter, onFilterChange, onRetry, onCreatePortfolio, onManagePortfolio, hiddenArchived = [],
}) => {
  const groups = grouping?.groups ?? [];
  const hasPortfolios = groups.length > 0;

  return (
    <section data-portfolio-shelf="" aria-labelledby="portfolio-shelf-title" className="rounded-2xl border border-slate-700/50 bg-secondary p-4 shadow-xl sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="portfolio-shelf-title" className="text-lg font-semibold text-white">Carteiras</h2>
          <p className="text-sm text-gray-400">
            Totais de {monthLabel} · <span data-owner-label="">{ownerLabel}</span>. Organizar posições não altera saldos.
          </p>
        </div>
        {onCreatePortfolio && status === 'ready' && (
          <button type="button" onClick={onCreatePortfolio} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-highlight px-4 py-2 font-medium text-white shadow-lg shadow-highlight/20 transition-all hover:bg-highlight-hover sm:w-auto">
            Nova carteira
          </button>
        )}
      </div>

      {status === 'loading' && !grouping ? (
        <div role="status" className="flex items-center gap-3 py-4 text-sm text-gray-400">
          <span className="h-5 w-5 animate-spin rounded-full border-b-2 border-highlight" aria-hidden="true" />
          Carregando carteiras…
        </div>
      ) : status === 'error' && !grouping ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-600/60 bg-slate-800/60 px-4 py-3 text-sm text-gray-200">
          <span>Não foi possível carregar as carteiras. As posições abaixo continuam disponíveis.</span>
          <button type="button" onClick={onRetry} className="rounded-lg border border-slate-600 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700/60">Tentar novamente</button>
        </div>
      ) : grouping ? (
        <>
          {status === 'error' && (
            <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-600/60 bg-slate-800/60 px-4 py-2 text-sm text-gray-200">
              <span>Não foi possível atualizar as carteiras. Exibindo o último resultado carregado.</span>
              <button type="button" onClick={onRetry} className="rounded-lg border border-slate-600 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700/60">Tentar novamente</button>
            </div>
          )}
          {!hasPortfolios && (
            <p data-portfolio-empty="" className="mb-3 rounded-xl border border-dashed border-slate-600/70 px-4 py-3 text-sm text-gray-300">
              Você ainda não tem carteiras para {ownerLabel === 'Você' ? 'suas posições' : ownerLabel}. Crie uma carteira com o nome que preferir e
              classifique as posições uma a uma.
            </p>
          )}
          <div role="group" aria-label="Filtrar posições por carteira" className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
            <button type="button" aria-pressed={filter === null} onClick={() => onFilterChange(null)} className={`${card} ${cardState(filter === null)}`}>
              <span className="block text-xs uppercase tracking-wide text-gray-400">Todas as posições</span>
              <span className="mt-1 block text-lg font-semibold text-white">{formatCurrency(centsToAmount(grouping.totalCents))}</span>
              <span className="block text-xs text-gray-500">{count(grouping.groups.reduce((n, g) => n + g.positionIds.length, 0) + grouping.unassigned.positionIds.length)}</span>
            </button>
            {groups.map((g) => (
              <div key={g.portfolioId} className="relative">
                <button
                  type="button"
                  data-portfolio-card={g.kind}
                  aria-pressed={filter === g.portfolioId}
                  onClick={() => onFilterChange(g.portfolioId)}
                  className={`${card} ${cardState(filter === g.portfolioId)} w-full pr-10`}
                >
                  <span className="block max-w-[14rem] truncate text-sm font-medium text-white" title={g.name}>{g.name}</span>
                  {g.kind === 'archived' && <span className="mt-0.5 inline-block rounded bg-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-gray-300">Arquivada</span>}
                  {g.kind === 'unavailable' && <span className="mt-0.5 inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">Indisponível</span>}
                  <span className="mt-1 block text-lg font-semibold text-white">{formatCurrency(centsToAmount(g.totalCents))}</span>
                  <span className="block text-xs text-gray-500">{count(g.positionIds.length)}</span>
                </button>
                {onManagePortfolio && g.kind !== 'unavailable' && (
                  <button
                    type="button"
                    onClick={() => onManagePortfolio(g.portfolioId)}
                    aria-label={`Gerenciar carteira ${g.name}`}
                    title="Gerenciar carteira"
                    className="absolute right-2 top-2 rounded-lg p-1.5 text-gray-400 hover:bg-slate-700 hover:text-white"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6h.01M12 12h.01M12 18h.01" /></svg>
                  </button>
                )}
              </div>
            ))}
            <button type="button" data-portfolio-card="unassigned" aria-pressed={filter === 'unassigned'} onClick={() => onFilterChange('unassigned')} className={`${card} ${cardState(filter === 'unassigned')}`}>
              <span className="block text-sm font-medium text-gray-200">Sem carteira</span>
              <span className="mt-1 block text-lg font-semibold text-white">{formatCurrency(centsToAmount(grouping.unassigned.totalCents))}</span>
              <span className="block text-xs text-gray-500">{count(grouping.unassigned.positionIds.length)}</span>
            </button>
          </div>
          {onManagePortfolio && hiddenArchived.length > 0 && (
            <details data-hidden-archived="" className="mt-3 text-sm text-gray-400">
              <summary className="cursor-pointer select-none hover:text-gray-200">Carteiras arquivadas sem posições em {monthLabel} ({hiddenArchived.length})</summary>
              <ul className="mt-2 flex flex-wrap gap-2">
                {hiddenArchived.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => onManagePortfolio(p.id)} className="max-w-[16rem] truncate rounded-lg border border-slate-700/60 px-3 py-1 text-xs text-gray-300 hover:bg-slate-700/60" title={p.name}>{p.name}</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : null}
    </section>
  );
};

export default PortfolioShelf;
