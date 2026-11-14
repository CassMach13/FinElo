/**
 * Cliente Supabase vinculado à OPERAÇÃO (Etapa 2).
 *
 * A cerca de commit (`sessionCommitFence.ts`) reexecuta o criador do store a cada chamada de ação, de forma síncrona,
 * no instante em que a ação começa. Durante essa reexecução o cliente da conta ativa da aba é capturado aqui; o
 * criador o guarda numa constante local, e TODO o código da ação — inclusive depois de `await` — usa esse mesmo
 * cliente, mesmo que a aba troque de conta no meio. Uma operação de A nunca passa a usar o cliente de B.
 *
 * Fora da reexecução (criação do store, ações sem cerca como `setUser`/`signOut`), devolve o cliente compartilhado,
 * que sempre aponta para a conta ativa no momento da chamada.
 *
 * No modo de conta única o resolvedor devolve o próprio cliente global: comportamento idêntico ao anterior.
 */

type Resolver = () => unknown;

let resolver: Resolver | null = null;
let depth = 0;
let captured: unknown = undefined;

/** Registrado pelo módulo do cliente Supabase: devolve o cliente da conta ativa desta aba. */
export function setOperationClientResolver(next: Resolver | null): void {
  resolver = next;
}

/** Executa `fn` (síncrona) com o cliente da conta ativa capturado para quem chamar `operationClient`. */
export function runWithOperationBinding<T>(fn: () => T): T {
  const previous = captured;
  captured = resolver ? resolver() : undefined;
  depth += 1;
  try {
    return fn();
  } finally {
    depth -= 1;
    captured = previous;
  }
}

/** Dentro de `runWithOperationBinding`: o cliente capturado no início da operação. Fora: `shared`. */
export function operationClient<T>(shared: T): T {
  return depth > 0 && captured ? (captured as T) : shared;
}
