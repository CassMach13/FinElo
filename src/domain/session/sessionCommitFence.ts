import type { StateCreator } from 'zustand';
import { runWithOperationBinding } from './operationBinding';
import { captureSession, trackSessionOperation } from './sessionScope';

/**
 * Cerca de commit para TODAS as ações de um store Zustand.
 *
 * Cada chamada de ação captura a sessão (identidade + epoch) no instante em que começa e recebe um `set` próprio:
 * depois que a sessão muda, nenhum `set` dessa chamada — nem os feitos após `await` — chega ao estado. Isso vale
 * para ações novas sem que cada uma precise lembrar de checar `user.id`, e cobre A → B → A (o epoch avança).
 *
 * Mecânica: o criador do store é reexecutado por chamada com o `set` cercado, e só a ação chamada é usada. O
 * criador precisa ser puro (sem efeitos fora das ações), como o `useAppStore`.
 *
 * `unfenced`: ações que conduzem a própria transição de sessão (ex.: `setUser`, `signOut`) ou que só tocam dados
 * globais, não escopados ao usuário.
 */
export function withSessionCommitFence<T extends object>(
  creator: StateCreator<T, [], []>,
  options: { unfenced: ReadonlyArray<keyof T>; onDroppedCommit?: (action: string) => void }
): StateCreator<T, [], []> {
  return (set, get, api) => {
    const base = creator(set, get, api) as Record<string, unknown>;
    const fenced: Record<string, unknown> = { ...base };
    for (const [name, value] of Object.entries(base)) {
      if (typeof value !== 'function' || options.unfenced.includes(name as keyof T)) continue;
      fenced[name] = (...args: unknown[]) => {
        const ticket = captureSession();
        const fencedSet: typeof set = ((partial: Parameters<typeof set>[0], replace?: boolean) => {
          if (!ticket.isCurrent()) {
            options.onDroppedCommit?.(name);
            return;
          }
          (set as (p: typeof partial, r?: boolean) => void)(partial, replace);
        }) as typeof set;
        // Etapa 2: o criador captura aqui o cliente da conta ativa; a ação inteira usa esse cliente (operationBinding.ts).
        const scoped = runWithOperationBinding(() => creator(fencedSet, get, api)) as Record<string, (...a: unknown[]) => unknown>;
        const result = scoped[name](...args);
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          return trackSessionOperation(ticket, result as Promise<unknown>, name);
        }
        return result;
      };
    }
    return fenced as T;
  };
}
