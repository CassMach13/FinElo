/**
 * Escopo da sessão ativa deste navegador/aba.
 *
 * Fonte única da identidade que a interface mostra (`userId`) e da GERAÇÃO da sessão (`epoch`). O epoch avança em
 * toda transição de identidade (A → B, A → logout, logout → A) e em toda nova instância de login do MESMO usuário
 * (novo `session_id` no JWT). Renovação de token mantém usuário e instância: o epoch não muda.
 *
 * Uma operação captura um `SessionTicket` ao começar. Ela só pode afetar o estado enquanto o ticket for atual; um
 * ticket de A não volta a valer em A → B → A, porque o epoch já avançou duas vezes.
 *
 * Também registra as operações em voo (por identidade) para a barreira de rede (`sessionFence.ts`), que bloqueia
 * gravações enquanto houver trabalho pendente de OUTRA identidade.
 */

export interface SessionTicket {
  readonly userId: string | null;
  readonly epoch: number;
  /** Ainda é a mesma identidade e a mesma geração de sessão? */
  isCurrent(): boolean;
}

interface PendingOperation {
  readonly userId: string;
  readonly epoch: number;
  readonly label: string;
}

type TransitionListener = (next: { userId: string | null; epoch: number; previousUserId: string | null }) => void;

let activeUserId: string | null = null;
let activeInstance: string | null = null;
let epoch = 0;
const pending = new Set<PendingOperation>();
const listeners = new Set<TransitionListener>();
const epochListeners = new Set<() => void>();

const advance = (previousUserId: string | null) => {
  epoch += 1;
  for (const listener of [...listeners]) {
    try {
      listener({ userId: activeUserId, epoch, previousUserId });
    } catch (error) {
      console.error('[session] falha ao limpar estado da sessão anterior:', error);
    }
  }
  for (const notify of [...epochListeners]) notify();
};

export const getSessionEpoch = (): number => epoch;
export const getActiveSessionUserId = (): string | null => activeUserId;

/**
 * Identidade que a interface passa a exibir. Outro usuário (ou nenhum) avança o epoch e dispara a limpeza
 * registrada; o mesmo usuário (renovação de token, metadados atualizados) não muda nada.
 */
export function commitSessionIdentity(userId: string | null | undefined): boolean {
  const next = userId || null;
  if (next === activeUserId) return false;
  const previous = activeUserId;
  activeUserId = next;
  activeInstance = null;
  advance(previous);
  return true;
}

/** Logout explícito: encerra a geração ANTES de esperar a resposta do servidor. */
export function endSession(): void {
  const previous = activeUserId;
  activeUserId = null;
  activeInstance = null;
  advance(previous);
}

/**
 * Nova instância de login do MESMO usuário sem passar por logout nesta aba (ex.: relogin em outra aba). O primeiro
 * `session_id` observado só é registrado; uma troca dele avança o epoch. Renovação de token mantém o `session_id`.
 */
export function observeSessionInstance(userId: string | null | undefined, sessionInstanceId: string | null | undefined): boolean {
  if (!userId || !sessionInstanceId || userId !== activeUserId) return false;
  if (activeInstance === null) {
    activeInstance = sessionInstanceId;
    return false;
  }
  if (activeInstance === sessionInstanceId) return false;
  activeInstance = sessionInstanceId;
  advance(userId);
  return true;
}

export function captureSession(): SessionTicket {
  const userId = activeUserId;
  const capturedEpoch = epoch;
  return {
    userId,
    epoch: capturedEpoch,
    isCurrent: () => capturedEpoch === epoch && userId === activeUserId,
  };
}

/** Limpeza central registrada por módulos com estado da sessão (stores, caches). */
export function onSessionTransition(listener: TransitionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Para `useSyncExternalStore`: muda a cada nova geração de sessão. */
export function subscribeSessionEpoch(notify: () => void): () => void {
  epochListeners.add(notify);
  return () => epochListeners.delete(notify);
}

/** Registra uma operação assíncrona da identidade do ticket até ela terminar (sucesso ou falha). */
export function trackSessionOperation<T>(ticket: SessionTicket, promise: Promise<T>, label = 'operation'): Promise<T> {
  if (!ticket.userId) return promise;
  const entry: PendingOperation = { userId: ticket.userId, epoch: ticket.epoch, label };
  pending.add(entry);
  const done = () => {
    pending.delete(entry);
  };
  promise.then(done, done);
  return promise;
}

/** Há operação em voo de uma identidade diferente de `userId`? (base da quarentena de gravações) */
export function hasPendingOperationFromOtherIdentity(userId: string): boolean {
  for (const op of pending) if (op.userId !== userId) return true;
  return false;
}

export function pendingSessionOperations(): ReadonlyArray<PendingOperation> {
  return [...pending];
}

/** JWT do Supabase → identidade e instância. Sem validação de assinatura: só para comparar com a sessão local. */
export function readBearerIdentity(token: string | null | undefined): { sub: string; sessionId: string | null } | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const json = JSON.parse(decodeURIComponent(
      Array.from(atob(base64), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')
    ));
    if (!json || typeof json.sub !== 'string' || !json.sub) return null;
    return { sub: json.sub, sessionId: typeof json.session_id === 'string' ? json.session_id : null };
  } catch {
    return null;
  }
}

/** Só para testes: volta ao estado deslogado. Os ouvintes registrados por módulos continuam valendo. */
export function resetSessionScopeForTests(): void {
  activeUserId = null;
  activeInstance = null;
  epoch += 1;
  pending.clear();
}
