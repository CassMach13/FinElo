import { describe, expect, it } from 'vitest';
import { prepareManualPurchaseCompetenceOnPaymentDateEdit } from '../../src/services/creditCardManualCompetence';
import type { Account, Transaction } from '../../src/types';

const itau: Account = {
  id: 'acc-itau',
  Nome_Conta: 'Cartão Itaú',
  Tipo_Conta: 'Cartão de Crédito',
  dia_vencimento: 25,
} as Account;

describe('prepareManualPurchaseCompetenceOnPaymentDateEdit', () => {
  it('grava finelo_competence quando compra anterior ao vencimento é realocada para mês posterior', () => {
    const oldTx = {
      ID_Transacao: 'tx-1',
      ID_Conta: 'acc-itau',
      Origem: 'manual',
      Tipo: 'Despesa',
      Data: '2026-03-18',
      Data_Pagamento: '2026-04-25',
      Valor: -100,
      Descricao_Original: 'Compra Paris',
    } as Transaction;

    const result = prepareManualPurchaseCompetenceOnPaymentDateEdit(
      oldTx,
      { Data_Pagamento: '2026-05-25' },
      itau
    );

    expect(result.Descricao_Original).toContain('finelo_competence:2026-05');
    expect(result.Data_Pagamento).toBe('2026-05-25');
  });

  it('não grava marcador no ciclo natural compra maio com vencimento em junho', () => {
    const oldTx = {
      ID_Transacao: 'tx-2',
      ID_Conta: 'acc-itau',
      Origem: 'manual',
      Tipo: 'Despesa',
      Data: '2026-05-10',
      Data_Pagamento: '2026-05-25',
      Valor: -50,
      Descricao_Original: 'Netflix',
    } as Transaction;

    const result = prepareManualPurchaseCompetenceOnPaymentDateEdit(
      oldTx,
      { Data_Pagamento: '2026-06-25' },
      itau
    );

    expect(result.Descricao_Original).toBeUndefined();
    expect(result.Data_Pagamento).toBe('2026-06-25');
  });
});
