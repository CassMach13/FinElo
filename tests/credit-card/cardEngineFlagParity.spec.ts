import { describe, expect, it } from 'vitest';
import { computeAccountCardDisplay } from '../../src/components/transactions/accountBalanceCardMetrics';
import { creditCardRebuildFromImportHistoryService } from '../../src/services/creditCardRebuildFromImportHistoryService';
import type { Account, Transaction } from '../../src/types';

/**
 * MATRIZ COMPARATIVA — motor ligado × motor desligado.
 *
 * Pergunta que este arquivo responde com evidência: dois usuários com exatamente os
 * mesmos lançamentos veem números diferentes por causa das flags de cartão?
 *
 * As flags (`isCreditCardEngineEnabled`, `isCardV2Enabled`) entram em
 * `computeAccountCardDisplay` como `cardEngineEnabled` / `cardV2Enabled`. Rodar o mesmo
 * cenário com os dois valores mostra se o número exibido depende delas.
 */

const LIMITE = 10000;
const round2 = (v: number) => Math.round(v * 100) / 100;

const conta = (): Account =>
  ({
    id: 'acc-card',
    user_id: 'u1',
    Nome_Conta: 'Cartão Paridade',
    Tipo_Conta: 'Cartão de Crédito',
    Saldo_Inicial: 0,
    Data_Saldo_Inicial: new Date('2026-01-01'),
    limite_credito: LIMITE,
    dia_fechamento: 20,
    dia_vencimento: 28,
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

const estorno = (data: string, valor: number): Transaction => {
  seq += 1;
  return {
    ID_Transacao: `e-${seq}`,
    ID_Conta: 'acc-card',
    Origem: 'manual',
    Data: data,
    Valor: Math.abs(valor),
    Tipo: 'Renda',
    Descricao_Original: 'Estorno',
    Nome_Fantasia: 'Estorno',
    Categoria: 'Estorno',
  } as unknown as Transaction;
};

const logImport = (arquivo: string, ref: string, venc: string) =>
  ({
    id: `log-${arquivo}`,
    file_name: arquivo,
    imported_details: [{ ID_Conta: 'acc-card', Card_Reference_Label: ref, Card_Due_Date: venc }],
  }) as any;

/** Mesmo cenário, só mudando as flags. */
function comparar(transactions: Transaction[], importLogs: any[] = []) {
  const account = conta();
  const base = {
    transactions,
    accounts: [account],
    importLogs,
    cardSnapshotPipelineEnabled: false,
  };

  const motorLigado = computeAccountCardDisplay(account, {
    ...base,
    cardEngineEnabled: true,
    cardV2Enabled: false,
  });
  const motorDesligado = computeAccountCardDisplay(account, {
    ...base,
    cardEngineEnabled: false,
    cardV2Enabled: false,
  });
  const v2Ligado = computeAccountCardDisplay(account, {
    ...base,
    cardEngineEnabled: false,
    cardV2Enabled: true,
  });

  const campos = (d: ReturnType<typeof computeAccountCardDisplay>) => ({
    faturaAtual: d.faturaAtual,
    limiteDisponivel: d.limiteDisponivel,
    limiteUsadoPct: round2(d.limiteUsadoPct),
    faturaVencida: d.faturaVencida,
    faturaDueDateIso: d.faturaDueDateIso,
    faturaTitulo: d.faturaTitulo,
    diasParaVencer: d.diasParaVencer,
  });

  return {
    ligado: campos(motorLigado),
    desligado: campos(motorDesligado),
    v2: campos(v2Ligado),
  };
}

/** Oráculo independente: recalcula tudo a partir das transações cruas. */
function oraculo(transactions: Transaction[]) {
  const porMes: Record<string, { deb: number; est: number; pag: number }> = {};
  for (const t of transactions) {
    const ref = String(t.Data).slice(0, 7);
    porMes[ref] ||= { deb: 0, est: 0, pag: 0 };
    const v = Math.abs(Number(t.Valor));
    const ehPagamento = /pagamento/i.test(String(t.Categoria || ''));
    if (t.Tipo === 'Despesa') porMes[ref].deb = round2(porMes[ref].deb + v);
    else if (ehPagamento) porMes[ref].pag = round2(porMes[ref].pag + v);
    else porMes[ref].est = round2(porMes[ref].est + v);
  }
  let credito = 0;
  let aberto = 0;
  for (const ref of Object.keys(porMes).sort()) {
    const m = porMes[ref];
    const total = round2(m.deb - m.est);
    const deficit = round2(Math.max(0, total - m.pag));
    const excedente = total > 0.005 && round2(Math.max(0, m.pag - total)) >= 1 ? round2(m.pag - total) : 0;
    const aplicado = round2(Math.min(credito, deficit));
    aberto = round2(aberto + round2(deficit - aplicado));
    credito = round2(credito - aplicado + excedente);
  }
  return { limiteUtilizado: aberto, disponivel: round2(LIMITE - aberto) };
}

const CENARIOS: Array<{ nome: string; txs: Transaction[]; logs?: any[] }> = [
  { nome: 'manual simples', txs: [compra('2026-07-05', 400)] },
  {
    nome: 'manual com pagamento parcial',
    txs: [compra('2026-07-05', 400), pagamento('2026-07-20', 150)],
  },
  {
    nome: 'pagamento a maior com carry-forward',
    txs: [compra('2026-06-05', 300), pagamento('2026-06-25', 500), compra('2026-07-05', 400)],
  },
  { nome: 'estorno', txs: [compra('2026-07-05', 400), estorno('2026-07-18', 90)] },
  {
    nome: 'múltiplas competências',
    txs: [
      compra('2026-05-05', 100),
      compra('2026-06-05', 200),
      pagamento('2026-06-26', 200),
      compra('2026-07-05', 300),
      compra('2026-08-05', 400),
    ],
  },
  {
    nome: 'parcelas futuras',
    txs: [compra('2026-08-04', 100), compra('2026-11-04', 100), compra('2027-02-04', 100)],
  },
  {
    nome: 'faturas vencidas',
    txs: [compra('2026-05-05', 100), compra('2026-06-05', 500), compra('2026-07-05', 250)],
  },
  {
    nome: 'importado',
    txs: [compra('2026-07-05', 400, 'fatura_julho.csv')],
    logs: [logImport('fatura_julho.csv', '2026-07', '2026-08-28')],
  },
  {
    nome: 'importado com pagamento no extrato seguinte',
    txs: [
      compra('2026-07-05', 400, 'fatura_julho.csv'),
      compra('2026-08-05', 200, 'fatura_agosto.csv'),
      pagamento('2026-08-20', 100, 'fatura_agosto.csv'),
    ],
    logs: [
      logImport('fatura_julho.csv', '2026-07', '2026-08-28'),
      logImport('fatura_agosto.csv', '2026-08', '2026-09-28'),
    ],
  },
  {
    nome: 'manual + importado na mesma competência',
    txs: [
      compra('2026-07-05', 400, 'fatura_julho.csv'),
      compra('2026-07-15', 120),
      estorno('2026-07-18', 20),
    ],
    logs: [logImport('fatura_julho.csv', '2026-07', '2026-08-28')],
  },
];

describe('paridade entre motor ligado e desligado', () => {
  CENARIOS.forEach(({ nome, txs, logs }) => {
    it(`${nome}: os três estados de flag produzem o mesmo card`, () => {
      const r = comparar(txs, logs || []);

      expect(r.desligado).toEqual(r.ligado);
      expect(r.v2).toEqual(r.ligado);
    });

    it(`${nome}: o valor bate com o oráculo independente`, () => {
      const r = comparar(txs, logs || []);
      const o = oraculo(txs);

      expect(r.ligado.limiteDisponivel).toBe(o.disponivel);
      expect(round2(LIMITE - r.ligado.limiteDisponivel)).toBe(o.limiteUtilizado);
    });
  });
});

describe('o ledger de competência não consulta flag nenhuma', () => {
  it('competenceHistoryCardsForAccount nem recebe estado de flag na assinatura', () => {
    const account = conta();
    const txs = [compra('2026-07-05', 400), pagamento('2026-07-20', 150)];

    const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: account.id,
      account,
      accounts: [account],
      transactions: txs,
      importLogs: [],
    });

    const jul = cards.find((c) => c.referenceMonth === '2026-07');
    expect(jul?.statementTotal).toBe(400);
    expect(jul?.totalPayments).toBe(150);
    expect(jul?.openBalance).toBe(250);
  });

  it('conta sem lançamento nenhum não depende de flag para mostrar zero', () => {
    const r = comparar([]);
    expect(r.ligado.faturaAtual).toBe(0);
    expect(r.desligado.faturaAtual).toBe(0);
    expect(r.ligado.limiteDisponivel).toBe(LIMITE);
    expect(r.desligado.limiteDisponivel).toBe(LIMITE);
  });
});
