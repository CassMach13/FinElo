import { describe, expect, it } from 'vitest';
import { mapRowToCreditCardStatement } from '../../src/services/creditCardEngineService';
import { creditCardRebuildFromImportHistoryService } from '../../src/services/creditCardRebuildFromImportHistoryService';
import { computeAccountCardDisplay } from '../../src/components/transactions/accountBalanceCardMetrics';
import type { Account, Transaction } from '../../src/types';

/**
 * Evidência para a decisão de rollout do motor (investigação B).
 *
 * Censo de produção que motivou estes testes:
 * - 21 statements no total, 20 com `card_id` (modernos), **1 exclusivamente legado**;
 * - nessa única linha legada: `total_charges = 0`, `total_credits = 0`,
 *   `open_amount = 0`, e **`total_payments = 7356.47`**;
 * - 4 usuários têm transações de cartão; só 1 tem `credit_cards` e statements.
 *   Os outros três (146, 125 e 4 transações) não têm nenhuma estrutura do motor.
 */

const round2 = (v: number) => Math.round(v * 100) / 100;
const LIMITE = 20000;

const conta = (over: Partial<Account> = {}): Account =>
  ({
    id: 'acc-card',
    user_id: 'u1',
    Nome_Conta: 'Cartão',
    Tipo_Conta: 'Cartão de Crédito',
    Saldo_Inicial: 0,
    Data_Saldo_Inicial: new Date('2025-01-01'),
    limite_credito: LIMITE,
    dia_fechamento: 20,
    dia_vencimento: 28,
    ...over,
  }) as Account;

let seq = 0;
const compra = (data: string, valor: number, origem = 'manual'): Transaction => {
  seq += 1;
  return {
    ID_Transacao: `c-${seq}`,
    ID_Conta: 'acc-card',
    Origem: origem,
    Data: data,
    Valor: -Math.abs(valor),
    Tipo: 'Despesa',
    Descricao_Original: `Compra ${seq}`,
    Nome_Fantasia: `Loja ${seq}`,
    Categoria: 'Compras',
  } as unknown as Transaction;
};
const pagamento = (data: string, valor: number, origem = 'manual'): Transaction => {
  seq += 1;
  return {
    ID_Transacao: `p-${seq}`,
    ID_Conta: 'acc-card',
    Origem: origem,
    Data: data,
    Valor: Math.abs(valor),
    Tipo: 'Renda',
    Descricao_Original: 'Pagamento de fatura',
    Nome_Fantasia: 'Pagamento de fatura',
    Categoria: 'Pagamento Cartão de Crédito',
  } as unknown as Transaction;
};

describe('a linha exclusivamente legada de produção (payment-only)', () => {
  /** Forma exata observada no censo: só `total_payments`, sem card_id. */
  const linhaOrfa = {
    id: 'stmt-legado',
    card_id: null,
    account_id: 'acc-antiga',
    reference_label: '2026-03',
    due_date: '2026-04-10',
    source_import_lot_ids: [],
    total_charges: 0,
    total_credits: 0,
    open_amount: 0,
    statement_total: 0,
    open_balance: 0,
    total_payments: 7356.47,
    status: 'open',
  };

  it('é lida sem inventar dívida: total zero, saldo zero', () => {
    const st = mapRowToCreditCardStatement(linhaOrfa);

    expect(st.statementTotal).toBe(0);
    expect(st.openBalance).toBe(0);
    expect(st.totalPayments).toBe(7356.47);
  });

  it('é lida como quitada, não como fatura em aberto', () => {
    const st = mapRowToCreditCardStatement(linhaOrfa);
    expect(st.status).toBe('paid');
  });

  it('sem card_id, nenhuma consulta do motor a alcança', () => {
    // `getCardStatements` filtra por `.eq('card_id', cardId)`. Uma linha com card_id
    // nulo nunca entra no resultado — este teste fixa a premissa que torna a linha
    // inofensiva durante o rollout.
    const st = mapRowToCreditCardStatement(linhaOrfa);
    expect(st.cardId).toBeNull();
  });

  it('adotada pelo motor, os totais viriam do recálculo, não da coluna antiga', () => {
    // Ao rodar para essa conta, o upsert em (user_id, account_id, reference_label)
    // encontraria a linha e gravaria card_id. A partir daí ela é gerida pelo motor e
    // as colunas novas mandam — inclusive quando valem zero.
    const adotada = mapRowToCreditCardStatement({
      ...linhaOrfa,
      card_id: 'card-novo',
      statement_total: 0,
      open_balance: 0,
      total_payments: 0,
    });

    expect(adotada.statementTotal).toBe(0);
    expect(adotada.openBalance).toBe(0);
    expect(adotada.totalPayments).toBe(0);
    // Zerada de ponta a ponta, o status gravado é preservado em vez de virar 'paid':
    // sem totais não há informação para derivar, e inventar «paga» seria pior.
    expect(adotada.status).toBe('open');
  });
});

describe('conta no formato dos usuários B/C/D: transações de cartão, nenhuma estrutura do motor', () => {
  /** ~146 transações espalhadas em 12 competências, como o usuário B. */
  function historicoRealista() {
    const txs: Transaction[] = [];
    let faturado = 0;
    let pago = 0;
    for (let mes = 1; mes <= 12; mes++) {
      const mm = String(mes).padStart(2, '0');
      for (let i = 0; i < 11; i++) {
        const valor = round2(20 + ((mes * 7 + i * 13) % 400) + i * 0.37);
        txs.push(compra(`2026-${mm}-${String(2 + i).padStart(2, '0')}`, valor));
        faturado = round2(faturado + valor);
      }
      // pagamento parcial de 70% no mês
      const totalMes = round2(
        txs
          .filter((t) => String(t.Data).slice(0, 7) === `2026-${mm}` && t.Tipo === 'Despesa')
          .reduce((a, t) => a + Math.abs(Number(t.Valor)), 0)
      );
      const p = round2(totalMes * 0.7);
      txs.push(pagamento(`2026-${mm}-25`, p));
      pago = round2(pago + p);
    }
    return { txs, faturado, pago };
  }

  it('o card já funciona hoje sem nenhuma estrutura do motor', () => {
    const { txs, faturado, pago } = historicoRealista();
    const account = conta();

    const d = computeAccountCardDisplay(account, {
      transactions: txs,
      accounts: [account],
      importLogs: [],
      cardEngineEnabled: false,
      cardV2Enabled: false,
      cardSnapshotPipelineEnabled: false,
    });

    // Oráculo: gastou − pagou = dívida; o limite utilizado é essa dívida.
    const dividaEsperada = round2(faturado - pago);
    expect(round2(LIMITE - d.limiteDisponivel)).toBe(dividaEsperada);
    expect(txs.length).toBe(144);
  });

  it('ligar o motor não muda nenhum número exibido', () => {
    const { txs } = historicoRealista();
    const account = conta();
    const base = {
      transactions: txs,
      accounts: [account],
      importLogs: [],
      cardSnapshotPipelineEnabled: false,
    };

    const semMotor = computeAccountCardDisplay(account, {
      ...base,
      cardEngineEnabled: false,
      cardV2Enabled: false,
    });
    const comMotor = computeAccountCardDisplay(account, {
      ...base,
      cardEngineEnabled: true,
      cardV2Enabled: false,
    });

    expect(comMotor).toEqual(semMotor);
  });

  it('o ledger de competência cobre todas as competências do histórico', () => {
    const { txs } = historicoRealista();
    const account = conta();

    const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: account.id,
      account,
      accounts: [account],
      transactions: txs,
      importLogs: [],
    });

    expect(cards.length).toBe(12);
    // Conservação: soma dos totais menos soma dos pagamentos = soma dos saldos.
    const totais = round2(cards.reduce((a, c) => a + c.statementTotal, 0));
    const pagos = round2(cards.reduce((a, c) => a + c.totalPayments, 0));
    const abertos = round2(cards.reduce((a, c) => a + Math.max(c.openBalance, 0), 0));
    expect(abertos).toBe(round2(totais - pagos));
  });

  it('conta com pouquíssimas transações, como o usuário D, também funciona', () => {
    const account = conta();
    const txs = [
      compra('2026-06-05', 120),
      compra('2026-06-18', 80),
      pagamento('2026-06-27', 150),
      compra('2026-07-09', 60),
    ];

    const d = computeAccountCardDisplay(account, {
      transactions: txs,
      accounts: [account],
      importLogs: [],
      cardEngineEnabled: false,
      cardV2Enabled: false,
      cardSnapshotPipelineEnabled: false,
    });

    // 200 faturados em junho, 150 pagos -> 50; julho 60. Dívida 110.
    expect(round2(LIMITE - d.limiteDisponivel)).toBe(110);
  });
});

describe('nenhum valor financeiro está preso em coluna legada', () => {
  it('linha legada só com pagamento não carrega dívida a migrar', () => {
    // Reproduz as somas do censo: charges 0, credits 0, open_amount 0.
    const st = mapRowToCreditCardStatement({
      id: 's', card_id: null, account_id: 'a', reference_label: '2026-03',
      due_date: '2026-04-10', source_import_lot_ids: [],
      total_charges: 0, total_credits: 0, open_amount: 0,
      statement_total: 0, open_balance: 0, total_payments: 7356.47, status: 'open',
    });

    const valorPresoNoLegado = round2(st.statementTotal + st.openBalance);
    expect(valorPresoNoLegado).toBe(0);
  });

  it('se houvesse dívida legada, ela seria lida — o teste anterior não é vácuo', () => {
    const comDivida = mapRowToCreditCardStatement({
      id: 's2', card_id: null, account_id: 'a', reference_label: '2026-03',
      due_date: '2026-04-10', source_import_lot_ids: [],
      total_charges: 900, total_credits: 100, open_amount: 800,
      statement_total: 0, open_balance: 0, total_payments: 0, status: 'open',
    });

    expect(comDivida.statementTotal).toBe(800);
    expect(comDivida.openBalance).toBe(800);
  });
});
