import { describe, expect, it } from 'vitest';
import { computeAccountCardDisplay } from '../../src/components/transactions/accountBalanceCardMetrics';
import type { Account, Transaction } from '../../src/types';

/**
 * Princípio de produto verificado aqui:
 *
 *   valor + status + fechamento/vencimento exibidos no card sempre se referem à
 *   MESMA fatura.
 *
 * O valor principal é o saldo efetivamente em aberto (depois de pagamentos, créditos e
 * estornos), não o total bruto — o bruto continua no Histórico como «Total da fatura».
 *
 * «Uso do limite» e «disponível» seguem considerando todas as competências em aberto,
 * inclusive futuras, de propósito.
 *
 * Todos os cenários usam `hoje` fixo em 2026-09-01 via vencimentos construídos
 * relativamente a essa data, para não dependerem do relógio de quem roda os testes.
 */

const LIMITE = 10000;
const round2 = (v: number) => Math.round(v * 100) / 100;

const conta = (over: Partial<Account> = {}): Account =>
  ({
    id: 'acc-card',
    user_id: 'u1',
    Nome_Conta: 'Cartão Teste',
    Tipo_Conta: 'Cartão de Crédito',
    Saldo_Inicial: 0,
    Data_Saldo_Inicial: new Date('2026-01-01'),
    limite_credito: LIMITE,
    dia_fechamento: 20,
    dia_vencimento: 28,
    ...over,
  }) as Account;

let seq = 0;

function compra(dataIso: string, valor: number, origem = 'manual'): Transaction {
  seq += 1;
  return {
    ID_Transacao: `c-${seq}`,
    ID_Conta: 'acc-card',
    Origem: origem,
    Data: dataIso,
    Valor: -Math.abs(valor),
    Tipo: 'Despesa',
    Descricao_Original: `Compra ${seq}`,
    Nome_Fantasia: `Loja ${seq}`,
    Categoria: 'Compras',
  } as unknown as Transaction;
}

function pagamento(dataIso: string, valor: number, origem = 'manual'): Transaction {
  seq += 1;
  return {
    ID_Transacao: `p-${seq}`,
    ID_Conta: 'acc-card',
    Origem: origem,
    Data: dataIso,
    Valor: Math.abs(valor),
    Tipo: 'Renda',
    Descricao_Original: 'Pagamento de fatura',
    Nome_Fantasia: 'Pagamento de fatura',
    Categoria: 'Pagamento Cartão de Crédito',
  } as unknown as Transaction;
}

function estorno(dataIso: string, valor: number): Transaction {
  seq += 1;
  return {
    ID_Transacao: `e-${seq}`,
    ID_Conta: 'acc-card',
    Origem: 'manual',
    Data: dataIso,
    Valor: Math.abs(valor),
    Tipo: 'Renda',
    Descricao_Original: 'Estorno',
    Nome_Fantasia: 'Estorno',
    Categoria: 'Estorno',
  } as unknown as Transaction;
}

const logImport = (arquivo: string, ref: string, venc: string) =>
  ({
    id: `log-${arquivo}`,
    file_name: arquivo,
    imported_details: [{ ID_Conta: 'acc-card', Card_Reference_Label: ref, Card_Due_Date: venc }],
  }) as any;

function exibir(transactions: Transaction[], importLogs: any[] = [], account = conta()) {
  return computeAccountCardDisplay(account, {
    transactions,
    accounts: [account],
    importLogs,
    cardV2Enabled: false,
    cardEngineEnabled: false,
    cardSnapshotPipelineEnabled: false,
  });
}

describe('valor principal do card é o saldo em aberto, não o total bruto', () => {
  it('fatura parcialmente paga mostra o que falta pagar', () => {
    // Julho: compra de 400, pagamento parcial de 150 -> restam 250.
    const d = exibir([compra('2026-07-05', 400), pagamento('2026-07-20', 150)]);

    expect(d.faturaAtual).toBe(250);
    expect(d.limiteDisponivel).toBe(round2(LIMITE - 250));
  });

  it('crédito de mês anterior também abate o valor exibido', () => {
    // Junho: fatura 300, pago 500 -> 200 de crédito. Julho: fatura 400 -> restam 200.
    const d = exibir([
      compra('2026-06-05', 300),
      pagamento('2026-06-25', 500),
      compra('2026-07-05', 400),
    ]);

    expect(d.faturaAtual).toBe(200);
  });

  it('estorno abate o valor exibido', () => {
    const d = exibir([compra('2026-07-05', 400), estorno('2026-07-18', 90)]);
    expect(d.faturaAtual).toBe(310);
  });
});

describe('status e datas descrevem a mesma fatura do valor', () => {
  it('fatura vencida: título muda, badge liga e mostra o vencimento real dela', () => {
    // Julho vence 28/08; hoje é depois disso.
    const d = exibir([compra('2026-07-05', 400), pagamento('2026-07-20', 150)]);

    expect(d.faturaVencida).toBe(true);
    expect(d.faturaTitulo).toBe('Fatura em aberto');
    expect(d.faturaDueDateIso).toBe('2026-08-28');
    expect(d.faturaAtual).toBe(250);
  });

  it('fatura vencida não exibe contagem regressiva nem fechamento do ciclo seguinte', () => {
    const d = exibir([compra('2026-07-05', 400)]);

    expect(d.faturaVencida).toBe(true);
    expect(d.diasParaVencer).toBe(0);
    expect(d.diasParaFechar).toBe(0);
  });

  it('fatura a vencer mantém título normal e conta os dias até o vencimento dela', () => {
    // Agosto vence 28/09, ainda no futuro.
    const d = exibir([compra('2026-08-05', 500)]);

    expect(d.faturaVencida).toBe(false);
    expect(d.faturaTitulo).toBe('Fatura atual');
    expect(d.faturaDueDateIso).toBe('2026-09-28');
    expect(d.diasParaVencer).toBeGreaterThan(0);
  });

  it('vencimento exibido é o da competência escolhida, não o próximo genérico', () => {
    // Vencida de julho (28/08) convive com compra futura de dezembro.
    const d = exibir([compra('2026-07-05', 400), compra('2026-12-10', 90)]);

    expect(d.faturaDueDateIso).toBe('2026-08-28');
    expect(d.faturaVencida).toBe(true);
  });
});

describe('cenários pedidos', () => {
  it('fatura vencida parcialmente paga', () => {
    const d = exibir([compra('2026-07-05', 600), pagamento('2026-07-22', 250)]);

    expect(d.faturaVencida).toBe(true);
    expect(d.faturaAtual).toBe(350);
    expect(d.faturaDueDateIso).toBe('2026-08-28');
  });

  it('fatura vencida + compras futuras: futuro entra no limite, não no card', () => {
    const d = exibir([
      compra('2026-07-05', 400), // vencida
      compra('2026-11-10', 150), // futura
      compra('2027-02-10', 250), // futura
    ]);

    expect(d.faturaAtual).toBe(400);
    expect(d.faturaVencida).toBe(true);
    // Limite considera tudo: 400 + 150 + 250 = 800.
    expect(d.limiteDisponivel).toBe(round2(LIMITE - 800));
  });

  it('fatura corrente + parcelas futuras', () => {
    const txs = [compra('2026-08-04', 100)];
    for (let i = 1; i < 12; i++) {
      const mes = 8 + i;
      const ano = 2026 + Math.floor((mes - 1) / 12);
      const mm = String(((mes - 1) % 12) + 1).padStart(2, '0');
      txs.push(compra(`${ano}-${mm}-04`, 100));
    }

    const d = exibir(txs);

    expect(d.faturaAtual).toBe(100);
    expect(d.faturaDueDateIso).toBe('2026-09-28');
    expect(d.faturaVencida).toBe(false);
    // As 12 parcelas consomem limite.
    expect(d.limiteDisponivel).toBe(round2(LIMITE - 1200));
  });

  it('fatura totalmente quitada mostra zero, sem badge', () => {
    const d = exibir([compra('2026-08-05', 500), pagamento('2026-08-26', 500)]);

    expect(d.faturaAtual).toBe(0);
    expect(d.faturaVencida).toBe(false);
    expect(d.faturaTitulo).toBe('Fatura atual');
    expect(d.limiteDisponivel).toBe(LIMITE);
  });

  it('múltiplas vencidas: exibe a mais antiga', () => {
    const d = exibir([
      compra('2026-05-05', 100), // vence 28/06
      compra('2026-06-05', 500), // vence 28/07
      compra('2026-07-05', 250), // vence 28/08
    ]);

    expect(d.faturaVencida).toBe(true);
    expect(d.faturaDueDateIso).toBe('2026-06-28');
    expect(d.faturaAtual).toBe(100);
    expect(d.limiteDisponivel).toBe(round2(LIMITE - 850));
  });
});

describe('a regra não depende da origem dos lançamentos', () => {
  it('manual', () => {
    const d = exibir([compra('2026-07-05', 400), pagamento('2026-07-20', 100)]);
    expect(d.faturaAtual).toBe(300);
    expect(d.faturaVencida).toBe(true);
  });

  /**
   * Em arquivo importado, o pagamento que aparece no CSV do mês N abate a competência
   * N−1 — é a convenção do extrato (padrão XP), documentada no guia de ajuda. Por isso
   * o pagamento precisa vir no arquivo de agosto para quitar parte de julho.
   */
  it('importado', () => {
    const jul = 'fatura_julho.csv';
    const ago = 'fatura_agosto.csv';
    const d = exibir(
      [
        compra('2026-07-05', 400, jul),
        compra('2026-08-05', 200, ago),
        pagamento('2026-08-20', 100, ago), // abate julho
      ],
      [logImport(jul, '2026-07', '2026-08-28'), logImport(ago, '2026-08', '2026-09-28')]
    );

    // Julho: 400 faturados, 100 pagos pelo extrato de agosto -> 300 em aberto, vencida.
    expect(d.faturaAtual).toBe(300);
    expect(d.faturaVencida).toBe(true);
    expect(d.faturaDueDateIso).toBe('2026-08-28');
    // Limite considera julho (300) + agosto (200).
    expect(d.limiteDisponivel).toBe(round2(LIMITE - 500));
  });

  it('manual + importado na mesma competência', () => {
    const arq = 'fatura_julho.csv';
    const d = exibir(
      [compra('2026-07-05', 400, arq), compra('2026-07-15', 120), estorno('2026-07-18', 20)],
      [logImport(arq, '2026-07', '2026-08-28')]
    );

    // 400 importado + 120 manual - 20 de estorno = 500.
    expect(d.faturaAtual).toBe(500);
    expect(d.faturaVencida).toBe(true);
    expect(d.limiteDisponivel).toBe(round2(LIMITE - 500));
  });
});

describe('«Fatura em aberto» e «Uso do limite» seguem independentes', () => {
  it('o card mostra uma fatura; o limite soma todas', () => {
    const d = exibir([
      compra('2026-07-05', 400), // vencida, exibida
      compra('2026-08-05', 350), // corrente
      compra('2026-11-05', 200), // futura
    ]);

    expect(d.faturaAtual).toBe(400);
    expect(d.limiteDisponivel).toBe(round2(LIMITE - 950));
    expect(round2(LIMITE - d.limiteDisponivel)).toBeGreaterThan(d.faturaAtual);
  });
});
