export interface CardImportCycleMetadataInput {
  accountId: string;
  referenceLabel: string;
  dueDate: string;
  paymentTransactionIds?: string[];
  refundTransactionIds?: string[];
}

const normalizedIds = (value: string[] | undefined): string[] | undefined =>
  value === undefined ? undefined : Array.from(new Set(value.filter(Boolean)));

/**
 * Atualiza somente os metadados de competência de uma linha do histórico.
 * Classificações de pagamento/estorno são preservadas quando não foram
 * explicitamente informadas pelo chamador.
 */
export function withCardImportCycleMetadata(
  row: Record<string, unknown>,
  input: CardImportCycleMetadataInput
): Record<string, unknown> {
  const paymentTransactionIds = normalizedIds(input.paymentTransactionIds);
  const refundTransactionIds = normalizedIds(input.refundTransactionIds);

  return {
    ...row,
    ID_Conta: row.ID_Conta || input.accountId,
    Card_Cycle_Mode: 'manual',
    Card_Reference_Label: input.referenceLabel,
    Card_Due_Date: input.dueDate,
    Card_Payment_Tx_Ids:
      paymentTransactionIds === undefined
        ? row.Card_Payment_Tx_Ids ?? []
        : paymentTransactionIds,
    Card_Refund_Tx_Ids:
      refundTransactionIds === undefined
        ? row.Card_Refund_Tx_Ids ?? []
        : refundTransactionIds,
  };
}
