import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  VARIATION_DISCLAIMER,
  buildMonthlySeries,
  computeBalanceDelta,
  computeYScale,
  createRequestGuard,
  formatMonthLabel,
  formatSignedPercent,
  monthWindow,
  normalizeMonthKey,
  pickLatestMonthKey,
  shiftMonthKey,
  summarizePortfolio,
} from '../../src/domain/investments/portfolioOverview';
import {
  createPortfolioFetcher,
  loadPortfolio,
  resolveInitialMonthKey,
  type PortfolioData,
  type PortfolioLoaderDeps,
} from '../../src/services/investmentPortfolioLoader';
import PortfolioSummary from '../../src/components/investments/PortfolioSummary';
import PortfolioHistoryChart, { buildChartGeometry, describeMonth } from '../../src/components/investments/PortfolioHistoryChart';

const read = (p: string) => readFileSync(resolve(p), 'utf8').replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const row = (month: string, balance: number, institution = 'XP', id = `${month}-${institution}-${balance}`) => ({
  id,
  institution,
  balance,
  reference_month: month,
});

describe('chaves de mês (date-only, sem timezone)', () => {
  it('normaliza, vira o ano e monta 12 meses', () => {
    expect(normalizeMonthKey('2026-03-01T00:00:00+00:00')).toBe('2026-03-01');
    expect(normalizeMonthKey('lixo')).toBeNull();
    expect(normalizeMonthKey('2026-13-01')).toBeNull();
    expect(shiftMonthKey('2026-01-01', -1)).toBe('2025-12-01');
    expect(shiftMonthKey('2025-12-01', 1)).toBe('2026-01-01');
    const w = monthWindow('2026-02-01', 12);
    expect(w).toHaveLength(12);
    expect(w[0]).toBe('2025-03-01');
    expect(w[11]).toBe('2026-02-01');
    expect(formatMonthLabel('2026-03-01')).toBe('março de 2026');
  });
});

describe('resumo', () => {
  const rows = [
    row('2026-02-01', 1000, 'XP'),
    row('2026-03-01', 1500.1, 'XP'),
    row('2026-03-01', 500.2, 'Inter'),
    row('2026-03-01', 100, 'xp ', 'x3'),
    row('2026-04-01', 99999, 'Outra'),
  ];

  it('soma só o mês selecionado, conta instituições distintas e posições', () => {
    const s = summarizePortfolio(rows, '2026-03-01');
    expect(s.balance).toBe(2100.3); // sem deriva de ponto flutuante e sem misturar fevereiro/abril
    expect(s.positionCount).toBe(3);
    expect(s.institutionCount).toBe(2); // "XP" e "xp " são a mesma instituição
    expect(s.hasPositions).toBe(true);
  });

  it('variação nominal e percentual contra o mês imediatamente anterior', () => {
    const s = summarizePortfolio(rows, '2026-03-01');
    expect(s.previousMonthKey).toBe('2026-02-01');
    expect(s.delta).toEqual({ status: 'ok', absolute: 1100.3, percent: expect.closeTo(110.03, 5) });
  });

  it('mês anterior ausente = sem base comparável (não é zero)', () => {
    const s = summarizePortfolio([row('2026-03-01', 500)], '2026-03-01');
    expect(s.previousBalance).toBeNull();
    expect(s.delta).toEqual({ status: 'no_base', absolute: null, percent: null });
  });

  it('mês anterior com saldo zero verdadeiro: variação nominal existe, percentual não (nunca Infinity/NaN)', () => {
    const s = summarizePortfolio([row('2026-02-01', 0), row('2026-03-01', 500)], '2026-03-01');
    expect(s.previousBalance).toBe(0);
    expect(s.delta.status).toBe('ok');
    expect(s.delta.absolute).toBe(500);
    expect(s.delta.percent).toBeNull();
  });

  it('zero verdadeiro no mês selecionado ≠ ausência', () => {
    const zero = summarizePortfolio([row('2026-03-01', 0)], '2026-03-01');
    expect(zero.hasPositions).toBe(true);
    expect(zero.balance).toBe(0);
    const none = summarizePortfolio([row('2026-02-01', 10)], '2026-03-01');
    expect(none.hasPositions).toBe(false);
    expect(none.balance).toBeNull();
    expect(none.delta.status).toBe('no_base');
  });

  it('virada de ano e queda de saldo (percentual negativo, sem NaN)', () => {
    const s = summarizePortfolio([row('2025-12-01', 2000), row('2026-01-01', 1500)], '2026-01-01');
    expect(s.previousMonthKey).toBe('2025-12-01');
    expect(s.delta.absolute).toBe(-500);
    expect(s.delta.percent).toBe(-25);
    expect(formatSignedPercent(-25)).toBe('−25,0%');
  });

  it('computeBalanceDelta nunca devolve NaN/Infinity', () => {
    for (const [c, p] of [[0, 0], [10, 0], [0, 10], [null, 5], [5, null]] as const) {
      const d = computeBalanceDelta(c, p);
      for (const v of [d.absolute, d.percent]) if (v !== null) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('série de 12 meses', () => {
  it('agrupa por mês, preserva buracos e distingue zero de ausência', () => {
    const rows = [row('2025-06-01', 100), row('2025-06-01', 50, 'Inter'), row('2025-08-01', 0), row('2026-02-01', 300)];
    const s = buildMonthlySeries(rows, '2026-02-01', 12);
    expect(s).toHaveLength(12);
    expect(s[0].key).toBe('2025-03-01');
    expect(s[11].key).toBe('2026-02-01');
    const byKey = Object.fromEntries(s.map((p) => [p.key, p]));
    expect(byKey['2025-06-01'].balance).toBe(150);
    expect(byKey['2025-06-01'].positionCount).toBe(2);
    expect(byKey['2025-07-01'].balance).toBeNull(); // ausência
    expect(byKey['2025-08-01'].balance).toBe(0); // zero verdadeiro
    expect(byKey['2025-09-01'].balance).toBeNull();
    expect(s.filter((p) => p.balance !== null)).toHaveLength(3);
  });

  it('ignora meses fora da janela e nunca copia saldo para mês vazio', () => {
    const s = buildMonthlySeries([row('2024-01-01', 999), row('2026-02-01', 10)], '2026-02-01', 12);
    expect(s.filter((p) => p.balance !== null).map((p) => p.balance)).toEqual([10]);
  });

  it('intervalo sem dados: tudo null (nenhum zero fabricado)', () => {
    expect(buildMonthlySeries([], '2026-02-01', 12).every((p) => p.balance === null && p.positionCount === 0)).toBe(true);
  });

  it('janela com virada de ano', () => {
    const s = buildMonthlySeries([row('2025-12-01', 1), row('2026-01-01', 2)], '2026-01-01', 12);
    expect(s[10].key).toBe('2025-12-01');
    expect(s[11].key).toBe('2026-01-01');
    expect(s[0].key).toBe('2025-02-01');
  });
});

describe('escala e geometria do gráfico', () => {
  it('escala dinâmica contém todos os valores e depende dos dados', () => {
    const a = computeYScale([100_000, 105_000]);
    const b = computeYScale([5, 8_000_000]);
    for (const [scale, vals] of [[a, [100_000, 105_000]], [b, [5, 8_000_000]]] as const) {
      for (const v of vals) {
        expect(scale.min).toBeLessThanOrEqual(v);
        expect(scale.max).toBeGreaterThanOrEqual(v);
      }
    }
    expect(a.max).not.toBe(b.max);
    expect(computeYScale([]).ticks.length).toBeGreaterThan(0);
    const flat = computeYScale([1000]);
    expect(flat.max).toBeGreaterThan(flat.min);
  });

  it('gaps: o mês sem dados separa os trechos (a curva não atravessa o buraco)', () => {
    const rows = [row('2025-03-01', 100), row('2025-04-01', 110), row('2025-07-01', 130), row('2025-08-01', 140)];
    const months = buildMonthlySeries(rows, '2026-02-01', 12);
    const g = buildChartGeometry(months, 800, 280);
    expect((g.path.match(/M/g) ?? []).length).toBe(2);
    expect(g.points.filter((p) => p === null).length).toBe(8);
  });

  it('um mês isolado vira ponto (sem tendência inventada)', () => {
    const months = buildMonthlySeries([row('2026-02-01', 500)], '2026-02-01', 12);
    const g = buildChartGeometry(months, 800, 280);
    expect(g.isolated).toHaveLength(1);
    expect(g.area).toBe('');
    const html = renderToStaticMarkup(React.createElement(PortfolioHistoryChart, { months, selectedKey: '2026-02-01' }));
    expect(html).toContain('data-isolated-point');
  });

  it('sem nenhum dado: empty state, não gráfico plano de zeros', () => {
    const months = buildMonthlySeries([], '2026-02-01', 12);
    const html = renderToStaticMarkup(React.createElement(PortfolioHistoryChart, { months, selectedKey: '2026-02-01' }));
    expect(html).toContain('data-chart-empty');
    expect(html).not.toContain('<svg');
  });

  it('SVG com tabela sr-only, tooltip "Sem dados" e acessibilidade por mês', () => {
    const months = buildMonthlySeries([row('2025-12-01', 1234.5), row('2026-02-01', 2000)], '2026-02-01', 12);
    const html = renderToStaticMarkup(React.createElement(PortfolioHistoryChart, { months, selectedKey: '2026-02-01' }));
    expect(html).toContain('Evolução do saldo investido');
    expect(html).toContain('sr-only');
    expect(html).toContain('Sem posição registrada');
    expect(html.match(/role="button"/g)).toHaveLength(12);
    expect(describeMonth(months[10])).toContain('Sem posição registrada');
    expect(describeMonth(months[9])).toContain('R$');
    expect(html).toContain('tabindex="0"');
  });
});

describe('resumo na UI', () => {
  const html = (rows: ReturnType<typeof row>[], key = '2026-03-01') =>
    renderToStaticMarkup(React.createElement(PortfolioSummary, { summary: summarizePortfolio(rows, key) }));

  it('quatro indicadores, mês/ano explícito e copy de variação sem promessa de rentabilidade', () => {
    const out = html([row('2026-02-01', 1000), row('2026-03-01', 1100, 'XP'), row('2026-03-01', 100, 'Inter')]);
    expect(out).toContain('data-summary="balance"');
    expect(out).toContain('data-summary="delta"');
    expect(out).toContain('data-summary="institutions"');
    expect(out).toContain('data-summary="positions"');
    expect(out).toContain('março de 2026');
    expect(out).toContain(VARIATION_DISCLAIMER);
    expect(out).toContain('+R$');
    expect(out).not.toMatch(/rendeu|rentabilidade de|patrimônio líquido|NaN|Infinity/i);
    expect(out).not.toMatch(/text-(red|green|danger|success)|bg-(red|green)/);
  });

  it('sem base comparável e sem posição', () => {
    expect(html([row('2026-03-01', 10)])).toContain('Sem base comparável');
    const none = html([row('2026-01-01', 10)]);
    expect(none).toContain('Sem posição registrada');
    expect(none).toContain('Sem base comparável');
  });
});

describe('última posição disponível', () => {
  it('escolhe o maior mês até o corrente e ignora o futuro', () => {
    expect(pickLatestMonthKey(['2026-01-01', '2026-03-01', '2027-01-01'], '2026-06-01')).toBe('2026-03-01');
    expect(pickLatestMonthKey(['2026-06-01'], '2026-06-01')).toBe('2026-06-01');
    expect(pickLatestMonthKey([], '2026-06-01')).toBeNull();
  });

  it('resolveInitialMonthKey: usa a última posição; sem nenhuma, fica no mês corrente', async () => {
    expect(await resolveInitialMonthKey({ getLatestMonthKey: async () => '2026-03-01' }, '2026-10-01')).toBe('2026-03-01');
    expect(await resolveInitialMonthKey({ getLatestMonthKey: async () => null }, '2026-10-01')).toBe('2026-10-01');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Concorrência
// ---------------------------------------------------------------------------------------------------------------

function deferred<T>() {
  let resolveFn!: (v: T) => void;
  let rejectFn!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

const inv = (month: string, balance: number) => ({ id: `d-${month}`, user_id: 'u', institution: 'XP', product_type: 'CDB', balance, reference_month: month }) as never;

function harness() {
  const guard = createRequestGuard();
  let live = 'user-a';
  const state: { data: PortfolioData | null; loading: boolean; errors: unknown[] } = { data: null, loading: false, errors: [] };
  const fetcher = createPortfolioFetcher(guard, () => live, {
    onLoading: (l) => { state.loading = l; },
    onData: (d) => { state.data = d; },
    onError: (e) => { state.errors.push(e); },
  });
  return { fetcher, state, guard, setLive: (u: string) => { live = u; } };
}

const depsWith = (detail: () => Promise<never[]>, history: () => Promise<ReturnType<typeof row>[]>): PortfolioLoaderDeps => ({
  getDetail: detail,
  getHistory: history,
  getLatestMonthKey: async () => null,
});

describe('concorrência e sessão', () => {
  it('busca antiga do mês A não sobrescreve o mês B', async () => {
    const h = harness();
    const a = deferred<never[]>();
    const aHist = deferred<ReturnType<typeof row>[]>();
    const pA = h.fetcher(depsWith(() => a.promise, () => aHist.promise), 'user-a', '2026-01-01');
    const pB = h.fetcher(depsWith(async () => [inv('2026-02-01', 2)], async () => [row('2026-02-01', 2)]), 'user-a', '2026-02-01');
    await pB;
    expect(h.state.data?.monthKey).toBe('2026-02-01');
    a.resolve([inv('2026-01-01', 1)]);
    aHist.resolve([row('2026-01-01', 1)]);
    await pA;
    expect(h.state.data?.monthKey).toBe('2026-02-01');
    expect(h.state.loading).toBe(false);
  });

  it('busca do usuário A não sobrescreve a sessão do usuário B', async () => {
    const h = harness();
    const a = deferred<never[]>();
    const pA = h.fetcher(depsWith(() => a.promise, async () => [row('2026-01-01', 1)]), 'user-a', '2026-01-01');
    h.guard.invalidate();
    h.setLive('user-b');
    a.resolve([inv('2026-01-01', 1)]);
    await pA;
    expect(h.state.data).toBeNull();
    const pB = h.fetcher(depsWith(async () => [], async () => []), 'user-b', '2026-01-01');
    await pB;
    expect(h.state.data?.detail).toEqual([]);
  });

  it('mesmo sem invalidate, resultado de sessão diferente da viva é descartado', async () => {
    const h = harness();
    const a = deferred<never[]>();
    const pA = h.fetcher(depsWith(() => a.promise, async () => []), 'user-a', '2026-01-01');
    h.setLive('user-b');
    a.resolve([]);
    await pA;
    expect(h.state.data).toBeNull();
  });

  it('erro preserva os dados válidos anteriores e não vira carteira vazia', async () => {
    const h = harness();
    await h.fetcher(depsWith(async () => [inv('2026-02-01', 2)], async () => [row('2026-02-01', 2)]), 'user-a', '2026-02-01');
    const before = h.state.data;
    await h.fetcher(depsWith(async () => { throw new Error('rede'); }, async () => []), 'user-a', '2026-02-01');
    expect(h.state.data).toBe(before);
    expect(h.state.errors).toHaveLength(1);
    expect(h.state.loading).toBe(false);
  });

  it('detalhamento e histórico falham juntos (sem metade do estado)', async () => {
    const h = harness();
    await h.fetcher(depsWith(async () => [inv('2026-02-01', 2)], async () => { throw new Error('x'); }), 'user-a', '2026-02-01');
    expect(h.state.data).toBeNull();
    expect(h.state.errors).toHaveLength(1);
  });

  it('loadPortfolio pede 12 meses terminando no mês selecionado, uma única chamada de histórico', async () => {
    const calls: Array<[string, string]> = [];
    await loadPortfolio(
      { getDetail: async () => [], getHistory: async (s, e) => { calls.push([s, e]); return []; }, getLatestMonthKey: async () => null },
      '2026-02-01'
    );
    expect(calls).toEqual([['2025-03-01', '2026-02-01']]);
  });

  it('ação (importar/cadastrar/editar/excluir) refaz a busca e resumo/gráfico refletem o novo estado', async () => {
    const h = harness();
    let rows = [row('2026-02-01', 100)];
    const deps = depsWith(async () => [], async () => rows);
    await h.fetcher(deps, 'user-a', '2026-02-01');
    expect(summarizePortfolio(h.state.data!.history, '2026-02-01').balance).toBe(100);
    rows = [row('2026-02-01', 100), row('2026-02-01', 50, 'Inter')];
    await h.fetcher(deps, 'user-a', '2026-02-01'); // o que o view faz após importar/cadastrar
    const s = summarizePortfolio(h.state.data!.history, '2026-02-01');
    expect(s.balance).toBe(150);
    expect(s.institutionCount).toBe(2);
    expect(buildMonthlySeries(h.state.data!.history, '2026-02-01').at(-1)?.balance).toBe(150);
    rows = [];
    await h.fetcher(deps, 'user-a', '2026-02-01'); // exclusão total
    expect(summarizePortfolio(h.state.data!.history, '2026-02-01').hasPositions).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Contratos de código
// ---------------------------------------------------------------------------------------------------------------

describe('contratos', () => {
  const view = read('src/components/views/InvestmentsView.tsx');
  const service = read('src/services/investmentService.ts');
  const chart = read('src/components/investments/PortfolioHistoryChart.tsx');
  const domain = read('src/domain/investments/portfolioOverview.ts');

  it('view: o mês inicial só é resolvido uma vez por sessão e nunca sobrescreve navegação manual', () => {
    expect(view).toContain('userNavigatedRef.current = true');
    expect(view).toContain('if (!userNavigatedRef.current && key !== todayKey)');
    expect(view).toContain('resolveInitialMonthKey(');
    expect(view).not.toMatch(/copyFromPreviousMonth\([^)]*\)[^;]*useEffect/);
    // "Copiar do mês anterior" continua sendo uma ação do usuário, nunca chamada em efeito
    const effects = view.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g) ?? [];
    for (const e of effects) expect(e).not.toContain('copyFromPreviousMonth');
  });

  it('view: preserva ações e componentes existentes', () => {
    for (const needle of [
      'InvestmentModal', 'InvestmentImportModal', 'InvestmentBalanceDisplay', 'handleCopyPrevious', 'handleClearInstitution',
      'copyFromPreviousMonth', 'deleteInvestmentsByInstitutionAndMonth', 'isWealth', "setCurrentView('pricing')",
    ]) expect(view).toContain(needle);
    expect(view).toContain('onImportSuccess={() => fetchInvestments(currentDate)}');
  });

  it('nenhuma escrita nova no service e nenhuma consulta fora de investments', () => {
    const added = service.slice(service.indexOf('async getInvestmentHistory'), service.indexOf('async getLatestInvestments'));
    expect(added).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
    expect(added).toContain(".from('investments')");
    expect(added).not.toMatch(/transactions|assets|contas/);
    expect(added).toContain('.range(');
    expect(added).toContain(".eq('user_id', userId)");
  });

  it('sem biblioteca gráfica nova, sem valor fixo de saldo e sem taxa de rentabilidade derivada da variação', () => {
    expect(chart).not.toMatch(/from 'recharts'|from 'chart\.js'|from 'd3|victory|nivo/);
    const imports = [...chart.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.filter((i) => !i.startsWith('.') && i !== 'react')).toEqual([]);
    expect(code(chart)).not.toMatch(/R\$\s?\d/);
    expect(code(domain)).not.toMatch(/gross_return|yield_rate/);
  });

  it('Dashboard e Identidade Econômica intocados', () => {
    for (const f of ['src/utils/dashboardMetrics.ts', 'src/domain/economics/transactionSemantics.ts']) {
      expect(read(f)).not.toMatch(/portfolioOverview/);
    }
    expect(view).not.toMatch(/trackProductEvent/);
  });
});
