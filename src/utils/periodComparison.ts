import { formatCurrency, formatCurrencySigned } from './formatters';

export type ComparisonDirection = 'higher_better' | 'lower_better';

export interface PeriodDelta {
  absolute: number;
  percent: number | null;
}

export function computePeriodDelta(current: number, previous: number): PeriodDelta {
  const absolute = current - previous;
  const percent =
    previous !== 0 ? (absolute / Math.abs(previous)) * 100 : current !== 0 ? null : 0;
  return { absolute, percent };
}

export function deltaTone(
  delta: PeriodDelta,
  direction: ComparisonDirection
): 'positive' | 'negative' | 'neutral' {
  if (delta.absolute === 0 || delta.percent === 0) return 'neutral';
  const improved =
    direction === 'higher_better' ? delta.absolute > 0 : delta.absolute < 0;
  return improved ? 'positive' : 'negative';
}

export function formatPercentChange(percent: number | null): string {
  if (percent === null) return '—';
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(1)}%`;
}

export function formatPercentagePointChange(current: number, previous: number): string {
  const delta = current - previous;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)} p.p.`;
}

export function formatMoneyDelta(delta: number): string {
  return formatCurrencySigned(delta, { showPlusForPositive: true });
}

export function buildCompactComparisonDeltaLabel(
  delta: PeriodDelta,
  direction: ComparisonDirection,
  options?: { usePercentagePoints?: boolean; current?: number; previous?: number }
): { label: string; tone: 'positive' | 'negative' | 'neutral' } {
  const tone = deltaTone(delta, direction);
  const arrow = delta.absolute > 0 ? '▲' : delta.absolute < 0 ? '▼' : '•';

  if (options?.usePercentagePoints && options.current !== undefined && options.previous !== undefined) {
    const pp = formatPercentagePointChange(options.current, options.previous);
    return { label: `${arrow} ${pp}`, tone };
  }

  const pct = formatPercentChange(delta.percent);
  if (delta.percent === null && delta.absolute !== 0) {
    return { label: `${arrow} ${formatMoneyDelta(delta.absolute)}`, tone };
  }

  return { label: `${arrow} ${pct}`, tone };
}

export function buildComparisonDeltaLabel(
  delta: PeriodDelta,
  direction: ComparisonDirection,
  options?: { usePercentagePoints?: boolean; current?: number; previous?: number }
): { label: string; tone: 'positive' | 'negative' | 'neutral' } {
  const tone = deltaTone(delta, direction);

  if (options?.usePercentagePoints && options.current !== undefined && options.previous !== undefined) {
    const pp = formatPercentagePointChange(options.current, options.previous);
    const arrow = delta.absolute > 0 ? '▲' : delta.absolute < 0 ? '▼' : '•';
    return { label: `${arrow} ${pp} vs comparado`, tone };
  }

  const arrow = delta.absolute > 0 ? '▲' : delta.absolute < 0 ? '▼' : '•';
  const pct = formatPercentChange(delta.percent);
  const money = formatMoneyDelta(delta.absolute);

  if (delta.percent === null && delta.absolute !== 0) {
    return { label: `${arrow} ${money} vs comparado`, tone };
  }

  return { label: `${arrow} ${pct} (${money})`, tone };
}

export function formatComparisonValue(value: number, asNegativeExpense = false): string {
  if (asNegativeExpense) return formatCurrency(-Math.abs(value));
  return formatCurrency(value);
}
