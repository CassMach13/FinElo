import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  MATURITY_WINDOW_DAYS,
  buildInstitutionAllocation,
  buildMaturityAgenda,
  buildPortfolioNarrative,
  buildTypeAllocation,
  dayToDateString,
  formatAllocationPercent,
  localDateString,
  parseDateOnlyDay,
  selectMonthPositions,
  topGroup,
  type InsightPosition,
} from '../../src/domain/investments/portfolioInsights';
import { summarizePortfolio } from '../../src/domain/investments/portfolioOverview';
import { isSnapshotReady } from '../../src/services/investmentPortfolioLoader';
import PortfolioAllocation from '../../src/components/investments/PortfolioAllocation';
import PortfolioConcentration from '../../src/components/investments/PortfolioConcentration';
import PortfolioMaturities from '../../src/components/investments/PortfolioMaturities';
import PortfolioInsightsNarrative from '../../src/components/investments/PortfolioInsightsNarrative';

const read = (p: string) => readFileSync(resolve(p), 'utf8').replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let n = 0;
const pos = (o: Partial<InsightPosition> & { balance: number | string }): InsightPosition => ({
  id: `p${String(++n).padStart(3, '0')}`,
  institution: 'XP',
  product_type: 'Renda Fixa',
  product_name: 'CDB',
  maturity_date: null,
  ...o,
});

describe('escopo do mês', () => {
  it('posições de outros meses nunca entram em alocação, concentração, vencimentos nem leitura', () => {
    const mixed = [
      pos({ balance: 100, institution: 'XP', reference_month: '2026-03-01', maturity_date: '2026-04-01' }),
      pos({ balance: 900, institution: 'BTG', reference_month: '2026-02-01', maturity_date: '2026-03-05' }),
      pos({ balance: 500, institution: 'Inter', reference_month: '2026-04-01' }),
    ];
    const scoped = selectMonthPositions(mixed, '2026-03-01');
    expect(scoped).toHaveLength(1);
    expect(buildInstitutionAllocation(scoped).totalBalance).toBe(100);
    expect(buildMaturityAgenda(scoped, '2026-03-01', '2026-10-08').items).toHaveLength(1);
    expect(buildPortfolioNarrative({ monthKey: '2026-03-01', positions: scoped, institutions: buildInstitutionAllocation(scoped), types: buildTypeAllocation(scoped), maturities: buildMaturityAgenda(scoped, '2026-03-01', '2026-10-08') }).join(' ')).not.toContain('BTG');
  });
});

describe('alocação por instituição', () => {
  it('soma em centavos, percentuais e soma dos grupos = saldo da V2-A1', () => {
    const rows = [pos({ balance: 100000.1 }), pos({ balance: 50000.2, institution: 'BTG' }), pos({ balance: 0.3, institution: 'Nubank' })];
    const a = buildInstitutionAllocation(rows);
    expect(a.reliable).toBe(true);
    expect(a.groups.map((g) => g.label)).toEqual(['XP', 'BTG', 'Nubank']);
    expect(a.groups.reduce((s, g) => s + g.cents, 0)).toBe(a.totalCents);
    const v2a1 = summarizePortfolio(rows.map((r) => ({ institution: r.institution!, balance: r.balance, reference_month: '2026-03-01' })), '2026-03-01');
    expect(a.totalBalance).toBe(v2a1.balance);
    expect(a.groups.reduce((s, g) => s + (g.percent ?? 0), 0)).toBeCloseTo(100, 9);
    expect(a.groups[0].percent).toBeCloseTo((10000010 / 15000060) * 100, 9);
  });

  it('XP / xp / "XP " são uma instituição, com rótulo legível determinístico; mesma contagem da V2-A1', () => {
    const rows = [pos({ balance: 10, institution: 'xp' }), pos({ balance: 20, institution: 'XP ' }), pos({ balance: 30, institution: ' XP' })];
    const a = buildInstitutionAllocation(rows);
    expect(a.groups).toHaveLength(1);
    expect(a.groups[0].label).toBe('XP');
    expect(a.groups[0].positionCount).toBe(3);
    expect(a.groups[0].percent).toBe(100);
    const reversed = buildInstitutionAllocation([...rows].reverse());
    expect(reversed.groups[0].label).toBe('XP');
    const v2a1 = summarizePortfolio(rows.map((r) => ({ institution: r.institution!, balance: r.balance, reference_month: '2026-03-01' })), '2026-03-01');
    expect(a.groups.length).toBe(v2a1.institutionCount);
  });

  it('desempate estável por nome e instituição vazia = "Não informado"', () => {
    const a = buildInstitutionAllocation([pos({ balance: 10, institution: 'Zeta' }), pos({ balance: 10, institution: 'Alfa' }), pos({ balance: 5, institution: '   ' })]);
    expect(a.groups.map((g) => g.label)).toEqual(['Alfa', 'Zeta', 'Não informado']);
  });

  it('um grupo com 100%; vários grupos', () => {
    expect(buildInstitutionAllocation([pos({ balance: 1 })]).groups[0].percent).toBe(100);
    expect(buildInstitutionAllocation([pos({ balance: 1 }), pos({ balance: 1, institution: 'B' })]).groups.map((g) => g.percent)).toEqual([50, 50]);
  });
});

describe('alocação por tipo', () => {
  it('usa os rótulos existentes (sem inventar taxonomia): CDB e LCI continuam separados', () => {
    const a = buildTypeAllocation([
      pos({ balance: 10, product_type: 'CDB' }),
      pos({ balance: 20, product_type: 'lci' }),
      pos({ balance: 30, product_type: ' LCI ' }),
      pos({ balance: 5, product_type: '' }),
      pos({ balance: 5, product_type: null }),
    ]);
    expect(a.groups.map((g) => [g.label, g.cents])).toEqual([['LCI', 5000], ['CDB', 1000], ['Não informado', 1000]]);
    expect(a.groups.some((g) => /renda fixa/i.test(g.label))).toBe(false);
  });
});

describe('denominador inválido', () => {
  it('saldo total zero: sem percentuais e sem divisão por zero', () => {
    const a = buildInstitutionAllocation([pos({ balance: 0 }), pos({ balance: 0, institution: 'B' })]);
    expect(a.reliable).toBe(false);
    expect(a.issue).toBe('zero_total');
    expect(a.groups.every((g) => g.percent === null)).toBe(true);
    expect(topGroup(a)).toBeNull();
  });

  it('saldo negativo ou inválido: não fabrica distribuição normal', () => {
    for (const rows of [[pos({ balance: 100 }), pos({ balance: -20, institution: 'B' })], [pos({ balance: 100 }), pos({ balance: 'abc', institution: 'B' })]]) {
      const a = buildInstitutionAllocation(rows);
      expect(a.reliable).toBe(false);
      expect(a.issue).toBe('negative_or_invalid');
      expect(a.groups.every((g) => g.percent === null)).toBe(true);
      expect(topGroup(a)).toBeNull();
    }
  });

  it('nunca produz NaN, Infinity nem "-0%"', () => {
    for (const p of [null, NaN, Infinity, -0, 0.04, 100]) {
      const text = formatAllocationPercent(p as number | null);
      expect(text).not.toMatch(/NaN|Infinity|^-/);
    }
    expect(formatAllocationPercent(-0)).toBe('0,0%');
    expect(formatAllocationPercent(62.44)).toBe('62,4%');
  });

  it('sem posições: nenhum grupo e nenhuma concentração', () => {
    const a = buildInstitutionAllocation([]);
    expect(a.groups).toEqual([]);
    expect(topGroup(a)).toBeNull();
  });
});

describe('concentração', () => {
  it('maior participação por instituição e por tipo, com saldo e percentual reais', () => {
    const rows = [
      pos({ balance: 600, institution: 'XP', product_type: 'CDB' }),
      pos({ balance: 300, institution: 'BTG', product_type: 'Ações' }),
      pos({ balance: 100, institution: 'Inter', product_type: 'CDB' }),
    ];
    expect(topGroup(buildInstitutionAllocation(rows))).toEqual({ label: 'XP', percent: 60, balance: 600 });
    expect(topGroup(buildTypeAllocation(rows))).toEqual({ label: 'CDB', percent: 70, balance: 700 });
  });
});

describe('datas date-only', () => {
  it('validação estrita', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '26-01-01', '2026-1-1', '2026-03-01T00:00:00', '', ' 2026-03-01', 'abc', null, undefined]) {
      expect(parseDateOnlyDay(bad as string)).toBeNull();
    }
    expect(parseDateOnlyDay('2028-02-29')).not.toBeNull(); // bissexto
    expect(parseDateOnlyDay('2027-02-29')).toBeNull();
    const a = parseDateOnlyDay('2026-12-31')!;
    expect(dayToDateString(a + 1)).toBe('2027-01-01');
    expect(localDateString(new Date(2026, 9, 8, 23, 59))).toBe('2026-10-08');
  });
});

describe('agenda de vencimentos', () => {
  const TODAY = '2026-10-08';
  const MONTH = '2026-10-01';
  const withDate = (d: string | null, extra: Partial<InsightPosition> = {}) => pos({ balance: 100, maturity_date: d, ...extra });

  it('janela inclusiva: hoje até hoje + 90; fora da janela fica de fora', () => {
    const end = dayToDateString(parseDateOnlyDay(TODAY)! + MATURITY_WINDOW_DAYS);
    expect(end).toBe('2027-01-06');
    const agenda = buildMaturityAgenda(
      [withDate(TODAY, { id: 'a' }), withDate(end, { id: 'b' }), withDate('2027-01-07', { id: 'c' }), withDate('2026-10-07', { id: 'd' })],
      MONTH,
      TODAY
    );
    expect(agenda.items.map((i) => [i.id, i.daysUntil])).toEqual([['a', 0], ['b', 90]]);
    expect(agenda.temporal).toBe('current');
    expect(agenda.coverage).toEqual({ total: 4, valid: 4, missing: 0, invalid: 0 });
  });

  it('virada de ano e ano bissexto', () => {
    const a = buildMaturityAgenda([withDate('2027-01-02', { id: 'x' })], '2026-12-01', '2026-12-20');
    expect(a.items).toHaveLength(1);
    expect(a.items[0].daysUntil).toBe(13);
    const leap = buildMaturityAgenda([withDate('2028-02-29', { id: 'l' })], '2028-01-01', '2028-01-15');
    expect(leap.items[0].daysUntil).toBe(45);
    const cross = buildMaturityAgenda([withDate('2027-02-28', { id: 'm' })], '2026-12-01', '2026-12-15');
    expect(cross.items).toHaveLength(1);
    expect(cross.items[0].daysUntil).toBe(75);
  });

  it('ordena pelo vencimento mais próximo, depois id; soma só saldos registrados', () => {
    const agenda = buildMaturityAgenda(
      [withDate('2026-11-20', { id: 'z', balance: 10.5 }), withDate('2026-10-20', { id: 'b', balance: 20.25 }), withDate('2026-10-20', { id: 'a', balance: 1 })],
      MONTH,
      TODAY
    );
    expect(agenda.items.map((i) => i.id)).toEqual(['a', 'b', 'z']);
    expect(agenda.itemCount).toBe(3);
    expect(agenda.totalBalance).toBe(31.75);
  });

  it('cobertura: ausentes e inválidas contadas, e ausência não vira "não vence"', () => {
    const agenda = buildMaturityAgenda([withDate('2026-11-01'), withDate(null), withDate('  '), withDate('2026-02-30'), withDate('2026-11-05')], MONTH, TODAY);
    expect(agenda.coverage).toEqual({ total: 5, valid: 2, missing: 2, invalid: 1 });
    const none = buildMaturityAgenda([withDate(null), withDate('2026-13-01')], MONTH, TODAY);
    expect(none.state).toBe('no_dates');
    const outside = buildMaturityAgenda([withDate('2030-01-01'), withDate(null)], MONTH, TODAY);
    expect(outside.state).toBe('none_in_window');
    expect(outside.coverage.missing).toBe(1);
    expect(buildMaturityAgenda([], MONTH, TODAY).state).toBe('no_positions');
  });

  it('mês histórico usa o dia 1 do mês de referência (nunca hoje); mês futuro também', () => {
    const rows = [withDate('2026-03-10', { id: 'h1' }), withDate('2026-10-15', { id: 'h2' }), withDate('2026-06-30', { id: 'h3' })];
    const hist = buildMaturityAgenda(rows, '2026-03-01', TODAY);
    expect(hist.temporal).toBe('historical');
    expect(hist.referenceDate).toBe('2026-03-01');
    expect(hist.windowEnd).toBe('2026-05-30');
    expect(hist.items.map((i) => i.id)).toEqual(['h1']); // h2 só entraria se "hoje" fosse usado
    const fut = buildMaturityAgenda([withDate('2027-01-20', { id: 'f' })], '2027-01-01', TODAY);
    expect(fut.temporal).toBe('future');
    expect(fut.referenceDate).toBe('2027-01-01');
    expect(fut.items).toHaveLength(1);
  });

  it('duas posições na mesma data permanecem (ordem estável por id)', () => {
    const agenda = buildMaturityAgenda([withDate('2026-11-01', { id: 'q2' }), withDate('2026-11-01', { id: 'q1' })], MONTH, TODAY);
    expect(agenda.items.map((i) => i.id)).toEqual(['q1', 'q2']);
  });

  it('só as posições recebidas (mês selecionado): o mesmo produto em outro mês não entra', () => {
    const march = [withDate('2026-04-15', { id: 'cdb-mar' })];
    const april = [withDate('2026-04-15', { id: 'cdb-abr' }), withDate('2026-05-10', { id: 'cdb-abr-2' })];
    expect(buildMaturityAgenda(march, '2026-03-01', TODAY).items.map((i) => i.id)).toEqual(['cdb-mar']);
    expect(buildMaturityAgenda(april, '2026-04-01', TODAY).items.map((i) => i.id)).toEqual(['cdb-abr', 'cdb-abr-2']);
  });

  it('usa o saldo registrado (balance), nunca valor aplicado/rendimento/projeção', () => {
    const agenda = buildMaturityAgenda(
      [{ ...withDate('2026-11-01', { id: 'k', balance: 123.45 }), invested_principal: 1, gross_return_amount: 999, original_applied_amount: 5 } as never],
      MONTH,
      TODAY
    );
    expect(agenda.items[0].balance).toBe(123.45);
    expect(agenda.totalBalance).toBe(123.45);
    expect(code(read('src/domain/investments/portfolioInsights.ts'))).not.toMatch(/invested_principal|gross_return|yield_rate|original_applied/);
  });
});

describe('leitura do FinElo', () => {
  const TODAY = '2026-10-08';
  const build = (positions: InsightPosition[], monthKey = '2026-10-01') => {
    const institutions = buildInstitutionAllocation(positions);
    const types = buildTypeAllocation(positions);
    const maturities = buildMaturityAgenda(positions, monthKey, TODAY);
    return buildPortfolioNarrative({ monthKey, positions, institutions, types, maturities });
  };
  const rich = [
    pos({ balance: 600, institution: 'XP', product_type: 'CDB', maturity_date: '2026-11-10' }),
    pos({ balance: 300, institution: 'BTG', product_type: 'Ações' }),
    pos({ balance: 100, institution: 'Inter', product_type: 'CDB', maturity_date: '2026-12-01' }),
  ];

  it('texto com os valores reais do snapshot e o mês selecionado', () => {
    const lines = build(rich);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines[0]).toContain('outubro de 2026');
    expect(lines[0]).toContain('R$');
    expect(lines[0]).toContain('1.000,00');
    expect(lines[0]).toContain('3 posições');
    expect(lines[0]).toContain('3 instituições');
    expect(lines[1]).toContain('XP');
    expect(lines[1]).toContain('60,0%');
    expect(lines[1]).toContain('CDB');
    expect(lines[1]).toContain('70,0%');
    expect(lines[2]).toContain('2 posições com vencimento informado');
    expect(lines[2]).toContain('700,00');
  });

  it('nada hardcoded: outros dados produzem outro texto', () => {
    const other = build([pos({ balance: 5, institution: 'Zeta', product_type: 'Fundos' }), pos({ balance: 5, institution: 'Eta', product_type: 'Fundos' })]);
    expect(other.join(' ')).not.toContain('XP');
    expect(other.join(' ')).toContain('R$');
    expect(other.join(' ')).toContain('50,0%');
  });

  it('snapshot histórico cita o mês e o marco da janela', () => {
    const lines = build([pos({ balance: 10, maturity_date: '2026-04-10' })], '2026-03-01');
    expect(lines[0]).toContain('março de 2026');
    expect(lines.join(' ')).toContain('01/03/2026');
    expect(lines.join(' ')).not.toContain('a partir de hoje');
  });

  it('uma instituição: não afirma diversificação nem maior participação', () => {
    const text = build([pos({ balance: 10 }), pos({ balance: 20 })]).join(' ');
    expect(text).toContain('Todo o saldo registrado está em XP');
    expect(text).not.toMatch(/divers|maior participação/i);
  });

  it('percentual indisponível: nenhuma afirmação de concentração', () => {
    const text = build([pos({ balance: 100 }), pos({ balance: -50, institution: 'B' })]).join(' ');
    expect(text).not.toMatch(/%|participação|representa/);
  });

  it('sem datas válidas: nenhuma afirmação de vencimentos', () => {
    const text = build([pos({ balance: 100 }), pos({ balance: 50, institution: 'B', maturity_date: '2026-02-30' })]).join(' ');
    expect(text).not.toMatch(/vencimento/i);
  });

  it('datas válidas fora da janela: informa a janela e a cobertura', () => {
    const text = build([pos({ balance: 100, maturity_date: '2031-01-01' }), pos({ balance: 100, institution: 'B' })]).join(' ');
    expect(text).toContain('Nenhum vencimento informado na janela de 90 dias');
    expect(text).toContain('1 de 2 posições');
  });

  it('empty state curto e sem recomendação', () => {
    expect(build([], '2026-03-01')).toEqual(['Não há posições registradas em março de 2026.']);
  });

  it('nenhum aconselhamento, julgamento de risco nem rentabilidade em qualquer cenário e no código', () => {
    const forbidden = /rendeu|ganhou|rentabilidade|rendimento|lucro|risco|recomend|deve(ria)?\b|resgate|comprar|vender|mal diversificad|redistribu/i;
    const scenarios = [rich, [pos({ balance: 1 })], [pos({ balance: 0 })], [pos({ balance: -1 }), pos({ balance: 5, institution: 'B' })], []];
    for (const s of scenarios) for (const line of build(s)) expect(line).not.toMatch(forbidden);
    const src = code(read('src/domain/investments/portfolioInsights.ts'));
    const narrative = src.slice(src.indexOf('export function buildPortfolioNarrative'));
    expect(narrative).not.toMatch(/rendeu|ganhou|risco|recomend|comprar|vender|redistribu/i);
  });
});

describe('UI', () => {
  const rows = [
    pos({ balance: 600, institution: 'XP', product_type: 'CDB', maturity_date: '2026-11-10', product_name: 'CDB Alfa' }),
    pos({ balance: 300, institution: 'BTG', product_type: 'Ações' }),
    pos({ balance: 100, institution: 'Inter', product_type: 'CDB' }),
  ];
  const inst = buildInstitutionAllocation(rows);
  const types = buildTypeAllocation(rows);

  it('barras proporcionais, valor, percentual e semântica acessível', () => {
    const html = renderToStaticMarkup(React.createElement(PortfolioAllocation, { title: 'Alocação por instituição', subtitle: 's', allocation: inst, dataKey: 'institution' }));
    expect(html.match(/data-allocation-row/g)).toHaveLength(3);
    expect(html).toContain('width:60%');
    expect(html).toContain('width:30%');
    expect(html).toContain('width:10%');
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="60"');
    expect(html).toMatch(/aria-valuetext="XP: R\$\s600,00, 60,0% do saldo registrado"/);
    expect(html).not.toMatch(/NaN|Infinity/);
    const t = renderToStaticMarkup(React.createElement(PortfolioAllocation, { title: 'Alocação por tipo de investimento', subtitle: 's', allocation: types, dataKey: 'type' }));
    expect(t).toContain('CDB');
    expect(t).toContain('Ações');
  });

  it('denominador inválido: aviso discreto, sem barras nem percentuais', () => {
    const bad = buildInstitutionAllocation([pos({ balance: 5 }), pos({ balance: -1, institution: 'B' })]);
    const html = renderToStaticMarkup(React.createElement(PortfolioAllocation, { title: 't', subtitle: 's', allocation: bad, dataKey: 'institution' }));
    expect(html).toContain('data-allocation-notice');
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain('data-allocation-percent');
    const none = renderToStaticMarkup(React.createElement(PortfolioConcentration, { institution: null, type: null }));
    expect(none).toContain('data-concentration-empty');
  });

  it('concentração factual, sem julgamento', () => {
    const html = renderToStaticMarkup(React.createElement(PortfolioConcentration, { institution: topGroup(inst), type: topGroup(types) }));
    expect(html).toContain('Maior participação por instituição');
    expect(html).toContain('60,0%');
    expect(html).not.toMatch(/risco elevado|mal diversificad|recomend|text-(red|danger|amber|yellow)/i);
  });

  it('vencimentos: corrente, histórico e futuro com a referência explícita', () => {
    const cur = renderToStaticMarkup(React.createElement(PortfolioMaturities, { agenda: buildMaturityAgenda(rows, '2026-10-01', '2026-10-08'), monthKey: '2026-10-01' }));
    expect(cur).toContain('Vencimentos nos próximos 90 dias');
    expect(cur).toContain('data-maturity-item');
    expect(cur).toContain('CDB Alfa');
    expect(cur).toContain('saldos registrados, não a valores futuros de resgate');
    expect(cur).toContain('Datas de vencimento disponíveis em 1 das 3 posições');
    const hist = renderToStaticMarkup(React.createElement(PortfolioMaturities, { agenda: buildMaturityAgenda(rows, '2026-08-01', '2026-10-08'), monthKey: '2026-08-01' }));
    expect(hist).toContain('Vencimentos da posição de agosto de 2026');
    expect(hist).toContain('Janela de 90 dias a partir de 01/08/2026');
    expect(hist).toContain('não confirmam posições atuais');
    const fut = renderToStaticMarkup(React.createElement(PortfolioMaturities, { agenda: buildMaturityAgenda(rows, '2027-01-01', '2026-10-08'), monthKey: '2027-01-01' }));
    expect(fut).toContain('não representam previsão de investimentos futuros');
    const noDates = renderToStaticMarkup(React.createElement(PortfolioMaturities, { agenda: buildMaturityAgenda([pos({ balance: 1 })], '2026-10-01', '2026-10-08'), monthKey: '2026-10-01' }));
    expect(noDates).toContain('não possuem datas de vencimento suficientes para montar uma agenda');
    const empty = renderToStaticMarkup(React.createElement(PortfolioMaturities, { agenda: buildMaturityAgenda([pos({ balance: 1, maturity_date: '2030-01-01' })], '2026-10-01', '2026-10-08'), monthKey: '2026-10-01' }));
    expect(empty).toContain('Nenhum vencimento informado dentro da janela selecionada');
  });

  it('leitura renderiza cada linha', () => {
    const html = renderToStaticMarkup(React.createElement(PortfolioInsightsNarrative, { lines: ['a', 'b'] }));
    expect(html).toContain('Leitura do FinElo');
    expect(html.match(/data-narrative-line/g)).toHaveLength(2);
  });
});

describe('integração na view', () => {
  const view = read('src/components/views/InvestmentsView.tsx');

  it('ordem final: resumo, evolução, alocações, concentração, vencimentos, leitura, detalhamento', () => {
    const order = ['<PortfolioSummary', '<PortfolioHistoryChart', 'title="Alocação por instituição"', 'title="Alocação por tipo de investimento"', '<PortfolioConcentration', '<PortfolioMaturities', '<PortfolioInsightsNarrative', 'Saldo Investido</h2>'];
    const idx = order.map((o) => view.indexOf(o));
    expect(idx.every((i) => i > 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('a A2 deriva de `investments` (validado por viewReady), nunca de rawInvestments, e só renderiza com viewReady', () => {
    const block = view.slice(view.indexOf('const insights = useMemo'), view.indexOf('const series = useMemo'));
    expect(block).toContain('selectMonthPositions(investments, currentKey)');
    expect(block).toContain('buildInstitutionAllocation(positions)');
    expect(block).toContain('buildTypeAllocation(positions)');
    expect(block).toContain('buildMaturityAgenda(positions');
    expect(block).not.toContain('rawInvestments');
    expect(view).toContain('const investments = viewReady ? rawInvestments : [];');
    expect(view).toMatch(/\{viewReady && \(\n\s+<>\n\s+<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">/);
    const render = view.slice(view.indexOf('return (\n        <div className="max-w-7xl'));
    expect(render).not.toMatch(/rawInvestments/);
  });

  it('dados de outro mês/usuário não chegam à A2 (mesmo predicado da V2-A1)', () => {
    expect(isSnapshotReady({ monthKey: '2026-03-01', userId: 'a' }, '2026-03-01', 'b')).toBe(false);
    expect(isSnapshotReady({ monthKey: '2026-03-01', userId: 'a' }, '2026-04-01', 'a')).toBe(false);
  });

  it('sem consulta nova, sem estado remoto próprio, sem escrita, sem dependência, sem analytics', () => {
    const files = ['portfolioInsights.ts'].map((f) => read(`src/domain/investments/${f}`));
    const comps = ['PortfolioAllocation', 'PortfolioConcentration', 'PortfolioMaturities', 'PortfolioInsightsNarrative'].map((f) => read(`src/components/investments/${f}.tsx`));
    for (const src of [...files, ...comps]) {
      expect(src).not.toMatch(/supabase|fetch\(|investmentService|useAppStore|trackProductEvent|useState|useEffect/);
      const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      expect(imports.filter((i) => !i.startsWith('.') && i !== 'react')).toEqual([]);
    }
  });

  it('V2-A1 e detalhamento preservados', () => {
    for (const needle of ['<PortfolioSummary summary={summary} />', 'PortfolioHistoryChart months={series}', 'InvestmentModal', 'InvestmentImportModal', 'InvestmentBalanceDisplay', 'handleClearInstitution', 'handleCopyPrevious', 'isWealth', "setCurrentView('pricing')", 'onImportSuccess={() => fetchInvestments(currentDate)}']) {
      expect(view).toContain(needle);
    }
  });

  it('atualização após CRUD/importação vem do mesmo snapshot (useMemo sobre `investments`)', () => {
    expect(view).toContain('}, [investments, currentKey, todayDate]);');
  });
});
