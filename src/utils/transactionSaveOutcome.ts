import type { Transaction } from '../types';

/**
 * Resultado de salvar pelo modal de lançamento. Uma Promise resolvida NUNCA significa sucesso:
 * só `saved` autoriza fechar o modal e apagar o rascunho.
 *
 * - `saved`: há evidência positiva de que o banco gravou (linhas devolvidas, ou linhas novas já
 *   presentes no store).
 * - `refused`: o servidor respondeu que NÃO gravou (erro estruturado do PostgREST/Postgres, ou
 *   nenhuma linha afetada). A requisição foi revertida inteira. Pode-se tentar de novo.
 * - `uncertain`: não dá para afirmar nem negar. Falha de rede, timeout, resposta perdida,
 *   resposta vazia. O servidor pode ter gravado. Nunca é reenviado sozinho.
 */
export type TransactionSaveOutcome =
  | { status: 'saved' }
  | { status: 'refused'; message: string }
  | { status: 'uncertain'; message: string };

export type SaveKind = 'create' | 'edit';

export const REFUSED_MESSAGE: Record<SaveKind, string> = {
  create: 'Não foi possível salvar o lançamento. Seus dados foram mantidos: revise e tente novamente.',
  edit: 'Não foi possível salvar a alteração. Seus dados foram mantidos: revise e tente novamente.',
};
export const UNCERTAIN_MESSAGE: Record<SaveKind, string> = {
  create:
    'Não foi possível confirmar se o lançamento foi gravado. Seus dados foram mantidos. Antes de tentar de novo, confira a lista de transações para não duplicar.',
  edit: 'Não foi possível confirmar se a alteração foi gravada. Seus dados foram mantidos. Confira a lista de transações antes de tentar de novo.',
};

/** O servidor respondeu com sucesso, mas nenhuma linha foi atualizada (linha removida ou invisível para a sessão). */
export class NoRowsWrittenError extends Error {
  readonly definitive = true;
  constructor() {
    super('Nenhuma linha foi atualizada.');
    this.name = 'NoRowsWrittenError';
  }
}

/**
 * Recusa definitiva: SQLSTATE de 5 caracteres (`23505`, `42501`, `P0001`), `PGRST123` ou
 * `NoRowsWrittenError`. Só uma resposta HTTP do servidor traz esse código, e o servidor reverte a
 * requisição inteira nesses casos. Todo SQLSTATE traz ao menos um dígito, o que descarta `ETIME`.
 * Falha de rede, abort e timeout chegam sem código (ou com um código de runtime como
 * `ECONNRESET`, que não tem este formato) e ficam como incertos.
 */
export function isDefinitiveRefusal(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if (error instanceof NoRowsWrittenError) return true;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^(PGRST\d{3}|(?=[0-9A-Z]*\d)[0-9A-Z]{5})$/.test(code);
}

type Row = Pick<Transaction, 'ID_Conta' | 'Nome_Fantasia' | 'Valor' | 'Tipo' | 'Categoria'> & { ID_Transacao?: string };
type Payload = { ID_Conta?: unknown; Nome_Fantasia?: unknown; Valor?: unknown; Tipo?: unknown; Categoria?: unknown };

const cents = (value: unknown) => Math.round(Number(value) * 100);
const keyOf = (row: Payload) =>
  [row.ID_Conta ?? '', row.Nome_Fantasia ?? '', cents(row.Valor), row.Tipo ?? '', row.Categoria ?? ''].join('\u0001');

/**
 * Linhas NOVAS no store (ids que não existiam antes da chamada) que casam, uma a uma, com o que foi
 * enviado. O store grava o resultado do insert antes das etapas posteriores, então uma exceção
 * tardia (recálculo, cartão) não pode ser confundida com falha: as linhas já estão lá.
 */
export function persistedInStore(
  before: ReadonlySet<string | undefined>,
  payloads: readonly Payload[],
  after: readonly Row[]
): boolean {
  if (payloads.length === 0) return false;
  const pending = new Map<string, number>();
  for (const payload of payloads) pending.set(keyOf(payload), (pending.get(keyOf(payload)) ?? 0) + 1);
  for (const row of after) {
    if (!row || !row.ID_Transacao || before.has(row.ID_Transacao)) continue;
    const left = pending.get(keyOf(row));
    if (left) pending.set(keyOf(row), left - 1);
  }
  return [...pending.values()].every((left) => left === 0);
}

export interface SaveNewTransactionsDeps<P extends Payload = Payload> {
  /** Ação addTransaction do store, sem alteração. */
  add: (payload: P | P[]) => Promise<readonly Row[]>;
  /** Leitura do estado atual do store (somente leitura). */
  readTransactions: () => readonly Row[];
}

/**
 * Grava lançamentos novos e devolve o resultado classificado. Não reenvia, não compensa, não
 * altera payload nem resultado do store: apenas observa.
 */
export async function saveNewTransactions<P extends Payload>(
  payloads: readonly P[],
  deps: SaveNewTransactionsDeps<P>
): Promise<TransactionSaveOutcome> {
  const before = new Set(deps.readTransactions().map((row) => row?.ID_Transacao));
  const uncertain: TransactionSaveOutcome = { status: 'uncertain', message: UNCERTAIN_MESSAGE.create };
  let rows: readonly Row[];
  try {
    rows = await deps.add(payloads.length === 1 ? payloads[0] : [...payloads]);
  } catch (error) {
    if (persistedInStore(before, payloads, deps.readTransactions())) return { status: 'saved' };
    return isDefinitiveRefusal(error) ? { status: 'refused', message: REFUSED_MESSAGE.create } : uncertain;
  }
  // Positivo: o banco devolveu exatamente as linhas pedidas.
  if (Array.isArray(rows) && rows.length === payloads.length && rows.every((row) => row && row.ID_Transacao)) {
    return { status: 'saved' };
  }
  // Vazio ou parcial (ex.: sem sessão, ou select sem linhas visíveis): ambíguo, a menos que o store prove.
  return persistedInStore(before, payloads, deps.readTransactions()) ? { status: 'saved' } : uncertain;
}

/**
 * Edição: o store (modo estrito) só resolve quando o servidor devolveu a linha atualizada, ou quando
 * não havia nada a gravar. Qualquer outra coisa chega aqui como exceção.
 */
export function classifyThrownSave(error: unknown, kind: SaveKind = 'edit'): TransactionSaveOutcome {
  return isDefinitiveRefusal(error)
    ? { status: 'refused', message: REFUSED_MESSAGE[kind] }
    : { status: 'uncertain', message: UNCERTAIN_MESSAGE[kind] };
}
