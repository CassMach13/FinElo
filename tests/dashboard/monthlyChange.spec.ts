import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MonthlyChangeCard, {
  MONTHLY_CHANGE_EMPTY,
  MONTHLY_CHANGE_NOTE,
  formatChangePercent,
  formatSignedCurrency,
} from '../../src/components/dashboard/MonthlyChangeCard';
import type { Category, Transaction } from '../../src/types';
import {
  computeMonthlyChange,
  getComparedMonths,
  shareOfExpenseDelta,
  type MonthlyChange,
} from '../../src/utils/monthlyChange';
import {
  SIMILAR_PACE_POINTS,
  STABLE_BAND_PERCENT,
  buildMonthlyChangeReading,
} from '../../src/utils/monthlyChangeReading';
import { computeDashboardPeriodMetrics } from '../../src/utils/dashboardMetrics';

const TODAY = '2026-10-06';

const categories: Category[] = [
  { id: '1', Nome_Categoria: 'Salário', Tipo: 'Renda' },
  { id: '2', Nome_Categoria: 'Mercado', Tipo: 'Despesa' },
  { id: '3', Nome_Categoria: 'Lazer', Tipo: 'Despesa' },
  { id: '4', Nome_Categoria: 'Transporte', Tipo: 'Despesa' },
  { id: '5', Nome_Categoria: 'Movimentação', Tipo: 'Ambos' },
  { id: '6', Nome_Categoria: 'Aportes', Tipo: 'Despesa', is_investment: true },
];

let seq = 0;
const tx = (date: string, tipo: 'Renda' | 'Despesa', valor: number, extra: Partial<Transaction> = {}): Transaction =>
  ({
    ID_Transacao: `t${(seq += 1)}`,
    Data: date,
    Descricao_Original: 'x',
    Nome_Fantasia: 'x',
    Valor: tipo === 'Despesa' ? -Math.abs(valor) : valor,
    Tipo: tipo,
    Categoria: tipo === 'Renda' ? 'Salário' : 'Mercado',
    Origem: 'manual',
    Fonte: 'Manual',
    ...extra,
  }) as unknown as Transaction;

const compute = (transactions: Transaction[], today: string = TODAY) =>
  computeMonthlyChange({ transactions, categories, today });

/** Setembro e agosto com dados mínimos. */
const base = (): Transaction[] => [
  tx('2026-08-10', 'Renda', 1000),
  tx('2026-08-12', 'Despesa', 400),
  tx('2026-09-10', 'Renda', 1100),
  tx('2026-09-12', 'Despesa', 500),
];

describe('Mudança do mês — meses comparados', () => {
  it('06/10/2026: setembro × agosto, sem outubro', () => {
    expect(getComparedMonths(TODAY)).toEqual({
      current: { year: 2026, month: 9 },
      previous: { year: 2026, month: 8 },
    });
    const m = compute([...base(), tx('2026-10-02', 'Renda', 99999), tx('2026-10-05', 'Despesa', 88888)]);
    expect(m.currentMonth).toMatchObject({ label: 'setembro', income: 1100, expense: 500 });
    expect(m.previousMonth).toMatchObject({ label: 'agosto', income: 1000, expense: 400 });
  });

  it('15/01/2027: dezembro × novembro', () => {
    expect(getComparedMonths('2027-01-15')).toEqual({
      current: { year: 2026, month: 12 },
      previous: { year: 2026, month: 11 },
    });
    const m = compute([tx('2026-12-10', 'Renda', 10), tx('2026-11-10', 'Renda', 5), tx('2027-01-02', 'Renda', 999)], '2027-01-15');
    expect(m.currentMonth.income).toBe(10);
    expect(m.previousMonth.income).toBe(5);
  });

  it('fevereiro: janeiro × dezembro; março: fevereiro × janeiro (bissexto e não)', () => {
    expect(getComparedMonths('2027-02-10')).toEqual({ current: { year: 2027, month: 1 }, previous: { year: 2026, month: 12 } });
    expect(getComparedMonths('2028-03-01')).toEqual({ current: { year: 2028, month: 2 }, previous: { year: 2028, month: 1 } });
    const m = compute([tx('2028-02-29', 'Despesa', 7), tx('2028-01-31', 'Despesa', 3), tx('2028-03-01', 'Despesa', 100)], '2028-03-01');
    expect(m.currentMonth.expense).toBe(7); // 29/02 dentro de fevereiro
    expect(m.previousMonth.expense).toBe(3);
  });

  it('nunca inclui o mês corrente, inclusive no último dia do mês', () => {
    const m = compute([tx('2026-10-31', 'Despesa', 50), ...base()], '2026-10-31');
    expect(m.currentMonth.expense).toBe(500);
  });

  it('Data_Pagamento prevalece; sem ela vale Data', () => {
    const m = compute([
      tx('2026-08-28', 'Despesa', 100, { Data_Pagamento: '2026-09-05' as unknown as Date }), // compra em agosto, paga em setembro
      tx('2026-09-30', 'Despesa', 40, { Data_Pagamento: '2026-10-05' as unknown as Date }), // paga em outubro: fora
      tx('2026-08-15', 'Despesa', 10),
    ]);
    expect(m.currentMonth.expense).toBe(100);
    expect(m.previousMonth.expense).toBe(10);
  });

  it('strings ISO com horário e Date em meia-noite UTC ficam no dia civil certo', () => {
    const m = compute([
      tx('2026-09-30T00:00:00+00:00', 'Despesa', 1),
      tx(new Date('2026-09-01T00:00:00.000Z') as unknown as string, 'Despesa', 2),
      tx('2026-08-31T00:00:00+00:00', 'Despesa', 4),
    ]);
    expect(m.currentMonth.expense).toBe(3);
    expect(m.previousMonth.expense).toBe(4);
  });

  it('mesmos valores que computeDashboardPeriodMetrics para o mesmo intervalo', () => {
    const data = [...base(), tx('2026-09-20', 'Renda', 300, { Categoria: 'Movimentação' }), tx('2026-09-21', 'Despesa', 77, { Categoria: 'Aportes' })];
    const m = compute(data);
    const sep = computeDashboardPeriodMetrics(data, categories, {
      start: new Date(2026, 8, 1, 0, 0, 0, 0),
      end: new Date(2026, 8, 30, 23, 59, 59, 999),
    }).operational;
    expect(m.currentMonth.income).toBeCloseTo(sep.income, 2);
    expect(m.currentMonth.expense).toBeCloseTo(sep.expense, 2);
  });
});

describe('Mudança do mês — elegibilidade', () => {
  it('dados nos dois meses: elegível', () => {
    expect(compute(base()).eligible).toBe(true);
  });

  it('só o último mês, ou só o anterior: não elegível', () => {
    expect(compute([tx('2026-09-10', 'Renda', 10)]).eligible).toBe(false);
    expect(compute([tx('2026-08-10', 'Renda', 10)]).eligible).toBe(false);
    expect(compute([]).eligible).toBe(false);
  });

  it('demo não cria elegibilidade nem soma', () => {
    const demo = [
      tx('2026-08-10', 'Renda', 10, { Origem: 'demo.csv' }),
      tx('2026-09-10', 'Despesa', 10, { Fonte: 'Demo' }),
    ];
    expect(compute(demo).eligible).toBe(false);
    const m = compute([...demo, ...base()]);
    expect(m.currentMonth).toMatchObject({ income: 1100, expense: 500 });
    expect(m.previousMonth).toMatchObject({ income: 1000, expense: 400 });
  });

  it('mês com só despesa ou só renda conta', () => {
    expect(compute([tx('2026-08-10', 'Despesa', 10), tx('2026-09-10', 'Renda', 10)]).eligible).toBe(true);
    expect(compute([tx('2026-08-10', 'Renda', 10), tx('2026-09-10', 'Despesa', 10)]).eligible).toBe(true);
  });

  it('valor zero/NaN/Infinity sozinho não cria mês real; Ambos/investimento também não', () => {
    const bad = (d: string, v: number) => ({ ...tx(d, 'Despesa', 1), Valor: v }) as Transaction;
    const only = [
      tx('2026-08-10', 'Renda', 10),
      tx('2026-09-10', 'Renda', 0),
      bad('2026-09-11', Number.NaN),
      bad('2026-09-12', Number.POSITIVE_INFINITY),
      tx('2026-09-13', 'Renda', 5, { Categoria: 'Movimentação' }),
      tx('2026-09-14', 'Despesa', 5, { Categoria: 'Aportes' }),
    ];
    const m = compute(only);
    expect(m.eligible).toBe(false);
    expect(m.currentMonth.hasData).toBe(false);
    expect(JSON.stringify(m)).not.toMatch(/NaN|Infinity/);
  });
});

describe('Mudança do mês — resumo', () => {
  const pct = (cur: [number, number], prev: [number, number]) =>
    compute([
      tx('2026-08-10', 'Renda', prev[0] || 0.0001), tx('2026-08-11', 'Despesa', prev[1] || 0.0001),
      tx('2026-09-10', 'Renda', cur[0] || 0.0001), tx('2026-09-11', 'Despesa', cur[1] || 0.0001),
    ]);

  it('aumento e redução de entradas e saídas, com delta absoluto', () => {
    const m = compute(base());
    expect(m.incomeChange.amount).toBe(100);
    expect(m.incomeChange.percentage).toBeCloseTo(10, 6);
    expect(m.expenseChange.amount).toBe(100);
    expect(m.expenseChange.percentage).toBeCloseTo(25, 6);
    const down = compute([
      tx('2026-08-10', 'Renda', 1000), tx('2026-08-11', 'Despesa', 400),
      tx('2026-09-10', 'Renda', 900), tx('2026-09-11', 'Despesa', 300),
    ]);
    expect(down.incomeChange).toEqual({ amount: -100, percentage: -10 });
    expect(down.expenseChange).toEqual({ amount: -100, percentage: -25 });
  });

  it('anterior zero → sem percentual (valor absoluto continua); ambos zero → sem percentual', () => {
    const m = compute([tx('2026-08-10', 'Despesa', 100), tx('2026-09-10', 'Renda', 500), tx('2026-09-11', 'Despesa', 100)]);
    expect(m.previousMonth.income).toBe(0);
    expect(m.incomeChange).toEqual({ amount: 500, percentage: null });
    const onlyExpense = compute([tx('2026-08-10', 'Despesa', 100), tx('2026-09-10', 'Despesa', 100)]);
    expect(onlyExpense.incomeChange).toEqual({ amount: 0, percentage: null });
    expect(JSON.stringify(pct([0, 0], [0, 0]))).not.toMatch(/NaN|Infinity/);
  });

  it('formatação: 1 casa, sem -0,0%, sem base = —', () => {
    expect(formatChangePercent(10)).toBe('+10,0%');
    expect(formatChangePercent(-25)).toBe('−25,0%');
    expect(formatChangePercent(-0.04)).toBe('0,0%');
    expect(formatChangePercent(0.04)).toBe('0,0%');
    expect(formatChangePercent(0)).toBe('0,0%');
    expect(formatChangePercent(-0)).toBe('0,0%');
    expect(formatChangePercent(null)).toBe('—');
    expect(formatChangePercent(Number.NaN)).toBe('—');
    expect(formatChangePercent(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatChangePercent(1 / 3)).toBe('+0,3%');
    expect(formatSignedCurrency(380)).toMatch(/^\+R\$/);
    expect(formatSignedCurrency(-290)).toMatch(/^−R\$/);
  });
});

describe('Mudança do mês — categorias de saída', () => {
  const exp = (d: string, v: number, c: string) => tx(d, 'Despesa', v, { Categoria: c });
  const data = [
    tx('2026-08-10', 'Renda', 1), tx('2026-09-10', 'Renda', 1),
    exp('2026-08-05', 1100, 'Mercado'), exp('2026-09-05', 1480, 'Mercado'), // +380
    exp('2026-08-06', 720, 'Lazer'), exp('2026-09-06', 430, 'Lazer'), // −290
    exp('2026-08-07', 300, 'Transporte'), exp('2026-09-07', 250, 'Transporte'), // −50
    exp('2026-09-08', 200, 'Nova'), // nova
    exp('2026-08-08', 120, 'Sumiu'), // desapareceu
    exp('2026-08-09', 10, 'Igual'), exp('2026-09-09', 10, 'Igual'), // delta 0
  ];

  it('aumentou, diminuiu, nova e desapareceu; top 3 por |delta|; delta zero fora', () => {
    const m = compute(data);
    expect(m.categoryChanges.map((c) => [c.category, c.delta])).toEqual([
      ['Mercado', 380],
      ['Lazer', -290],
      ['Nova', 200],
    ]);
    expect(m.allCategoryChanges.map((c) => c.category)).toEqual(['Mercado', 'Lazer', 'Nova', 'Sumiu', 'Transporte']);
    const nova = m.allCategoryChanges.find((c) => c.category === 'Nova')!;
    expect(nova).toMatchObject({ previousAmount: 0, currentAmount: 200 });
    const sumiu = m.allCategoryChanges.find((c) => c.category === 'Sumiu')!;
    expect(sumiu).toMatchObject({ previousAmount: 120, currentAmount: 0, delta: -120 });
    expect(m.allCategoryChanges.find((c) => c.category === 'Igual')).toBeUndefined();
  });

  it('empate em |delta| é determinístico (nome) e independe da ordem de entrada', () => {
    const tie = [
      tx('2026-08-10', 'Renda', 1), tx('2026-09-10', 'Renda', 1),
      exp('2026-09-01', 100, 'Zeta'), exp('2026-08-01', 100, 'Beta'), exp('2026-09-02', 100, 'Alfa'),
    ];
    const a = compute(tie).allCategoryChanges.map((c) => c.category);
    const b = compute([...tie].reverse()).allCategoryChanges.map((c) => c.category);
    expect(a).toEqual(['Alfa', 'Beta', 'Zeta']);
    expect(b).toEqual(a);
  });

  it('Ambos, investimento, demo e Renda não entram nas categorias', () => {
    const m = compute([
      ...base(),
      exp('2026-09-05', 999, 'Movimentação'),
      exp('2026-09-05', 999, 'Aportes'),
      tx('2026-09-05', 'Despesa', 999, { Categoria: 'Lazer', Origem: 'demo.csv' }),
      tx('2026-09-05', 'Renda', 999, { Categoria: 'Lazer' }),
    ]);
    expect(m.allCategoryChanges.map((c) => c.category)).toEqual(['Mercado']);
  });

  it('parcela de contribuição só com mesmo sinal do total e total ≠ 0', () => {
    const m = compute(data);
    const mercado = m.allCategoryChanges.find((c) => c.category === 'Mercado')!;
    const lazer = m.allCategoryChanges.find((c) => c.category === 'Lazer')!;
    expect(m.totalExpenseDelta).toBe(m.currentMonth.expense - m.previousMonth.expense);
    expect(shareOfExpenseDelta(mercado, m.totalExpenseDelta)).not.toBeNull();
    expect(shareOfExpenseDelta(lazer, m.totalExpenseDelta)).toBeNull();
    expect(shareOfExpenseDelta(mercado, 0)).toBeNull();
  });
});

describe('Leitura do FinElo — mudança do mês', () => {
  const L = { current: 'setembro', previous: 'agosto' };
  const r = (i: number | null, e: number | null) => buildMonthlyChangeReading(i, e, L);

  it('limiares documentados', () => {
    expect(STABLE_BAND_PERCENT).toBe(5);
    expect(SIMILAR_PACE_POINTS).toBe(2);
  });

  it('saídas cresceram mais / entradas cresceram mais', () => {
    expect(r(5, 20).text).toBe('As saídas registradas cresceram mais que as entradas em setembro.');
    expect(r(20, 5).text).toBe('As entradas registradas cresceram mais que as saídas em setembro.');
  });

  it('ritmo semelhante, com limite de 2 p.p.', () => {
    expect(r(10, 11.5).text).toBe('Entradas e saídas registradas cresceram em ritmo semelhante.');
    expect(r(-10, -11.5).text).toBe('Entradas e saídas registradas diminuíram em ritmo semelhante.');
    expect(r(10, 11.99).kind).toBe('similar');
    expect(r(10, 12).kind).toBe('expense_faster');
  });

  it('estabilidade, com limite de 5%', () => {
    expect(r(4.99, -4.99).text).toBe('Os valores registrados ficaram próximos aos de agosto.');
    expect(r(5, 0).kind).not.toBe('stable');
  });

  it('saídas diminuíram', () => {
    expect(r(0, -20).text).toContain('saídas registradas diminuíram em setembro');
    expect(r(10, -10).text).toBe('As entradas registradas aumentaram e as saídas registradas diminuíram em setembro.');
    expect(r(-5, -20).text).toBe('As saídas registradas diminuíram mais que as entradas em setembro.');
  });

  it('percentual indisponível em um lado ou nos dois', () => {
    expect(r(null, null).kind).toBe('unavailable');
    expect(r(null, 20).text).toBe('As saídas registradas aumentaram em setembro.');
    expect(r(-20, null).text).toBe('As entradas registradas diminuíram em setembro.');
    expect(r(null, 1).text).toBe('As saídas registradas ficaram próximas às de agosto.');
    expect(r(Number.NaN, 20).text).toBe('As saídas registradas aumentaram em setembro.');
  });

  it('toda frase menciona registrad* e nunca usa linguagem proibida', () => {
    const rates = [null, -30, -12, -5, -4.9, 0, 1, 4.9, 5, 12, 30];
    const banned = /infla|padr[aã]o de vida|poder (de compra|aquisitivo)|gastando demais|renda real|consumo aumentou|melhorou|piorou/i;
    for (const i of rates) {
      for (const e of rates) {
        const { text } = r(i, e);
        expect(text, `${i}/${e}`).toMatch(/registrad/);
        expect(text, `${i}/${e}`).not.toMatch(banned);
        expect(text).not.toMatch(/NaN|Infinity|undefined/);
      }
    }
  });
});

describe('MonthlyChangeCard — render', () => {
  const model: MonthlyChange = compute([
    tx('2026-08-10', 'Renda', 1000), tx('2026-09-10', 'Renda', 1100),
    tx('2026-08-05', 'Despesa', 1100, { Categoria: 'Mercado' }), tx('2026-09-05', 'Despesa', 1480, { Categoria: 'Mercado' }),
    tx('2026-08-06', 'Despesa', 720, { Categoria: 'Lazer' }), tx('2026-09-06', 'Despesa', 430, { Categoria: 'Lazer' }),
  ]);
  const html = renderToStaticMarkup(React.createElement(MonthlyChangeCard, { model }));

  it('título, subtítulo, meses, resumos e nota', () => {
    expect(html).toContain('O que mudou no seu mês?');
    expect(html).toContain('Compare o último mês completo com o mês anterior.');
    expect(html).toContain('Setembro × Agosto');
    expect(html).toContain('Entradas registradas');
    expect(html).toContain('Saídas registradas');
    expect(html).toContain('Leitura do FinElo');
    expect(html).toContain(MONTHLY_CHANGE_NOTE);
    expect(html).toContain('+10,0%');
  });

  it('top de categorias com Agosto → Setembro e delta sinalizado; sem afirmar causa', () => {
    expect(html).toContain('O que mais mudou nas saídas');
    expect(html).toContain('Categorias com maior variação registrada');
    expect(html).toContain('Mercado');
    expect(html).toContain('Lazer');
    expect(html).toMatch(/\+R\$\s?380,00/);
    expect(html).toMatch(/−R\$\s?290,00/);
    expect(html).not.toMatch(/causou|culpa|explica seu aumento/i);
  });

  it('sem saldo, sem NaN/Infinity e sem linguagem proibida', () => {
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
    expect(html).not.toMatch(/saldo|infla|padrão de vida|poder de compra|gastando demais|renda real/i);
  });

  it('anterior zero mostra — e o valor absoluto', () => {
    const m = compute([tx('2026-08-10', 'Despesa', 100), tx('2026-09-10', 'Renda', 500), tx('2026-09-11', 'Despesa', 100)]);
    const out = renderToStaticMarkup(React.createElement(MonthlyChangeCard, { model: m }));
    expect(out).toContain('—');
    expect(out).toContain('sem base no mês anterior');
    expect(out).toMatch(/R\$\s?500,00/);
  });

  it('sem mudança de categoria: mensagem em vez de lista vazia', () => {
    const same = compute([
      tx('2026-08-10', 'Renda', 10), tx('2026-09-10', 'Renda', 10),
      tx('2026-08-11', 'Despesa', 5), tx('2026-09-11', 'Despesa', 5),
    ]);
    expect(same.categoryChanges).toHaveLength(0);
    const out = renderToStaticMarkup(React.createElement(MonthlyChangeCard, { model: same }));
    expect(out).toContain('Sem mudanças relevantes nas categorias de saída entre os dois meses.');
    expect(out).not.toContain('<ul class="mt-1');
  });

  it('inelegível: estado compacto, sem números', () => {
    const out = renderToStaticMarkup(React.createElement(MonthlyChangeCard, { model: compute([tx('2026-09-10', 'Renda', 10)]) }));
    expect(out).toContain(MONTHLY_CHANGE_EMPTY);
    expect(out).not.toContain('Entradas registradas');
    expect(out).not.toMatch(/R\$/);
  });
});

describe('Integração na Dashboard e layout móvel (contrato de código)', () => {
  const read = (p: string) => readFileSync(resolve(p), 'utf8');
  const dashboard = read('src/components/views/DashboardView.tsx');
  const card = read('src/components/dashboard/MonthlyChangeCard.tsx');

  it('fica depois do 50-30-20 e antes da Evolução anual', () => {
    const rule = dashboard.indexOf('Método 50-30-20 (Saúde Financeira)');
    const monthly = dashboard.indexOf('<MonthlyChangeCard');
    const annual = dashboard.indexOf('<AnnualEvolutionCard');
    expect(monthly).toBeGreaterThan(rule);
    expect(annual).toBeGreaterThan(monthly);
    expect(dashboard).toMatch(/computeMonthlyChange\(\{ transactions, categories: allCategories, today: todayKey \}\)/);
  });

  it('layout móvel: empilha, quebra texto, sem largura fixa', () => {
    expect(card).toContain('grid-cols-1');
    expect(card).toContain('sm:grid-cols-2');
    expect(card).toContain('break-words');
    expect(card).toContain('min-w-0');
    expect(card).not.toMatch(/min-w-\[\d+px\]|overflow-x-(auto|scroll)/);
  });

  it('sem rede, banco, analytics ou ajuda', () => {
    for (const p of ['src/components/dashboard/MonthlyChangeCard.tsx', 'src/utils/monthlyChange.ts', 'src/utils/monthlyChangeReading.ts']) {
      expect(read(p)).not.toMatch(/supabase|fetch\(|trackProductEvent|helpIntent|localStorage/);
    }
  });
});
