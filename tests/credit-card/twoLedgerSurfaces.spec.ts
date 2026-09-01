import { describe, expect, it } from 'vitest';
import {
  projectCardTwoLedger,
  centsToCurrency,
  type CompetenceHistoryLike,
} from '../../src/domain/credit-card/twoLedgerProjection';
import { computeAccountCardDisplay } from '../../src/components/transactions/accountBalanceCardMetrics';
import type { Account, Transaction } from '../../src/types';

/**
 * Consumo dos dois livros pelas superfícies: limite, fatura atual, status e histórico.
 *
 * O princípio sob teste é de apresentação, não de aritmética: uma diferença de
 * reconciliação nunca aparece como dívida vencida, pagamento, crédito disponível
 * ou carry econômico. Se há saldo econômico, ele governa tudo. Se não há, a fatura
 * não pode ser marcada como vencida só porque sobrou diferença.
 */

const c = (reais: number) => Math.round(reais * 100);
const HOJE = '2026-09-01';

const comp = (
  referenceMonth: string,
  statementTotal: number,
  totalPayments: number,
  dueDate?: string
): CompetenceHistoryLike => ({
  referenceMonth,
  competenceBR: referenceMonth,
  dueDate: dueDate ?? `${referenceMonth}-10`,
  statementTotal,
  totalPayments,
});

const projetar = (cards: CompetenceHistoryLike[], asOf = HOJE) =>
  projectCardTwoLedger(cards, { asOf });

// ---------------------------------------------------------------------------

describe('caso real de regressão — a cadeia dos R$ 0,22 nas superfícies', () => {
  const cadeia = (): CompetenceHistoryLike[] => [
    comp('2024-12', 6052.63, 6052.85),
    comp('2025-02', 5798.44, 5858.74),
    // `totalPayments` já traz somada a confirmação de R$ 0,72.
    comp('2025-03', 6777.72, 6717.2),
  ];

  it('saldo econômico em aberto é zero em todas as competências', () => {
    const p = projetar(cadeia());
    expect(p.competences.map((x) => x.economicOpenBalanceCents)).toEqual([0, 0, 0]);
    expect(p.economicUsedCents).toBe(0);
  });

  it('nenhuma competência aparece como vencida', () => {
    const p = projetar(cadeia());
    expect(p.competences.every((x) => x.economicStatus !== 'overdue')).toBe(true);
    expect(p.current?.economicStatus).not.toBe('overdue');
  });

  it('o suspense fecha em zero depois da cadeia completa', () => {
    expect(projetar(cadeia()).suspenseBalanceCents).toBe(0);
  });

  it('o limite não é alterado por esse suspense', () => {
    const p = projetar(cadeia());
    // Nenhuma dívida econômica, logo nada consome limite — apesar de terem
    // transitado R$ 60,52 pelo livro 2.
    expect(p.economicUsedCents).toBe(0);
  });

  it('nenhuma dívida nem crédito econômico fictício é criado', () => {
    const p = projetar(cadeia());
    expect(p.economicCarryCents).toBe(0);
    expect(p.competences.reduce((a, x) => a + x.economicOpenBalanceCents, 0)).toBe(0);
  });

  it('a conciliação pendente aparece — mas só como indicação secundária', () => {
    const p = projetar(cadeia());
    expect(p.reconciliationPending).toBe(true);
    expect(p.competences.every((x) => x.hasPendingReconciliation)).toBe(true);
    // E não contamina nenhum número econômico.
    expect(p.economicUsedCents).toBe(0);
    expect(p.economicCarryCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('limite', () => {
  it('saldo econômico em aberto consome limite', () => {
    const p = projetar([comp('2026-07', 400, 150)]);
    expect(p.economicUsedCents).toBe(c(250));
  });

  it('suspense positivo NÃO altera o limite utilizado', () => {
    const semSuspense = projetar([comp('2026-07', 400, 400)]);
    const comSuspense = projetar([comp('2026-07', 400, 900)]);

    expect(comSuspense.suspenseBalanceCents).toBe(c(500));
    expect(comSuspense.economicUsedCents).toBe(semSuspense.economicUsedCents);
    expect(comSuspense.economicUsedCents).toBe(0);
  });

  it('suspense também não libera limite que a dívida ocupa', () => {
    // Excedente de 500 em julho, dívida de 300 em setembro sem relação: o
    // suspense compensa até onde alcança, e o resto continua consumindo limite.
    const p = projetar([comp('2026-07', 400, 900), comp('2026-09', 800, 0)]);

    expect(p.competences[1].economicOpenBalanceCents).toBe(c(300));
    expect(p.economicUsedCents).toBe(c(300));
    expect(p.suspenseBalanceCents).toBe(0);
  });

  it('competências futuras em aberto seguem consumindo limite', () => {
    const p = projetar([comp('2026-07', 400, 400), comp('2026-12', 150, 0), comp('2027-02', 250, 0)]);
    expect(p.economicUsedCents).toBe(c(400));
  });

  it('o limite disponível na superfície ignora o suspense', () => {
    const conta = contaCartao();
    const d = exibir(
      [compra('2026-07-05', 400), pagamento('2026-07-20', 900)],
      conta
    );

    // Pagou 500 a mais sem procedência: não vira crédito e não muda o limite.
    expect(d.limiteDisponivel).toBe(LIMITE);
    expect(d.faturaAtual).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('seleção da fatura atual', () => {
  it('competência quitada com reconciliação pendente NÃO sequestra o destaque', () => {
    // 2026-06 tem suspense pendente mas saldo zero; 2026-07 tem dívida real.
    const p = projetar([comp('2026-06', 300, 300.22), comp('2026-07', 400, 150)]);

    expect(p.competences[0].economicOpenBalanceCents).toBe(0);
    expect(p.competences[0].hasPendingReconciliation).toBe(true);
    expect(p.current?.referenceMonth).toBe('2026-07');
    expect(p.current?.economicStatus).toBe('overdue');
  });

  it('sem dívida econômica alguma, nada é marcado como vencido', () => {
    const p = projetar([comp('2026-06', 300, 300.22), comp('2026-07', 400, 400)]);

    expect(p.current?.economicStatus).toBe('paid');
    expect(p.competences.every((x) => x.economicStatus !== 'overdue')).toBe(true);
  });

  it('a vencida mais antiga com saldo tem prioridade', () => {
    const p = projetar([
      comp('2026-05', 100, 0),
      comp('2026-06', 500, 0),
      comp('2026-07', 250, 0),
    ]);
    expect(p.current?.referenceMonth).toBe('2026-05');
  });

  it('sem vencidas, mostra a próxima em aberto', () => {
    const p = projetar([comp('2026-12', 300, 300), comp('2027-01', 600, 0)]);
    expect(p.current?.referenceMonth).toBe('2027-01');
    expect(p.current?.economicStatus).toBe('open');
  });

  it('com tudo quitado, cai no ciclo mais próximo, sem selo', () => {
    const p = projetar([comp('2026-12', 300, 300), comp('2027-01', 600, 600)]);
    expect(p.current?.referenceMonth).toBe('2026-12');
    expect(p.current?.economicOpenBalanceCents).toBe(0);
    expect(p.current?.economicStatus).toBe('paid');
  });

  it('compromissos futuros não deslocam o destaque', () => {
    const p = projetar([comp('2026-07', 400, 150), comp('2027-06', 90, 0), comp('2028-02', 10, 0)]);
    expect(p.current?.referenceMonth).toBe('2026-07');
  });
});

// ---------------------------------------------------------------------------

/**
 * As duas confusões que este PR existe para tornar impossíveis, cercadas de perto.
 *
 * A primeira: marcar como vencida uma competência só porque a data passou. Era a
 * regra antiga, e é o que fazia R$ 0,22 de diferença virar «FATURA EM ABERTO ·
 * VENCIDA». Vencida exige DÍVIDA vencida.
 *
 * A segunda: escolher a fatura em destaque sem olhar o saldo econômico. Uma
 * competência antiga, quitada e não conciliada é justamente a que a regra errada
 * escolheria primeiro.
 */
describe('vencida exige dívida econômica, não apenas data passada', () => {
  it('competência antiga, quitada e não conciliada não é vencida', () => {
    const p = projetar([comp('2024-01', 500, 500.22)], HOJE);
    expect(p.competences[0].economicStatus).toBe('paid');
    expect(p.current?.economicStatus).not.toBe('overdue');
  });

  it('várias competências antigas quitadas com diferenças não geram nenhuma vencida', () => {
    const p = projetar(
      [comp('2024-01', 500, 500.22), comp('2024-02', 600, 600.5), comp('2024-03', 700, 700.1)],
      HOJE
    );
    expect(p.competences.filter((x) => x.economicStatus === 'overdue')).toEqual([]);
    expect(p.reconciliationPending).toBe(true);
  });

  it('a mesma competência vira vencida assim que existe dívida de verdade', () => {
    const quitada = projetar([comp('2024-01', 500, 500.22)], HOJE);
    const devendo = projetar([comp('2024-01', 500, 499)], HOJE);

    expect(quitada.competences[0].economicStatus).toBe('paid');
    expect(devendo.competences[0].economicStatus).toBe('overdue');
  });

  it('na superfície, o selo VENCIDA não aparece por diferença de conciliação', () => {
    const d = exibir([compra('2026-06-05', 300), pagamento('2026-06-25', 300.9)]);

    expect(d.faturaVencida).toBe(false);
    expect(d.faturaTitulo).toBe('Fatura atual');
    expect(d.reconciliacaoPendente).toBe(true);
  });

  it('na superfície, o selo VENCIDA continua aparecendo com dívida real vencida', () => {
    const d = exibir([compra('2026-06-05', 300), pagamento('2026-06-25', 250)]);

    expect(d.faturaVencida).toBe(true);
    expect(d.faturaTitulo).toBe('Fatura em aberto');
    expect(d.faturaAtual).toBe(50);
  });
});

describe('a fatura em destaque é escolhida pelo saldo econômico', () => {
  it('competências quitadas anteriores são puladas', () => {
    const p = projetar([comp('2026-04', 300, 300), comp('2026-05', 400, 400), comp('2026-06', 500, 200)]);
    expect(p.current?.referenceMonth).toBe('2026-06');
    expect(p.current?.economicOpenBalanceCents).toBe(c(300));
  });

  it('uma quitada antiga com diferença pendente não é escolhida na frente de uma devedora', () => {
    const p = projetar([comp('2024-01', 300, 300.22), comp('2026-06', 500, 200)]);

    expect(p.competences[0].hasPendingReconciliation).toBe(true);
    expect(p.current?.referenceMonth).toBe('2026-06');
  });

  it('o valor exibido é o da competência escolhida, não o da primeira da série', () => {
    const p = projetar([comp('2026-04', 300, 300), comp('2026-06', 500, 200)]);
    expect(p.current?.economicOpenBalanceCents).toBe(c(300));
    expect(p.current?.statementTotalCents).toBe(c(500));
  });

  it('na superfície, o valor vem da competência com dívida', () => {
    const d = exibir([
      compra('2026-05-05', 300),
      pagamento('2026-05-25', 300),
      compra('2026-06-05', 500),
      pagamento('2026-06-25', 200),
    ]);

    expect(d.faturaAtual).toBe(300);
    expect(d.faturaVencida).toBe(true);
  });

  it('série inteiramente quitada não destaca dívida alguma', () => {
    const p = projetar([comp('2026-04', 300, 300), comp('2026-05', 400, 400)]);
    expect(p.current?.economicOpenBalanceCents).toBe(0);
    expect(p.economicUsedCents).toBe(0);
  });

  /**
   * Sem nenhuma competência vencida, a escolha depende INTEIRAMENTE do saldo
   * econômico — não há data que a resgate. É a forma em que ignorar o saldo
   * escolhe visivelmente a competência errada.
   */
  it('quitada antiga é pulada em favor de uma futura em aberto', () => {
    const p = projetar([comp('2026-12', 300, 300), comp('2027-03', 600, 0)]);

    expect(p.current?.referenceMonth).toBe('2027-03');
    expect(p.current?.economicOpenBalanceCents).toBe(c(600));
  });

  it('duas quitadas antigas são puladas em favor da terceira em aberto', () => {
    const p = projetar([
      comp('2026-11', 300, 300),
      comp('2026-12', 400, 400),
      comp('2027-03', 600, 250),
    ]);

    expect(p.current?.referenceMonth).toBe('2027-03');
    expect(p.current?.economicOpenBalanceCents).toBe(c(350));
  });

  it('quitada antiga COM diferença pendente também é pulada quando nada venceu', () => {
    const p = projetar([comp('2026-12', 300, 300.4), comp('2027-03', 600, 100)]);

    expect(p.competences[0].hasPendingReconciliation).toBe(true);
    expect(p.current?.referenceMonth).toBe('2027-03');
    // 600 − 100 − 0,40 de suspense compensado.
    expect(p.current?.economicOpenBalanceCents).toBe(c(499.6));
  });

  it('na superfície, uma competência futura em aberto governa o valor exibido', () => {
    const d = exibir([
      compra('2026-08-05', 300),
      pagamento('2026-08-25', 300),
      compra('2026-12-05', 600),
    ]);

    expect(d.faturaAtual).toBe(600);
    expect(d.faturaVencida).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('combinações de dívida e reconciliação', () => {
  it('dívida econômica real sem reconciliação alguma', () => {
    const p = projetar([comp('2026-07', 400, 150)]);

    expect(p.competences[0].economicOpenBalanceCents).toBe(c(250));
    expect(p.competences[0].economicStatus).toBe('overdue');
    expect(p.competences[0].reconciliationStatus).toBe('reconciled');
    expect(p.reconciliationPending).toBe(false);
  });

  it('reconciliação pendente sem dívida nenhuma', () => {
    const p = projetar([comp('2026-07', 400, 400.5)]);

    expect(p.competences[0].economicOpenBalanceCents).toBe(0);
    expect(p.competences[0].economicStatus).toBe('paid');
    expect(p.competences[0].reconciliationStatus).toBe('unreconciled');
    expect(p.reconciliationPending).toBe(true);
    expect(p.economicUsedCents).toBe(0);
  });

  it('dívida e reconciliação simultâneas ficam em campos distintos', () => {
    // 2026-06 gera suspense de 0,50; 2026-07 deve 250 e o suspense explica 0,50.
    const p = projetar([comp('2026-06', 300, 300.5), comp('2026-07', 400, 150)]);
    const julho = p.competences[1];

    expect(julho.economicOpenBalanceCents).toBe(c(249.5));
    expect(julho.economicStatus).toBe('overdue');
    expect(julho.reconciliationStatus).toBe('unreconciled');
    // A dívida é econômica; a diferença é do livro 2. Somadas dariam 250.
    expect(julho.unresolvedReconciliationDeltaCents).toBe(c(-0.5));
    expect(p.economicUsedCents).toBe(c(249.5));
  });

  it('fatura paga com reconciliação pendente não é vencida', () => {
    const p = projetar([comp('2026-01', 500, 500.22)], HOJE);
    const x = p.competences[0];

    expect(x.economicStatus).toBe('paid');
    expect(x.economicStatus).not.toBe('overdue');
    expect(x.hasPendingReconciliation).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('sinal do suspense', () => {
  it('suspense positivo: pagou a mais sem procedência', () => {
    const p = projetar([comp('2026-07', 400, 450)]);

    expect(p.competences[0].unresolvedReconciliationDeltaCents).toBe(c(50));
    expect(p.suspenseBalanceCents).toBe(c(50));
  });

  it('a competência que consome suspense registra delta negativo', () => {
    const p = projetar([comp('2026-06', 400, 450), comp('2026-07', 300, 250)]);

    expect(p.competences[0].unresolvedReconciliationDeltaCents).toBe(c(50));
    expect(p.competences[1].unresolvedReconciliationDeltaCents).toBe(c(-50));
    expect(p.suspenseBalanceCents).toBe(0);
  });

  /**
   * Assimetria deliberada. Um excedente inexplicado fica no livro 2 porque não se
   * sabe se o cliente pagou a mais ou se o extrato subestima. Um DÉFICIT
   * inexplicado, sem nada a montante que o explique, é dívida: o extrato é a
   * obrigação conhecida, e não se deixa de dever por o número ser pequeno.
   */
  it('déficit inexplicado sem suspense a montante é dívida, não suspense negativo', () => {
    const p = projetar([comp('2026-07', 400, 399.78)]);

    expect(p.competences[0].economicOpenBalanceCents).toBe(c(0.22));
    expect(p.competences[0].economicStatus).toBe('overdue');
    expect(p.suspenseBalanceCents).toBe(0);
  });

  it('o saldo do livro 2 nunca fica negativo', () => {
    const p = projetar([comp('2026-06', 400, 450), comp('2026-07', 300, 100)]);
    expect(p.suspenseBalanceCents).toBe(0);
    expect(p.suspenseBalanceCents).toBeGreaterThanOrEqual(0);
  });

  it('suspense que se compensa depois zera sem deixar rastro econômico', () => {
    const p = projetar([comp('2026-06', 400, 450), comp('2026-07', 300, 250)]);

    expect(p.suspenseBalanceCents).toBe(0);
    expect(p.economicUsedCents).toBe(0);
    expect(p.economicCarryCents).toBe(0);
    expect(p.competences.every((x) => x.economicStatus !== 'overdue')).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('histórico', () => {
  const serie = (): CompetenceHistoryLike[] => [
    comp('2026-04', 300, 300),
    comp('2026-05', 400, 450),
    comp('2026-06', 500, 200),
    comp('2026-07', 600, 550),
  ];

  it('preserva total e status econômico de cada competência', () => {
    const p = projetar(serie());

    expect(p.competences.map((x) => x.statementTotalCents)).toEqual([
      c(300), c(400), c(500), c(600),
    ]);
    expect(p.competences.map((x) => x.economicStatus)).toEqual([
      'paid', 'paid', 'overdue', 'overdue',
    ]);
  });

  it('preserva a existência de reconciliação pendente, sem misturar com dívida', () => {
    const p = projetar(serie());

    // Maio gera 50 de suspense; junho consome os 50 e ainda deve 250.
    expect(p.competences[1].unresolvedReconciliationDeltaCents).toBe(c(50));
    expect(p.competences[1].economicOpenBalanceCents).toBe(0);
    expect(p.competences[2].unresolvedReconciliationDeltaCents).toBe(c(-50));
    expect(p.competences[2].economicOpenBalanceCents).toBe(c(250));
  });

  it('o delta não é escondido — cada linha carrega o seu', () => {
    const p = projetar(serie());
    const comDelta = p.competences.filter((x) => x.unresolvedReconciliationDeltaCents !== 0);
    expect(comDelta.map((x) => x.referenceMonth)).toEqual(['2026-05', '2026-06']);
  });

  it('cobre todas as competências da série, em ordem', () => {
    const p = projetar(serie());
    expect(p.competences.map((x) => x.referenceMonth)).toEqual([
      '2026-04', '2026-05', '2026-06', '2026-07',
    ]);
  });

  it('a soma dos saldos econômicos do histórico é o limite utilizado', () => {
    const p = projetar(serie());
    const somaHistorico = p.competences.reduce((a, x) => a + x.economicOpenBalanceCents, 0);
    expect(somaHistorico).toBe(p.economicUsedCents);
    expect(p.economicUsedCents).toBe(c(300));
  });
});

// ---------------------------------------------------------------------------

const LIMITE = 10000;

function contaCartao(over: Partial<Account> = {}): Account {
  return {
    id: 'acc-card',
    user_id: 'u1',
    Nome_Conta: 'Cartão',
    Tipo_Conta: 'Cartão de Crédito',
    Saldo_Inicial: 0,
    Data_Saldo_Inicial: new Date('2026-01-01'),
    limite_credito: LIMITE,
    dia_fechamento: 20,
    dia_vencimento: 28,
    ...over,
  } as Account;
}

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

const logImport = (arquivo: string, ref: string, venc: string) =>
  ({
    id: `log-${arquivo}`,
    file_name: arquivo,
    imported_details: [{ ID_Conta: 'acc-card', Card_Reference_Label: ref, Card_Due_Date: venc }],
  }) as any;

function exibir(transactions: Transaction[], account = contaCartao(), importLogs: any[] = []) {
  return computeAccountCardDisplay(account, {
    transactions,
    accounts: [account],
    importLogs,
    cardV2Enabled: false,
    cardEngineEnabled: false,
    cardSnapshotPipelineEnabled: false,
  });
}

describe('superfície do card, ponta a ponta', () => {
  it('dívida real continua aparecendo e vencendo', () => {
    const d = exibir([compra('2026-07-05', 400), pagamento('2026-07-20', 150)]);

    expect(d.faturaAtual).toBe(250);
    expect(d.faturaVencida).toBe(true);
    expect(d.limiteDisponivel).toBe(LIMITE - 250);
    expect(d.reconciliacaoPendente).toBe(false);
  });

  it('excedente sem procedência não vira crédito nem selo de vencida', () => {
    const d = exibir([compra('2026-07-05', 400), pagamento('2026-07-20', 400.22)]);

    expect(d.faturaAtual).toBe(0);
    expect(d.faturaVencida).toBe(false);
    expect(d.limiteDisponivel).toBe(LIMITE);
    expect(d.reconciliacaoPendente).toBe(true);
  });

  it('a diferença de centavos de um mês não vira dívida vencida no mês seguinte', () => {
    // O caso que produzia «FATURA EM ABERTO · VENCIDA · R$ 0,22» em produção.
    const d = exibir([
      compra('2026-06-05', 300),
      pagamento('2026-06-25', 300.22),
      compra('2026-07-05', 400),
      pagamento('2026-07-25', 399.78),
    ]);

    expect(d.faturaAtual).toBe(0);
    expect(d.faturaVencida).toBe(false);
    expect(d.limiteDisponivel).toBe(LIMITE);
  });

  it('manual', () => {
    const d = exibir([compra('2026-07-05', 400), pagamento('2026-07-20', 100)]);
    expect(d.faturaAtual).toBe(300);
    expect(d.faturaVencida).toBe(true);
  });

  it('importado — o pagamento do arquivo de agosto quita parte de julho', () => {
    const jul = 'fatura_julho.csv';
    const ago = 'fatura_agosto.csv';
    const d = exibir(
      [
        compra('2026-07-05', 400, jul),
        compra('2026-08-05', 200, ago),
        pagamento('2026-08-20', 100, ago),
      ],
      contaCartao(),
      [logImport(jul, '2026-07', '2026-08-28'), logImport(ago, '2026-08', '2026-09-28')]
    );

    expect(d.faturaAtual).toBe(300);
    expect(d.faturaVencida).toBe(true);
    expect(d.limiteDisponivel).toBe(LIMITE - 500);
  });

  it('misto — manual e importado na mesma competência', () => {
    const arq = 'fatura_julho.csv';
    const d = exibir(
      [compra('2026-07-05', 400, arq), compra('2026-07-15', 120)],
      contaCartao(),
      [logImport(arq, '2026-07', '2026-08-28')]
    );

    expect(d.faturaAtual).toBe(520);
    expect(d.limiteDisponivel).toBe(LIMITE - 520);
  });

  it('múltiplas competências: o card mostra uma, o limite soma todas', () => {
    const d = exibir([
      compra('2026-07-05', 400),
      compra('2026-08-05', 350),
      compra('2026-11-05', 200),
    ]);

    expect(d.faturaAtual).toBe(400);
    expect(d.limiteDisponivel).toBe(LIMITE - 950);
  });
});

// ---------------------------------------------------------------------------

describe('conversão de centavos para moeda', () => {
  it('não introduz deriva de ponto flutuante', () => {
    expect(centsToCurrency(c(0.22))).toBe(0.22);
    expect(centsToCurrency(c(6052.63))).toBe(6052.63);
    expect(centsToCurrency(0)).toBe(0);
  });
});
