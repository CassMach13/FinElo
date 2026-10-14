import React, { useEffect, useState } from 'react';
import type { InvestmentHolding, InvestmentPortfolio } from '../../types';
import { appConfirm } from '../../hooks/useDialogStore';
import {
  HOLDING_NAME_MAX,
  archivePortfolio,
  createHolding,
  unarchivePortfolio,
  updateHolding,
} from '../../services/investmentStructureService';
import { archiveConfirmation, positionsLabel, structureErrorMessage } from './portfolioMessages';

/**
 * Gestão de UMA carteira (V2-B1B): renomear, arquivar/desarquivar e os ativos (holdings) dela.
 * Nunca exclui carteira nem ativo e nunca toca em posições: arquivar preserva classificações e totais.
 */
export interface PortfolioManagerDrawerProps {
  portfolio: InvestmentPortfolio;
  holdings: InvestmentHolding[];
  ownerUserId: string;
  ownerLabel: string;
  monthLabel: string;
  positionsThisMonth: number;
  onClose: () => void;
  onRename: () => void;
  /** Recarregar carteiras e ativos depois de uma alteração; recebe a mensagem de sucesso. */
  onChanged: (message: string) => void;
}

type HoldingDraft = { id: string | null; displayName: string; institutionRef: string; productTypeRef: string };
const EMPTY_DRAFT: HoldingDraft = { id: null, displayName: '', institutionRef: '', productTypeRef: '' };

const input = 'w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-highlight focus:outline-none';

const PortfolioManagerDrawer: React.FC<PortfolioManagerDrawerProps> = ({
  portfolio, holdings, ownerUserId, ownerLabel, monthLabel, positionsThisMonth, onClose, onRename, onChanged,
}) => {
  const archived = !!portfolio.archived_at;
  const [draft, setDraft] = useState<HoldingDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(null);
    setError(null);
  }, [portfolio.id]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setDraft(null);
      onChanged(success);
    } catch (err) {
      setError(structureErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleArchive = async () => {
    const ok = await appConfirm(archiveConfirmation(portfolio.name, positionsThisMonth, monthLabel), 'Arquivar carteira', 'Arquivar', 'warning');
    if (ok) await run(() => archivePortfolio(portfolio.id), `Carteira "${portfolio.name}" arquivada.`);
  };

  const handleSaveHolding = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft || !draft.displayName.trim()) return;
    const refs = { institutionRef: draft.institutionRef, productTypeRef: draft.productTypeRef };
    if (draft.id) {
      const id = draft.id;
      await run(() => updateHolding(id, { displayName: draft.displayName, ...refs }), 'Ativo atualizado.');
    } else {
      await run(() => createHolding({ ownerUserId, portfolioId: portfolio.id, displayName: draft.displayName, ...refs }), 'Ativo criado.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="portfolio-manager-title">
      <div className="flex h-full w-full max-w-md flex-col border-l border-slate-700/50 bg-secondary shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-700/50 px-5 py-4">
          <div className="min-w-0">
            <h2 id="portfolio-manager-title" className="truncate text-lg font-semibold text-white" title={portfolio.name}>{portfolio.name}</h2>
            <p className="text-xs text-gray-400">
              Proprietário: <span data-owner-label="">{ownerLabel}</span> · {positionsLabel(positionsThisMonth)} em {monthLabel}
              {archived && <span className="ml-2 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-gray-300">Arquivada</span>}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-lg p-1.5 text-gray-400 hover:bg-slate-700 hover:text-white">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Carteira</h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={onRename} className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-slate-700/60 disabled:opacity-50">Renomear</button>
              {archived ? (
                <button type="button" disabled={busy} onClick={() => run(() => unarchivePortfolio(portfolio.id), `Carteira "${portfolio.name}" desarquivada.`)} className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-slate-700/60 disabled:opacity-50">Desarquivar</button>
              ) : (
                <button type="button" disabled={busy} onClick={handleArchive} className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">Arquivar</button>
              )}
            </div>
            {archived && <p className="text-xs text-gray-400">Arquivada: mantém as posições já classificadas e não recebe novas.</p>}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Ativos</h3>
                <p className="text-xs text-gray-500">Identificam o mesmo investimento ao longo dos meses. Instituição e tipo são opcionais.</p>
              </div>
              {!archived && !draft && (
                <button type="button" disabled={busy} onClick={() => setDraft(EMPTY_DRAFT)} className="shrink-0 rounded-lg bg-highlight px-3 py-1.5 text-sm font-medium text-white hover:bg-highlight-hover disabled:opacity-50">Novo ativo</button>
              )}
            </div>

            {draft && (
              <form onSubmit={handleSaveHolding} className="space-y-2 rounded-xl border border-slate-700/60 bg-slate-800/40 p-3">
                <input aria-label="Nome do ativo" autoFocus value={draft.displayName} maxLength={HOLDING_NAME_MAX} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} placeholder="Nome (ex.: CDB Banco X 2027)" className={input} />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input aria-label="Instituição (opcional)" value={draft.institutionRef} maxLength={HOLDING_NAME_MAX} onChange={(e) => setDraft({ ...draft, institutionRef: e.target.value })} placeholder="Instituição (opcional)" className={input} />
                  <input aria-label="Tipo de produto (opcional)" value={draft.productTypeRef} maxLength={HOLDING_NAME_MAX} onChange={(e) => setDraft({ ...draft, productTypeRef: e.target.value })} placeholder="Tipo (opcional)" className={input} />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setDraft(null)} className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-slate-700/60">Cancelar</button>
                  <button type="submit" disabled={busy || !draft.displayName.trim()} className="rounded-lg bg-highlight px-3 py-1.5 text-sm font-medium text-white hover:bg-highlight-hover disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar'}</button>
                </div>
              </form>
            )}

            {holdings.length === 0 ? (
              <p data-holdings-empty="" className="rounded-lg border border-dashed border-slate-600/70 px-3 py-3 text-sm text-gray-400">Nenhum ativo nesta carteira. Ativos são opcionais: dá para classificar posições só na carteira.</p>
            ) : (
              <ul className="divide-y divide-slate-700/50 rounded-xl border border-slate-700/50">
                {holdings.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white" title={h.display_name}>{h.display_name}</p>
                      <p className="truncate text-xs text-gray-500">{[h.institution_ref, h.product_type_ref].filter(Boolean).join(' · ') || '—'}</p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setDraft({ id: h.id, displayName: h.display_name, institutionRef: h.institution_ref ?? '', productTypeRef: h.product_type_ref ?? '' })}
                      className="shrink-0 rounded-lg px-2 py-1 text-xs text-highlight hover:bg-slate-700/60 disabled:opacity-50"
                    >
                      Editar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default PortfolioManagerDrawer;
