import { describe, expect, it } from 'vitest';
import {
  creditCardRebuildFromImportHistoryService as svc,
  importedPaymentAllocationsByTransaction,
} from '../../src/services/creditCardRebuildFromImportHistoryService';
import { projectCardTwoLedger } from '../../src/domain/credit-card/twoLedgerProjection';
import {
  referenceMonthFromTransaction,
  inferUserTargetCompetenceOnPaymentEdit,
  paymentIsoLooksLikeCardDueDate,
} from '../../src/services/creditCardManualCompetence';
import {
  effectiveDueDateIso,
  nominalDueDateForPaidOn,
} from '../../src/domain/credit-card/dueDate';
import type { Account, Transaction } from '../../src/types';

/**
 * Pagamentos parciais, antecipados e históricos no cartão.
 *
 * Caso de origem (dados sintéticos com a mesma forma): cartão que fecha no 11 e
 * vence no 18, cliente que paga a fatura em várias parcelas — parte antes do
 * vencimento da fatura anterior e parte depois. Dois defeitos:
 *
 *  1. Todo pagamento importado no arquivo N ia para a competência N−1, qualquer
 *     que fosse a data. Pagamento feito depois do vencimento de N−1 é
 *     antecipação de N: mandá-lo para N−1 inflava N−1 (excedente) e deixava N
 *     sem pagamento. No primeiro arquivo, N−1 nem existe — o dinheiro sumia.
 *  2. Vencimento em fim de semana é pago na segunda. A segunda-feira não era
 *     reconhecida como vencimento, e a compra ia para a competência seguinte.
 *
 * Todos os valores em centavos inteiros: nada de tolerância.
 */

const ACC = 'card-nu';
const conta: Account = {
  id: ACC,
  Nome_Conta: 'Cartão Nubank',
  Tipo_Conta: 'Cartão de Crédito',
  dia_fechamento: 11,
  dia_vencimento: 18,
  limite_credito: 20000,
} as Account;

let seq = 0;
const compraImportada = (file: string, data: string, valor: number, desc = 'Compra'): Transaction =>
  ({
    ID_Transacao: `c${++seq}`, ID_Conta: ACC, Origem: file, Data: data, Valor: -Math.abs(valor),
    Tipo: 'Despesa', Descricao_Original: `${desc} ${seq}`, Nome_Fantasia: `${desc} ${seq}`,
  }) as unknown as Transaction;

const pagamentoImportado = (file: string, data: string, valor: number, id?: string): Transaction =>
  ({
    ID_Transacao: id ?? `p${++seq}`, ID_Conta: ACC, Origem: file, Data: data, Valor: Math.abs(valor),
    Tipo: 'Renda', Descricao_Original: 'Pagamento recebido', Nome_Fantasia: 'Pagamento recebido',
    Categoria: 'Pagamento Cartão de Crédito',
  }) as unknown as Transaction;

const estornoImportado = (file: string, data: string, valor: number): Transaction =>
  ({
    ID_Transacao: `e${++seq}`, ID_Conta: ACC, Origem: file, Data: data, Valor: Math.abs(valor),
    Tipo: 'Renda', Descricao_Original: `Estorno de compra ${seq}`, Nome_Fantasia: 'Estorno',
  }) as unknown as Transaction;

const log = (file: string, ref: string, due: string) =>
  ({ id: `log-${file}`, file_name: file, imported_details: [{ ID_Conta: ACC, Card_Reference_Label: ref, Card_Due_Date: due }] }) as any;

const manual = (over: Record<string, unknown>): Transaction =>
  ({ ID_Conta: ACC, Origem: 'manual', ...over }) as unknown as Transaction;

const compraManual = (id: string, data: string, vencimento: string, valor: number, desc = `Compra ${id}`) =>
  manual({ ID_Transacao: id, Tipo: 'Despesa', Data: data, Data_Pagamento: vencimento, Valor: -Math.abs(valor), Nome_Fantasia: desc, Categoria: 'Compras', Descricao_Original: desc });

const pagamentoDirigido = (id: string, data: string, ref: string, valor: number) =>
  manual({
    ID_Transacao: id, Tipo: 'Renda', Data: data, Data_Pagamento: data, Valor: Math.abs(valor),
    Nome_Fantasia: 'Pagamento de Fatura', Categoria: 'Pagamento de Fatura',
    Descricao_Original: `Pagamento de Fatura (${ref}) finelo_competence:${ref}`,
  });

function projetar(transactions: Transaction[], importLogs: any[] = [], asOf = '2026-11-02', confirmations: any[] = []) {
  const snapshot = JSON.stringify({ transactions, importLogs });
  const cards = svc.competenceHistoryCardsForAccount({
    accountId: ACC, account: conta, accounts: [conta], transactions, importLogs, userPaymentConfirmations: confirmations,
  });
  const p = projectCardTwoLedger(cards, { asOf });
  // Integridade: o cálculo nunca altera os lançamentos de entrada.
  expect(JSON.stringify({ transactions, importLogs })).toBe(snapshot);
  const mes = (ref: string) => p.competences.find((c) => c.referenceMonth === ref);
  const card = (ref: string) => cards.find((c) => c.referenceMonth === ref);
  return { cards, p, mes, card };
}

/** Σ pagamentos reconhecidos = Σ pagamentos lançados + confirmações. Cada centavo uma vez. */
function expectConservacao(transactions: Transaction[], p: ReturnType<typeof projectCardTwoLedger>, confirmacoesCents = 0) {
  const pagos = transactions
    .filter((t) => t.Tipo === 'Renda' && /pagamento/i.test(String(t.Descricao_Original)))
    .reduce((s, t) => s + Math.round(Number(t.Valor) * 100), 0);
  const reconhecidos = p.competences.reduce((s, c) => s + c.recognizedPaymentsCents, 0);
  expect(reconhecidos).toBe(pagos + confirmacoesCents);
}

// ---------------------------------------------------------------------------
// Datas de vencimento
// ---------------------------------------------------------------------------

describe('vencimento efetivo e prazo do pagamento em dia', () => {
  it('vencimento em dia útil é o próprio dia', () => {
    expect(effectiveDueDateIso('2026-02-18')).toBe('2026-02-18'); // quarta
  });

  it('sábado e domingo passam para a segunda', () => {
    expect(effectiveDueDateIso('2026-07-18')).toBe('2026-07-20'); // sábado
    expect(effectiveDueDateIso('2026-10-18')).toBe('2026-10-19'); // domingo
    expect(effectiveDueDateIso('2026-10-31')).toBe('2026-11-02'); // sábado, vira o mês
  });

  it('data inválida volta como veio, sem inventar vencimento', () => {
    expect(effectiveDueDateIso('lixo')).toBe('lixo');
    expect(effectiveDueDateIso('2026-02-30')).toBe('2026-02-30');
  });

  it('reconhece a segunda-feira que substitui o vencimento e devolve o vencimento NOMINAL', () => {
    expect(nominalDueDateForPaidOn('2026-10-19', 18)).toBe('2026-10-18');
    expect(nominalDueDateForPaidOn('2026-07-20', 18)).toBe('2026-07-18');
    expect(nominalDueDateForPaidOn('2026-11-02', 31)).toBe('2026-10-31');
    expect(nominalDueDateForPaidOn('2026-10-18', 18)).toBe('2026-10-18');
    expect(nominalDueDateForPaidOn('2026-10-19', 17)).toBe('2026-10-17'); // sábado 17 → segunda 19
  });

  it('segunda-feira comum não é vencimento', () => {
    expect(nominalDueDateForPaidOn('2026-10-20', 18)).toBeNull(); // terça
    expect(nominalDueDateForPaidOn('2026-09-21', 18)).toBeNull(); // 18/09 foi sexta
    expect(nominalDueDateForPaidOn('2026-02-30', 18)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Competência de compras manuais com vencimento no fim de semana
// ---------------------------------------------------------------------------

describe('compra manual com vencimento deslocado pelo fim de semana', () => {
  it('Data_Pagamento 19/10 (domingo 18/10) → competência 2026-09', () => {
    expect(referenceMonthFromTransaction(compraManual('a', '2026-09-20', '2026-10-19', 100), conta)).toBe('2026-09');
  });

  it('Data_Pagamento 20/07 (sábado 18/07) → competência 2026-06', () => {
    expect(referenceMonthFromTransaction(compraManual('b', '2026-06-25', '2026-07-20', 100), conta)).toBe('2026-06');
  });

  it('Data_Pagamento 18/10 (o próprio vencimento) → 2026-09', () => {
    expect(referenceMonthFromTransaction(compraManual('c', '2026-09-20', '2026-10-18', 100), conta)).toBe('2026-09');
  });

  it('Data_Pagamento 20/10 (terça, não é vencimento) → mês do pagamento, 2026-10', () => {
    expect(referenceMonthFromTransaction(compraManual('d', '2026-10-15', '2026-10-20', 100), conta)).toBe('2026-10');
  });

  it('vencimento dia 31 num sábado, pago em 02/11 → competência 2026-09, não 2026-10', () => {
    const conta31 = { ...conta, dia_vencimento: 31 } as Account;
    expect(inferUserTargetCompetenceOnPaymentEdit('2026-11-02', '2026-10-01', conta31)).toBe('2026-09');
  });

  it('o formulário grava o mesmo que a leitura deriva', () => {
    expect(inferUserTargetCompetenceOnPaymentEdit('2026-10-19', '2026-09-20', conta)).toBe('2026-09');
    expect(inferUserTargetCompetenceOnPaymentEdit('2026-07-20', '2026-06-25', conta)).toBe('2026-06');
    expect(paymentIsoLooksLikeCardDueDate('2026-10-19', conta)).toBe(true);
    expect(paymentIsoLooksLikeCardDueDate('2026-10-20', conta)).toBe(false);
  });

  it('marcador explícito do usuário prevalece sobre a data', () => {
    const t = compraManual('e', '2026-09-20', '2026-10-19', 100, 'Compra marcada (2026-10) finelo_competence:2026-10');
    expect(referenceMonthFromTransaction(t, conta)).toBe('2026-10');
  });

  it('fatura inteira com vencimento 19/10 fica numa competência só, ao lado da de 18/11', () => {
    const { mes } = projetar([
      compraManual('o1', '2026-09-15', '2026-10-19', 1000),
      compraManual('o2', '2026-10-05', '2026-10-19', 500.55),
      compraManual('n1', '2026-10-15', '2026-11-18', 300.1),
    ]);
    expect(mes('2026-09')?.statementTotalCents).toBe(150055);
    expect(mes('2026-10')?.statementTotalCents).toBe(30010);
  });
});

// ---------------------------------------------------------------------------
// Pagamentos importados
// ---------------------------------------------------------------------------

/**
 * Quatro faturas importadas (fecha 11, vence 18):
 *  A  ref 2026-01  vence 18/02  total 3.069,86  — pagos 900 (03/02) + 669,86 (09/02) + 1.500 (18/02)
 *  B  ref 2026-02  vence 18/03  total 3.335,22  — pago 3.335,22 (11/03)
 *  C  ref 2026-03  vence 18/04  total 1.000,00  — pagos 400 (26/03) + 600 (16/04)
 *  D  ref 2026-04  vence 18/05  total   700,00  — sem pagamento ainda (asOf 10/05)
 *
 * Cada extrato mostra os pagamentos lançados no SEU período: os de 03/02 e
 * 09/02 aparecem no extrato A (é antecipação de A, cuja anterior venceu em
 * 18/01); o de 18/02 aparece no extrato B (é o pagamento em dia de A).
 */
function cadeiaAntecipada() {
  const fa = 'Nubank_2026-02-18.csv';
  const fb = 'Nubank_2026-03-18.csv';
  const fc = 'Nubank_2026-04-18.csv';
  const fd = 'Nubank_2026-05-18.csv';
  const tx: Transaction[] = [
    compraImportada(fa, '2026-01-15', 3069.86),
    pagamentoImportado(fa, '2026-02-03', 900, 'pA1'),
    pagamentoImportado(fa, '2026-02-09', 669.86, 'pA2'),
    compraImportada(fb, '2026-02-20', 3335.22),
    pagamentoImportado(fb, '2026-02-18', 1500, 'pA3'),
    pagamentoImportado(fb, '2026-03-11', 3335.22, 'pB1'),
    compraImportada(fc, '2026-03-20', 1000),
    pagamentoImportado(fc, '2026-03-26', 400, 'pC1'),
    compraImportada(fd, '2026-04-20', 700),
    pagamentoImportado(fd, '2026-04-16', 600, 'pC2'),
  ];
  const logs = [
    log(fa, '2026-01', '2026-02-18'),
    log(fb, '2026-02', '2026-03-18'),
    log(fc, '2026-03', '2026-04-18'),
    log(fd, '2026-04', '2026-05-18'),
  ];
  return { tx, logs };
}

describe('pagamentos parciais importados', () => {
  it('antecipações e parciais quitam cada fatura exatamente, sem fantasma e sem excedente', () => {
    const { tx, logs } = cadeiaAntecipada();
    const { p, mes } = projetar(tx, logs, '2026-05-10');

    expect(mes('2025-12')).toBeUndefined();
    expect(mes('2026-01')?.recognizedPaymentsCents).toBe(306986);
    expect(mes('2026-01')?.economicOpenBalanceCents).toBe(0);
    expect(mes('2026-02')?.recognizedPaymentsCents).toBe(333522);
    expect(mes('2026-02')?.economicOpenBalanceCents).toBe(0);
    expect(mes('2026-03')?.recognizedPaymentsCents).toBe(100000);
    expect(mes('2026-03')?.economicOpenBalanceCents).toBe(0);
    expect(mes('2026-04')?.recognizedPaymentsCents).toBe(0);
    expect(mes('2026-04')?.economicOpenBalanceCents).toBe(70000);
    expect(mes('2026-04')?.economicStatus).toBe('open');

    expect(p.suspenseBalanceCents).toBe(0);
    expect(p.reconciliationPending).toBe(false);
    expect(p.economicUsedCents).toBe(70000);
    expect(p.competences.every((c) => c.unresolvedReconciliationDeltaCents === 0)).toBe(true);
    expectConservacao(tx, p);
  });

  it('cada pagamento é contado uma vez e o destino de cada um é rastreável', () => {
    const { tx, logs } = cadeiaAntecipada();
    const { cards } = projetar(tx, logs, '2026-05-10');
    const idx = importedPaymentAllocationsByTransaction(cards);

    const destino = (id: string) => (idx.get(id) || []).map((a) => [a.referenceMonth, Math.round(a.amount * 100)]);
    expect(destino('pA1')).toEqual([['2026-01', 90000]]);
    expect(destino('pA2')).toEqual([['2026-01', 66986]]);
    expect(destino('pA3')).toEqual([['2026-01', 150000]]); // em dia: vai para N−1
    expect(destino('pB1')).toEqual([['2026-02', 333522]]);
    expect(destino('pC1')).toEqual([['2026-03', 40000]]);
    expect(destino('pC2')).toEqual([['2026-03', 60000]]); // em dia, no extrato seguinte
  });

  it('pagamento depois do vencimento completa a anterior e o resto abate a atual', () => {
    const fa = 'X_jan.csv';
    const fb = 'X_fev.csv';
    const tx = [
      compraImportada(fa, '2026-01-10', 1000),
      compraImportada(fb, '2026-02-10', 800),
      pagamentoImportado(fb, '2026-02-18', 600, 'em-dia'), // anterior vence 18/02
      pagamentoImportado(fb, '2026-03-02', 600, 'atrasado'), // 400 completam jan, 200 abatem fev
    ];
    const logs = [log(fa, '2026-01', '2026-02-18'), log(fb, '2026-02', '2026-03-18')];
    const { p, mes, cards } = projetar(tx, logs, '2026-03-05');

    expect(mes('2026-01')?.recognizedPaymentsCents).toBe(100000);
    expect(mes('2026-01')?.economicOpenBalanceCents).toBe(0);
    expect(mes('2026-02')?.recognizedPaymentsCents).toBe(20000);
    expect(mes('2026-02')?.economicOpenBalanceCents).toBe(60000);

    const idx = importedPaymentAllocationsByTransaction(cards);
    expect((idx.get('atrasado') || []).map((a) => [a.referenceMonth, Math.round(a.amount * 100)]))
      .toEqual([['2026-01', 40000], ['2026-02', 20000]]);
    expect(p.suspenseBalanceCents).toBe(0);
    expectConservacao(tx, p);
  });

  it('pagamentos atrasados em datas diferentes são somados na ordem cronológica', () => {
    const fa = 'Y_jan.csv';
    const fb = 'Y_fev.csv';
    const tx = [
      compraImportada(fa, '2026-01-10', 1000),
      compraImportada(fb, '2026-02-10', 500),
      pagamentoImportado(fb, '2026-03-05', 300, 'p2'),
      pagamentoImportado(fb, '2026-02-25', 800, 'p1'),
    ];
    const logs = [log(fa, '2026-01', '2026-02-18'), log(fb, '2026-02', '2026-03-18')];
    const { mes, cards } = projetar(tx, logs, '2026-03-10');
    const idx = importedPaymentAllocationsByTransaction(cards);

    expect((idx.get('p1') || []).map((a) => [a.referenceMonth, Math.round(a.amount * 100)])).toEqual([['2026-01', 80000]]);
    expect((idx.get('p2') || []).map((a) => [a.referenceMonth, Math.round(a.amount * 100)]))
      .toEqual([['2026-01', 20000], ['2026-02', 10000]]);
    expect(mes('2026-01')?.economicOpenBalanceCents).toBe(0);
    expect(mes('2026-02')?.economicOpenBalanceCents).toBe(40000);
  });

  it('pagamento em dia acima da fatura fica no livro 2 — não vira crédito da próxima', () => {
    const fa = 'Z_jan.csv';
    const fb = 'Z_fev.csv';
    const tx = [
      compraImportada(fa, '2026-01-10', 1000),
      compraImportada(fb, '2026-02-10', 500),
      pagamentoImportado(fb, '2026-02-18', 1250, 'over'),
    ];
    const logs = [log(fa, '2026-01', '2026-02-18'), log(fb, '2026-02', '2026-03-18')];
    const { p, mes } = projetar(tx, logs, '2026-03-01');

    expect(mes('2026-01')?.recognizedPaymentsCents).toBe(125000);
    expect(mes('2026-01')?.economicOpenBalanceCents).toBe(0);
    expect(mes('2026-02')?.economicOpenBalanceCents).toBe(50000);
    expect(p.suspenseBalanceCents).toBe(25000);
    expect(p.economicUsedCents).toBe(50000);
    expectConservacao(tx, p);
  });

  it('pagamento atrasado acima de tudo: o excedente sobra na atual, sem sumir', () => {
    const fa = 'W_jan.csv';
    const fb = 'W_fev.csv';
    const tx = [
      compraImportada(fa, '2026-01-10', 1000),
      compraImportada(fb, '2026-02-10', 500),
      pagamentoImportado(fb, '2026-02-25', 1700, 'big'),
    ];
    const logs = [log(fa, '2026-01', '2026-02-18'), log(fb, '2026-02', '2026-03-18')];
    const { p, mes } = projetar(tx, logs, '2026-03-01');
    expect(mes('2026-01')?.recognizedPaymentsCents).toBe(100000);
    expect(mes('2026-02')?.recognizedPaymentsCents).toBe(70000);
    expect(mes('2026-02')?.economicOpenBalanceCents).toBe(0);
    expectConservacao(tx, p);
  });

  it('primeiro arquivo: pagamento em dia de fatura não importada continua fantasma (sem crédito fictício)', () => {
    const fa = 'F_fev.csv';
    const tx = [
      compraImportada(fa, '2026-02-01', 900),
      pagamentoImportado(fa, '2026-01-18', 2000, 'velho'), // vencimento da fatura de dezembro
    ];
    const { p, mes } = projetar(tx, [log(fa, '2026-01', '2026-02-18')], '2026-02-10');
    expect(mes('2026-01')?.recognizedPaymentsCents).toBe(0);
    expect(mes('2026-01')?.economicOpenBalanceCents).toBe(90000);
    expect(mes('2025-12')).toBeUndefined();
    expect(p.suspenseBalanceCents).toBe(0);
  });

  it('primeiro arquivo: pagamento depois do vencimento anterior abate a própria fatura', () => {
    const fa = 'G_fev.csv';
    const tx = [compraImportada(fa, '2026-02-01', 900), pagamentoImportado(fa, '2026-02-05', 400)];
    const { mes } = projetar(tx, [log(fa, '2026-01', '2026-02-18')], '2026-02-10');
    expect(mes('2026-01')?.recognizedPaymentsCents).toBe(40000);
    expect(mes('2026-01')?.economicOpenBalanceCents).toBe(50000);
    expect(mes('2025-12')).toBeUndefined();
  });

  /**
   * Não há folga por data. Lançado um dia depois, o pagamento segue o caminho
   * do atraso — que quita a fatura anterior inteira antes de tocar na atual. A
   * sobra de 0,50 fica com a anterior pela política de micro-excedente (valor),
   * não por uma janela de datas que esconderia atraso de verdade.
   */
  it('pagamento lançado no dia útil seguinte ao vencimento quita a anterior; sobra de centavos fica nela', () => {
    const fa = 'H_jan.csv';
    const fb = 'H_fev.csv';
    const tx = [
      compraImportada(fa, '2026-01-10', 1000),
      compraImportada(fb, '2026-02-10', 500),
      pagamentoImportado(fb, '2026-02-19', 1000.5, 'compensado'), // venceu 18/02 (quarta)
    ];
    const logs = [log(fa, '2026-01', '2026-02-18'), log(fb, '2026-02', '2026-03-18')];
    const { p, mes } = projetar(tx, logs, '2026-03-01');
    expect(mes('2026-01')?.recognizedPaymentsCents).toBe(100050);
    expect(mes('2026-02')?.economicOpenBalanceCents).toBe(50000); // os 0,50 não abatem fevereiro
    expect(p.suspenseBalanceCents).toBe(50);
  });

  it('estorno, IOF e acerto manual de centavos entram no total da fatura certa', () => {
    const fa = 'I_jan.csv';
    const fb = 'I_fev.csv';
    const tx = [
      compraImportada(fa, '2026-01-10', 1000),
      compraImportada(fa, '2026-01-12', 12.34, 'IOF de compra internacional'),
      estornoImportado(fa, '2026-01-20', 200),
      compraManual('acerto', '2026-01-20', '2026-02-18', 0.03, 'Acerto IOF'),
      compraImportada(fb, '2026-02-10', 300),
      pagamentoImportado(fb, '2026-02-18', 812.37, 'quita'),
    ];
    const logs = [log(fa, '2026-01', '2026-02-18'), log(fb, '2026-02', '2026-03-18')];
    const { p, mes } = projetar(tx, logs, '2026-03-01');
    // 1000 + 12,34 − 200 + 0,03 = 812,37
    expect(mes('2026-01')?.statementTotalCents).toBe(81237);
    expect(mes('2026-01')?.economicOpenBalanceCents).toBe(0);
    expect(mes('2026-01')?.unresolvedReconciliationDeltaCents).toBe(0);
    expect(p.suspenseBalanceCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pagamentos manuais dirigidos e a fatura de novembro
// ---------------------------------------------------------------------------

describe('pagamentos manuais e faturas futuras', () => {
  it('dois parciais dirigidos à mesma competência são somados, uma vez cada', () => {
    const tx = [
      compraManual('j1', '2026-05-20', '2026-06-18', 2000),
      compraManual('j2', '2026-06-05', '2026-06-18', 1751.23),
      pagamentoDirigido('pg1', '2026-06-16', '2026-05', 2100),
      pagamentoDirigido('pg2', '2026-06-18', '2026-05', 1651.23),
    ];
    const { p, mes } = projetar(tx);
    expect(mes('2026-05')?.statementTotalCents).toBe(375123);
    expect(mes('2026-05')?.recognizedPaymentsCents).toBe(375123);
    expect(mes('2026-05')?.economicOpenBalanceCents).toBe(0);
    expect(mes('2026-05')?.economicStatus).toBe('paid');
    expect(p.suspenseBalanceCents).toBe(0);
    expectConservacao(tx, p);
  });

  it('fatura que vence em novembro sem pagamento fica em aberto — o excedente antigo não a quita', () => {
    const tx = [
      compraManual('s1', '2026-09-10', '2026-10-19', 1000),
      pagamentoDirigido('ps', '2026-10-15', '2026-09', 1500), // 500 a mais, sem decisão
      compraManual('n1', '2026-10-15', '2026-11-18', 543.19),
    ];
    const { p, mes } = projetar(tx);
    expect(mes('2026-09')?.economicOpenBalanceCents).toBe(0);
    expect(mes('2026-10')?.recognizedPaymentsCents).toBe(0);
    expect(mes('2026-10')?.economicOpenBalanceCents).toBe(54319);
    expect(mes('2026-10')?.economicStatus).toBe('open');
    expect(p.economicUsedCents).toBe(54319);
    expect(p.suspenseBalanceCents).toBe(50000);
  });

  // A confirmação «está pago» zera o saldo da competência. Ela não acrescenta
  // dinheiro: o que os pagamentos registrados já cobrem não é contado de novo.
  // Antes ela somava, virava excedente e consumia faturas futuras.
  it('confirmação redundante não duplica o pagamento já registrado', () => {
    const tx = [
      compraManual('k1', '2026-04-15', '2026-05-18', 500),
      pagamentoDirigido('pk', '2026-05-18', '2026-04', 500),
    ];
    const conf = [{ referenceMonth: '2026-04', settledAmount: 500, confirmedAt: '2026-11-02T00:00:00Z' }];
    const { p, mes, card } = projetar(tx, [], '2026-11-02', conf);
    expect(mes('2026-04')?.recognizedPaymentsCents).toBe(50000);
    expect(mes('2026-04')?.economicOpenBalanceCents).toBe(0);
    expect(p.suspenseBalanceCents).toBe(0);
    expect(card('2026-04')?.userConfirmedAmount).toBe(500); // o que o usuário confirmou continua visível
    expect(card('2026-04')?.userConfirmedAppliedAmount).toBe(0);
    expectConservacao(tx, p, 0);
  });

  it('confirmação cobre só o centavo que faltava: fatura quitada, sem alerta de vencida', () => {
    const tx = [
      compraManual('k1', '2026-04-15', '2026-05-18', 500.01),
      pagamentoDirigido('pk', '2026-05-18', '2026-04', 500),
    ];
    const conf = [{ referenceMonth: '2026-04', settledAmount: 500.01, confirmedAt: '2026-11-02T00:00:00Z' }];
    const { p, mes, card } = projetar(tx, [], '2026-11-02', conf);
    expect(mes('2026-04')?.economicOpenBalanceCents).toBe(0);
    expect(mes('2026-04')?.economicStatus).toBe('paid');
    expect(card('2026-04')?.userConfirmedAppliedAmount).toBe(0.01); // rastreável: o centavo entrou pela confirmação
    expect(p.suspenseBalanceCents).toBe(0);
    expectConservacao(tx, p, 1);
  });

  it('sem a confirmação, o mesmo centavo continua em aberto (nada é apagado sozinho)', () => {
    const tx = [
      compraManual('k1', '2026-04-15', '2026-05-18', 500.01),
      pagamentoDirigido('pk', '2026-05-18', '2026-04', 500),
    ];
    const { mes } = projetar(tx, [], '2026-11-02');
    expect(mes('2026-04')?.economicOpenBalanceCents).toBe(1);
  });

  it('confirmação sem pagamento registrado quita a fatura inteira (uso original)', () => {
    const tx = [compraManual('k1', '2026-04-15', '2026-05-18', 300)];
    const conf = [{ referenceMonth: '2026-04', settledAmount: 300, confirmedAt: '2026-11-02T00:00:00Z' }];
    const { p, mes } = projetar(tx, [], '2026-11-02', conf);
    expect(mes('2026-04')?.recognizedPaymentsCents).toBe(30000);
    expect(mes('2026-04')?.economicStatus).toBe('paid');
    expectConservacao(tx, p, 30000);
  });

  it('confirmação acima da fatura não vira crédito para a fatura seguinte', () => {
    const tx = [
      compraManual('k1', '2026-04-15', '2026-05-18', 300),
      compraManual('k2', '2026-05-15', '2026-06-18', 200),
    ];
    const conf = [{ referenceMonth: '2026-04', settledAmount: 450, confirmedAt: '2026-11-02T00:00:00Z' }];
    const { p, mes } = projetar(tx, [], '2026-11-02', conf);
    expect(mes('2026-04')?.recognizedPaymentsCents).toBe(30000);
    expect(mes('2026-05')?.priorCreditAppliedCents).toBe(0);
    expect(mes('2026-05')?.economicOpenBalanceCents).toBe(20000);
    expect(p.suspenseBalanceCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Os cinco cenários do uso real (dados sintéticos): fecha 11, vence 18.
// ---------------------------------------------------------------------------

/** Pagamento antigo, lançado à mão antes do marcador de competência existir. */
const pagamentoManualLegado = (id: string, data: string, valor: number) =>
  manual({
    ID_Transacao: id, Tipo: 'Renda', Data: data, Data_Pagamento: data, Valor: Math.abs(valor),
    Nome_Fantasia: 'Pagamento de Fatura', Categoria: 'Pagamento de Fatura', Descricao_Original: 'Pagamento de Fatura',
  });

describe('uso real do cartão: os cinco cenários', () => {
  it('1. fatura paga de uma vez', () => {
    const tx = [
      compraManual('u1', '2026-05-20', '2026-06-18', 1234.56),
      pagamentoDirigido('u1p', '2026-06-18', '2026-05', 1234.56),
    ];
    const { p, mes } = projetar(tx, [], '2026-06-20');
    expect(mes('2026-05')?.economicOpenBalanceCents).toBe(0);
    expect(mes('2026-05')?.economicStatus).toBe('paid');
    expect(p.economicUsedCents).toBe(0);
    expect(p.suspenseBalanceCents).toBe(0);
    expectConservacao(tx, p);
  });

  it('2. fatura paga em vários parciais: o restante cai a cada pagamento e zera no último', () => {
    const compras = [compraManual('v1', '2026-09-20', '2026-10-19', 5431.93)];
    const parciais = [
      pagamentoDirigido('v1a', '2026-10-01', '2026-09', 2000),
      pagamentoDirigido('v1b', '2026-10-10', '2026-09', 1431.93),
      pagamentoDirigido('v1c', '2026-10-19', '2026-09', 2000),
    ];
    const restante = [543193, 343193, 200000, 0];
    for (let n = 0; n <= parciais.length; n++) {
      const tx = [...compras, ...parciais.slice(0, n)];
      const { p, mes } = projetar(tx, [], '2026-10-15');
      expect(mes('2026-09')?.economicOpenBalanceCents).toBe(restante[n]);
      expect(p.economicUsedCents).toBe(restante[n]); // o limite volta junto
      expectConservacao(tx, p);
    }
  });

  it('3. pagamentos históricos (importados e manuais sem marcador) continuam reconhecidos sem recriar nada', () => {
    const fa = 'H_jan.csv';
    const tx = [
      compraImportada(fa, '2026-01-05', 900),
      compraManual('h2', '2026-02-05', '2026-03-18', 700),
      pagamentoImportado(fa, '2026-02-18', 900, 'imp-jan'),
      pagamentoManualLegado('leg-fev', '2026-03-18', 700),
    ];
    const logs = [log(fa, '2026-01', '2026-02-18')];
    const { p, mes } = projetar(tx, logs, '2026-04-01');
    expect(mes('2026-01')?.economicStatus).toBe('paid');
    expect(mes('2026-02')?.economicStatus).toBe('paid');
    expect(p.economicUsedCents).toBe(0);
    expect(p.suspenseBalanceCents).toBe(0);
    expectConservacao(tx, p);
  });

  it('4. competência vinculada errada: corrigir o vínculo do MESMO lançamento move o pagamento', () => {
    const base = [
      compraManual('w6', '2026-06-20', '2026-07-20', 800), // 18/07 é sábado: vence segunda 20/07
      compraManual('w7', '2026-07-20', '2026-08-18', 300),
    ];
    const errado = [...base, pagamentoDirigido('wp', '2026-07-20', '2026-07', 800)];
    const antes = projetar(errado, [], '2026-08-01');
    expect(antes.mes('2026-06')?.economicOpenBalanceCents).toBe(80000);
    expect(antes.mes('2026-06')?.economicStatus).toBe('overdue');

    const corrigido = [...base, pagamentoDirigido('wp', '2026-07-20', '2026-06', 800)];
    const depois = projetar(corrigido, [], '2026-08-01');
    expect(depois.mes('2026-06')?.economicStatus).toBe('paid');
    expect(depois.mes('2026-07')?.economicOpenBalanceCents).toBe(30000);
    expect(depois.mes('2026-07')?.economicStatus).toBe('open');
    expect(depois.p.suspenseBalanceCents).toBe(0);
    expectConservacao(corrigido, depois.p);
  });

  it('5. fatura futura ainda não paga: em aberto, não vencida, e é a fatura atual do card', () => {
    const tx = [
      compraManual('f9', '2026-09-20', '2026-10-19', 1000),
      pagamentoDirigido('f9p', '2026-10-19', '2026-09', 1000),
      compraManual('f10', '2026-10-15', '2026-11-18', 5431.93),
    ];
    const { p, mes } = projetar(tx, [], '2026-11-02');
    expect(mes('2026-09')?.economicStatus).toBe('paid');
    expect(mes('2026-10')?.economicOpenBalanceCents).toBe(543193);
    expect(mes('2026-10')?.economicStatus).toBe('open');
    expect(p.current?.referenceMonth).toBe('2026-10');
    expect(p.economicUsedCents).toBe(543193);
  });

  it('tudo quitado: o card aponta o próximo vencimento, não a fatura mais antiga', () => {
    const tx = [
      compraManual('q1', '2026-01-20', '2026-02-18', 100),
      pagamentoDirigido('q1p', '2026-02-18', '2026-01', 100),
      compraManual('q10', '2026-10-15', '2026-11-18', 200),
      pagamentoDirigido('q10p', '2026-11-02', '2026-10', 200),
    ];
    const { p } = projetar(tx, [], '2026-11-02');
    expect(p.economicUsedCents).toBe(0);
    expect(p.current?.referenceMonth).toBe('2026-10');
    expect(p.current?.dueDate).toBe('2026-11-18');
  });

  it('centavo pago a mais numa fatura abate a seguinte e a conta do histórico fecha', () => {
    const tx = [
      compraManual('d6', '2026-06-20', '2026-07-20', 100),
      pagamentoDirigido('d6p', '2026-07-20', '2026-06', 100.01),
      compraManual('d7', '2026-07-20', '2026-08-18', 50),
      pagamentoDirigido('d7p', '2026-08-01', '2026-07', 20),
    ];
    const { p, mes } = projetar(tx, [], '2026-08-05');
    const jul = mes('2026-07')!;
    expect(jul.priorDifferenceAppliedCents).toBe(1);
    expect(jul.economicOpenBalanceCents).toBe(2999);
    expect(jul.statementTotalCents - jul.recognizedPaymentsCents - jul.priorDifferenceAppliedCents - jul.priorCreditAppliedCents)
      .toBe(jul.economicOpenBalanceCents);
    expect(p.suspenseBalanceCents).toBe(0);
    expectConservacao(tx, p);
  });
});
