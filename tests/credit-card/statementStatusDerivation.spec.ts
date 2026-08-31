import { describe, expect, it } from 'vitest';
import { mapRowToCreditCardStatement } from '../../src/services/creditCardEngineService';

/**
 * A coluna `status` de credit_card_statements pode ficar defasada em relação aos
 * próprios totais da linha: o upsert de importação grava `status: 'open'` fixo e
 * conta com um recálculo posterior para corrigir.
 *
 * O caso abaixo é uma linha real observada em staging (fatura 3c2c7a80, 07/2026):
 * total 190,00, pagamentos 190,00, saldo 0,00 e `status = 'open'`, com `updated_at`
 * POSTERIOR à criação do pagamento — ou seja, não é dado obsoleto por falta de
 * recálculo. `inferStatusFromTotals(190, 190)` não produz 'open' em nenhum caminho.
 *
 * A leitura passou a derivar o status dos totais, então a UI fica imune à deriva.
 */
describe('status da fatura é derivado dos totais na leitura', () => {
  const linhaBase = {
    id: 'stmt-1',
    card_id: 'card-1',
    account_id: 'acc-1',
    reference_label: '2026-07',
    due_year: 2026,
    due_month: 7,
    due_date: '2026-08-10',
    source_import_lot_ids: [],
    total_purchases: 190,
    total_fees: 0,
    total_interest: 0,
    total_refunds: 0,
  };

  it('linha quitada gravada como "open" é lida como "paid"', () => {
    const st = mapRowToCreditCardStatement({
      ...linhaBase,
      statement_total: 190,
      total_payments: 190,
      open_balance: 0,
      status: 'open',
    });

    expect(st.status).toBe('paid');
    expect(st.statementTotal).toBe(190);
    expect(st.totalPayments).toBe(190);
  });

  it('pagamento a maior também é lido como "paid"', () => {
    const st = mapRowToCreditCardStatement({
      ...linhaBase,
      statement_total: 88.64,
      total_payments: 190,
      open_balance: 0,
      status: 'open',
    });

    expect(st.status).toBe('paid');
  });

  it('pagamento parcial é lido como "partial", mesmo gravado como "open"', () => {
    const st = mapRowToCreditCardStatement({
      ...linhaBase,
      statement_total: 449.9,
      total_payments: 399.9,
      open_balance: 50,
      status: 'open',
    });

    expect(st.status).toBe('partial');
  });

  it('fatura sem pagamento e vencida é lida como "overdue"', () => {
    const st = mapRowToCreditCardStatement({
      ...linhaBase,
      due_date: '2020-01-10',
      statement_total: 500,
      total_payments: 0,
      open_balance: 500,
      status: 'paid',
    });

    expect(st.status).toBe('overdue');
  });

  it('fatura sem pagamento e a vencer é lida como "open"', () => {
    const st = mapRowToCreditCardStatement({
      ...linhaBase,
      due_date: '2999-01-10',
      statement_total: 500,
      total_payments: 0,
      open_balance: 500,
      status: 'paid',
    });

    expect(st.status).toBe('open');
  });

  it('derivação é idempotente: reler o resultado não muda o status', () => {
    const primeira = mapRowToCreditCardStatement({
      ...linhaBase,
      statement_total: 300,
      total_payments: 120,
      open_balance: 180,
      status: 'open',
    });

    const segunda = mapRowToCreditCardStatement({
      ...linhaBase,
      statement_total: primeira.statementTotal,
      total_payments: primeira.totalPayments,
      open_balance: primeira.openBalance,
      status: primeira.status,
    });

    expect(segunda.status).toBe(primeira.status);
    expect(primeira.status).toBe('partial');
  });
});
