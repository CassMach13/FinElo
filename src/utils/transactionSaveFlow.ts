import { UNCERTAIN_MESSAGE, type TransactionSaveOutcome } from './transactionSaveOutcome';
import { TRANSACTION_DRAFT_TTL_MS } from './transactionDraftStorage';

/**
 * Orquestra o envio do modal de lançamento. Não conhece React nem o banco: recebe a função de
 * salvar, recebe de volta um resultado classificado e decide só o que é do fluxo.
 *
 * - Um único envio por vez, valendo também entre aberturas do modal (fechar durante o envio e
 *   reabrir não libera um segundo envio).
 * - Depois de um resultado incerto, o mesmo lançamento só é enviado de novo com confirmação
 *   explícita do usuário. Nada é reenviado automaticamente.
 * - A lembrança de "resultado incerto" pertence a UM usuário: outra conta no mesmo navegador não a vê.
 */
export const BUSY_MESSAGE = 'Ainda há um salvamento em andamento. Aguarde a confirmação antes de enviar de novo.';
export const DUPLICATE_WARNING =
  'O envio anterior deste lançamento não teve o resultado confirmado e pode ter sido gravado. Salvar de novo pode duplicar o lançamento. Confira a lista de transações antes de continuar.';

export type TransactionSubmitResult =
  | TransactionSaveOutcome
  | { status: 'busy'; message: string }
  | { status: 'declined' };

export const UNCERTAIN_STORAGE_KEY = 'finelo_new_transaction_uncertain_v1';

/** Uma dúvida: a impressão digital do conteúdo cujo envio terminou sem resultado confirmado, e quando. */
export interface UncertainEntry {
  hash: string;
  at: number;
}

/** Quantas dúvidas distintas cada usuário carrega ao mesmo tempo. Passando disso, a mais antiga é esquecida. */
export const MAX_UNCERTAIN_ENTRIES = 20;

/** Onde a lembrança de "resultado incerto" fica. Guarda só impressões digitais, nunca o conteúdo. */
export interface UncertainMemory {
  read(): UncertainEntry[];
  write(entries: UncertainEntry[]): void;
}

const memoryOnly = (): UncertainMemory => {
  let entries: UncertainEntry[] = [];
  return {
    read: () => entries,
    write: (next) => {
      entries = next;
    },
  };
};

const isEntry = (value: unknown): value is UncertainEntry =>
  !!value &&
  typeof (value as UncertainEntry).hash === 'string' &&
  typeof (value as UncertainEntry).at === 'number';

/**
 * Sobrevive a recarregar a página, como o rascunho (mesmo prazo). Sem storage, cai para a memória.
 * Aceita também o formato anterior (uma única dúvida, sem lista).
 */
export const sessionUncertainMemory = (userId: string): UncertainMemory => {
  const fallback = memoryOnly();
  const storageKey = `${UNCERTAIN_STORAGE_KEY}:${userId}`;
  return {
    read() {
      try {
        const parsed = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
        const list = Array.isArray(parsed) ? parsed : [parsed];
        return list.filter(isEntry);
      } catch {
        return fallback.read();
      }
    },
    write(entries) {
      fallback.write(entries);
      try {
        if (entries.length > 0) sessionStorage.setItem(storageKey, JSON.stringify(entries));
        else sessionStorage.removeItem(storageKey);
      } catch {
        /* sem storage: vale a memória */
      }
    },
  };
};

/** FNV-1a de 32 bits: basta para reconhecer "o mesmo conteúdo"; não é segredo nem guarda o texto. */
const fingerprint = (key: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16) + ':' + key.length;
};

export interface SaveGuard {
  inflight: boolean;
  /** Este conteúdo tem um envio de resultado incerto ainda dentro do prazo? */
  isUncertain(key: string): boolean;
  markUncertain(key: string): void;
  /** Este conteúdo foi confirmado: só a dúvida DELE se encerra. Confirmar outro lançamento não apaga a dúvida dos demais. */
  clearUncertain(key: string): void;
}

export const createSaveGuard = (
  memory: UncertainMemory = memoryOnly(),
  now: () => number = Date.now
): SaveGuard => {
  const live = () => memory.read().filter((entry) => now() - entry.at <= TRANSACTION_DRAFT_TTL_MS);
  return {
    inflight: false,
    isUncertain(key) {
      const hash = fingerprint(key);
      return live().some((entry) => entry.hash === hash);
    },
    markUncertain(key) {
      const hash = fingerprint(key);
      const kept = live().filter((entry) => entry.hash !== hash);
      memory.write([...kept, { hash, at: now() }].slice(-MAX_UNCERTAIN_ENTRIES));
    },
    clearUncertain(key) {
      const hash = fingerprint(key);
      memory.write(live().filter((entry) => entry.hash !== hash));
    },
  };
};

const guards = new Map<string, SaveGuard>();

/** Um guarda por usuário, compartilhado por todas as instâncias do modal na página. Sem usuário: sem memória persistente. */
export function saveGuardFor(userId: string | null | undefined): SaveGuard {
  const id = userId || '';
  let guard = guards.get(id);
  if (!guard) {
    guard = createSaveGuard(id ? sessionUncertainMemory(id) : memoryOnly());
    guards.set(id, guard);
  }
  return guard;
}

export interface TransactionSubmitRequest {
  guard: SaveGuard;
  /** Identifica o conteúdo enviado (só para lançamentos novos); `null` em edição, que é idempotente. */
  key: string | null;
  /** Chamada ao handler real. Nunca é repetida por este fluxo. */
  save: () => Promise<TransactionSaveOutcome>;
  confirmDuplicate: (message: string) => Promise<boolean>;
  /** Chamado somente com gravação confirmada (ex.: apagar o rascunho). Nunca em recusa ou incerteza. */
  onSaved?: () => void;
}

export async function submitTransactionSave(request: TransactionSubmitRequest): Promise<TransactionSubmitResult> {
  const { guard } = request;
  if (guard.inflight) return { status: 'busy', message: BUSY_MESSAGE };
  // Reservado antes de qualquer espera: um segundo clique no mesmo instante encontra o envio em curso.
  guard.inflight = true;
  try {
    if (request.key !== null && guard.isUncertain(request.key)) {
      if (!(await request.confirmDuplicate(DUPLICATE_WARNING))) return { status: 'declined' };
    }
    let outcome: TransactionSaveOutcome;
    try {
      outcome = await request.save();
    } catch {
      // O handler deve devolver o resultado classificado; se lançar, nada é afirmado.
      outcome = { status: 'uncertain', message: UNCERTAIN_MESSAGE.create };
    }
    if (outcome.status === 'saved') request.onSaved?.();
    if (request.key !== null) {
      if (outcome.status === 'saved') guard.clearUncertain(request.key);
      else if (outcome.status === 'uncertain') guard.markUncertain(request.key);
    }
    return outcome;
  } finally {
    guard.inflight = false;
  }
}
