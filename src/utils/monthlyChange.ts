import type { Category, EconomicEventKind, Transaction } from '../types';
import { classifyTransaction, isAnalysisEconomicTransaction } from '../domain/economics/transactionSemantics';
import { computeAnnualChangePercent } from './annualEvolution';
import {
  buildCategorySets,
  computeOperationalSummary,
  getTransactionEffectiveDate,
} from './dashboardMetrics';
import { localTodayIso } from './dateOnly';

/**
 * "O que mudou no seu mês?": último mês calendário COMPLETO × o mês anterior a ele.
 *
 * Mesmo contrato operacional da Dashboard (categorias Ambos/investimento fora, `Renda` soma
 * `Valor`, `Despesa` soma `abs(Valor)`, data efetiva `Data_Pagamento || Data`) e demo fora.
 * Não neutraliza movimentos internos: eles entram quando registrados como renda ou despesa.
 * O mês corrente nunca entra.
 */

export const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
export const MAX_CATEGORY_CHANGES = 3;

export interface MonthlyChangeMonth {
  year: number;
  /** 1–12 */
  month: number;
  /** minúsculo: "setembro" */
  label: string;
  income: number;
  expense: number;
  /** Há lançamento operacional real no mês. */
  hasData: boolean;
}

export interface MonthlyChangeSide {
  /** atual − anterior */
  amount: number;
  /** `null` sem base matemática válida. */
  percentage: number | null;
}

export interface CategoryChange {
  category: string;
  previousAmount: number;
  currentAmount: number;
  delta: number;
}

export interface MonthlyChange {
  eligible: boolean;
  currentMonth: MonthlyChangeMonth;
  previousMonth: MonthlyChangeMonth;
  incomeChange: MonthlyChangeSide;
  expenseChange: MonthlyChangeSide;
  /** Todas as categorias de saída com delta ≠ 0, por |delta| desc (desempate por nome). */
  allCategoryChanges: CategoryChange[];
  /** As {@link MAX_CATEGORY_CHANGES} maiores. */
  categoryChanges: CategoryChange[];
  totalExpenseDelta: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const sideOf = (current: number, previous: number): MonthlyChangeSide => ({
  amount: round2(current - previous),
  percentage: computeAnnualChangePercent(current, previous),
});

/** Os dois meses comparados a partir de "hoje" (civil local). */
export function getComparedMonths(today?: Date | string): {
  current: { year: number; month: number };
  previous: { year: number; month: number };
} {
  const iso = typeof today === 'string' ? today : localTodayIso(today);
  const [y, m] = iso.split('-').map(Number);
  const shift = (back: number) => {
    const d = new Date(y, m - 1 - back, 1, 12, 0, 0, 0);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  };
  return { current: shift(1), previous: shift(2) };
}

export function computeMonthlyChange(input: {
  transactions: Transaction[];
  categories: Category[];
  today?: Date | string;
  /** Eventos carregados (id → kind). Sem ele, nada é neutralizado. */
  economicKindByEventId?: ReadonlyMap<string, EconomicEventKind>;
}): MonthlyChange {
  const { current, previous } = getComparedMonths(input.today);
  const categorySets = buildCategorySets(input.categories);
  const operational = input.transactions.filter((t) =>
    isAnalysisEconomicTransaction(classifyTransaction(t, { categorySets, economicKindByEventId: input.economicKindByEventId }))
  );

  const key = (y: number, m: number) => y * 100 + m;
  const curKey = key(current.year, current.month);
  const prevKey = key(previous.year, previous.month);
  const cur: Transaction[] = [];
  const prev: Transaction[] = [];
  for (const t of operational) {
    const d = getTransactionEffectiveDate(t);
    if (Number.isNaN(d.getTime())) continue;
    const k = key(d.getFullYear(), d.getMonth() + 1);
    if (k === curKey) cur.push(t);
    else if (k === prevKey) prev.push(t);
  }

  const build = (ref: { year: number; month: number }, rows: Transaction[]): MonthlyChangeMonth => {
    const s = computeOperationalSummary(rows);
    return {
      year: ref.year,
      month: ref.month,
      label: MONTH_NAMES[ref.month - 1],
      income: round2(s.income),
      expense: round2(s.expense),
      hasData: rows.length > 0,
    };
  };
  const currentMonth = build(current, cur);
  const previousMonth = build(previous, prev);

  const byCategory = new Map<string, { previous: number; current: number }>();
  const add = (rows: Transaction[], field: 'previous' | 'current') => {
    for (const t of rows) {
      if (t.Tipo !== 'Despesa') continue;
      const name = String(t.Categoria ?? '');
      const entry = byCategory.get(name) ?? { previous: 0, current: 0 };
      entry[field] += Math.abs(t.Valor);
      byCategory.set(name, entry);
    }
  };
  add(prev, 'previous');
  add(cur, 'current');

  const allCategoryChanges: CategoryChange[] = [...byCategory.entries()]
    .map(([category, v]) => {
      const previousAmount = round2(v.previous);
      const currentAmount = round2(v.current);
      return { category, previousAmount, currentAmount, delta: round2(currentAmount - previousAmount) };
    })
    .filter((c) => c.delta !== 0)
    .sort(
      (a, b) =>
        Math.abs(b.delta) - Math.abs(a.delta) || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0)
    );

  return {
    eligible: currentMonth.hasData && previousMonth.hasData,
    currentMonth,
    previousMonth,
    incomeChange: sideOf(currentMonth.income, previousMonth.income),
    expenseChange: sideOf(currentMonth.expense, previousMonth.expense),
    allCategoryChanges,
    categoryChanges: allCategoryChanges.slice(0, MAX_CATEGORY_CHANGES),
    totalExpenseDelta: round2(currentMonth.expense - previousMonth.expense),
  };
}

/**
 * Parte da variação total das saídas explicada pela categoria. Só existe quando o total variou e
 * a categoria se moveu no mesmo sentido; senão `null`. Não exibido na V1.
 */
export function shareOfExpenseDelta(change: CategoryChange, totalExpenseDelta: number): number | null {
  if (totalExpenseDelta === 0 || change.delta === 0) return null;
  if (Math.sign(change.delta) !== Math.sign(totalExpenseDelta)) return null;
  return change.delta / totalExpenseDelta;
}
