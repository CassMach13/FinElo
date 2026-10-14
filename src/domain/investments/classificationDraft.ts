import type { Investment, InvestmentHolding, InvestmentPortfolio } from '../../types';

/**
 * Regras puras do formulário de classificação (V2-B1B): destino inicial, ativos disponíveis e o que muda.
 * Ativo (holding) é opcional; um ativo só pode ter UMA posição por mês (índice único do banco).
 */

export const NEW_HOLDING = '__new__';

export interface ClassificationDraft {
  portfolioId: string;
  /** '' = sem ativo; NEW_HOLDING = criar um ativo novo; senão o id do ativo. */
  holdingChoice: string;
}

type Position = Pick<Investment, 'id' | 'portfolio_id' | 'holding_id'>;
type Portfolio = Pick<InvestmentPortfolio, 'id' | 'archived_at'>;

/** Começa na carteira atual se ela ainda aceita classificação; senão na primeira ativa (ou nenhuma). */
export function initialDraft(position: Position, activePortfolios: readonly Portfolio[]): ClassificationDraft {
  const current = activePortfolios.find((p) => p.id === position.portfolio_id && !p.archived_at);
  if (current) return { portfolioId: current.id, holdingChoice: position.holding_id ?? '' };
  return { portfolioId: activePortfolios.find((p) => !p.archived_at)?.id ?? '', holdingChoice: '' };
}

/** Ativos da carteira escolhida, marcando os já usados por OUTRA posição do mesmo mês. */
export function holdingOptions(
  holdings: readonly Pick<InvestmentHolding, 'id' | 'portfolio_id' | 'display_name'>[],
  portfolioId: string,
  monthPositions: readonly Position[],
  positionId: string
): Array<{ id: string; name: string; takenBy: string | null }> {
  const used = new Map<string, string>();
  for (const p of monthPositions) if (p.holding_id && p.id !== positionId) used.set(p.holding_id, p.id);
  return holdings
    .filter((h) => h.portfolio_id === portfolioId)
    .map((h) => ({ id: h.id, name: h.display_name, takenBy: used.get(h.id) ?? null }));
}

/**
 * "Sem ativo" só é uma escolha útil quando muda algo: numa posição que JÁ tem ativo, na mesma carteira, trocar por
 * "sem ativo" seria só soltar o vínculo (para isso existe "Remover da carteira").
 */
export function offersNoHolding(position: Position, draft: ClassificationDraft): boolean {
  return !(position.holding_id && draft.portfolioId === position.portfolio_id);
}

/** Há algo a gravar? Reenviar a mesma classificação não é mudança (e o banco nem a auditaria). */
export function draftChanges(position: Position, draft: ClassificationDraft): boolean {
  if (!draft.portfolioId) return false;
  if (draft.holdingChoice === NEW_HOLDING) return true;
  return draft.portfolioId !== (position.portfolio_id ?? '') || (draft.holdingChoice || null) !== (position.holding_id ?? null);
}
