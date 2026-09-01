import { describe, expect, it } from 'vitest';
import { computeAccountCardDisplay } from '../../src/components/transactions/accountBalanceCardMetrics';
import type { Account, Transaction } from '../../src/types';

/**
 * Oráculo do limite do cartão, sobre a mesma função que o card em Transações usa.
 *
 * Regra: limite utilizado = soma dos saldos em aberto de todas as competências.
 * Limite disponível = limite total − limite utilizado, nunca negativo.
 */

const round2 = (v: number) => Math.round(v * 100) / 100;

const LIMITE = 10000;

const account: Account = {
  id: 'acc-card',
  Nome_Conta: 'Cartão Oráculo',
  Tipo_Conta: 'Cartão de Crédito',
  limite_credito: LIMITE,
  dia_vencimento: 10,
  dia_fechamento: 3,
  Saldo_Inicial: 0,
} as Account;

let seq = 0;

function compra(dataIso: string, valor: number): Transaction {
  seq += 1;
  return {
    ID_Transacao: `c-${seq}`,
    ID_Conta: account.id,
    Origem: 'manual',
    Data: dataIso,
    Valor: -Math.abs(valor),
    Tipo: 'Despesa',
    Descricao_Original: `Compra ${seq}`,
    Nome_Fantasia: `Loja ${seq}`,
    Categoria: 'Compras',
  } as unknown as Transaction;
}

function pagamento(dataIso: string, valor: number): Transaction {
  seq += 1;
  return {
    ID_Transacao: `p-${seq}`,
    ID_Conta: account.id,
    Origem: 'manual',
    Data: dataIso,
    Valor: Math.abs(valor),
    Tipo: 'Renda',
    Descricao_Original: 'Pagamento de fatura',
    Nome_Fantasia: 'Pagamento de fatura',
    Categoria: 'Pagamento Cartão de Crédito',
  } as unknown as Transaction;
}

function display(transactions: Transaction[]) {
  return computeAccountCardDisplay(account, {
    transactions,
    accounts: [account],
    importLogs: [],
    cardV2Enabled: false,
    cardEngineEnabled: false,
    cardSnapshotPipelineEnabled: false,
  });
}

describe('oráculo: limite utilizado e disponível', () => {
  it('sem lançamentos, o limite está inteiro disponível', () => {
    const d = display([]);
    expect(d.limite).toBe(LIMITE);
    expect(d.limiteDisponivel).toBe(LIMITE);
    expect(d.limiteUsadoPct).toBe(0);
  });

  it('compras não pagas consomem exatamente o seu valor do limite', () => {
    const d = display([compra('2026-07-05', 1500), compra('2026-07-20', 500)]);

    // Oráculo: 2000 em aberto -> 8000 disponíveis -> 20% usado.
    expect(d.limiteDisponivel).toBe(round2(LIMITE - 2000));
    expect(round2(d.limiteUsadoPct)).toBe(20);
  });

  it('pagamento parcial devolve ao limite exatamente o que foi pago', () => {
    const d = display([
      compra('2026-07-05', 2000),
      pagamento('2026-07-25', 750),
    ]);

    // Oráculo: 2000 − 750 = 1250 em aberto -> 8750 disponíveis.
    expect(d.limiteDisponivel).toBe(round2(LIMITE - 1250));
  });

  it('fatura quitada devolve o limite inteiro', () => {
    const d = display([compra('2026-07-05', 3000), pagamento('2026-07-25', 3000)]);
    expect(d.limiteDisponivel).toBe(LIMITE);
    expect(d.limiteUsadoPct).toBe(0);
  });

  it('pagamento a maior não pode reduzir o limite disponível abaixo do devido', () => {
    // Junho: fatura 1000, pagos 1500 (500 a mais). Julho: fatura 800.
    const d = display([
      compra('2026-06-05', 1000),
      pagamento('2026-06-25', 1500),
      compra('2026-07-05', 800),
    ]);

    // Oráculo: gastou 1800, pagou 1500, deve 300 -> 9700 disponíveis.
    expect(d.limiteDisponivel).toBe(round2(LIMITE - 300));
  });

  it('limite disponível nunca fica negativo, mesmo estourando o limite', () => {
    const d = display([compra('2026-07-05', LIMITE + 2500)]);

    expect(d.limiteDisponivel).toBe(0);
    expect(d.limiteUsadoPct).toBe(100);
  });

  it('vários ciclos em aberto somam no limite utilizado', () => {
    const d = display([
      compra('2026-05-05', 300),
      compra('2026-06-05', 400),
      compra('2026-07-05', 500),
    ]);

    // Oráculo: 300 + 400 + 500 = 1200 em aberto.
    expect(d.limiteDisponivel).toBe(round2(LIMITE - 1200));
  });

  it('conservação: disponível + utilizado = limite total, em cenário misto', () => {
    const d = display([
      compra('2026-05-05', 1234.56),
      pagamento('2026-05-28', 1000),
      compra('2026-06-05', 789.01),
      pagamento('2026-06-28', 500),
      compra('2026-07-05', 321.99),
    ]);

    // Oráculo: faturado 2345,56; pago 1500; devido 845,56.
    const devido = round2(1234.56 + 789.01 + 321.99 - 1500);
    expect(devido).toBe(845.56);
    expect(d.limiteDisponivel).toBe(round2(LIMITE - devido));
    expect(round2(d.limiteDisponivel + devido)).toBe(LIMITE);
  });
});
