/**
 * O que uma edição pode mudar numa transação IMPORTADA.
 *
 * ===========================================================================
 * POR QUE ISTO EXISTE
 * ===========================================================================
 *
 * O modal de edição foi escrito para lançamentos manuais. Ao salvar, ele monta o registro inteiro
 * a partir do formulário: `Parcela_Atual`/`Total_Parcelas` saem `null` (o formulário não
 * hidrata a recorrência), `Fonte` vira `'Manual'`, `Descricao_Original` é reescrita com o nome
 * digitado e `Data_Pagamento`/`Valor` são derivados dos campos. No desktop esse modal só abre para
 * lançamentos manuais; no mobile o "Editar" do cartão abre para qualquer um. E o
 * `updateTransaction` do store persistia o payload inteiro.
 *
 * Resultado: uma edição cosmética de uma transação importada (por exemplo, trocar a categoria)
 * apagava a numeração de parcelas e a descrição original do banco, o que o usuário via como
 * "1/3 → 1/1 → 3/3" e interpretava como corrupção dos dados (chamado 20260905-9C10).
 *
 * ===========================================================================
 * O CONTRATO
 * ===========================================================================
 *
 * Numa importada só os campos de IDENTIFICAÇÃO AMIGÁVEL, que o usuário é dono, mudam. Tudo que
 * descreve a linha do banco (valor, data, conta, tipo, origem, fonte, descrição original,
 * parcela) é imutável por aqui. É uma lista de PERMITIDOS, não de proibidos: um campo novo na
 * tabela nasce protegido.
 *
 * `Data_Pagamento` está na lista porque a célula "Pagamento" da tabela já é editável para
 * importadas desde o início (`nonEditableImportedFields` não a inclui); remover seria mudar o
 * produto, não proteger metadata.
 *
 * Lançamento manual não muda: passa direto. Registro sem `Origem` conta como manual, como no
 * resto do app (`Origem || 'manual'`).
 */
import type { Transaction } from '../../types';
import { toDateOnlyIso } from '../../utils/dateOnly';

export const IMPORTED_TRANSACTION_EDITABLE_FIELDS = [
  'Nome_Fantasia',
  'Categoria',
  'linked_asset_id',
  'Data_Pagamento',
] as const satisfies readonly (keyof Transaction)[];

export type ImportedEditableField = (typeof IMPORTED_TRANSACTION_EDITABLE_FIELDS)[number];

const EDITABLE_SET = new Set<string>(IMPORTED_TRANSACTION_EDITABLE_FIELDS);

export const isManualTransaction = (
  transaction: Pick<Transaction, 'Origem'> | null | undefined
): boolean => String(transaction?.Origem || 'manual').trim().toLowerCase() === 'manual';

/** Vale para a UI (desabilitar controles) e para o store (filtrar o payload). */
export const canEditImportedField = (field: string): field is ImportedEditableField =>
  EDITABLE_SET.has(field);

/** Valor "igual" no sentido do usuário: datas pelo dia civil, vazio/null/undefined/'' equivalentes. */
function isSameValue(field: ImportedEditableField, a: unknown, b: unknown): boolean {
  if (field === 'Data_Pagamento') {
    return toDateOnlyIso(a as Date | string | undefined) === toDateOnlyIso(b as Date | string | undefined);
  }
  const normalize = (v: unknown) => (v === undefined || v === null || v === '' ? '' : v);
  return normalize(a) === normalize(b);
}

/**
 * Filtra o payload de uma atualização ANTES da persistência.
 *
 * Manual: devolve o payload como veio. Importada: devolve somente os campos permitidos que o
 * usuário de fato pediu (valor definido) e que mudaram em relação ao registro atual. Assim uma
 * linha inteira enviada pela edição inline, ou um formulário com campos vazios, nunca regrava a
 * estrutura. `undefined` significa "não mexa", não "apague".
 */
export function sanitizeTransactionUpdate(
  previous: Transaction,
  requested: Partial<Transaction>
): Partial<Transaction> {
  if (isManualTransaction(previous)) return { ...requested };

  const safe: Partial<Transaction> = {};
  for (const field of IMPORTED_TRANSACTION_EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(requested, field)) continue;
    const next = requested[field];
    if (next === undefined) continue;
    if (isSameValue(field, previous[field], next)) continue;
    (safe as Record<string, unknown>)[field] = next;
  }
  return safe;
}
