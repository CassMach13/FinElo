import { describe, expect, it } from 'vitest';
import { withCardImportCycleMetadata } from '../../src/utils/cardImportCycleMetadata';

describe('withCardImportCycleMetadata', () => {
  it('preserva classificações existentes quando o chamador altera somente a competência', () => {
    const updated = withCardImportCycleMetadata(
      {
        ID_Conta: 'card-1',
        Card_Payment_Tx_Ids: ['pay-1'],
        Card_Refund_Tx_Ids: ['refund-1'],
      },
      {
        accountId: 'card-1',
        referenceLabel: '2026-06',
        dueDate: '2026-07-28',
      }
    );

    expect(updated).toMatchObject({
      Card_Reference_Label: '2026-06',
      Card_Due_Date: '2026-07-28',
      Card_Payment_Tx_Ids: ['pay-1'],
      Card_Refund_Tx_Ids: ['refund-1'],
    });
  });

  it('aceita substituição explícita e remove IDs duplicados', () => {
    const updated = withCardImportCycleMetadata(
      {},
      {
        accountId: 'card-1',
        referenceLabel: '2026-07',
        dueDate: '2026-08-28',
        paymentTransactionIds: ['pay-1', 'pay-1'],
        refundTransactionIds: [],
      }
    );

    expect(updated.Card_Payment_Tx_Ids).toEqual(['pay-1']);
    expect(updated.Card_Refund_Tx_Ids).toEqual([]);
  });
});
