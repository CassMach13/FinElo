import type { Transaction } from '../../types';

/**
 * Imported rows may retain user-owned presentation metadata, but the bank row
 * and every field that identifies its financial/statement meaning are immutable
 * through the generic transaction editor.
 */
export const IMPORTED_TRANSACTION_EDITABLE_FIELDS = [
  'Nome_Fantasia',
  'Categoria',
  'linked_asset_id',
] as const satisfies readonly (keyof Transaction)[];

type ImportedTransactionEditableField =
  (typeof IMPORTED_TRANSACTION_EDITABLE_FIELDS)[number];

const IMPORTED_TRANSACTION_EDITABLE_FIELD_SET = new Set<keyof Transaction>(
  IMPORTED_TRANSACTION_EDITABLE_FIELDS
);

export interface InstallmentMetadata {
  current: number | null;
  total: number | null;
}

export const isManualTransaction = (
  transaction: Pick<Transaction, 'Origem'> | null | undefined
): boolean =>
  String(transaction?.Origem ?? '').trim().toLowerCase() === 'manual';

export const canEditTransactionField = (
  transaction: Pick<Transaction, 'Origem'>,
  field: keyof Transaction
): boolean => {
  if (field === 'Fonte') return false;
  if (isManualTransaction(transaction)) return true;
  return IMPORTED_TRANSACTION_EDITABLE_FIELD_SET.has(field);
};

/**
 * Defense in depth for the persistence layer. UI restrictions are insufficient:
 * an imported row only accepts the explicit cosmetic whitelist here as well.
 */
export function sanitizeTransactionUpdate(
  previous: Transaction,
  requested: Partial<Transaction>
): Partial<Transaction> {
  if (isManualTransaction(previous)) return { ...requested };

  const safe: Partial<Transaction> = {};
  for (const field of IMPORTED_TRANSACTION_EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(requested, field)) continue;
    (safe as Record<ImportedTransactionEditableField, unknown>)[field] = requested[field];
  }
  return safe;
}

/** Existing records keep the metadata already persisted; recurrence controls
 * only generate metadata for a brand-new manual transaction. */
export function resolveInstallmentMetadataForSave(
  existing: Pick<Transaction, 'Parcela_Atual' | 'Total_Parcelas'> | null | undefined,
  generated: InstallmentMetadata
): InstallmentMetadata {
  if (!existing) return generated;
  return {
    current: existing.Parcela_Atual ?? null,
    total: existing.Total_Parcelas ?? null,
  };
}

export function resolveTransactionSourceForSave(
  existing: Pick<Transaction, 'Fonte'> | null | undefined
): string {
  return existing ? existing.Fonte : 'Manual';
}

export function resolveOriginalDescriptionForSave(
  existing: Pick<Transaction, 'Origem' | 'Descricao_Original'> | null | undefined,
  generatedDescription: string
): string {
  if (existing && !isManualTransaction(existing)) return existing.Descricao_Original;
  return generatedDescription;
}

/** Missing or invalid metadata is unknown, not an invented one-installment plan. */
export function formatInstallmentLabel(
  current: number | null | undefined,
  total: number | null | undefined
): string {
  if (
    !Number.isInteger(current) ||
    !Number.isInteger(total) ||
    Number(current) < 1 ||
    Number(total) < 1 ||
    Number(current) > Number(total)
  ) {
    return '—';
  }
  return `${current}/${total}`;
}
