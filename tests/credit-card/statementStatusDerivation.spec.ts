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

  /**
   * As migrations 046 (V2) e 047 (motor) deixaram os dois conjuntos de colunas na
   * mesma tabela, todas `not null default 0`. Uma linha escrita pelo caminho V2 tem
   * `statement_total = 0` por default e o valor real em `total_charges`.
   *
   * Sem o fallback legado, derivar o status desses zeros exibiria uma fatura em
   * aberto como PAGA — que é o pior erro possível num app de finanças.
   */
  describe('linha legada do caminho V2 (sem statement_total)', () => {
    // Linha genuinamente legada NÃO tem card_id: o upsert do caminho V2 nem inclui
    // esse campo no payload. Só o motor grava.
    const linhaV2 = {
      id: 'stmt-v2',
      account_id: 'acc-1',
      reference_label: '2026-07',
      due_date: '2999-01-10',
      source_import_lot_ids: [],
      statement_total: 0,
      open_balance: 0,
      total_charges: 1200,
      total_credits: 200,
      open_amount: 700,
      total_payments: 300,
      status: 'partial',
    };

    it('não marca como paga uma fatura em aberto gravada no formato antigo', () => {
      const st = mapRowToCreditCardStatement(linhaV2);

      // Oráculo: 1200 de compras − 200 de créditos = 1000 de fatura; 300 pagos.
      expect(st.statementTotal).toBe(1000);
      expect(st.totalPayments).toBe(300);
      expect(st.status).toBe('partial');
      expect(st.status).not.toBe('paid');
    });

    it('usa open_amount mesmo com open_balance no default zero da coluna', () => {
      // `open_balance` é `not null default 0`: nunca chega null, então um fallback com
      // `??` jamais desviaria. Numa linha legada o saldo real está em `open_amount`.
      const st = mapRowToCreditCardStatement({ ...linhaV2, open_balance: 0 });
      expect(st.openBalance).toBe(700);
    });

    it('fatura inteiramente zerada preserva o status gravado, em vez de inventar "paid"', () => {
      const st = mapRowToCreditCardStatement({
        ...linhaBase,
        card_id: null,
        statement_total: 0,
        total_payments: 0,
        open_balance: 0,
        total_charges: 0,
        total_credits: 0,
        status: 'open',
      });

      expect(st.status).toBe('open');
    });
  });

  /**
   * `card_id` é o discriminador entre linha gerida pelo motor e linha exclusivamente
   * legada: só o motor grava esse campo — o `upsertStatement` do caminho V2 nem o inclui
   * no payload. Isso importa na migração, quando o motor assume uma conta que já tinha
   * histórico antigo e passa a atualizar a MESMA linha (as migrations 046 e 047
   * compartilham tabela e chave única).
   */
  describe('discriminador entre linha do motor e linha legada', () => {
    const legadoObsoleto = {
      total_charges: 500,
      total_credits: 0,
      open_amount: 500,
    };

    it('linha do motor com zero legítimo não ressuscita o total legado', () => {
      const st = mapRowToCreditCardStatement({
        ...linhaBase,
        ...legadoObsoleto,
        card_id: 'card-1',
        source_import_lot_ids: ['lot-1'],
        statement_total: 0,
        open_balance: 0,
        total_payments: 0,
      });

      expect(st.statementTotal).toBe(0);
      expect(st.openBalance).toBe(0);
    });

    it('linha do motor com valor usa as colunas novas, ignorando as legadas', () => {
      const st = mapRowToCreditCardStatement({
        ...linhaBase,
        ...legadoObsoleto,
        card_id: 'card-1',
        statement_total: 120,
        open_balance: 20,
        total_payments: 100,
      });

      expect(st.statementTotal).toBe(120);
      expect(st.openBalance).toBe(20);
    });

    it('linha sem card_id continua lendo as colunas legadas', () => {
      const st = mapRowToCreditCardStatement({
        ...linhaBase,
        ...legadoObsoleto,
        card_id: null,
        statement_total: 0,
        open_balance: 0,
        total_payments: 100,
      });

      expect(st.statementTotal).toBe(500);
      expect(st.openBalance).toBe(500);
    });
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
