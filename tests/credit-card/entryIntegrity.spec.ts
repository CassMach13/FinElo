import { describe, expect, it } from 'vitest';
import { planCreditCardEntryPersistence } from '../../src/utils/creditCardEntryIntegrity';

const incoming = (transactionId: string, hash: string, amount = -10) => ({
  transaction_id: transactionId,
  card_id: 'card-a',
  account_id: 'account-a',
  source_file_name: 'fatura.csv',
  source_row_hash: hash,
  amount,
});

describe('credit card entry integrity', () => {
  it('preserva valores iguais quando os IDs das transações são diferentes', () => {
    const plan = planCreditCardEntryPersistence(
      [incoming('tx-a', 'hash-a'), incoming('tx-b', 'hash-b')],
      []
    );
    expect(plan.upserts).toHaveLength(2);
    expect(plan.updates).toHaveLength(0);
  });

  it('bloqueia o mesmo ID duas vezes no lote', () => {
    expect(() =>
      planCreditCardEntryPersistence(
        [incoming('tx-a', 'hash-a'), incoming('tx-a', 'hash-b')],
        []
      )
    ).toThrow(/mais de uma vez no mesmo lote/);
  });

  it('atualiza a projeção existente quando apenas o hash da linha mudou', () => {
    const plan = planCreditCardEntryPersistence([incoming('tx-a', 'hash-new')], [
      {
        id: 'entry-a',
        transaction_id: 'tx-a',
        card_id: 'card-a',
        account_id: 'account-a',
        source_file_name: 'fatura.csv',
        source_row_hash: 'hash-old',
      },
    ]);
    expect(plan.upserts).toHaveLength(0);
    expect(plan.updates).toEqual([{ id: 'entry-a', row: incoming('tx-a', 'hash-new') }]);
  });

  it('falha fechado quando o histórico já é ambíguo', () => {
    const existing = ['entry-a', 'entry-b'].map((id, index) => ({
      id,
      transaction_id: 'tx-a',
      card_id: 'card-a',
      account_id: 'account-a',
      source_file_name: 'fatura.csv',
      source_row_hash: `hash-${index}`,
    }));
    expect(() => planCreditCardEntryPersistence([incoming('tx-a', 'hash-new')], existing)).toThrow(
      /já possui 2 projeções/
    );
  });
});
