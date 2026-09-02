import { describe, expect, it } from 'vitest';
import { prepareManualPurchaseCompetenceOnPaymentDateEdit } from '../../src/services/creditCardManualCompetence';
import type { Account, Transaction } from '../../src/types';

const itau: Account = {
  id: 'acc-itau',
  Nome_Conta: 'Cartão Itaú',
  Tipo_Conta: 'Cartão de Crédito',
  dia_vencimento: 25,
} as Account;

/**
 * ATENÇÃO — as expectativas deste arquivo foram INVERTIDAS de propósito.
 *
 * Elas fixavam duas regras que descartavam a fatura escolhida pelo usuário:
 * «compra e vencimento no mesmo mês → vale o mês da compra» e «compra bem antes
 * do vencimento → vale o mês do vencimento». Com a segunda data significando
 * VENCIMENTO DA FATURA, as duas contradizem o que foi informado.
 *
 * A regra passou a ser uma só: competência = mês(vencimento) − 1, porque a
 * competência N vence em N+1. E o marcador é gravado sempre que a data muda,
 * não só quando diverge da derivação — as duas agora são a mesma conta, e o
 * teste antigo nunca dispararia, deixando marcador velho com data nova.
 */
describe('prepareManualPurchaseCompetenceOnPaymentDateEdit', () => {
  it('a fatura informada manda: vencimento 25/05 → competência 2026-04', () => {
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

    // Vencimento 25/05 é a fatura da competência 2026-04, não 2026-05.
    expect(result.Descricao_Original).toContain('finelo_competence:2026-04');
    expect(result.Data_Pagamento).toBe('2026-05-25');
  });

  it('grava o marcador também no ciclo natural — a escolha não pode ficar implícita', () => {
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

    // Vencimento 25/06 → competência 2026-05. O marcador vai junto SEMPRE:
    // gravado só «quando diverge», ele nunca seria reescrito ao trocar a data.
    expect(result.Descricao_Original).toContain('finelo_competence:2026-05');
    expect(result.Data_Pagamento).toBe('2026-06-25');
  });
});
