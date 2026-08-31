import { describe, expect, it } from 'vitest';
import { creditCardStatementEngine } from '../../src/domain/credit-card/creditCardStatementEngine';
import type {
  CreditCardImportEntry,
  CreditCardPayment,
  CreditCardStatement,
} from '../../src/domain/credit-card/types';

/**
 * Oráculo independente do motor.
 *
 * Estes testes NÃO reusam a implementação para calcular o esperado. Cada valor é
 * derivado aritmeticamente do enunciado do cenário, para que uma divergência acuse
 * um erro real de contabilidade e não uma tautologia.
 */

const round2 = (v: number) => Math.round(v * 100) / 100;

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${(seq += 1)}`;

function makeStatement(over: Partial<CreditCardStatement> = {}): CreditCardStatement {
  return {
    id: nextId('stmt'),
    cardId: 'card-1',
    accountId: 'acc-1',
    purchaseReferenceLabel: '2026-07',
    dueYear: 2026,
    dueMonth: 7,
    dueDate: '2026-07-10',
    closingDate: '2026-07-03',
    status: 'open',
    sourceImportLotIds: [],
    totalPurchases: 0,
    totalFees: 0,
    totalInterest: 0,
    totalRefunds: 0,
    statementTotal: 0,
    totalPayments: 0,
    openBalance: 0,
    ...over,
  };
}

let rowSeq = 0;
function purchase(statementId: string, amount: number, postedDate = '2026-06-15'): CreditCardImportEntry {
  rowSeq += 1;
  return {
    statementId,
    sourceRowIndex: rowSeq,
    postedDate,
    description: `Compra ${rowSeq}`,
    amount: -Math.abs(amount),
    sourceRowHash: `h-${rowSeq}`,
    descriptionNormalized: `compra ${rowSeq}`,
    direction: 'debit',
    absAmount: Math.abs(amount),
    entryType: 'purchase',
    classificationSource: 'system',
    classificationConfidence: 1,
    sourceFileName: 'fatura.csv',
  } as CreditCardImportEntry;
}

function payment(statementId: string, amount: number, paymentDate = '2026-07-05'): CreditCardPayment {
  return {
    cardId: 'card-1',
    statementId,
    paymentDate,
    amount: Math.abs(amount),
    source: 'manual',
  };
}

describe('oráculo: fatura com pagamentos parciais', () => {
  it('pagamento parcial único deixa exatamente o restante em aberto', () => {
    const st = makeStatement();
    const entries = [purchase(st.id, 300), purchase(st.id, 200)];
    const payments = [payment(st.id, 180)];

    // Oráculo: 300 + 200 = 500 de compras; 180 pagos; restam 320.
    const esperadoTotal = 500;
    const esperadoPago = 180;
    const esperadoAberto = 320;

    const r = creditCardStatementEngine.recalculateStatement({ statement: st, entries, payments });

    expect(r.statementTotal).toBe(esperadoTotal);
    expect(r.totalPayments).toBe(esperadoPago);
    expect(r.openBalance).toBe(esperadoAberto);
    expect(r.status).toBe('partial');
  });

  it('vários pagamentos parciais da mesma fatura somam corretamente', () => {
    const st = makeStatement();
    const entries = [purchase(st.id, 1000)];
    const payments = [
      payment(st.id, 250, '2026-07-02'),
      payment(st.id, 250, '2026-07-05'),
      payment(st.id, 100, '2026-07-09'),
    ];

    // Oráculo: 1000 de compras; 250+250+100 = 600 pagos; restam 400.
    const r = creditCardStatementEngine.recalculateStatement({ statement: st, entries, payments });

    expect(r.statementTotal).toBe(1000);
    expect(r.totalPayments).toBe(600);
    expect(r.openBalance).toBe(400);
    expect(r.status).toBe('partial');
  });

  it('pagamentos parciais que somam o total exato quitam a fatura', () => {
    const st = makeStatement();
    const entries = [purchase(st.id, 750.5)];
    const payments = [payment(st.id, 500), payment(st.id, 250.5)];

    const r = creditCardStatementEngine.recalculateStatement({ statement: st, entries, payments });

    expect(r.statementTotal).toBe(750.5);
    expect(r.totalPayments).toBe(750.5);
    expect(r.openBalance).toBe(0);
    expect(r.status).toBe('paid');
  });

  it('novos gastos após um pagamento parcial voltam a abrir saldo', () => {
    const st = makeStatement();
    // 500 de compras, 500 pagos (quitada), depois entra mais 120 de compra.
    const entries = [purchase(st.id, 500), purchase(st.id, 120, '2026-07-01')];
    const payments = [payment(st.id, 500, '2026-06-30')];

    // Oráculo: total 620; pago 500; aberto 120.
    const r = creditCardStatementEngine.recalculateStatement({ statement: st, entries, payments });

    expect(r.statementTotal).toBe(620);
    expect(r.totalPayments).toBe(500);
    expect(r.openBalance).toBe(120);
    expect(r.status).toBe('partial');
  });
});

describe('oráculo: pagamento a maior (excesso)', () => {
  it('não pode engolir silenciosamente o excesso pago', () => {
    const st = makeStatement();
    const entries = [purchase(st.id, 800)];
    const payments = [payment(st.id, 1000)];

    // Oráculo: fatura de 800, pagos 1000. O excesso é de 200.
    // O saldo em aberto é 0, mas os 200 precisam continuar rastreáveis em algum lugar:
    // ou como openBalance negativo (crédito), ou preservados em totalPayments.
    const r = creditCardStatementEngine.recalculateStatement({ statement: st, entries, payments });

    expect(r.statementTotal).toBe(800);
    // totalPayments precisa preservar o que de fato foi pago, senão o dinheiro some.
    expect(r.totalPayments).toBe(1000);

    const excedente = round2(r.totalPayments - r.statementTotal);
    expect(excedente).toBe(200);
  });
});

describe('estorno de pagamento', () => {
  /**
   * Um pagamento não é desfeito gravando valor negativo: `credit_card_payments`
   * tem `check (amount >= 0)` (migration 047), e os dois caminhos de escrita já
   * forçam o sinal (`Math.max(0, ...)` e `Math.abs(...)`). Desfazer um pagamento
   * significa remover a linha.
   *
   * O `Math.abs` em `sumPaymentsForStatement` é, portanto, defensivo: nenhum valor
   * negativo chega até ele. Este teste fixa o comportamento realmente alcançável.
   */
  it('remover o pagamento reabre exatamente o saldo correspondente', () => {
    const st = makeStatement();
    const entries = [purchase(st.id, 500)];
    const pagoIntegral = [payment(st.id, 300), payment(st.id, 100)];

    const antes = creditCardStatementEngine.recalculateStatement({
      statement: st,
      entries,
      payments: pagoIntegral,
    });
    expect(antes.totalPayments).toBe(400);
    expect(antes.openBalance).toBe(100);

    // Estorno do pagamento de 100 = a linha deixa de existir.
    const depois = creditCardStatementEngine.recalculateStatement({
      statement: st,
      entries,
      payments: [pagoIntegral[0]],
    });
    expect(depois.totalPayments).toBe(300);
    expect(depois.openBalance).toBe(200);
  });
});

describe('oráculo: ciclos consecutivos', () => {
  it('cada ciclo mantém seu próprio saldo, sem contaminar o vizinho', () => {
    const jul = makeStatement({ dueYear: 2026, dueMonth: 7, purchaseReferenceLabel: '2026-07' });
    const ago = makeStatement({ dueYear: 2026, dueMonth: 8, purchaseReferenceLabel: '2026-08' });

    const entriesByStatement = new Map([
      [jul.id, [purchase(jul.id, 400)]],
      [ago.id, [purchase(ago.id, 250)]],
    ]);
    // Julho pago pela metade; agosto intocado.
    const payments = [payment(jul.id, 200)];

    const result = creditCardStatementEngine.recalculateCardHistory({
      statements: [jul, ago],
      entriesByStatement,
      payments,
    });

    const rJul = result.find((s) => s.id === jul.id)!;
    const rAgo = result.find((s) => s.id === ago.id)!;

    // Oráculo: julho 400 - 200 = 200 aberto; agosto 250 - 0 = 250 aberto.
    expect(rJul.statementTotal).toBe(400);
    expect(rJul.openBalance).toBe(200);
    expect(rAgo.statementTotal).toBe(250);
    expect(rAgo.openBalance).toBe(250);

    // Soma do que o cartão deve = 450. É a base do "limite utilizado".
    const totalEmAberto = round2(rJul.openBalance + rAgo.openBalance);
    expect(totalEmAberto).toBe(450);
  });

  /**
   * DIVERGÊNCIA CONHECIDA E DELIBERADAMENTE FIXADA AQUI.
   *
   * `recalculateCardHistory` trata cada fatura isoladamente e não transporta
   * excedente entre ciclos. Quem faz o carry-forward é o ledger de competência
   * (`applySequentialCreditCarryForward`), que é o caminho que alimenta a UI.
   *
   * Este motor puro só é consumido por `atomicRebuildShadow` — auditoria read-only,
   * hoje atrás de flag desligada. Enquanto essa flag não for ligada, a divergência
   * é latente. Se for ligada, a auditoria vai acusar como "diferença" todo cartão
   * com pagamento a maior, sem que exista bug de verdade.
   *
   * O teste fixa o comportamento atual para que a diferença seja uma decisão
   * visível, e não uma surpresa no dia em que a flag for ligada.
   */
  it('motor puro não transporta excedente entre ciclos (só o ledger de competência transporta)', () => {
    const jul = makeStatement({ dueYear: 2026, dueMonth: 7 });
    const ago = makeStatement({ dueYear: 2026, dueMonth: 8 });

    const entriesByStatement = new Map([
      [jul.id, [purchase(jul.id, 300)]],
      [ago.id, [purchase(ago.id, 500)]],
    ]);
    // Pagou 500 numa fatura de 300 -> 200 de crédito a favor do cliente.
    const payments = [payment(jul.id, 500)];

    const result = creditCardStatementEngine.recalculateCardHistory({
      statements: [jul, ago],
      entriesByStatement,
      payments,
    });

    const rJul = result.find((s) => s.id === jul.id)!;
    const rAgo = result.find((s) => s.id === ago.id)!;

    // Oráculo econômico: o cliente gastou 800 e pagou 500, logo deve 300.
    const dividaReal = round2(
      rJul.statementTotal + rAgo.statementTotal - rJul.totalPayments - rAgo.totalPayments
    );
    expect(dividaReal).toBe(300);

    // Comportamento atual do motor puro: o excedente de 200 em julho é truncado
    // e agosto continua devendo 500 cheios.
    const somaTruncada = round2(Math.max(rJul.openBalance, 0) + Math.max(rAgo.openBalance, 0));
    expect(rJul.openBalance).toBe(0);
    expect(rAgo.openBalance).toBe(500);
    expect(somaTruncada).toBe(500);

    // O excedente permanece rastreável em totalPayments — não some do registro.
    expect(round2(rJul.totalPayments - rJul.statementTotal)).toBe(200);
  });
});

describe('oráculo: arredondamento acumulado', () => {
  it('centenas de lançamentos com centavos não acumulam erro', () => {
    const st = makeStatement();
    const entries: CreditCardImportEntry[] = [];
    let somaExata = 0;
    for (let i = 0; i < 300; i++) {
      const valor = round2(10 + (i % 97) * 0.01);
      somaExata = round2(somaExata + valor);
      entries.push(purchase(st.id, valor));
    }

    const r = creditCardStatementEngine.recalculateStatement({ statement: st, entries, payments: [] });

    expect(r.statementTotal).toBe(somaExata);
  });

  it('muitos pagamentos pequenos somam sem deriva de ponto flutuante', () => {
    const st = makeStatement();
    const entries = [purchase(st.id, 100)];
    const payments: CreditCardPayment[] = [];
    let somaExata = 0;
    for (let i = 0; i < 100; i++) {
      const valor = 0.07;
      somaExata = round2(somaExata + valor);
      payments.push(payment(st.id, valor));
    }

    const r = creditCardStatementEngine.recalculateStatement({ statement: st, entries, payments });

    expect(r.totalPayments).toBe(somaExata);
    expect(r.openBalance).toBe(round2(100 - somaExata));
  });
});
