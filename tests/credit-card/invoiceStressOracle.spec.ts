import { describe, expect, it } from 'vitest';
import { creditCardRebuildFromImportHistoryService } from '../../src/services/creditCardRebuildFromImportHistoryService';
import type { CompetenceHistoryCard } from '../../src/services/creditCardRebuildFromImportHistoryService';
import type { Account, Transaction } from '../../src/types';

/**
 * Estresse e combinatória sobre o caminho vivo (`competenceHistoryCardsForAccount`),
 * que é o mesmo que alimenta o card do cartão e a aba Transações.
 *
 * Cada expectativa é derivada da aritmética do cenário montado no próprio teste,
 * nunca de uma segunda chamada à implementação.
 */

const round2 = (v: number) => Math.round(v * 100) / 100;

const account: Account = {
  id: 'acc-card',
  Nome_Conta: 'Cartão Estresse',
  Tipo_Conta: 'Cartão de Crédito',
  dia_vencimento: 10,
  limite_credito: 50000,
} as Account;

let txSeq = 0;

function compraManual(dataIso: string, valor: number): Transaction {
  txSeq += 1;
  return {
    ID_Transacao: `m-${txSeq}`,
    ID_Conta: account.id,
    Origem: 'manual',
    Data: dataIso,
    Valor: -Math.abs(valor),
    Tipo: 'Despesa',
    Descricao_Original: `Compra manual ${txSeq}`,
    Nome_Fantasia: `Loja ${txSeq}`,
    Categoria: 'Compras',
  } as unknown as Transaction;
}

function compraImportada(dataIso: string, valor: number, arquivo: string): Transaction {
  txSeq += 1;
  return {
    ID_Transacao: `i-${txSeq}`,
    ID_Conta: account.id,
    Origem: arquivo,
    Data: dataIso,
    Valor: -Math.abs(valor),
    Tipo: 'Despesa',
    Descricao_Original: `Compra importada ${txSeq}`,
  } as unknown as Transaction;
}

/** Pagamento manual de fatura, direcionado pela Data_Pagamento no dia do vencimento. */
function pagamentoManual(dataIso: string, valor: number): Transaction {
  txSeq += 1;
  return {
    ID_Transacao: `p-${txSeq}`,
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

function importLog(arquivo: string, referenceMonth: string, dueDate: string) {
  return {
    id: `log-${arquivo}`,
    file_name: arquivo,
    imported_details: [{ ID_Conta: account.id, Card_Reference_Label: referenceMonth, Card_Due_Date: dueDate }],
  } as any;
}

function build(transactions: Transaction[], importLogs: any[] = []): CompetenceHistoryCard[] {
  return creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
    accountId: account.id,
    account,
    accounts: [account],
    transactions,
    importLogs,
  });
}

const byRef = (cards: CompetenceHistoryCard[], ref: string) =>
  cards.find((c) => c.referenceMonth === ref);

/** Invariante global: gastou − pagou = soma dos saldos em aberto. */
function conferirConservacao(cards: CompetenceHistoryCard[]) {
  const totalFaturado = round2(cards.reduce((a, c) => a + c.statementTotal, 0));
  const totalPago = round2(cards.reduce((a, c) => a + c.totalPayments, 0));
  const totalAberto = round2(cards.reduce((a, c) => a + Math.max(c.openBalance, 0), 0));
  return { totalFaturado, totalPago, totalAberto, dividaEsperada: round2(totalFaturado - totalPago) };
}

describe('estresse: pagamentos parciais múltiplos na mesma competência', () => {
  it('três pagamentos parciais somam e deixam o resto exato em aberto', () => {
    const txs = [
      compraManual('2026-07-03', 1000),
      compraManual('2026-07-14', 500),
      pagamentoManual('2026-07-20', 300),
      pagamentoManual('2026-07-25', 200),
      pagamentoManual('2026-07-28', 150),
    ];

    const cards = build(txs);
    const jul = byRef(cards, '2026-07')!;

    // Oráculo: compras 1000+500 = 1500; pagamentos 300+200+150 = 650; aberto 850.
    expect(jul.statementTotal).toBe(1500);
    expect(jul.totalPayments).toBe(650);
    expect(jul.openBalance).toBe(850);
  });

  it('novo gasto depois de quitar reabre a fatura pelo valor exato do gasto', () => {
    const txs = [
      compraManual('2026-07-03', 400),
      pagamentoManual('2026-07-10', 400),
      compraManual('2026-07-22', 75.5),
    ];

    const cards = build(txs);
    const jul = byRef(cards, '2026-07')!;

    // Oráculo: 400 + 75,50 = 475,50 faturado; 400 pago; 75,50 aberto.
    expect(jul.statementTotal).toBe(475.5);
    expect(jul.totalPayments).toBe(400);
    expect(jul.openBalance).toBe(75.5);
  });
});

describe('estresse: mistura de lançamentos manuais e fatura importada', () => {
  it('manual e importado na mesma competência somam sem se anular', () => {
    const arquivo = 'fatura_julho.csv';
    const txs = [
      compraImportada('2026-07-05', 800, arquivo),
      compraImportada('2026-07-08', 200, arquivo),
      compraManual('2026-07-12', 150),
      compraManual('2026-07-19', 50),
    ];

    const cards = build(txs, [importLog(arquivo, '2026-07', '2026-08-10')]);
    const jul = byRef(cards, '2026-07')!;

    // Oráculo: 800 + 200 + 150 + 50 = 1200.
    expect(jul.statementTotal).toBe(1200);
    expect(jul.openBalance).toBe(1200);
  });

  it('estorno manual abate a fatura importada da mesma competência', () => {
    const arquivo = 'fatura_julho.csv';
    const estorno = {
      ID_Transacao: 'est-1',
      ID_Conta: account.id,
      Origem: 'manual',
      Data: '2026-07-20',
      Valor: 120,
      Tipo: 'Renda',
      Descricao_Original: 'Estorno compra duplicada',
      Nome_Fantasia: 'Estorno',
      Categoria: 'Estorno',
    } as unknown as Transaction;

    const txs = [compraImportada('2026-07-05', 1000, arquivo), estorno];
    const cards = build(txs, [importLog(arquivo, '2026-07', '2026-08-10')]);
    const jul = byRef(cards, '2026-07')!;

    // Oráculo: 1000 de compra − 120 de estorno = 880.
    expect(jul.totalDebits).toBe(1000);
    expect(jul.totalRefunds).toBe(120);
    expect(jul.statementTotal).toBe(880);
  });
});

describe('estresse: doze ciclos consecutivos sem erro cumulativo', () => {
  it('conserva gastou − pagou = em aberto ao longo de 12 meses', () => {
    const txs: Transaction[] = [];
    let faturadoEsperado = 0;
    let pagoEsperado = 0;

    for (let mes = 1; mes <= 12; mes++) {
      const mm = String(mes).padStart(2, '0');
      // Três compras e um pagamento parcial de 60% por mês.
      const compras = [123.45, 67.89, 10.11];
      compras.forEach((v, i) => {
        txs.push(compraManual(`2026-${mm}-${String(3 + i * 5).padStart(2, '0')}`, v));
        faturadoEsperado = round2(faturadoEsperado + v);
      });
      const totalMes = round2(compras.reduce((a, b) => a + b, 0));
      const pagamento = round2(totalMes * 0.6);
      txs.push(pagamentoManual(`2026-${mm}-25`, pagamento));
      pagoEsperado = round2(pagoEsperado + pagamento);
    }

    const cards = build(txs);
    const c = conferirConservacao(cards);

    expect(c.totalFaturado).toBe(faturadoEsperado);
    expect(c.totalPago).toBe(pagoEsperado);
    // Sem excedente em nenhum mês, o aberto tem de bater exatamente com a dívida.
    expect(c.totalAberto).toBe(c.dividaEsperada);
  });

  it('excedente em um mês reduz a dívida total, sem sumir nem duplicar', () => {
    const txs = [
      compraManual('2026-03-05', 200),
      pagamentoManual('2026-03-20', 500), // 300 a mais
      compraManual('2026-04-05', 100),
      compraManual('2026-05-05', 400),
    ];

    const cards = build(txs);
    const c = conferirConservacao(cards);

    // Oráculo: faturado 700, pago 500, dívida 200.
    expect(c.totalFaturado).toBe(700);
    expect(c.totalPago).toBe(500);
    expect(c.totalAberto).toBe(200);
    expect(c.totalAberto).toBe(c.dividaEsperada);
  });
});

describe('estresse: volume alto', () => {
  it('300 lançamentos com centavos não acumulam erro de arredondamento', () => {
    const txs: Transaction[] = [];
    let esperado = 0;
    for (let i = 0; i < 300; i++) {
      const dia = String((i % 27) + 1).padStart(2, '0');
      const valor = round2(3 + (i % 89) * 0.01);
      txs.push(compraManual(`2026-06-${dia}`, valor));
      esperado = round2(esperado + valor);
    }

    const cards = build(txs);
    const jun = byRef(cards, '2026-06')!;

    expect(jun.statementTotal).toBe(esperado);
    expect(jun.openBalance).toBe(esperado);
  });

  it('muitos pagamentos pequenos somam sem deriva', () => {
    const txs: Transaction[] = [compraManual('2026-06-01', 100)];
    let pagoEsperado = 0;
    for (let i = 0; i < 90; i++) {
      const dia = String((i % 27) + 1).padStart(2, '0');
      txs.push(pagamentoManual(`2026-06-${dia}`, 0.33));
      pagoEsperado = round2(pagoEsperado + 0.33);
    }

    const cards = build(txs);
    const jun = byRef(cards, '2026-06')!;

    expect(jun.totalPayments).toBe(pagoEsperado);
    expect(jun.openBalance).toBe(round2(100 - pagoEsperado));
  });
});

describe('estresse: datas de borda', () => {
  it('compra no primeiro e no último dia do mês ficam na mesma competência', () => {
    const txs = [compraManual('2026-07-01', 10), compraManual('2026-07-31', 20)];
    const cards = build(txs);
    const jul = byRef(cards, '2026-07')!;
    expect(jul.statementTotal).toBe(30);
    expect(cards.filter((c) => c.statementTotal > 0)).toHaveLength(1);
  });

  it('virada de ano separa dezembro de janeiro', () => {
    const txs = [compraManual('2026-12-31', 111), compraManual('2027-01-01', 222)];
    const cards = build(txs);
    expect(byRef(cards, '2026-12')!.statementTotal).toBe(111);
    expect(byRef(cards, '2027-01')!.statementTotal).toBe(222);
  });

  it('fevereiro de ano bissexto aceita o dia 29', () => {
    const txs = [compraManual('2028-02-29', 55)];
    const cards = build(txs);
    expect(byRef(cards, '2028-02')!.statementTotal).toBe(55);
  });
});
