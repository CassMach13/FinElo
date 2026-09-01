import { describe, expect, it } from 'vitest';
import { creditCardRebuildFromImportHistoryService } from '../../src/services/creditCardRebuildFromImportHistoryService';
import type { Account, Transaction } from '../../src/types';

/**
 * Rede de equivalência da extração do núcleo financeiro puro.
 *
 * A extração precisa ser COMPORTAMENTALMENTE NEUTRA: o mesmo algoritmo, movido
 * de lugar. Este arquivo congela a saída de `competenceHistoryCardsForAccount`
 * sobre um conjunto de casos — reais e sintéticos — para que qualquer desvio
 * apareça como diferença de valor, não como impressão.
 *
 * Se um número aqui mudar durante a extração, a extração não foi neutra.
 */

let seq = 0;
const conta = (over: Partial<Account> = {}): Account =>
  ({
    id: 'acc-eq',
    user_id: 'u1',
    Nome_Conta: 'Cartão Equivalência',
    Tipo_Conta: 'Cartão de Crédito',
    Saldo_Inicial: 0,
    Data_Saldo_Inicial: new Date('2024-01-01'),
    limite_credito: 50000,
    dia_fechamento: 20,
    dia_vencimento: 10,
    ...over,
  }) as Account;

const compra = (data: string, valor: number, origem = 'manual'): Transaction => {
  seq += 1;
  return {
    ID_Transacao: `c-${seq}`,
    ID_Conta: 'acc-eq',
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
    ID_Conta: 'acc-eq',
    Origem: origem,
    Data: data,
    Valor: Math.abs(valor),
    Tipo: 'Renda',
    Descricao_Original: 'Pagamento de fatura',
    Nome_Fantasia: 'Pagamento de fatura',
    Categoria: 'Pagamento Cartão de Crédito',
  } as unknown as Transaction;
};

const estorno = (data: string, valor: number): Transaction => {
  seq += 1;
  return {
    ID_Transacao: `e-${seq}`,
    ID_Conta: 'acc-eq',
    Origem: 'manual',
    Data: data,
    Valor: Math.abs(valor),
    Tipo: 'Renda',
    Descricao_Original: 'Estorno',
    Nome_Fantasia: 'Estorno',
    Categoria: 'Estorno',
  } as unknown as Transaction;
};

const log = (arquivo: string, ref: string, venc: string) =>
  ({
    id: `log-${arquivo}`,
    file_name: arquivo,
    imported_details: [{ ID_Conta: 'acc-eq', Card_Reference_Label: ref, Card_Due_Date: venc }],
  }) as never;

function rodar(
  transactions: Transaction[],
  importLogs: unknown[] = [],
  userPaymentConfirmations?: Array<{ referenceMonth: string; settledAmount: number; confirmedAt: string }>
) {
  const account = conta();
  return creditCardRebuildFromImportHistoryService
    .competenceHistoryCardsForAccount({
      accountId: account.id,
      account,
      accounts: [account],
      transactions,
      importLogs: importLogs as never,
      userPaymentConfirmations,
    })
    .map((c) => ({
      ref: c.referenceMonth,
      venc: c.dueDate,
      total: c.statementTotal,
      pago: c.totalPayments,
      aberto: c.openBalance,
      debitos: c.totalDebits,
      estornos: c.totalRefunds,
      fontes: c.files.map((f) => f.fileName).sort(),
    }));
}

// ---------------------------------------------------------------------------

/**
 * A cadeia real de produção, com os arquivos XP e a convenção N→N−1: o pagamento
 * que aparece no arquivo do mês seguinte quita a competência anterior.
 */
const XP = (mes: string) => `Fatura_Cartao_XP_${mes}.csv`;

const cadeiaReal = () => ({
  txs: [
    compra('2024-12-08', 6052.63, XP('Dez_2024')),
    pagamento('2025-01-05', 6052.85, XP('Jan_2025')),
    compra('2025-02-06', 5798.44, XP('Fev_2025')),
    pagamento('2025-03-05', 5858.74, XP('Mar_2025')),
    compra('2025-03-07', 6777.72, XP('Mar_2025')),
    pagamento('2025-04-05', 6716.48, XP('Abr_2025')),
  ],
  logs: [
    log(XP('Dez_2024'), '2024-12', '2025-01-10'),
    log(XP('Jan_2025'), '2025-01', '2025-02-10'),
    log(XP('Fev_2025'), '2025-02', '2025-03-10'),
    log(XP('Mar_2025'), '2025-03', '2025-04-10'),
    log(XP('Abr_2025'), '2025-04', '2025-05-10'),
  ],
});

describe('equivalência do núcleo — cadeia real dos R$ 0,22', () => {
  it('produz exatamente os mesmos totais por competência', () => {
    const { txs, logs } = cadeiaReal();
    const saida = rodar(txs, logs);

    const dez = saida.find((c) => c.ref === '2024-12');
    const fev = saida.find((c) => c.ref === '2025-02');
    const mar = saida.find((c) => c.ref === '2025-03');

    expect(dez).toMatchObject({ total: 6052.63, pago: 6052.85 });
    expect(fev).toMatchObject({ total: 5798.44, pago: 5858.74 });
    expect(mar).toMatchObject({ total: 6777.72, pago: 6716.48 });
  });

  it('a confirmação manual de R$ 0,72 entra nos pagamentos da competência certa', () => {
    const { txs, logs } = cadeiaReal();
    const saida = rodar(txs, logs, [
      { referenceMonth: '2025-03', settledAmount: 0.72, confirmedAt: '2026-09-01T00:00:00Z' },
    ]);

    expect(saida.find((c) => c.ref === '2025-03')?.pago).toBe(6717.2);
  });

  /**
   * A ordem é DECRESCENTE e os meses que só carregam pagamento aparecem como
   * competência de total zero. Não é o que eu supunha ao escrever este teste —
   * é o que o núcleo faz hoje, e é exatamente isso que a extração precisa
   * preservar.
   */
  it('o conjunto de competências e vencimentos é estável', () => {
    const { txs, logs } = cadeiaReal();
    const saida = rodar(txs, logs);

    expect(saida.map((c) => c.ref)).toEqual(['2025-04', '2025-03', '2025-02', '2025-01', '2024-12']);
    expect(saida.map((c) => c.venc)).toEqual([
      '2025-05-10', '2025-04-10', '2025-03-10', '2025-02-10', '2025-01-10',
    ]);
    expect(saida.filter((c) => c.total === 0).map((c) => c.ref)).toEqual(['2025-04', '2025-01']);
  });

  /**
   * `openBalance` aqui vem do carry ANTIGO, com o piso de R$ 1,00 ainda vivo no
   * ledger: o excedente de 0,22 de 2024-12 é descartado e 2025-03 fica com 0,94.
   * A projeção dos dois livros ignora este campo e recalcula. Fica registrado
   * porque, se a extração mudar este número, ela não foi neutra.
   */
  it('o saldo do ledger antigo permanece o mesmo', () => {
    const { txs, logs } = cadeiaReal();
    const saida = rodar(txs, logs);
    expect(saida.find((c) => c.ref === '2025-03')?.aberto).toBe(0.94);
  });
});

describe('equivalência do núcleo — formas sintéticas', () => {
  it('cartão puramente manual', () => {
    const saida = rodar([
      compra('2026-06-05', 300),
      pagamento('2026-06-25', 500),
      compra('2026-07-05', 400),
      pagamento('2026-07-20', 150),
    ]);

    expect(saida).toEqual([
      { ref: '2026-07', venc: '2026-08-10', total: 400, pago: 150, aberto: 50, debitos: 400, estornos: 0, fontes: ['Lançamentos manuais'] },
      { ref: '2026-06', venc: '2026-07-10', total: 300, pago: 500, aberto: 0, debitos: 300, estornos: 0, fontes: ['Lançamentos manuais'] },
    ]);
  });

  it('estorno reduz o total da competência', () => {
    const saida = rodar([compra('2026-07-05', 400), estorno('2026-07-18', 90)]);

    expect(saida[0]).toMatchObject({ total: 310, debitos: 400, estornos: 90 });
  });

  it('importado com convenção N→N−1', () => {
    const jul = 'fatura_julho.csv';
    const ago = 'fatura_agosto.csv';
    const saida = rodar(
      [compra('2026-07-05', 400, jul), compra('2026-08-05', 200, ago), pagamento('2026-08-20', 100, ago)],
      [log(jul, '2026-07', '2026-08-10'), log(ago, '2026-08', '2026-09-10')]
    );

    expect(saida.find((c) => c.ref === '2026-07')).toMatchObject({ total: 400, pago: 100, aberto: 300 });
    expect(saida.find((c) => c.ref === '2026-08')).toMatchObject({ total: 200, pago: 0 });
  });

  it('misto manual + importado na mesma competência', () => {
    const arq = 'fatura_julho.csv';
    const saida = rodar(
      [compra('2026-07-05', 400, arq), compra('2026-07-15', 120), estorno('2026-07-18', 20)],
      [log(arq, '2026-07', '2026-08-10')]
    );

    expect(saida[0]).toMatchObject({ total: 500, debitos: 520, estornos: 20 });
    expect(saida[0].fontes).toEqual(['Lançamentos manuais', 'fatura_julho.csv']);
  });

  it('múltiplos portadores somam na mesma competência', () => {
    const a = 'Fatura_XP_Ione_Jan_2025.csv';
    const b = 'Fatura_XP_Cassio_Jan_2025.csv';
    const saida = rodar(
      [compra('2025-01-08', 216.25, a), compra('2025-01-09', 1000, b)],
      [log(a, '2025-01', '2025-02-10'), log(b, '2025-01', '2025-02-10')]
    );

    expect(saida[0]).toMatchObject({ ref: '2025-01', total: 1216.25 });
    expect(saida[0].fontes.length).toBe(2);
  });

  it('série longa mantém uma competência por mês', () => {
    const txs: Transaction[] = [];
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      txs.push(compra(`2026-${mm}-05`, 100 + m));
      txs.push(pagamento(`2026-${mm}-25`, 50 + m));
    }
    const saida = rodar(txs);

    expect(saida.length).toBe(12);
    expect(saida.map((c) => c.total)).toEqual([112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101]);
    expect(saida.map((c) => c.aberto)).toEqual([50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50]);
  });

  it('conta sem lançamento nenhum não produz competência', () => {
    expect(rodar([])).toEqual([]);
  });
});
