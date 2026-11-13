import {
  getActiveSessionUserId,
  hasPendingOperationFromOtherIdentity,
  readBearerIdentity,
} from './sessionScope';

/**
 * Barreira de rede do cliente Supabase global (REST, Storage e Edge Functions; Auth passa intacto).
 *
 * Com UM cliente, o token anexado a uma requisição é o da sessão atual do SDK, não o da operação que a iniciou.
 * Esta barreira não consegue atribuir a requisição à operação, então aplica duas regras conservadoras sobre o
 * portador (`sub` do JWT):
 *
 *  R1 — identidade: se a aba exibe o usuário X, nenhuma requisição sai com credencial de Y (ex.: outra aba trocou a
 *       sessão compartilhada e esta ainda não processou o evento).
 *  R2 — quarentena de gravação: enquanto houver operação em voo de OUTRA identidade, nenhuma gravação (método
 *       diferente de GET/HEAD/OPTIONS, incluindo RPC) sai com a credencial atual. Assim uma operação iniciada por A
 *       não grava com o token de B; as leituras dela seguem, mas o resultado já é descartado pelo epoch.
 *
 * O isolamento definitivo por operação (cliente vinculado a cada sessão) fica para a Etapa 2.
 */

export class SessionFenceError extends Error {
  readonly code: 'identity_mismatch' | 'cross_identity_write';
  constructor(code: SessionFenceError['code']) {
    super(
      code === 'identity_mismatch'
        ? 'A sessão desta aba mudou. Atualize a página para continuar.'
        : 'Há uma operação da sessão anterior em andamento. Tente novamente em instantes.'
    );
    this.name = 'SessionFenceError';
    this.code = code;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const FENCED_PATHS = ['/rest/v1/', '/storage/v1/', '/functions/v1/'];

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const requestMethod = (input: RequestInfo | URL, init?: RequestInit): string =>
  (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : undefined) ?? 'GET').toUpperCase();

const requestBearer = (input: RequestInfo | URL, init?: RequestInit): string | null => {
  const headers = new Headers(init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined));
  const value = headers.get('Authorization');
  return value?.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : null;
};

/** Decide se a requisição pode sair. Exportado para teste. */
export function sessionFenceDecision(
  url: string,
  method: string,
  bearer: string | null,
  supabaseUrl: string
): SessionFenceError['code'] | null {
  const base = supabaseUrl.replace(/\/+$/, '');
  if (!url.startsWith(base)) return null;
  const path = url.slice(base.length);
  if (!FENCED_PATHS.some((prefix) => path.startsWith(prefix))) return null;
  // Chave publicável/anônima não é JWT de usuário: a RLS trata como anônimo.
  const identity = readBearerIdentity(bearer);
  if (!identity) return null;
  const active = getActiveSessionUserId();
  if (active && identity.sub !== active) return 'identity_mismatch';
  if (!SAFE_METHODS.has(method) && hasPendingOperationFromOtherIdentity(identity.sub)) return 'cross_identity_write';
  return null;
}

export function createSessionFencedFetch(supabaseUrl: string, baseFetch?: FetchLike): FetchLike {
  return (input, init) => {
    const decision = sessionFenceDecision(requestUrl(input), requestMethod(input, init), requestBearer(input, init), supabaseUrl);
    if (decision) {
      console.warn(`[session] requisição bloqueada (${decision})`);
      return Promise.reject(new SessionFenceError(decision));
    }
    return (baseFetch ?? globalThis.fetch)(input, init);
  };
}
