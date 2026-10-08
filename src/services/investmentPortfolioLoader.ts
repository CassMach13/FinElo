import type { Investment } from '../types';
import { monthWindow, type createRequestGuard, type PortfolioRow } from '../domain/investments/portfolioOverview';

/** Dependências injetáveis (o service real em produção; fakes nos testes). Somente leitura. */
export interface PortfolioLoaderDeps {
  getDetail(monthKey: string): Promise<Investment[]>;
  getHistory(startKey: string, endKey: string): Promise<PortfolioRow[]>;
  getLatestMonthKey(todayKey: string): Promise<string | null>;
}

export interface PortfolioData {
  monthKey: string;
  detail: Investment[];
  /** Linhas dos 12 meses que terminam em `monthKey` (mesma população do detalhamento). */
  history: PortfolioRow[];
}

/** Snapshot carregado + o DONO (sessão) e o mês a que pertence. */
export interface PortfolioSnapshot extends PortfolioData {
  userId: string;
}

/**
 * A view só pode exibir um snapshot do MESMO mês e do MESMO usuário da sessão atual. Predicado puro, avaliado a cada
 * render: não depende de efeito para impedir que dados do usuário anterior apareçam.
 */
export function isSnapshotReady(snapshot: { monthKey: string | null; userId: string | null }, currentKey: string, currentUserId: string | null | undefined): boolean {
  return !!currentUserId && snapshot.userId === currentUserId && snapshot.monthKey === currentKey;
}

export const HISTORY_MONTHS = 12;

/** Detalhamento e histórico do MESMO mês e da MESMA sessão, buscados juntos e entregues juntos (ou falham juntos). */
export async function loadPortfolio(deps: PortfolioLoaderDeps, monthKey: string): Promise<PortfolioData> {
  const window = monthWindow(monthKey, HISTORY_MONTHS);
  const [detail, history] = await Promise.all([
    deps.getDetail(monthKey),
    deps.getHistory(window[0], monthKey),
  ]);
  return { monthKey, detail, history };
}

/**
 * Mês inicial da tela: o mês corrente se ele tem posições; senão a última posição disponível até o mês corrente;
 * sem nenhuma posição, o mês corrente (as ações de importar/adicionar continuam valendo).
 */
export async function resolveInitialMonthKey(deps: Pick<PortfolioLoaderDeps, 'getLatestMonthKey'>, todayKey: string): Promise<string> {
  const latest = await deps.getLatestMonthKey(todayKey);
  return latest ?? todayKey;
}

export interface PortfolioFetcherHandlers {
  onLoading(loading: boolean): void;
  onData(data: PortfolioSnapshot): void;
  onError(error: unknown): void;
}

/**
 * Busca com guarda de concorrência: só a ÚLTIMA busca iniciada, da sessão (userId) ainda ativa, grava resultado,
 * erro ou estado de carregamento. Uma busca antiga do mês A nunca sobrescreve o mês B; a de um usuário nunca
 * sobrescreve a sessão de outro. Erro não grava dados (o chamador preserva os anteriores).
 */
export function createPortfolioFetcher(guard: ReturnType<typeof createRequestGuard>, getLiveUserId: () => string, handlers: PortfolioFetcherHandlers) {
  return async function fetchPortfolio(deps: PortfolioLoaderDeps, userId: string, monthKey: string): Promise<void> {
    const token = guard.begin(userId);
    const current = () => guard.isCurrent(token, getLiveUserId());
    handlers.onLoading(true);
    try {
      const data = await loadPortfolio(deps, monthKey);
      if (current()) handlers.onData({ ...data, userId });
    } catch (error) {
      if (current()) handlers.onError(error);
    } finally {
      if (current()) handlers.onLoading(false);
    }
  };
}
