import type { Category, Transaction } from '../types';
import { classifyTransaction, isAnalysisOperationalTransaction } from '../domain/economics/transactionSemantics';
import {
  buildCategorySets,
  computeOperationalSummary,
  getTransactionEffectiveDate,
} from './dashboardMetrics';
import { localTodayIso } from './dateOnly';
import { computePeriodDelta } from './periodComparison';

/**
 * Evolução anual: entradas e saídas REGISTRADAS, ano calendário atual × anterior.
 *
 * Usa exatamente o contrato operacional da Dashboard (`dashboardMetrics.ts`): exclui categorias
 * Ambos/investimento, soma `Valor` de `Renda` e `abs(Valor)` de `Despesa`, e posiciona o
 * lançamento por `Data_Pagamento || Data`. Não neutraliza pagamentos de fatura nem transferências:
 * eles entram quando registrados como renda ou despesa, como nos cards atuais.
 *
 * Só meses calendário COMPLETOS entram. Em 06/10/2026: jan–set/2026 contra jan–set/2025.
 */

/** Mínimo de meses com dados reais nos DOIS anos para mostrar o bloco. */
export const MIN_PAIRED_MONTHS = 3;

export interface AnnualEvolutionMonth {
  /** 1–12 */
  month: number;
  incomeCurrent: number;
  incomePrevious: number;
  expenseCurrent: number;
  expensePrevious: number;
  /** Lançamentos que participam do contrato operacional naquele mês. */
  currentCount: number;
  previousCount: number;
  /** Há dado real nos dois anos neste mês. */
  paired: boolean;
}

export interface AnnualEvolutionTotals {
  incomeCurrent: number;
  incomePrevious: number;
  expenseCurrent: number;
  expensePrevious: number;
}

export type AnnualEvolutionIneligibleReason = 'no_complete_month' | 'insufficient_paired_months';

export type AnnualEvolution =
  | {
      status: 'ineligible';
      reason: AnnualEvolutionIneligibleReason;
      currentYear: number;
      previousYear: number;
      /** Último mês completo (0 quando ainda não há nenhum). */
      lastMonth: number;
      pairedMonths: number[];
    }
  | {
      status: 'eligible';
      currentYear: number;
      previousYear: number;
      lastMonth: number;
      /** Todos os meses completos do intervalo, com zero onde não há lançamento. */
      months: AnnualEvolutionMonth[];
      /** Meses com dado real nos dois anos: base dos totais e da elegibilidade. */
      pairedMonths: number[];
      totals: AnnualEvolutionTotals;
      incomeChangePercent: number | null;
      expenseChangePercent: number | null;
    };

/** Percentual `((atual - anterior) / abs(anterior)) * 100`; `null` sem base matemática válida. */
export function computeAnnualChangePercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  const { percent } = computePeriodDelta(current, previous);
  return percent !== null && Number.isFinite(percent) ? percent : null;
}

/** Lançamento que pode somar: tipo do contrato, valor finito e diferente de zero. */
export function computeAnnualEvolution(input: {
  transactions: Transaction[];
  categories: Category[];
  /** Data civil de hoje; injetável para teste e para a virada do dia. */
  today?: Date | string;
}): AnnualEvolution {
  const todayIso = typeof input.today === 'string' ? input.today : localTodayIso(input.today);
  const [yearStr, monthStr] = todayIso.split('-');
  const currentYear = Number(yearStr);
  const currentMonth = Number(monthStr);
  const previousYear = currentYear - 1;
  const lastMonth = currentMonth - 1;

  if (lastMonth < 1) {
    return {
      status: 'ineligible',
      reason: 'no_complete_month',
      currentYear,
      previousYear,
      lastMonth: 0,
      pairedMonths: [],
    };
  }

  const categorySets = buildCategorySets(input.categories);
  const operational = input.transactions.filter((t) =>
    isAnalysisOperationalTransaction(classifyTransaction(t, { categorySets }))
  );

  const current: Transaction[][] = Array.from({ length: lastMonth }, () => []);
  const previous: Transaction[][] = Array.from({ length: lastMonth }, () => []);

  for (const t of operational) {
    const date = getTransactionEffectiveDate(t);
    if (Number.isNaN(date.getTime())) continue;
    const month = date.getMonth() + 1;
    if (month > lastMonth) continue;
    const year = date.getFullYear();
    if (year === currentYear) current[month - 1].push(t);
    else if (year === previousYear) previous[month - 1].push(t);
  }

  const months: AnnualEvolutionMonth[] = [];
  for (let i = 0; i < lastMonth; i += 1) {
    const cur = computeOperationalSummary(current[i]);
    const prev = computeOperationalSummary(previous[i]);
    months.push({
      month: i + 1,
      incomeCurrent: cur.income,
      incomePrevious: prev.income,
      expenseCurrent: cur.expense,
      expensePrevious: prev.expense,
      currentCount: current[i].length,
      previousCount: previous[i].length,
      paired: current[i].length > 0 && previous[i].length > 0,
    });
  }

  const pairedMonths = months.filter((m) => m.paired).map((m) => m.month);
  if (pairedMonths.length < MIN_PAIRED_MONTHS) {
    return {
      status: 'ineligible',
      reason: 'insufficient_paired_months',
      currentYear,
      previousYear,
      lastMonth,
      pairedMonths,
    };
  }

  const totals = months
    .filter((m) => m.paired)
    .reduce<AnnualEvolutionTotals>(
      (acc, m) => ({
        incomeCurrent: acc.incomeCurrent + m.incomeCurrent,
        incomePrevious: acc.incomePrevious + m.incomePrevious,
        expenseCurrent: acc.expenseCurrent + m.expenseCurrent,
        expensePrevious: acc.expensePrevious + m.expensePrevious,
      }),
      { incomeCurrent: 0, incomePrevious: 0, expenseCurrent: 0, expensePrevious: 0 }
    );

  return {
    status: 'eligible',
    currentYear,
    previousYear,
    lastMonth,
    months,
    pairedMonths,
    totals,
    incomeChangePercent: computeAnnualChangePercent(totals.incomeCurrent, totals.incomePrevious),
    expenseChangePercent: computeAnnualChangePercent(totals.expenseCurrent, totals.expensePrevious),
  };
}
