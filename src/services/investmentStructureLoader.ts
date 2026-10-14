import type { InvestmentHolding, InvestmentPortfolio } from '../types';

/** Leitura de carteiras e holdings de UM proprietário (V2-B1B). Somente leitura; dependências injetáveis. */
export interface StructureLoaderDeps {
  listPortfolios(ownerUserId: string): Promise<InvestmentPortfolio[]>;
  listHoldings(ownerUserId: string): Promise<InvestmentHolding[]>;
}

export type StructureStatus = 'off' | 'loading' | 'ready' | 'error';

export interface StructureState {
  /** Proprietário a que os dados pertencem: a view só usa dados do proprietário que está consultando. */
  ownerUserId: string | null;
  status: StructureStatus;
  /** Já houve uma carga bem-sucedida para este proprietário (recarga/erro mantêm os dados anteriores). */
  loaded: boolean;
  portfolios: InvestmentPortfolio[];
  holdings: InvestmentHolding[];
}

export const STRUCTURE_OFF: StructureState = { ownerUserId: null, status: 'off', loaded: false, portfolios: [], holdings: [] };

/** Dados só valem para o proprietário consultado; qualquer outro estado é tratado como "nada carregado". */
export function structureFor(state: StructureState, ownerUserId: string | null | undefined): StructureState {
  if (!ownerUserId) return STRUCTURE_OFF;
  if (state.ownerUserId !== ownerUserId) return { ...STRUCTURE_OFF, ownerUserId, status: 'loading' };
  return state;
}

/**
 * Com a flag desligada NÃO consulta nada (nenhuma requisição às tabelas novas). Só a última carga grava estado; erro
 * preserva os dados do mesmo proprietário (a tela mostra o aviso sem apagar o que já exibia).
 */
export function createStructureLoader(deps: StructureLoaderDeps, onState: (update: (prev: StructureState) => StructureState) => void) {
  let latest = 0;
  return async function load(enabled: boolean, ownerUserId: string | null | undefined): Promise<void> {
    const id = ++latest;
    if (!enabled || !ownerUserId) {
      onState(() => STRUCTURE_OFF);
      return;
    }
    onState((prev) => (prev.ownerUserId === ownerUserId ? { ...prev, status: 'loading' } : { ...STRUCTURE_OFF, ownerUserId, status: 'loading' }));
    try {
      const [portfolios, holdings] = await Promise.all([deps.listPortfolios(ownerUserId), deps.listHoldings(ownerUserId)]);
      if (id !== latest) return;
      onState(() => ({ ownerUserId, status: 'ready', loaded: true, portfolios, holdings }));
    } catch (error) {
      if (id !== latest) return;
      console.error('Failed to load investment portfolios:', error);
      onState((prev) => (prev.ownerUserId === ownerUserId ? { ...prev, status: 'error' } : { ...STRUCTURE_OFF, ownerUserId, status: 'error' }));
    }
  };
}
