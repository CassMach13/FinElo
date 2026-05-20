import type { Transaction } from '../types';

/**
 * Política de sincronização Transações → motor de cartão.
 *
 * Princípio: o histórico de fatura vem dos lotes/linhas importados (`credit_card_entries`).
 * A tabela `transactions` espelha para relatório (categoria, apelido, etc.).
 * Só reprocessamos a origem quando o usuário altera dados que mudam o extrato contábil:
 * data, valor, conta ou origem — ou em inclusão/exclusão (tratado em add/delete).
 */
export const CREDIT_CARD_LEDGER_REPROCESS_FIELDS = [
  'Data',
  'Data_Pagamento',
  'Valor',
  'ID_Conta',
  'Origem',
] as const satisfies readonly (keyof Transaction)[];

export type CreditCardLedgerReprocessField = (typeof CREDIT_CARD_LEDGER_REPROCESS_FIELDS)[number];

/** Campos que nunca devem disparar reprocessamento automático do motor. */
export const CREDIT_CARD_LEDGER_COSMETIC_FIELDS = [
  'Categoria',
  'Nome_Fantasia',
  'Descricao_Original',
  'Tipo',
  'Portador',
  'Parcela_Atual',
  'Total_Parcelas',
  'Tags',
  'Observacoes',
  'linked_asset_id',
  'Fonte',
] as const satisfies readonly (keyof Transaction)[];

const REPROCESS_FIELD_SET = new Set<string>(CREDIT_CARD_LEDGER_REPROCESS_FIELDS);

const toComparable = (value: unknown): string | number | null => {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return value as string | number;
};

const fieldValuesEqual = (before: unknown, after: unknown): boolean =>
  toComparable(before) === toComparable(after);

/**
 * Indica se a edição de uma transação deve reprocessar a origem no motor de cartão.
 */
export function shouldReprocessCreditCardLedgerAfterTransactionUpdate(
  previous: Transaction | undefined,
  fieldsToUpdate: Partial<Transaction>
): boolean {
  const keys = Object.keys(fieldsToUpdate).filter((k) => k !== 'ID_Transacao') as (keyof Transaction)[];

  if (keys.length === 0) return false;

  for (const key of keys) {
    if (!REPROCESS_FIELD_SET.has(key)) continue;

    const nextValue = fieldsToUpdate[key];
    if (previous === undefined) return true;

    const prevValue = previous[key];
    if (!fieldValuesEqual(prevValue, nextValue)) return true;
  }

  return false;
}

/** @deprecated use CREDIT_CARD_LEDGER_REPROCESS_FIELDS */
export const CREDIT_CARD_LEDGER_MOTOR_FIELDS = CREDIT_CARD_LEDGER_REPROCESS_FIELDS;

export function getCosmeticOnlyPatchKeys(
  fieldsToUpdate: Partial<Transaction>
): (keyof Transaction)[] {
  return (Object.keys(fieldsToUpdate).filter(
    (k) => k !== 'ID_Transacao' && !REPROCESS_FIELD_SET.has(k)
  ) as (keyof Transaction)[]);
}
