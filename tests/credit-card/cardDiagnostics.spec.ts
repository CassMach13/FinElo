import { describe, expect, it } from 'vitest';
import {
  diagnoseCreditCard,
  summarizeCardDiagnostics,
  type CardDiagnosticsInput,
} from '../../src/domain/credit-card/cardDiagnostics';
import { projectCardTwoLedger } from '../../src/domain/credit-card/twoLedgerProjection';

/**
 * O diagnóstico do cartão.
 *
 * A pergunta que ele existe para responder é «por que meu cartão não está
 * batendo?», e o maior risco não é deixar de achar algo: é acusar problema que
 * não existe. Cada trava aqui nasceu de um alerta que parecia certo quando
 * rodado contra conta real e não era.
 *
 * As séries são montadas pelo motor de verdade — `projectCardTwoLedger` — e não
 * à mão. Um fixture escrito à mão pode descrever um estado que o domínio nunca
 * produziria, e o teste passaria provando nada.
 */

const serie = (linhas: Array<[string, string, number, number]>) =>
  projectCardTwoLedger(
    linhas.map(([referenceMonth, dueDate, statementTotal, totalPayments]) => ({
      referenceMonth,
      dueDate,
      statementTotal,
      totalPayments,
    })),
    { asOf: '2026-09-02' }
  );

const diagnosticar = (
  linhas: Array<[string, string, number, number]>,
  reconciliation?: CardDiagnosticsInput['reconciliation']
) => diagnoseCreditCard({ competences: serie(linhas).competences, reconciliation });

const codigos = (achados: ReturnType<typeof diagnosticar>) => achados.map((a) => a.code);

// ---------------------------------------------------------------------------

describe('cartão sem problema não vira alerta', () => {
  it('série toda quitada não produz nenhum item', () => {
    const achados = diagnosticar([
      ['2026-05', '2026-06-10', 1000, 1000],
      ['2026-06', '2026-07-10', 800, 800],
      ['2026-07', '2026-08-10', 500, 500],
    ]);

    expect(achados).toEqual([]);
    expect(summarizeCardDiagnostics(achados).label).toBe('Cartão consistente');
  });

  /**
   * TRAVA 1. A convenção de pagamento faz o mês N+1 quitar o mês N, então um
   * excedente aparece numa competência e a seguinte o consome. Numa conta real
   * isso gerava «R$ 138,10 pagos a mais» sobre valores já resolvidos.
   */
  it('excedente que a competência seguinte consome não é alertado', () => {
    const achados = diagnosticar([
      ['2026-05', '2026-06-10', 1000, 1060.3],
      ['2026-06', '2026-07-10', 1000, 939.7],
      ['2026-07', '2026-08-10', 500, 500],
    ]);

    expect(achados).toEqual([]);
  });

  /**
   * TRAVA 2. Que a conta do mês ainda não foi paga o usuário sabe — avisar
   * sobre a fatura mais recente é ruído.
   */
  it('a fatura mais recente em aberto não vira alerta', () => {
    const achados = diagnosticar([
      ['2026-05', '2026-06-10', 1000, 1000],
      ['2026-07', '2026-08-10', 700, 0],
    ]);

    expect(codigos(achados)).not.toContain('fatura_sem_pagamento_encontrado');
  });

  /**
   * TRAVA 3. Numa conta onde nenhuma fatura jamais recebeu pagamento, o cartão
   * é um diário de compras. Sem esta trava a regra dispara em todas as faturas
   * de uma vez, acusando de erro um jeito legítimo de usar o app.
   */
  it('conta que nunca registra pagamento não é acusada de faturas em aberto', () => {
    const achados = diagnosticar([
      ['2026-04', '2026-05-10', 134.43, 0],
      ['2026-05', '2026-06-10', 7774.15, 0],
      ['2026-06', '2026-07-10', 6596.66, 0],
      ['2026-07', '2026-08-10', 1086.3, 0],
    ]);

    expect(achados).toEqual([]);
  });
});

describe('problemas que valem alerta', () => {
  it('fatura vencida sem pagamento encontrado, numa conta que registra pagamentos', () => {
    const achados = diagnosticar([
      ['2026-03', '2026-04-10', 500, 0],
      ['2026-05', '2026-06-10', 1000, 1000],
      ['2026-07', '2026-08-10', 300, 0],
    ]);

    const item = achados.find((a) => a.code === 'fatura_sem_pagamento_encontrado');
    expect(item).toBeDefined();
    expect(item!.severity).toBe('atencao');
    expect(item!.competences).toEqual(['2026-03']);
    expect(item!.amountCents).toBe(50000);
    expect(item!.message).toMatch(/não encontramos pagamentos associados/i);
    expect(item!.message).not.toMatch(/você não pagou/i);
  });

  it('pagamento acima do valor da fatura que sobrevive até o fim', () => {
    const achados = diagnosticar([
      ['2026-05', '2026-06-10', 1000, 1250],
      ['2026-06', '2026-07-10', 800, 800],
    ]);

    const item = achados.find((a) => a.code === 'pagamento_acima_da_fatura');
    expect(item).toBeDefined();
    expect(item!.severity).toBe('atencao');
    expect(item!.amountCents).toBe(25000);
  });

  it('diferença pequena é «vale revisar», nunca erro nem crédito', () => {
    const achados = diagnosticar([
      ['2026-05', '2026-06-10', 1000, 1000.22],
      ['2026-06', '2026-07-10', 800, 800],
    ]);

    const item = achados.find((a) => a.code === 'pagamento_acima_da_fatura');
    expect(item!.severity).toBe('revisar');
    expect(item!.amountCents).toBe(22);
    expect(item!.message).not.toMatch(/erro|crédito|dívida/i);
  });

  it('pagamento que não encontrou fatura aparece', () => {
    const achados = diagnosticar([
      ['2026-05', '2026-06-10', 1000, 1000],
      ['2026-06', '2026-07-10', 0, 300],
      ['2026-07', '2026-08-10', 500, 500],
    ]);

    const item = achados.find((a) => a.code === 'pagamento_sem_fatura');
    expect(item).toBeDefined();
    expect(item!.amountCents).toBe(30000);
    expect(item!.message).toMatch(/precisa ser associado a uma fatura/i);
  });
});

describe('agregação: uma causa, um item', () => {
  it('quatro faturas sem pagamento viram UM alerta, não quatro', () => {
    const achados = diagnosticar([
      ['2026-01', '2026-02-10', 3069.86, 0],
      ['2026-02', '2026-03-10', 3335.22, 0],
      ['2026-03', '2026-04-10', 7340.22, 0],
      ['2026-04', '2026-05-10', 5163.37, 0],
      ['2026-06', '2026-07-10', 3751.2, 3751.2],
      ['2026-07', '2026-08-10', 449.15, 0],
    ]);

    const sem = achados.filter((a) => a.code === 'fatura_sem_pagamento_encontrado');
    expect(sem).toHaveLength(1);
    expect(sem[0].competences).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    expect(sem[0].amountCents).toBe(1890867);
    expect(sem[0].competenceLabel).toBe('janeiro, fevereiro, março e abril de 2026');
    expect(sem[0].title).toBe('4 faturas em aberto sem pagamento encontrado');
  });

  it('cada código aparece no máximo uma vez por severidade', () => {
    const achados = diagnosticar([
      ['2026-01', '2026-02-10', 500, 0],
      ['2026-02', '2026-03-10', 700, 0],
      ['2026-05', '2026-06-10', 1000, 1000],
      ['2026-07', '2026-08-10', 300, 0],
    ]);

    const chaves = achados.map((a) => `${a.code}:${a.severity}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});

describe('coerência com o selo A CONCILIAR', () => {
  const pilotoLinhas: Array<[string, string, number, number]> = [
    ['2024-12', '2025-01-10', 6052.63, 6052.85],
    ['2025-01', '2025-02-10', 6261.95, 6262.89],
    ['2025-02', '2025-03-10', 5798.44, 5858.74],
    ['2025-03', '2025-04-10', 6777.72, 6717.2],
    ['2026-07', '2026-08-10', 7258.08, 0],
  ];

  /**
   * A regra que este bloco existe para impedir: o card dizendo «A CONCILIAR» e
   * o diagnóstico dizendo «Cartão consistente» na mesma tela.
   */
  it('com o selo aceso, o cartão nunca é declarado consistente', () => {
    const achados = diagnosticar(pilotoLinhas, {
      pendente: true,
      referenceMonth: '2024-12',
    });

    expect(achados.length).toBeGreaterThan(0);
    expect(summarizeCardDiagnostics(achados).label).not.toBe('Cartão consistente');

    const item = achados.find((a) => a.code === 'diferenca_a_conciliar')!;
    expect(item.severity).toBe('revisar');
    expect(item.amountCents).toBe(22);
    expect(item.action).toBe('ver_diferenca');
    expect(item.message).toMatch(/diferença de R\$ 0,22/);
  });

  /** O valor sai da MESMA competência que o selo aponta — não há segunda conta. */
  it('o valor mostrado é o da competência que o selo aponta', () => {
    const achados = diagnosticar(pilotoLinhas, {
      pendente: true,
      referenceMonth: '2025-01',
    });

    const item = achados.find((a) => a.code === 'diferenca_a_conciliar')!;
    expect(item.competences).toEqual(['2025-01']);
    expect(item.amountCents).toBe(94);
  });

  it('sem o selo, a mesma série não gera item de conciliação', () => {
    expect(codigos(diagnosticar(pilotoLinhas))).not.toContain('diferenca_a_conciliar');
    expect(codigos(diagnosticar(pilotoLinhas, { pendente: false, referenceMonth: null })))
      .not.toContain('diferenca_a_conciliar');
  });

  it('a competência do selo não é alertada duas vezes', () => {
    const achados = diagnosticar(
      [
        ['2026-05', '2026-06-10', 1000, 1250],
        ['2026-06', '2026-07-10', 800, 800],
      ],
      { pendente: true, referenceMonth: '2026-05' }
    );

    expect(achados.filter((a) => a.competences.includes('2026-05'))).toHaveLength(1);
    expect(codigos(achados)).toEqual(['diferenca_a_conciliar']);
  });
});

describe('o diagnóstico não mexe no que recebe', () => {
  it('a projeção entra e sai idêntica', () => {
    const projecao = serie([
      ['2026-01', '2026-02-10', 500, 0],
      ['2026-05', '2026-06-10', 1000, 1000.5],
      ['2026-07', '2026-08-10', 300, 0],
    ]);

    const antes = JSON.stringify(projecao);
    Object.freeze(projecao.competences);
    projecao.competences.forEach((c) => Object.freeze(c));

    expect(() => diagnoseCreditCard({ competences: projecao.competences })).not.toThrow();
    expect(JSON.stringify(projecao)).toBe(antes);
  });

  it('série vazia não quebra e não inventa alerta', () => {
    expect(diagnoseCreditCard({ competences: [] })).toEqual([]);
  });
});

describe('ordem e resumo', () => {
  it('o que precisa de atenção vem antes do que só vale revisar', () => {
    // O excedente de R$ 0,40 fica na PENÚLTIMA competência e a última não tem
    // déficit — assim ele sobrevive, em vez de ser consumido e suprimido.
    const achados = diagnosticar([
      ['2026-01', '2026-02-10', 500, 0],
      ['2026-05', '2026-06-10', 1000, 1000],
      ['2026-06', '2026-07-10', 800, 800.4],
      ['2026-07', '2026-08-10', 300, 300],
    ]);

    expect(achados.length).toBeGreaterThan(1);
    expect(achados[0].severity).toBe('atencao');
    expect(achados[achados.length - 1].severity).toBe('revisar');
  });

  it('o resumo conta os itens e sinaliza atenção', () => {
    expect(summarizeCardDiagnostics([])).toEqual({
      total: 0,
      precisaAtencao: false,
      label: 'Cartão consistente',
    });

    const um = diagnosticar([
      ['2026-01', '2026-02-10', 500, 0],
      ['2026-05', '2026-06-10', 1000, 1000],
      ['2026-07', '2026-08-10', 300, 0],
    ]);
    expect(summarizeCardDiagnostics(um).label).toBe('1 item para revisar');
    expect(summarizeCardDiagnostics(um).precisaAtencao).toBe(true);
  });
});
