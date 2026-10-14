import { summarizeOwnerInvestments, type OwnerInvestmentSummary, type OwnerLatestPosition } from '../domain/investments/ownerInvestmentTotals';

/**
 * Carrega a última posição de investimentos de cada proprietário do escopo do Dashboard. Só a última carga iniciada
 * grava estado; o resultado vale apenas para a mesma chave (sessão + escopo + data + proprietários). Assim, trocar de
 * proprietário ou de sessão nunca mostra o total de outro titular durante o carregamento.
 */
export type OwnerInvestmentsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface OwnerInvestmentsState {
  key: string | null;
  status: OwnerInvestmentsStatus;
  summary: OwnerInvestmentSummary | null;
}

export const OWNER_INVESTMENTS_IDLE: OwnerInvestmentsState = { key: null, status: 'idle', summary: null };

export type LoadOwnerPositions = (endDate: Date, ownerUserIds: readonly string[]) => Promise<OwnerLatestPosition[]>;

export const ownerInvestmentsKey = (scopeKey: string, endDate: Date, ownerUserIds: readonly string[]): string =>
  `${scopeKey}|${endDate.toISOString().split('T')[0]}|${[...ownerUserIds].sort().join(',')}`;

export function createOwnerInvestmentsLoader(load: LoadOwnerPositions, onState: (state: OwnerInvestmentsState) => void) {
  let latest = 0;
  return async function run(key: string, endDate: Date, ownerUserIds: readonly string[]): Promise<void> {
    const id = ++latest;
    onState({ key, status: 'loading', summary: null });
    try {
      const positions = await load(endDate, ownerUserIds);
      if (id !== latest) return;
      onState({ key, status: 'ready', summary: summarizeOwnerInvestments(positions) });
    } catch (error) {
      if (id !== latest) return;
      console.error('Failed to load investments by owner:', error);
      onState({ key, status: 'error', summary: null });
    }
  };
}

/** Estado só vale para a chave pedida; qualquer outra (escopo anterior, outra sessão) é "carregando". */
export function ownerInvestmentsFor(state: OwnerInvestmentsState, key: string | null): OwnerInvestmentsState {
  if (!key) return OWNER_INVESTMENTS_IDLE;
  if (state.key !== key) return { key, status: 'loading', summary: null };
  return state;
}
