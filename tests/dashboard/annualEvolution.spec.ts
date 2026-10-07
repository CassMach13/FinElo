import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AnnualEvolutionCard, {
  ANNUAL_EVOLUTION_DISCLAIMER,
} from '../../src/components/dashboard/AnnualEvolutionCard';
import AnnualEvolutionChart, {
  MonthTooltipBody,
  NO_DATA_LABEL,
  buildGappedPath,
  seriesHasData,
  seriesValueLabel,
} from '../../src/components/charts/AnnualEvolutionChart';
import type { Category, Transaction } from '../../src/types';
import { formatCurrency } from '../../src/utils/formatters';
import {
  computeAnnualChangePercent,
  computeAnnualEvolution,
  type AnnualEvolution,
} from '../../src/utils/annualEvolution';
import {
  SIMILAR_PACE_POINTS,
  STABLE_BAND_PERCENT,
  buildAnnualEvolutionReading,
} from '../../src/utils/annualEvolutionReading';
import { computeDashboardPeriodMetrics } from '../../src/utils/dashboardMetrics';

const TODAY = '2026-10-06';

const categories: Category[] = [
  { id: '1', Nome_Categoria: 'Salário', Tipo: 'Renda' },
  { id: '2', Nome_Categoria: 'Mercado', Tipo: 'Despesa' },
  { id: '3', Nome_Categoria: 'Movimentação', Tipo: 'Ambos' },
  { id: '4', Nome_Categoria: 'Aportes', Tipo: 'Despesa', is_investment: true },
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

/** Um par renda+despesa por mês, em cada um dos anos pedidos. */
const monthsOf = (year: number, months: number[], income = 1000, expense = 400): Transaction[] =>
  months.flatMap((m) => {
    const d = `${year}-${String(m).padStart(2, '0')}-10`;
    return [tx(d, 'Renda', income), tx(d, 'Despesa', expense)];
  });

const compute = (transactions: Transaction[], today: string = TODAY) =>
  computeAnnualEvolution({ transactions, categories, today });

const eligible = (m: AnnualEvolution) => {
  if (m.status !== 'eligible') throw new Error(`esperava elegível, veio ${m.status}/${m.reason}`);
  return m;
};

describe('Evolução anual — período e meses completos', () => {
  it('em 06/10/2026 compara jan–set/2026 com jan–set/2025, sem outubro', () => {
    const data = [
      ...monthsOf(2026, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      ...monthsOf(2025, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    ];
    const m = eligible(compute(data));
    expect(m.currentYear).toBe(2026);
    expect(m.previousYear).toBe(2025);
    expect(m.lastMonth).toBe(9);
    expect(m.months.map((x) => x.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // outubro (parcial em 2026, inteiro em 2025) fica de fora dos dois lados
    expect(m.totals.incomeCurrent).toBe(9000);
    expect(m.totals.incomePrevious).toBe(9000);
  });

  it('outubro excluído mesmo com valor alto só nele', () => {
    const data = [...monthsOf(2026, [1, 2, 3]), ...monthsOf(2025, [1, 2, 3]), tx('2026-10-02', 'Renda', 99999)];
    expect(eligible(compute(data)).totals.incomeCurrent).toBe(3000);
  });

  it('em janeiro ainda não há mês completo: não elegível', () => {
    const m = compute([...monthsOf(2026, [1]), ...monthsOf(2025, [1, 2, 3])], '2026-01-15');
    expect(m).toMatchObject({ status: 'ineligible', reason: 'no_complete_month', lastMonth: 0 });
  });

  it('em fevereiro só janeiro é completo: menos de 3 pares', () => {
    const m = compute([...monthsOf(2026, [1]), ...monthsOf(2025, [1])], '2026-02-01');
    expect(m).toMatchObject({ status: 'ineligible', reason: 'insufficient_paired_months', lastMonth: 1 });
  });

  it('o último dia do mês corrente ainda é mês parcial; o dia 1º do seguinte já o completa', () => {
    const data = [...monthsOf(2026, [1, 2, 3]), ...monthsOf(2025, [1, 2, 3])];
    expect(eligible(compute(data, '2026-04-30')).lastMonth).toBe(3);
    expect(eligible(compute(data, '2026-05-01')).lastMonth).toBe(4);
  });
});

describe('Evolução anual — elegibilidade (3 meses pareados com dado real)', () => {
  it('3 meses pareados: elegível', () => {
    const m = compute([...monthsOf(2026, [1, 2, 3]), ...monthsOf(2025, [1, 2, 3])]);
    expect(m.status).toBe('eligible');
  });

  it('menos de 3 pareados: não elegível e informa quantos', () => {
    const m = compute([...monthsOf(2026, [1, 2, 3]), ...monthsOf(2025, [1, 2])]);
    expect(m).toMatchObject({ status: 'ineligible', reason: 'insufficient_paired_months', pairedMonths: [1, 2] });
  });

  it('meses não consecutivos contam (jan, mar, abr nos dois anos)', () => {
    const m = eligible(compute([...monthsOf(2026, [1, 3, 4]), ...monthsOf(2025, [1, 3, 4])]));
    expect(m.pairedMonths).toEqual([1, 3, 4]);
  });

  it('meses diferentes em cada ano não formam par', () => {
    const m = compute([...monthsOf(2026, [1, 2, 3]), ...monthsOf(2025, [4, 5, 6])]);
    expect(m).toMatchObject({ status: 'ineligible', pairedMonths: [] });
  });

  it('mês sem lançamentos fica no eixo com zero, não é pareado e não entra nos totais', () => {
    const m = eligible(
      compute([...monthsOf(2026, [1, 2, 4, 5]), ...monthsOf(2025, [1, 2, 3, 4])]) // 2026 sem mar; 2025 sem mai
    );
    const march = m.months.find((x) => x.month === 3)!;
    expect(march).toMatchObject({ incomeCurrent: 0, expenseCurrent: 0, incomePrevious: 1000, paired: false });
    expect(m.pairedMonths).toEqual([1, 2, 4]);
    expect(m.totals).toEqual({
      incomeCurrent: 3000,
      incomePrevious: 3000,
      expenseCurrent: 1200,
      expensePrevious: 1200,
    });
  });

  it('demo não conta para elegibilidade nem para valores', () => {
    const demo = [
      ...monthsOf(2026, [1, 2, 3]).map((t) => ({ ...t, Origem: 'demo.csv' }) as Transaction),
      ...monthsOf(2025, [1, 2, 3]).map((t) => ({ ...t, Fonte: 'Demo' }) as Transaction),
    ];
    expect(compute(demo)).toMatchObject({ status: 'ineligible', pairedMonths: [] });

    const mixed = eligible(compute([...demo, ...monthsOf(2026, [4, 5, 6]), ...monthsOf(2025, [4, 5, 6])]));
    expect(mixed.pairedMonths).toEqual([4, 5, 6]);
    expect(mixed.totals.incomeCurrent).toBe(3000);
  });

  it('só categoria Ambos/investimento não cria mês com dado', () => {
    const excluded = (year: number) =>
      [1, 2, 3].flatMap((m) => [
        tx(`${year}-0${m}-10`, 'Renda', 500, { Categoria: 'Movimentação' }),
        tx(`${year}-0${m}-11`, 'Despesa', 500, { Categoria: 'Aportes' }),
      ]);
    expect(compute([...excluded(2026), ...excluded(2025)])).toMatchObject({ status: 'ineligible', pairedMonths: [] });
  });

  it('valor zero ou não finito não conta como dado e nunca vira NaN', () => {
    const bad = (year: number) =>
      [1, 2, 3].flatMap((m) => [
        tx(`${year}-0${m}-10`, 'Renda', 0),
        { ...tx(`${year}-0${m}-12`, 'Despesa', 1), Valor: Number.NaN } as Transaction,
        { ...tx(`${year}-0${m}-13`, 'Renda', 1), Valor: Number.POSITIVE_INFINITY } as Transaction,
      ]);
    expect(compute([...bad(2026), ...bad(2025)])).toMatchObject({ status: 'ineligible', pairedMonths: [] });

    const m = eligible(compute([...bad(2026), ...monthsOf(2026, [1, 2, 3]), ...monthsOf(2025, [1, 2, 3])]));
    expect(JSON.stringify(m)).not.toMatch(/NaN|Infinity|null.*NaN/);
    expect(m.totals.incomeCurrent).toBe(3000);
  });
});

describe('Evolução anual — mesmas regras da Dashboard', () => {
  it('cada mês é igual ao computeDashboardPeriodMetrics do mesmo intervalo, categorias e dados', () => {
    const data = [
      ...monthsOf(2026, [1, 2, 3], 1000, 400),
      ...monthsOf(2025, [1, 2, 3], 800, 300),
      tx('2026-02-20', 'Renda', 700, { Categoria: 'Movimentação' }),
      tx('2026-02-21', 'Despesa', 650, { Categoria: 'Aportes' }),
      tx('2025-03-05', 'Despesa', 55.55),
    ];
    const m = eligible(compute(data));
    for (const row of m.months.filter((r) => r.paired)) {
      const range = (year: number) => ({
        start: new Date(year, row.month - 1, 1, 0, 0, 0, 0),
        end: new Date(year, row.month, 0, 23, 59, 59, 999),
      });
      const cur = computeDashboardPeriodMetrics(data, categories, range(2026)).operational;
      const prev = computeDashboardPeriodMetrics(data, categories, range(2025)).operational;
      expect(row.incomeCurrent).toBeCloseTo(cur.income, 2);
      expect(row.expenseCurrent).toBeCloseTo(cur.expense, 2);
      expect(row.incomePrevious).toBeCloseTo(prev.income, 2);
      expect(row.expensePrevious).toBeCloseTo(prev.expense, 2);
    }
  });

  it('mantém o contrato operacional: par de pagamento em categoria Renda soma nos dois lados', () => {
    const payment = (year: number) =>
      [1, 2, 3].flatMap((m) => [
        tx(`${year}-0${m}-15`, 'Renda', 300, { Categoria: 'Salário' }),
        tx(`${year}-0${m}-15`, 'Despesa', 300, { Categoria: 'Salário' }),
      ]);
    const m = eligible(compute([...payment(2026), ...payment(2025)]));
    expect(m.totals.incomeCurrent).toBe(900);
    expect(m.totals.expenseCurrent).toBe(900);
  });

  it('usa Data_Pagamento; sem ela, Data', () => {
    const data = [
      // compra em fev, paga em mar -> março
      tx('2026-02-28', 'Despesa', 100, { Data_Pagamento: '2026-03-05' as unknown as Date }),
      // sem Data_Pagamento -> Data (abril)
      tx('2026-04-02', 'Despesa', 40),
      // paga em outubro (mês parcial): fora, apesar de Data em setembro
      tx('2026-09-30', 'Despesa', 999, { Data_Pagamento: '2026-10-03' as unknown as Date }),
      ...monthsOf(2025, [3, 4, 5], 0.01, 1),
      ...monthsOf(2026, [5], 1, 1),
    ];
    const m = eligible(compute(data));
    expect(m.months[1].expenseCurrent).toBe(0); // fevereiro não recebe a compra
    expect(m.months[2].expenseCurrent).toBe(100); // março
    expect(m.months[3].expenseCurrent).toBe(40); // abril
    expect(m.months.reduce((s, r) => s + r.expenseCurrent, 0)).toBe(100 + 40 + 1);
  });
});

describe('Evolução anual — variação percentual', () => {
  const base = (cur: [number, number], prev: [number, number]) =>
    eligible(
      compute([
        ...monthsOf(2026, [1, 2, 3], cur[0] / 3, cur[1] / 3),
        ...monthsOf(2025, [1, 2, 3], prev[0] / 3, prev[1] / 3),
      ])
    );

  it('((atual − anterior) / abs(anterior)) × 100', () => {
    const m = base([1100, 900], [1000, 1000]);
    expect(m.incomeChangePercent).toBeCloseTo(10, 6);
    expect(m.expenseChangePercent).toBeCloseTo(-10, 6);
  });

  it('computeAnnualChangePercent: anterior 0, ambos 0, NaN e Infinity não geram percentual', () => {
    expect(computeAnnualChangePercent(100, 0)).toBeNull();
    expect(computeAnnualChangePercent(0, 0)).toBeNull();
    expect(computeAnnualChangePercent(Number.NaN, 10)).toBeNull();
    expect(computeAnnualChangePercent(10, Number.NaN)).toBeNull();
    expect(computeAnnualChangePercent(Number.POSITIVE_INFINITY, 10)).toBeNull();
    expect(computeAnnualChangePercent(10, Number.NEGATIVE_INFINITY)).toBeNull();
    expect(computeAnnualChangePercent(0, 50)).toBe(-100);
  });

  it('ano anterior sem entradas (mas com saídas): percentual de entradas indisponível', () => {
    const data = [
      ...monthsOf(2026, [1, 2, 3], 1000, 400),
      ...[1, 2, 3].map((m) => tx(`2025-0${m}-10`, 'Despesa', 400)),
    ];
    const m = eligible(compute(data));
    expect(m.totals.incomePrevious).toBe(0);
    expect(m.incomeChangePercent).toBeNull();
    expect(m.expenseChangePercent).toBe(0);
  });

  it('ambos zero em uma natureza: sem percentual', () => {
    const only = (year: number) => [1, 2, 3].map((m) => tx(`${year}-0${m}-10`, 'Despesa', 100));
    const m = eligible(compute([...only(2026), ...only(2025)]));
    expect(m.incomeChangePercent).toBeNull();
    expect(m.expenseChangePercent).toBe(0);
  });
});

describe('Leitura do FinElo — regra determinística', () => {
  const text = (i: number | null, e: number | null) => buildAnnualEvolutionReading(i, e);

  it('documenta os limiares', () => {
    expect(STABLE_BAND_PERCENT).toBe(5);
    expect(SIMILAR_PACE_POINTS).toBe(2);
  });

  it('entradas cresceram mais que saídas', () => {
    expect(text(20, 8)).toEqual({
      kind: 'income_faster',
      text: 'Nos seus lançamentos registrados, as entradas cresceram mais que as saídas.',
    });
  });

  it('saídas cresceram mais rápido que entradas', () => {
    expect(text(8, 20)).toEqual({
      kind: 'expense_faster',
      text: 'Nos seus lançamentos registrados, as saídas cresceram mais rápido que as entradas.',
    });
  });

  it('ritmo semelhante (diferença < 2 p.p.)', () => {
    expect(text(10, 11.5).text).toBe('Entradas e saídas registradas cresceram em ritmo semelhante.');
    expect(text(-10, -11.5).text).toBe('Entradas e saídas registradas diminuíram em ritmo semelhante.');
  });

  it('limite de 2 p.p.: 1,99 é semelhante, 2,00 não é', () => {
    expect(text(10, 11.99).kind).toBe('similar');
    expect(text(10, 12).kind).toBe('expense_faster');
    expect(text(12, 10).kind).toBe('income_faster');
  });

  it('estabilidade: as duas variações abaixo de 5% em módulo', () => {
    expect(text(4.99, -4.99)).toEqual({
      kind: 'stable',
      text: 'Os valores registrados permaneceram relativamente estáveis.',
    });
    expect(text(0, 0).kind).toBe('stable');
  });

  it('limite de 5%: 5,00 já não é estável', () => {
    expect(text(5, 0).kind).not.toBe('stable');
    expect(text(0, -5).kind).not.toBe('stable');
    expect(text(5, 4.99).kind).toBe('similar'); // fora da banda, mas ritmo semelhante
  });

  it('sinais opostos e quedas', () => {
    expect(text(10, -10).text).toBe('Nos seus lançamentos registrados, as entradas aumentaram e as saídas diminuíram.');
    expect(text(-10, 10).text).toBe('Nos seus lançamentos registrados, as saídas aumentaram e as entradas diminuíram.');
    expect(text(-5, -20).text).toBe('Nos seus lançamentos registrados, as saídas diminuíram mais que as entradas.');
    expect(text(-20, -5).text).toBe('Nos seus lançamentos registrados, as entradas diminuíram mais que as saídas.');
  });

  it('um lado estável e o outro não', () => {
    expect(text(12, 1).text).toContain('as entradas aumentaram enquanto as saídas ficaram relativamente estáveis');
    expect(text(1, 12).text).toContain('as saídas aumentaram enquanto as entradas ficaram relativamente estáveis');
    expect(text(-12, 1).text).toContain('as entradas diminuíram enquanto as saídas ficaram relativamente estáveis');
    expect(text(1, -12).text).toContain('as saídas diminuíram enquanto as entradas ficaram relativamente estáveis');
  });

  it('sem base: nenhuma conclusão', () => {
    for (const [i, e] of [[null, 5], [5, null], [null, null], [Number.NaN, 1], [1, Number.POSITIVE_INFINITY]] as const) {
      expect(text(i, e).kind).toBe('unavailable');
    }
  });

  it('toda frase fala em lançamentos/valores registrados e evita diagnóstico', () => {
    const rates = [-30, -12, -5, -4.9, -1, 0, 1, 4.9, 5, 12, 30];
    const banned = /infla|padr[aã]o de vida|poder (de compra|aquisitivo)|gastando demais|renda real|crescimento real|economia real|piorou|melhorou/i;
    for (const i of rates) {
      for (const e of rates) {
        const { text: t } = text(i, e);
        expect(t, `${i}/${e}`).toMatch(/registrad/);
        expect(t, `${i}/${e}`).not.toMatch(banned);
      }
    }
    expect(text(null, 1).text).toMatch(/registrados/);
  });
});

describe('AnnualEvolutionCard — renderização', () => {
  const eligibleModel = eligible(
    compute([...monthsOf(2026, [1, 2, 3, 4, 5, 6, 7, 8, 9]), ...monthsOf(2025, [1, 2, 3, 4, 5, 6, 7, 8, 9], 800, 300)])
  );
  const html = renderToStaticMarkup(React.createElement(AnnualEvolutionCard, { model: eligibleModel }));

  it('título, subtítulo, período e disclaimer', () => {
    expect(html).toContain('Evolução anual');
    expect(html).toContain('Compare suas entradas e saídas registradas com o mesmo período do ano anterior.');
    expect(html).toContain('Jan–Set 2026 vs. Jan–Set 2025');
    expect(html).toContain(ANNUAL_EVOLUTION_DISCLAIMER);
    expect(ANNUAL_EVOLUTION_DISCLAIMER).toContain('identificados pelo FinElo não entram nos totais');
    expect(ANNUAL_EVOLUTION_DISCLAIMER).toContain('ainda não identificados podem influenciá-los');
    expect(ANNUAL_EVOLUTION_DISCLAIMER).not.toMatch(/todas as transferências/i);
  });

  it('resumos anterior → atual com variação e Leitura do FinElo', () => {
    expect(html).toContain('Entradas');
    expect(html).toContain('Saídas');
    expect(html).toContain('R$');
    expect(html).toContain('+25.0%'); // 1000 vs 800
    expect(html).toContain('Leitura do FinElo');
    expect(html).toContain('Nos seus lançamentos registrados');
  });

  it('legenda com as quatro séries; sólido atual, tracejado anterior', () => {
    for (const label of ['Entradas 2026', 'Entradas 2025', 'Saídas 2026', 'Saídas 2025']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('stroke-dasharray');
    // redesign: 2 linhas atuais (2.65, sólidas) + 2 anteriores (1.3, tracejadas) + 2 brilhos atrás das atuais
    expect(html.match(/<path d="M[^"]*" fill="none" stroke="#(49d2c7|ff7673)" stroke-width="2.65"/g)?.length).toBe(2);
    expect(html.match(/<path d="M[^"]*" fill="none" stroke="#(6dcec8|ff9794)" stroke-width="1.3" stroke-dasharray="3.5 5"/g)?.length).toBe(2);
  });

  it('sem NaN, Infinity ou linguagem de diagnóstico', () => {
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
    expect(html).not.toMatch(/infla|padrão de vida|poder de compra|gastando demais|renda real/i);
  });

  it('anterior sem base: mostra "—" e não percentual', () => {
    const noBase = eligible(
      compute([
        ...monthsOf(2026, [1, 2, 3]),
        ...[1, 2, 3].map((m) => tx(`2025-0${m}-10`, 'Despesa', 400)),
      ])
    );
    const out = renderToStaticMarkup(React.createElement(AnnualEvolutionCard, { model: noBase }));
    expect(out).toContain('—');
    expect(out).toContain('sem base no ano anterior');
    expect(out).not.toMatch(/NaN|Infinity/);
  });

  it('meses sem par ficam explícitos nos totais', () => {
    const partial = eligible(compute([...monthsOf(2026, [1, 2, 3, 4]), ...monthsOf(2025, [1, 2, 3])]));
    const out = renderToStaticMarkup(React.createElement(AnnualEvolutionCard, { model: partial }));
    expect(out).toContain('Os totais consideram os 3 meses com lançamentos nos dois anos');
  });

  it('inelegível com dados insuficientes: estado compacto, sem gráfico', () => {
    const m = compute([...monthsOf(2026, [1, 2]), ...monthsOf(2025, [1, 2])]);
    const out = renderToStaticMarkup(React.createElement(AnnualEvolutionCard, { model: m }));
    expect(out).toContain('pelo menos 3 meses completos');
    expect(out).not.toContain('<svg role="img"');
    expect(out).not.toContain('Leitura do FinElo');
  });

  it('sem mês completo (janeiro): bloco oculto', () => {
    const m = compute([], '2026-01-20');
    expect(renderToStaticMarkup(React.createElement(AnnualEvolutionCard, { model: m }))).toBe('');
  });
});

describe('Integração na Dashboard e layout móvel (contrato de código)', () => {
  const read = (p: string) => readFileSync(resolve(p), 'utf8');
  const dashboard = read('src/components/views/DashboardView.tsx');
  const card = read('src/components/dashboard/AnnualEvolutionCard.tsx');
  const chart = read('src/components/charts/AnnualEvolutionChart.tsx');

  it('renderiza imediatamente depois do 50-30-20 e antes do patrimônio', () => {
    const rule = dashboard.indexOf('Método 50-30-20 (Saúde Financeira)');
    const annual = dashboard.indexOf('<AnnualEvolutionCard');
    const netWorth = dashboard.indexOf('<NetWorthSummaryCard');
    expect(rule).toBeGreaterThan(0);
    expect(annual).toBeGreaterThan(rule);
    expect(netWorth).toBeGreaterThan(annual);
    // nada entre o fim do contêiner do 50-30-20 e o novo bloco
    const between = dashboard.slice(dashboard.lastIndexOf('</Card>', annual), annual);
    // o único bloco permitido entre os dois é "O que mudou no seu mês?" (MonthlyChangeCard)
    expect(between.replace('<MonthlyChangeCard model={monthlyChange} />', '').replace(/\s+/g, ' ')).toBe('</Card> </div> ');
  });

  it('calcula sobre todo o histórico, independente do período selecionado', () => {
    expect(dashboard).toMatch(/computeAnnualEvolution\(\{ transactions, categories: allCategories, today: todayKey, economicKindByEventId \}\)/);
  });

  it('resumos empilham no mobile, textos quebram e nada força largura', () => {
    expect(card).toContain('grid-cols-1');
    expect(card).toContain('sm:grid-cols-2');
    expect(card).toContain('min-w-0');
    expect(card).toContain('break-words');
    expect(card).toContain('flex-wrap');
    expect(chart).toContain('max-w-full');
    expect(chart).toContain('flex-wrap');
    expect(chart).not.toMatch(/min-w-\[\d+px\]/);
    expect(chart).not.toMatch(/overflow-x-(auto|scroll)/);
  });

  it('tooltip é limitado ao contêiner e há tabela acessível', () => {
    expect(chart).toMatch(/Math\.min\(Math\.max\(x\(active\) - TOOLTIP_WIDTH \/ 2, 0\), Math\.max\(0, width - TOOLTIP_WIDTH\)\)/);
    expect(chart).toContain('sr-only');
    expect(chart).toContain('ResizeObserver');
  });

  it('o recurso não toca em rede, banco nem nos demais cards', () => {
    for (const src of [card, chart, read('src/utils/annualEvolution.ts'), read('src/utils/annualEvolutionReading.ts')]) {
      expect(src).not.toMatch(/supabase|fetch\(|localStorage|trackProductEvent/);
    }
  });
});

describe('Evolução anual — "sem dados" é diferente de zero', () => {
  // hoje = 15/05/2026 → jan–abr completos. 2025 não tem nada em fevereiro.
  const TODAY_MAY = '2026-05-15';
  const base = () => [
    ...monthsOf(2026, [1, 2, 3, 4], 1000, 400),
    ...monthsOf(2025, [1, 3, 4], 800, 300),
  ];
  const model = () => eligible(compute(base(), TODAY_MAY));
  const feb = (m: Extract<AnnualEvolution, { status: 'eligible' }>) => m.months[1];

  it('A. fevereiro do ano anterior sem lançamento: sem dados, não zero observado', () => {
    const f = feb(model());
    expect(f.previousCount).toBe(0);
    expect(seriesHasData(f, 'incomePrevious')).toBe(false);
    expect(seriesHasData(f, 'expensePrevious')).toBe(false);
    expect(seriesValueLabel(f, 'incomePrevious')).toBe(NO_DATA_LABEL);
    expect(seriesValueLabel(f, 'expensePrevious')).toBe(NO_DATA_LABEL);
    expect(seriesHasData(f, 'incomeCurrent')).toBe(true);
    expect(seriesValueLabel(f, 'incomeCurrent')).toBe(formatCurrency(1000));
  });

  it('B. ano atual sem lançamento no mês: mesma regra', () => {
    const m = eligible(compute([...monthsOf(2026, [1, 3, 4]), ...monthsOf(2025, [1, 2, 3, 4])], TODAY_MAY));
    const f = feb(m);
    expect(f.currentCount).toBe(0);
    expect(seriesValueLabel(f, 'incomeCurrent')).toBe(NO_DATA_LABEL);
    expect(seriesValueLabel(f, 'expenseCurrent')).toBe(NO_DATA_LABEL);
    expect(seriesValueLabel(f, 'incomePrevious')).toBe(formatCurrency(1000));
  });

  it('C. mês só com despesa: entrada R$ 0,00 é valor real, não ausência', () => {
    const data = [...monthsOf(2026, [1, 3, 4]), tx('2026-02-10', 'Despesa', 250), ...monthsOf(2025, [1, 2, 3, 4])];
    const f = feb(eligible(compute(data, TODAY_MAY)));
    expect(f.incomeCurrent).toBe(0);
    expect(f.expenseCurrent).toBe(250);
    expect(seriesHasData(f, 'incomeCurrent')).toBe(true);
    expect(seriesValueLabel(f, 'incomeCurrent')).toBe(formatCurrency(0));
    expect(seriesValueLabel(f, 'incomeCurrent')).not.toBe(NO_DATA_LABEL);
  });

  it('D. mês só com renda: saída R$ 0,00 é valor real', () => {
    const data = [...monthsOf(2026, [1, 3, 4]), tx('2026-02-10', 'Renda', 900), ...monthsOf(2025, [1, 2, 3, 4])];
    const f = feb(eligible(compute(data, TODAY_MAY)));
    expect(f.expenseCurrent).toBe(0);
    expect(f.incomeCurrent).toBe(900);
    expect(seriesValueLabel(f, 'expenseCurrent')).toBe(formatCurrency(0));
  });

  it('E. buildGappedPath quebra o trecho em cada mês sem dados', () => {
    const P = (x: number, y: number) => ({ x, y });
    expect(buildGappedPath([P(0, 1), P(10, 2), P(20, 3)])).toBe('M0.0,1.0L10.0,2.0L20.0,3.0');
    expect(buildGappedPath([P(0, 1), null, P(20, 3)])).toBe('M0.0,1.0 M20.0,3.0');
    expect(buildGappedPath([P(0, 1), P(10, 2), null, P(30, 3), P(40, 4)])).toBe('M0.0,1.0L10.0,2.0 M30.0,3.0L40.0,4.0');
    expect(buildGappedPath([null, P(10, 2), null])).toBe('M10.0,2.0');
    expect(buildGappedPath([null, null])).toBe('');
  });

  const html = renderToStaticMarkup(
    React.createElement(AnnualEvolutionChart, { months: model().months, currentYear: 2026, previousYear: 2025 })
  );
  const pathOf = (color: string, width: string) =>
    new RegExp(`<path d="([^"]*)" fill="none" stroke="${color}" stroke-width="${width}"`).exec(html)![1];
  const paths = [pathOf('#6dcec8', '1.3'), pathOf('#ff9794', '1.3'), pathOf('#49d2c7', '2.65'), pathOf('#ff7673', '2.65')];

  it('F. a linha do ano anterior termina em janeiro, não cruza fevereiro e recomeça em março', () => {
    // ordem do componente: entradas 2025, saídas 2025, entradas 2026, saídas 2026
    expect(paths).toHaveLength(4);
    for (const previous of paths.slice(0, 2)) {
      // janeiro isolado; mês sem dados abre novo M; março→abril é UMA curva (C) e nada atravessa o buraco
      expect(previous).toMatch(/^M[\d.]+,[\d.]+ M[\d.]+,[\d.]+ C[\d.]+,[\d.]+ [\d.]+,[\d.]+ [\d.]+,[\d.]+$/);
      expect(previous.match(/M/g)).toHaveLength(2);
    }
    // ano atual tem os quatro meses: uma linha contínua, sem quebra, só curvas
    for (const current of paths.slice(2)) {
      expect(current).not.toContain(' M');
      expect(current).not.toContain('L');
      expect(current.match(/C/g)).toHaveLength(3);
    }
  });

  it('F2. sem ponto plotado em fevereiro para o ano anterior', () => {
    // sem pontos permanentes: os marcadores só existem no mês ativo (hover/foco)
    expect(html.match(/<circle /g)).toBeNull();
  });

  it('G. tooltip mostra "Sem dados" no ano ausente e valores no ano com dados', () => {
    const out = renderToStaticMarkup(
      React.createElement(MonthTooltipBody, { month: feb(model()), currentYear: 2026, previousYear: 2025 })
    );
    expect(out).toContain('fevereiro');
    expect(out.match(/Sem dados/g)).toHaveLength(2);
    expect(out).toContain(formatCurrency(1000));
    expect(out).toContain(formatCurrency(400));
    // seções ANO ATUAL · 2026 / ANO ANTERIOR · 2025; no anterior as duas linhas dizem "Sem dados"
    expect(out).toContain('Ano anterior · 2025');
    const previousSection = out.slice(out.indexOf('Ano anterior · 2025'));
    for (const label of ['Entradas', 'Saídas']) {
      expect(previousSection).toMatch(new RegExp(`${label}</dt><dd[^>]*>${NO_DATA_LABEL}</dd>`));
    }
    expect(out).not.toContain('Variação das entradas'); // sem base nos dois anos, sem variação
  });

  it('G2. tooltip com zero verdadeiro mostra R$ 0,00', () => {
    const data = [...monthsOf(2026, [1, 3, 4]), tx('2026-02-10', 'Despesa', 250), ...monthsOf(2025, [1, 2, 3, 4])];
    const out = renderToStaticMarkup(
      React.createElement(MonthTooltipBody, {
        month: feb(eligible(compute(data, TODAY_MAY))),
        currentYear: 2026,
        previousYear: 2025,
      })
    );
    expect(out).toContain(formatCurrency(0));
    expect(out).not.toContain('Sem dados');
  });

  it('H. tabela acessível e aria-label do mês dizem "Sem dados", sem R$ 0,00 inventado', () => {
    const febRow = /<tr><th scope="row">fevereiro<\/th>(.*?)<\/tr>/.exec(html);
    expect(febRow).not.toBeNull();
    const cells = [...febRow![1].matchAll(/<td>(.*?)<\/td>/g)].map((m) => m[1]);
    // colunas: entradas atual, entradas anterior, saídas atual, saídas anterior
    expect(cells).toEqual([formatCurrency(1000), NO_DATA_LABEL, formatCurrency(400), NO_DATA_LABEL]);

    const label = /aria-label="(fevereiro: [^"]*)"/.exec(html)![1];
    expect(label).toContain(`entradas 2025 ${NO_DATA_LABEL}`);
    expect(label).toContain(`saídas 2025 ${NO_DATA_LABEL}`);
    expect(label).toContain(`entradas 2026 ${formatCurrency(1000)}`);
  });

  it('I. totais e variações ficam nos meses pareados, com valores fixos', () => {
    const m = model();
    expect(m.pairedMonths).toEqual([1, 3, 4]);
    expect(m.totals).toEqual({
      incomeCurrent: 3000,
      incomePrevious: 2400,
      expenseCurrent: 1200,
      expensePrevious: 900,
    });
    expect(m.incomeChangePercent).toBeCloseTo(25, 6);
    expect(m.expenseChangePercent).toBeCloseTo(33.3333333, 4);
  });

  it('J. mês sem par (só 2026) não muda totais, percentuais nem a Leitura do FinElo', () => {
    const without = model();
    const withExtra = eligible(compute([...base(), tx('2026-02-12', 'Renda', 50000)], TODAY_MAY));
    expect(feb(withExtra).incomeCurrent).toBe(51000); // aparece no gráfico...
    expect(withExtra.totals).toEqual(without.totals); // ...mas não nos totais
    expect(withExtra.incomeChangePercent).toBe(without.incomeChangePercent);
    expect(withExtra.expenseChangePercent).toBe(without.expenseChangePercent);
    expect(buildAnnualEvolutionReading(withExtra.incomeChangePercent, withExtra.expenseChangePercent)).toEqual(
      buildAnnualEvolutionReading(without.incomeChangePercent, without.expenseChangePercent)
    );
  });
});
