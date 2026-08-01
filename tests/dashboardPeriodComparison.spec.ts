import { describe, expect, it } from 'vitest';
import {
  computeDashboardPeriodMetrics,
  computeOperationalSummary,
} from '../src/utils/dashboardMetrics';
import {
  defaultComparePreset,
  formatCompactPeriodLabel,
  formatCustomRangeLabel,
  formatDashboardPeriodLabel,
  getCompareDateRange,
  getDashboardDateRange,
  shiftAnchorBack,
  shiftAnchorForward,
} from '../src/utils/dashboardPeriod';
import {
  buildComparisonDeltaLabel,
  computePeriodDelta,
  deltaTone,
} from '../src/utils/periodComparison';
import type { Category, Transaction } from '../src/types';

const categories: Category[] = [
  { id: '1', Nome_Categoria: 'Salário', Tipo: 'Renda' },
  { id: '2', Nome_Categoria: 'Alimentação', Tipo: 'Despesa' },
  { id: '3', Nome_Categoria: 'Investimentos', Tipo: 'Despesa', is_investment: true },
];

const tx = (
  partial: Partial<Transaction> & Pick<Transaction, 'Valor' | 'Tipo' | 'Categoria'>
): Transaction => ({
  Data: new Date('2026-05-10'),
  Descricao_Original: 'teste',
  Nome_Fantasia: 'teste',
  Fonte: 'manual',
  Origem: 'manual',
  ...partial,
});

describe('dashboardPeriod', () => {
  it('ano civil cobre janeiro a dezembro', () => {
    const range = getDashboardDateRange({
      viewMode: 'yearly',
      selectedDate: new Date(2026, 5, 15),
    });
    expect(range.start.getFullYear()).toBe(2026);
    expect(range.start.getMonth()).toBe(0);
    expect(range.end.getMonth()).toBe(11);
    expect(range.end.getDate()).toBe(31);
  });

  it('comparação ano anterior desloca o mesmo intervalo', () => {
    const primary = getDashboardDateRange({
      viewMode: 'yearly',
      selectedDate: new Date(2026, 0, 1),
    });
    const compare = getCompareDateRange(
      primary,
      'yearly',
      'year_over_year',
      new Date(2025, 0, 1)
    );
    expect(compare.start.getFullYear()).toBe(2025);
    expect(compare.end.getFullYear()).toBe(2025);
  });

  it('período anterior no modo mensal recua um mês', () => {
    const primary = getDashboardDateRange({
      viewMode: 'monthly',
      selectedDate: new Date(2026, 5, 1),
    });
    const anchor = shiftAnchorBack(new Date(2026, 5, 1), 'monthly');
    const compare = getCompareDateRange(primary, 'monthly', 'previous', anchor);
    expect(compare.start.getMonth()).toBe(4);
    expect(compare.end.getMonth()).toBe(4);
  });

  it('navega entre meses sem pular fevereiro quando a âncora está no dia 31', () => {
    const previous = shiftAnchorBack(new Date(2026, 2, 31, 12), 'monthly');
    const next = shiftAnchorForward(new Date(2026, 0, 31, 12), 'monthly');

    expect([previous.getFullYear(), previous.getMonth(), previous.getDate()]).toEqual([2026, 1, 1]);
    expect([next.getFullYear(), next.getMonth(), next.getDate()]).toEqual([2026, 1, 1]);
  });

  it('preset padrão em visão anual é ano anterior', () => {
    expect(defaultComparePreset('yearly')).toBe('year_over_year');
    expect(defaultComparePreset('monthly')).toBe('previous');
  });

  it('formata rótulo anual', () => {
    const range = getDashboardDateRange({
      viewMode: 'yearly',
      selectedDate: new Date(2026, 0, 1),
    });
    expect(formatDashboardPeriodLabel('yearly', range)).toBe('2026');
  });

  it('período personalizado jan–mai 2026 vs ano anterior ficam distintos', () => {
    const primary = getDashboardDateRange({
      viewMode: 'custom',
      selectedDate: new Date(2026, 0, 1),
      customDateRange: { start: '2026-01-01', end: '2026-05-31' },
    });
    const compare = getCompareDateRange(
      primary,
      'custom',
      'year_over_year',
      new Date(2025, 0, 1)
    );

    const primaryLabel = formatCustomRangeLabel(primary);
    const compareLabel = formatCustomRangeLabel(compare);

    expect(primaryLabel).not.toBe('Período personalizado');
    expect(compareLabel).not.toBe('Período personalizado');
    expect(primaryLabel).not.toBe(compareLabel);
    expect(primaryLabel).toContain('2026');
    expect(compareLabel).toContain('2025');
  });

  it('rótulo compacto para jan–mai no mesmo ano', () => {
    const range = getDashboardDateRange({
      viewMode: 'custom',
      selectedDate: new Date(2026, 0, 1),
      customDateRange: { start: '2026-01-01', end: '2026-05-31' },
    });
    expect(formatCompactPeriodLabel(range)).toBe('jan–mai/26');
  });

  it('intervalo personalizado de ano inteiro vira só o ano', () => {
    const range = getDashboardDateRange({
      viewMode: 'custom',
      selectedDate: new Date(2026, 0, 1),
      customDateRange: { start: '2026-01-01', end: '2026-12-31' },
    });
    expect(formatDashboardPeriodLabel('custom', range)).toBe('2026');
  });
});

describe('dashboardMetrics', () => {
  it('exclui investimentos do resumo operacional', () => {
    const transactions: Transaction[] = [
      tx({ Valor: 5000, Tipo: 'Renda', Categoria: 'Salário' }),
      tx({ Valor: -1000, Tipo: 'Despesa', Categoria: 'Alimentação' }),
      tx({ Valor: -800, Tipo: 'Despesa', Categoria: 'Investimentos' }),
    ];
    const range = getDashboardDateRange({
      viewMode: 'monthly',
      selectedDate: new Date(2026, 4, 1),
    });
    const metrics = computeDashboardPeriodMetrics(transactions, categories, range);
    expect(metrics.operational.income).toBe(5000);
    expect(metrics.operational.expense).toBe(1000);
    expect(metrics.investment.netFlow).toBe(800);
  });

  it('calcula taxa de economia', () => {
    const summary = computeOperationalSummary([
      tx({ Valor: 1000, Tipo: 'Renda', Categoria: 'Salário' }),
      tx({ Valor: -400, Tipo: 'Despesa', Categoria: 'Alimentação' }),
    ]);
    expect(summary.balance).toBe(600);
    expect(summary.savingsRate).toBeCloseTo(60, 1);
  });

  it('inclui data civil em texto no primeiro dia do período no fuso do Brasil', () => {
    const range = getDashboardDateRange({
      viewMode: 'monthly',
      selectedDate: new Date(2026, 7, 15),
    });
    const metrics = computeDashboardPeriodMetrics(
      [
        tx({
          Data: '2026-08-01' as unknown as Date,
          Valor: -25,
          Tipo: 'Despesa',
          Categoria: 'Alimentação',
        }),
      ],
      categories,
      range
    );

    expect(metrics.operational.expense).toBe(25);
  });
});

describe('periodComparison', () => {
  it('delta positivo em métrica higher_better é tom positivo', () => {
    const delta = computePeriodDelta(1200, 1000);
    expect(delta.absolute).toBe(200);
    expect(deltaTone(delta, 'higher_better')).toBe('positive');
  });

  it('queda de despesa é tom positivo em lower_better', () => {
    const delta = computePeriodDelta(800, 1000);
    expect(deltaTone(delta, 'lower_better')).toBe('positive');
  });

  it('economia usa pontos percentuais', () => {
    const delta = computePeriodDelta(12, 8);
    const { label } = buildComparisonDeltaLabel(delta, 'higher_better', {
      usePercentagePoints: true,
      current: 12,
      previous: 8,
    });
    expect(label).toContain('4.0 p.p.');
  });
});
