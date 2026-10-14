import React, { useEffect, useState } from 'react';
import type { InvestmentPortfolio } from '../../types';
import { PORTFOLIO_NAME_MAX, createPortfolio, renamePortfolio } from '../../services/investmentStructureService';
import { structureErrorMessage } from './portfolioMessages';

/** Criar ou renomear carteira (V2-B1B). Nome livre; sem tipo nem classificação obrigatória. */
export interface PortfolioFormModalProps {
  isOpen: boolean;
  /** Proprietário dos dados (pode ser um familiar autorizado; o banco registra o operador). */
  ownerUserId: string;
  ownerLabel: string;
  /** Presente = renomear. */
  portfolio?: Pick<InvestmentPortfolio, 'id' | 'name'> | null;
  onClose: () => void;
  onSaved: (portfolio: InvestmentPortfolio) => void;
}

const PortfolioFormModal: React.FC<PortfolioFormModalProps> = ({ isOpen, ownerUserId, ownerLabel, portfolio, onClose, onSaved }) => {
  const [name, setName] = useState(portfolio?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isRename = !!portfolio;

  useEffect(() => {
    if (!isOpen) return;
    setName(portfolio?.name ?? '');
    setError(null);
    setIsSubmitting(false);
  }, [isOpen, portfolio?.id]);

  if (!isOpen) return null;

  const trimmed = name.trim();
  const unchanged = isRename && trimmed === portfolio!.name;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting || !trimmed || unchanged) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const saved = isRename ? await renamePortfolio(portfolio!.id, trimmed) : await createPortfolio({ ownerUserId, name: trimmed });
      onSaved(saved);
    } catch (err) {
      setError(structureErrorMessage(err));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="portfolio-form-title">
      <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col rounded-t-2xl border border-slate-700/50 bg-secondary shadow-xl sm:rounded-2xl">
        <div className="border-b border-slate-700/50 px-5 py-4">
          <h2 id="portfolio-form-title" className="text-lg font-semibold text-white">{isRename ? 'Renomear carteira' : 'Nova carteira'}</h2>
          <p className="text-xs text-gray-400">Proprietário: <span data-owner-label="">{ownerLabel}</span></p>
        </div>
        <div className="space-y-2 px-5 py-4">
          <label htmlFor="portfolio-name" className="block text-sm font-medium text-gray-300">Nome</label>
          <input
            id="portfolio-name"
            autoFocus
            value={name}
            maxLength={PORTFOLIO_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Aposentadoria, Reserva, Viagem"
            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white placeholder-gray-500 focus:border-highlight focus:outline-none"
          />
          <p className="text-right text-[11px] text-gray-500">{trimmed.length}/{PORTFOLIO_NAME_MAX}</p>
          {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-700/50 px-5 py-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-gray-200 hover:bg-slate-700/60">Cancelar</button>
          <button type="submit" disabled={isSubmitting || !trimmed || unchanged} className="rounded-lg bg-highlight px-4 py-2 text-sm font-medium text-white hover:bg-highlight-hover disabled:cursor-not-allowed disabled:opacity-50">
            {isSubmitting ? 'Salvando…' : isRename ? 'Salvar nome' : 'Criar carteira'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default PortfolioFormModal;
