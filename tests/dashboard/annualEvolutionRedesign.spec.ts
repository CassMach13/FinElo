import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AnnualEvolutionChart, {
  CHART_COLORS,
  CURVE_TENSION,
  MonthTooltipBody,
  buildSmoothGappedArea,
  buildSmoothGappedPath,
  findPeakIndex,
  monthChangePercent,
} from '../../src/components/charts/AnnualEvolutionChart';
import AnnualEvolutionCard, { ANNUAL_EVOLUTION_DISCLAIMER } from '../../src/components/dashboard/AnnualEvolutionCard';
import type { AnnualEvolution, AnnualEvolutionMonth } from '../../src/utils/annualEvolution';

/** Redesign visual "C — Equilíbrio": só apresentação. Os números e a semântica do modelo não mudam. */
const P = (x: number, y: number) => ({ x, y });
const BOUNDS = { yMin: 0, yMax: 100 };

const month = (m: number, o: Partial<AnnualEvolutionMonth> = {}): AnnualEvolutionMonth => ({
  month: m, incomeCurrent: 0, incomePrevious: 0, expenseCurrent: 0, expensePrevious: 0,
  currentCount: 1, previousCount: 1, paired: true, ...o,
});

const render = (months: AnnualEvolutionMonth[], currentYear = 2026, previousYear = 2025) =>
  renderToStaticMarkup(React.createElement(AnnualEvolutionChart, { months, currentYear, previousYear }));

describe('curva suave (Bézier) com buracos preservados', () => {
  it('tensão 0,15; 3 pontos contínuos ⇒ um M e curvas C, nenhum L', () => {
    expect(CURVE_TENSION).toBe(0.15);
    const d = buildSmoothGappedPath([P(0, 50), P(10, 20), P(20, 60)], BOUNDS);
    expect(d.startsWith('M0.0,50.0')).toBe(true);
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d.match(/C/g)).toHaveLength(2);
    expect(d).not.toContain('L');
  });

  it('pontos de controle seguem a fórmula (prev/cur/point/following × 0,15)', () => {
    // segmento p0→p1: prev = p0, following = p2
    const [p0, p1, p2] = [P(0, 50), P(10, 20), P(20, 60)];
    const c1 = `${(p0.x + (p1.x - p0.x) * 0.15).toFixed(1)},${(p0.y + (p1.y - p0.y) * 0.15).toFixed(1)}`;
    const c2 = `${(p1.x - (p2.x - p0.x) * 0.15).toFixed(1)},${(p1.y - (p2.y - p0.y) * 0.15).toFixed(1)}`;
    expect(buildSmoothGappedPath([p0, p1, p2], BOUNDS)).toContain(`C${c1} ${c2} 10.0,20.0`);
  });

  it('mês sem dados: dois M e nenhuma curva atravessa o buraco', () => {
    const d = buildSmoothGappedPath([P(0, 10), P(10, 20), null, P(30, 40), P(40, 30)], BOUNDS);
    expect(d.match(/M/g)).toHaveLength(2);
    const [first, second] = d.split(' M');
    expect(first).toMatch(/^M0\.0,10\.0 C/);
    expect(first).not.toContain('30.0'); // nada do 2º trecho no 1º
    expect(second).toMatch(/^30\.0,40\.0 C/);
    expect(d).not.toMatch(/C[^M]*(?:20\.0,\d+\.\d) [^M]*30\.0,40\.0$/); // nenhuma curva 10→30
  });

  it('ponto isolado e vazio: sem NaN/crash; sem dados ⇒ path vazio', () => {
    expect(buildSmoothGappedPath([null, P(10, 20), null], BOUNDS)).toBe('M10.0,20.0');
    expect(buildSmoothGappedPath([null, null], BOUNDS)).toBe('');
    expect(buildSmoothGappedPath([], BOUNDS)).toBe('');
    for (const d of [buildSmoothGappedPath([P(0, 0), P(0, 0), P(5, 100)], BOUNDS), buildSmoothGappedPath([P(0, 5)], BOUNDS)]) {
      expect(d).not.toMatch(/NaN|Infinity/);
    }
  });

  it('os pontos de controle não extrapolam a área vertical do plot', () => {
    const d = buildSmoothGappedPath([P(0, 99), P(10, 1), P(20, 99), P(30, 1)], { yMin: 0, yMax: 100 });
    const ys = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });

  it('a área acompanha os buracos: um polígono fechado por trecho; ponto isolado não gera área', () => {
    const area = buildSmoothGappedArea([P(0, 10), P(10, 20), null, P(30, 40), null, P(50, 5), P(60, 8)], 100, BOUNDS);
    expect(area.match(/Z/g)).toHaveLength(2); // trechos de 2 pontos; o isolado em x=30 fica de fora
    expect(area).toContain('L10.0,100.0 L0.0,100.0 Z');
    expect(area).not.toMatch(/30\.0,40\.0/);
    expect(buildSmoothGappedArea([P(0, 1)], 100, BOUNDS)).toBe('');
  });
});

describe('zero verdadeiro × sem dados no componente', () => {
  const months = [
    month(1, { incomeCurrent: 100, expenseCurrent: 50 }),
    month(2, { incomeCurrent: 0, expenseCurrent: 80 }), // zero verdadeiro de entrada (há lançamentos)
    month(3, { incomeCurrent: 0, expenseCurrent: 0, currentCount: 0 }), // sem dados no ano atual
    month(4, { incomeCurrent: 120, expenseCurrent: 60 }),
  ];
  const html = render(months);
  const currentIncome = new RegExp(`<path d="([^"]*)" fill="none" stroke="${CHART_COLORS.incomeCurrent}" stroke-width="2.65"`).exec(html)![1];

  it('zero COM dados continua ponto válido; zero SEM dados abre buraco (dois M)', () => {
    expect(currentIncome.match(/M/g)).toHaveLength(2);
    expect(currentIncome).toMatch(/^M[\d.]+,[\d.]+ C[\d.,\s-]+ [\d.]+,[\d.]+ M[\d.]+,[\d.]+$/); // jan→fev curva; abr isolado
  });

  it('sem NaN, Infinity nem undefined no markup', () => {
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('a tabela acessível e os rótulos continuam dizendo "Sem dados" (nunca zero inventado)', () => {
    expect(html).toContain('<table class="sr-only">');
    expect(html).toContain('<caption>Entradas e saídas registradas por mês, 2026 e 2025</caption>');
    expect(html).toContain('Sem dados');
  });
});

describe('picos, variação e tooltip', () => {
  const months = [
    month(1, { incomeCurrent: 10, expenseCurrent: 90 }),
    month(2, { incomeCurrent: 30, expenseCurrent: 20 }),
    month(3, { incomeCurrent: 99, expenseCurrent: 99, currentCount: 0 }), // sem dados: nunca é pico
    month(4, { incomeCurrent: 20, expenseCurrent: 70 }),
  ];

  it('maior entrada e maior saída vêm do ano atual COM dados', () => {
    expect(findPeakIndex(months, 'incomeCurrent')).toBe(1);
    expect(findPeakIndex(months, 'expenseCurrent')).toBe(0);
  });

  it('sem pico quando não há dados ou o máximo não é positivo; empate fica com o primeiro', () => {
    expect(findPeakIndex([month(1, { currentCount: 0, incomeCurrent: 5 })], 'incomeCurrent')).toBeNull();
    expect(findPeakIndex([month(1), month(2)], 'incomeCurrent')).toBeNull();
    expect(findPeakIndex([month(1, { incomeCurrent: 7 }), month(2, { incomeCurrent: 7 })], 'incomeCurrent')).toBe(0);
  });

  it('os rótulos de pico são renderizados (desktop) e ocultos no mobile (classe CSS ≤ 760px)', () => {
    const html = render(months);
    expect(html).toContain('data-peak-label="income"');
    expect(html).toContain('data-peak-label="expense"');
    expect(html).toContain('Maior entrada');
    expect(html).toContain('Maior saída');
    expect(html).toMatch(/hidden[^"]*min-\[761px\]:block/);
  });

  it('variação do tooltip só com base válida nos DOIS anos; nunca Infinity/NaN', () => {
    expect(monthChangePercent(month(1, { incomeCurrent: 150, incomePrevious: 100 }), 'income')).toBe(50);
    expect(monthChangePercent(month(1, { incomeCurrent: 150, incomePrevious: 0 }), 'income')).toBeNull(); // sem base: sem divisão por zero
    expect(monthChangePercent(month(1, { previousCount: 0, incomeCurrent: 150 }), 'income')).toBeNull();
    const html = renderToStaticMarkup(React.createElement(MonthTooltipBody, { month: month(1, { incomeCurrent: 150, incomePrevious: 0 }), currentYear: 2026, previousYear: 2025 }));
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).not.toContain('Variação das entradas');
    const ok = renderToStaticMarkup(React.createElement(MonthTooltipBody, { month: month(1, { incomeCurrent: 150, incomePrevious: 100 }), currentYear: 2026, previousYear: 2025 }));
    expect(ok).toContain('Variação das entradas');
  });
});

describe('estilo: sem pontos permanentes, legenda agrupada, anos dinâmicos, sem switcher', () => {
  const months = [month(1, { incomeCurrent: 10, expenseCurrent: 5 }), month(2, { incomeCurrent: 20, expenseCurrent: 8 }), month(3, { incomeCurrent: 15, expenseCurrent: 9 })];

  it('nenhum marcador permanente (círculos só no mês ativo)', () => {
    expect(render(months).match(/<circle /g)).toBeNull();
  });

  it('cores, traços e opacidades do Equilíbrio', () => {
    const html = render(months);
    for (const color of Object.values(CHART_COLORS)) expect(html).toContain(color);
    expect(html).toContain('stroke-width="2.65"');
    expect(html).toContain('stroke-width="1.3" stroke-dasharray="3.5 5"');
    expect(html).toContain('opacity="0.45"');
    expect(html).toContain('stroke-width="5"'); // brilho
    expect(html).toContain('rgba(148, 163, 184, 0.075)'); // grade recuada
    expect(html).toContain('feGaussianBlur');
  });

  it('a área sob o ano atual existe e respeita o gradiente', () => {
    const html = render(months);
    expect(html).toMatch(/fill="url\(#ae-inc-[^)]+\)"/);
    expect(html).toMatch(/fill="url\(#ae-exp-[^)]+\)"/);
  });

  it('legenda agrupada MÉTRICA | PERÍODO com os anos DO MODELO (nada de 2026/2025 fixo)', () => {
    const html = render(months, 2031, 2030);
    expect(html).toContain('Métrica');
    expect(html).toContain('Período');
    expect(html).toContain('>2031<');
    expect(html).toContain('>2030<');
    expect(html).not.toMatch(/2026|2025/);
    expect(html).toContain('Comparativo mensal');
    expect(html).toContain('Gráfico');
  });

  it('não existe o seletor de variações do protótipo', () => {
    const card = readFileSync(resolve('src/components/dashboard/AnnualEvolutionCard.tsx'), 'utf8');
    const chart = readFileSync(resolve('src/components/charts/AnnualEvolutionChart.tsx'), 'utf8');
    for (const src of [card, chart, render(months)]) expect(src).not.toMatch(/Futurista|variant-switch|Variação A|Clean\b/);
  });
});

describe('Card: resumo, leitura e disclaimer da 3A preservados', () => {
  const model: AnnualEvolution = {
    status: 'eligible', currentYear: 2031, previousYear: 2030, lastMonth: 3,
    months: [month(1, { incomeCurrent: 10, incomePrevious: 5, expenseCurrent: 4, expensePrevious: 2 }), month(2, { incomeCurrent: 12, incomePrevious: 6, expenseCurrent: 5, expensePrevious: 3 }), month(3, { incomeCurrent: 14, incomePrevious: 7, expenseCurrent: 6, expensePrevious: 4 })],
    pairedMonths: [1, 2, 3],
    totals: { incomeCurrent: 36, incomePrevious: 18, expenseCurrent: 15, expensePrevious: 9 },
    incomeChangePercent: 100, expenseChangePercent: 66.7,
  };
  const html = renderToStaticMarkup(React.createElement(AnnualEvolutionCard, { model }));

  it('anos e totais vêm do modelo; kicker RESUMO; variação com "no período"', () => {
    expect(html).toContain('Resumo');
    expect(html).toContain('2031');
    expect(html).toContain('vs. 2030');
    expect(html).toContain('no período');
    expect(html).not.toMatch(/2026|2025|136\.848/);
  });

  it('disclaimer da Fase 3A, exatamente', () => {
    expect(ANNUAL_EVOLUTION_DISCLAIMER).toBe(
      'Movimentações internas e pagamentos de fatura identificados pelo FinElo não entram nos totais. Lançamentos ainda não identificados podem influenciá-los.'
    );
    expect(html).toContain(ANNUAL_EVOLUTION_DISCLAIMER);
  });

  it('Leitura do FinElo vem de buildAnnualEvolutionReading (sem frase fixa) e tem destaque lateral', () => {
    const card = readFileSync(resolve('src/components/dashboard/AnnualEvolutionCard.tsx'), 'utf8');
    expect(card).toContain('buildAnnualEvolutionReading(model.incomeChangePercent, model.expenseChangePercent)');
    expect(html).toContain('Leitura do FinElo');
    expect(html).toContain('border-l-2');
  });

  it('sem base no ano anterior: "—" e a explicação, sem percentual inventado', () => {
    const out = renderToStaticMarkup(React.createElement(AnnualEvolutionCard, { model: { ...model, incomeChangePercent: null } }));
    expect(out).toContain('—');
    expect(out).toContain('sem base no ano anterior');
    expect(out).not.toMatch(/NaN|Infinity/);
  });
});

describe('guardas estáticas: nenhuma biblioteca de gráficos', () => {
  const chart = readFileSync(resolve('src/components/charts/AnnualEvolutionChart.tsx'), 'utf8');
  const card = readFileSync(resolve('src/components/dashboard/AnnualEvolutionCard.tsx'), 'utf8');
  const libs = /recharts|chart\.js|chartjs|react-chartjs|d3(?:-|['"/])|victory|nivo|apexcharts|echarts|visx/i;

  it('o gráfico e o card não importam biblioteca de gráficos', () => {
    for (const src of [chart, card]) {
      const imports = src.split('\n').filter((l) => /^\s*import /.test(l)).join('\n');
      expect(imports).not.toMatch(libs);
    }
  });

  it('package.json não tem dependência de gráficos', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names.filter((n) => libs.test(n))).toEqual([]);
  });

  it('a matemática do modelo continua fora do componente (sem tocar transações/Supabase)', () => {
    for (const src of [chart, card]) expect(src).not.toMatch(/supabase|fetch\(|localStorage|economic_event|transactionSemantics/);
  });
});
