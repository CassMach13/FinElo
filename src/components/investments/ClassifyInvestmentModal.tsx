import React, { useEffect, useMemo, useState } from 'react';
import type { Investment, InvestmentHolding, InvestmentPortfolio } from '../../types';
import { appConfirm } from '../../hooks/useDialogStore';
import { HOLDING_NAME_MAX, classifyInvestment, createHolding, unclassifyInvestment } from '../../services/investmentStructureService';
import { NEW_HOLDING, draftChanges, holdingOptions, initialDraft, type ClassificationDraft } from '../../domain/investments/classificationDraft';
import { formatCurrency } from '../../utils/formatters';
import { structureErrorMessage, unclassifyConfirmation } from './portfolioMessages';

/**
 * Classificar, mover ou desfazer a classificação de UMA posição (V2-B1B). Só grava `portfolio_id`/`holding_id` pelo
 * serviço restrito; saldo, mês e proprietário nunca são enviados. Quem fez e quando é registrado pelo banco.
 */
export interface ClassifyInvestmentModalProps {
  investment: Investment;
  ownerUserId: string;
  ownerLabel: string;
  monthLabel: string;
  portfolios: InvestmentPortfolio[];
  holdings: InvestmentHolding[];
  /** Posições do mesmo mês e proprietário (para não oferecer um ativo já usado no mês). */
  monthPositions: Investment[];
  onClose: () => void;
  onCreatePortfolio: () => void;
  /** Classificação gravada: recarregar o mês (e as carteiras, se `structureChanged`). */
  onDone: (message: string, structureChanged: boolean) => void;
}

const select = 'w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-highlight focus:outline-none';

const ClassifyInvestmentModal: React.FC<ClassifyInvestmentModalProps> = ({
  investment, ownerUserId, ownerLabel, monthLabel, portfolios, holdings, monthPositions, onClose, onCreatePortfolio, onDone,
}) => {
  const active = useMemo(() => portfolios.filter((p) => p.user_id === ownerUserId && !p.archived_at), [portfolios, ownerUserId]);
  const current = investment.portfolio_id ? portfolios.find((p) => p.id === investment.portfolio_id) ?? null : null;
  const productLabel = investment.product_name || investment.product_type;
  const [draft, setDraft] = useState<ClassificationDraft>(() => initialDraft(investment, active));
  const [newHoldingName, setNewHoldingName] = useState(productLabel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(initialDraft(investment, active));
    setNewHoldingName(productLabel);
    setError(null);
  }, [investment.id]);

  // Carteira criada a partir deste formulário: passa a ser o destino.
  useEffect(() => {
    if (!draft.portfolioId && active.length > 0) setDraft(initialDraft(investment, active));
  }, [active.length]);

  const options = holdingOptions(holdings, draft.portfolioId, monthPositions, investment.id);
  const canSave = !busy && draftChanges(investment, draft) && (draft.holdingChoice !== NEW_HOLDING || newHoldingName.trim().length > 0);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    let createdHolding = false;
    try {
      let holdingId: string | null = draft.holdingChoice || null;
      if (draft.holdingChoice === NEW_HOLDING) {
        const holding = await createHolding({
          ownerUserId,
          portfolioId: draft.portfolioId,
          displayName: newHoldingName,
          institutionRef: investment.institution,
          productTypeRef: investment.product_type,
        });
        createdHolding = true;
        holdingId = holding.id;
      }
      await classifyInvestment({ investmentId: investment.id, ownerUserId, portfolioId: draft.portfolioId, holdingId });
      const target = active.find((p) => p.id === draft.portfolioId);
      onDone(`"${productLabel}" agora está na carteira "${target?.name ?? ''}".`, createdHolding);
    } catch (err) {
      const message = structureErrorMessage(err);
      // O ativo novo já existe: a classificação pode ser refeita escolhendo-o na lista.
      setError(createdHolding ? `O ativo foi criado, mas a posição não foi classificada: ${message}` : message);
      if (createdHolding) setDraft((d) => ({ ...d, holdingChoice: '' }));
      setBusy(false);
    }
  };

  const handleUnclassify = async () => {
    if (!current) return;
    const ok = await appConfirm(unclassifyConfirmation(productLabel, current.name), 'Remover da carteira', 'Remover', 'warning');
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await unclassifyInvestment({ investmentId: investment.id, ownerUserId });
      onDone(`"${productLabel}" voltou para Sem carteira.`, false);
    } catch (err) {
      setError(structureErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="classify-title">
      <form onSubmit={handleSave} className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl border border-slate-700/50 bg-secondary shadow-xl sm:rounded-2xl">
        <div className="border-b border-slate-700/50 px-5 py-4">
          <h2 id="classify-title" className="text-lg font-semibold text-white">{current ? 'Mover ou remover da carteira' : 'Classificar em uma carteira'}</h2>
          <p className="mt-1 truncate text-sm text-gray-300" title={productLabel}>{productLabel}</p>
          <p className="text-xs text-gray-400">
            {investment.institution} · {monthLabel} · {formatCurrency(Number(investment.balance))} · Proprietário: <span data-owner-label="">{ownerLabel}</span>
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {current && (
            <p data-current-portfolio="" className="rounded-lg border border-slate-700/60 bg-slate-800/40 px-3 py-2 text-sm text-gray-300">
              Hoje em: <strong className="text-white">{current.name}</strong>
              {current.archived_at && <span className="ml-1 text-xs text-gray-400">(arquivada — não recebe novas classificações)</span>}
            </p>
          )}

          {active.length === 0 ? (
            <div data-no-active-portfolio="" className="rounded-lg border border-dashed border-slate-600/70 px-3 py-3 text-sm text-gray-300">
              <p>Não há carteira ativa para {ownerLabel === 'Você' ? 'suas posições' : ownerLabel}.</p>
              <button type="button" onClick={onCreatePortfolio} className="mt-2 rounded-lg bg-highlight px-3 py-1.5 text-sm font-medium text-white hover:bg-highlight-hover">Criar carteira</button>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <label htmlFor="classify-portfolio" className="block text-sm font-medium text-gray-300">Carteira</label>
                <select id="classify-portfolio" value={draft.portfolioId} onChange={(e) => setDraft({ portfolioId: e.target.value, holdingChoice: '' })} className={select}>
                  {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="classify-holding" className="block text-sm font-medium text-gray-300">Ativo <span className="font-normal text-gray-500">(opcional)</span></label>
                <select id="classify-holding" value={draft.holdingChoice} onChange={(e) => setDraft({ ...draft, holdingChoice: e.target.value })} className={select}>
                  <option value="">Sem ativo</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id} disabled={!!o.takenBy}>{o.takenBy ? `${o.name} (já usado em ${monthLabel})` : o.name}</option>
                  ))}
                  <option value={NEW_HOLDING}>+ Criar ativo novo</option>
                </select>
                {draft.holdingChoice === NEW_HOLDING && (
                  <input aria-label="Nome do novo ativo" value={newHoldingName} maxLength={HOLDING_NAME_MAX} onChange={(e) => setNewHoldingName(e.target.value)} className={`${select} mt-2`} />
                )}
                <p className="text-xs text-gray-500">O ativo identifica o mesmo investimento em outros meses. Um ativo recebe uma posição por mês.</p>
              </div>
            </>
          )}

          <p className="text-xs text-gray-500">Classificar não altera saldo, mês nem proprietário.</p>
          {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-700/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {current && (
              <button type="button" disabled={busy} onClick={handleUnclassify} className="w-full rounded-lg border border-amber-500/40 px-4 py-2 text-sm text-amber-300 hover:bg-amber-500/10 disabled:opacity-50 sm:w-auto">Remover da carteira</button>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-gray-200 hover:bg-slate-700/60">Cancelar</button>
            {active.length > 0 && (
              <button type="submit" disabled={!canSave} className="rounded-lg bg-highlight px-4 py-2 text-sm font-medium text-white hover:bg-highlight-hover disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? 'Salvando…' : current ? 'Mover' : 'Classificar'}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};

export default ClassifyInvestmentModal;
