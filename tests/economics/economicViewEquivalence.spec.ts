import { describe, expect, it } from 'vitest';
import type { Account, Budget, BudgetMonth, Category, Transaction } from '../../src/types';
import {
  buildCategorySets,
  classifyTransaction,
  isAnalysisOperationalTransaction,
  isBudgetSpendTransaction,
  isDashboardOperationalTransaction,
  isInvestmentTransaction,
  isRecurrenceBaseEligibleTransaction,
  isUpcomingEligibleTransaction,
} from '../../src/domain/economics/transactionSemantics';
import { FUNDING_ACCOUNT_OBS_PREFIX } from '../../src/services/creditCardDirectedPayment';
import { isDemoTransaction } from '../../src/domain/onboarding/firstSteps';
import { isCommitmentTransaction } from '../../src/utils/transactionPeriodFilters';
import {
  computeDashboardPeriodMetrics,
  toInvestmentData,
  toOperationalChartData,
} from '../../src/utils/dashboardMetrics';
import { computeMonthlyChange } from '../../src/utils/monthlyChange';
import { computeAnnualEvolution } from '../../src/utils/annualEvolution';
import { computeUpcomingEntries } from '../../src/utils/upcomingEntries';
import { detectRecurrences } from '../../src/domain/recurrences/detectRecurrences';
import { computeBudgetLines } from '../../src/domain/budgets/monthlyBudget';

/**
 * Predicados LEGADOS congelados: cópia literal do que cada consumidor fazia ANTES da centralização (Fase 2).
 * Não são código de produção; existem para provar equivalência total sobre um espaço de casos exaustivo.
 */
type CategorySetsLike = ReturnType<typeof buildCategorySets>;
const refFunding = (t: Transaction): boolean =>
  [t.Observacoes, t.Descricao_Original].some((raw) => String(raw ?? '').includes(FUNDING_ACCOUNT_OBS_PREFIX));
const refCountable = (t: Transaction): boolean =>
  (t.Tipo === 'Renda' || t.Tipo === 'Despesa') && Number.isFinite(t.Valor) && t.Valor !== 0;

const legacy = {
  dashboard: (t: Transaction, s: CategorySetsLike) => !s.ambos.has(t.Categoria) && !s.investment.has(t.Categoria),
  investment: (t: Transaction, s: CategorySetsLike) => s.investment.has(t.Categoria),
  analysis: (t: Transaction, s: CategorySetsLike) =>
    !isDemoTransaction(t) && refCountable(t) && !s.ambos.has(t.Categoria) && !s.investment.has(t.Categoria),
  budget: (t: Transaction) => !(t.Tipo !== 'Despesa' || !Number.isFinite(t.Valor) || t.Valor === 0) && !isDemoTransaction(t),
  upcoming: (t: Transaction, s: CategorySetsLike, isCard: boolean) =>
    (t.Tipo === 'Renda' || t.Tipo === 'Despesa') &&
    Number.isFinite(t.Valor) &&
    t.Valor !== 0 &&
    !isDemoTransaction(t) &&
    !(s.ambos.has(t.Categoria) || s.investment.has(t.Categoria)) &&
    !refFunding(t) &&
    !(isCard && t.Tipo === 'Renda'),
  recurrence: (t: Transaction, s: CategorySetsLike) =>
    t.Tipo === 'Despesa' &&
    Number.isFinite(t.Valor) &&
    t.Valor !== 0 &&
    !isDemoTransaction(t) &&
    !(s.ambos.has(t.Categoria) || s.investment.has(t.Categoria)) &&
    !refFunding(t) &&
    !isCommitmentTransaction(t),
};

const categories = [
  { id: '1', Nome_Categoria: 'Mercado', Tipo: 'Despesa' },
  { id: '2', Nome_Categoria: 'Salário', Tipo: 'Renda' },
  { id: '3', Nome_Categoria: 'Movimentação', Tipo: 'Ambos' },
  { id: '4', Nome_Categoria: 'Investimentos', Tipo: 'Despesa', is_investment: true },
  { id: '5', Nome_Categoria: 'Aporte Ambos', Tipo: 'Ambos', is_investment: true },
] as unknown as Category[];
const accounts = [
  { id: 'card', user_id: 'u', Nome_Conta: 'Cartão', Tipo_Conta: 'Cartão de Crédito' },
  { id: 'bank', user_id: 'u', Nome_Conta: 'Banco', Tipo_Conta: 'Conta Corrente' },
] as unknown as Account[];
const sets = buildCategorySets(categories);
const ctx = { categorySets: sets, accountById: new Map(accounts.map((a) => [a.id, a])) };

const spaces = {
  Tipo: ['Renda', 'Despesa', 'Outro', undefined] as unknown[],
  Valor: [-100, 100, 0, NaN, Infinity],
  demo: [null, { Origem: 'demo.csv' }, { Fonte: 'Demo' }] as Array<Partial<Transaction> | null>,
  Categoria: ['Mercado', 'Salário', 'Movimentação', 'Investimentos', 'Aporte Ambos', 'Inexistente'],
  marker: [null, { Descricao_Original: 'x finelo_funding_account:abc' }, { Observacoes: 'finelo_funding_account:abc' }] as Array<Partial<Transaction> | null>,
  ID_Conta: ['bank', 'card', undefined],
  commit: [null, { Parcela_Atual: 2, Total_Parcelas: 6 }, { Nome_Fantasia: 'Loja (1/3)' }] as Array<Partial<Transaction> | null>,
  event: [undefined, null, 'ev-1'] as Array<string | null | undefined>,
};

function* universe(): Generator<Transaction> {
  for (const Tipo of spaces.Tipo)
    for (const Valor of spaces.Valor)
      for (const demo of spaces.demo)
        for (const Categoria of spaces.Categoria)
          for (const marker of spaces.marker)
            for (const ID_Conta of spaces.ID_Conta)
              for (const commit of spaces.commit)
                for (const event of spaces.event)
                  yield {
                    ID_Transacao: 'x', Data: '2026-09-10', Nome_Fantasia: 'Compra', Descricao_Original: 'Compra', Origem: 'manual', Fonte: 'Manual',
                    Tipo, Valor, Categoria, ID_Conta, economic_event_id: event, ...(demo ?? {}), ...(marker ?? {}), ...(commit ?? {}),
                  } as unknown as Transaction;
}

describe('equivalência total das políticas × predicados legados (espaço exaustivo)', () => {
  it('cada política é idêntica ao que o consumidor fazia antes, em TODAS as combinações', () => {
    let n = 0;
    for (const t of universe()) {
      n += 1;
      const s = classifyTransaction(t, ctx);
      const isCard = ctx.accountById.get(t.ID_Conta ?? '')?.Tipo_Conta === 'Cartão de Crédito';
      const got = [
        isDashboardOperationalTransaction(s), isInvestmentTransaction(s), isAnalysisOperationalTransaction(s),
        isBudgetSpendTransaction(s), isUpcomingEligibleTransaction(s), isRecurrenceBaseEligibleTransaction(s),
      ];
      const want = [
        legacy.dashboard(t, sets), legacy.investment(t, sets), legacy.analysis(t, sets), legacy.budget(t),
        legacy.upcoming(t, sets, isCard), legacy.recurrence(t, sets),
      ];
      if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`divergência em ${JSON.stringify(t)}: ${got} ≠ ${want}`);
    }
    expect(n).toBe(4 * 5 * 3 * 6 * 3 * 3 * 3 * 3);
  });

  it('as APIs públicas de dashboardMetrics continuam equivalentes ao legado', () => {
    const all = [...universe()].filter((_, i) => i % 7 === 0);
    expect(toOperationalChartData(all, sets)).toEqual(all.filter((t) => legacy.dashboard(t, sets)));
    expect(toInvestmentData(all, sets)).toEqual(all.filter((t) => legacy.investment(t, sets)));
  });
});

// ------------------------------------------------------------------------------------------------------
// economic_event_id é no-op em cada consumidor (mesmas linhas, com e sem o id).
// ------------------------------------------------------------------------------------------------------
const U = 'u';
let seq = 0;
const row = (Data: string, Tipo: 'Renda' | 'Despesa', abs: number, Categoria: string, extra: Partial<Transaction> = {}): Transaction =>
  ({
    ID_Transacao: `r${++seq}`, user_id: U, Data, Nome_Fantasia: extra.Nome_Fantasia ?? Categoria, Descricao_Original: extra.Descricao_Original ?? Categoria,
    Valor: Tipo === 'Despesa' ? -abs : abs, Tipo, Categoria, Origem: 'manual', Fonte: 'Manual', ID_Conta: 'bank', ...extra,
  }) as unknown as Transaction;

const dataset = (): Transaction[] => {
  seq = 0;
  const out: Transaction[] = [];
  for (const m of ['2025-04', '2025-05', '2025-06', '2025-07', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']) {
    out.push(row(`${m}-05`, 'Renda', 6000, 'Salário'));
    out.push(row(`${m}-10`, 'Despesa', 700, 'Mercado'));
    out.push(row(`${m}-12`, 'Despesa', 39.9, 'Mercado', { Nome_Fantasia: 'Streaming', Descricao_Original: 'Streaming' }));
    out.push(row(`${m}-15`, 'Despesa', 300, 'Investimentos'));
    out.push(row(`${m}-20`, 'Despesa', 500, 'Movimentação'));
    out.push(row(`${m}-21`, 'Despesa', 80, 'Mercado', { Origem: 'demo.csv' }));
    out.push(row(`${m}-22`, 'Despesa', 120, 'Mercado', { Parcela_Atual: 2, Total_Parcelas: 6 }));
    out.push(row(`${m}-23`, 'Renda', 50, 'Mercado', { ID_Conta: 'card' }));
  }
  out.push(row('2026-09-20', 'Renda', 2000, 'Salário', { ID_Conta: 'card', Descricao_Original: 'Pagamento de Fatura finelo_funding_account:bank' }));
  out.push(row('2026-09-20', 'Despesa', 2000, 'Salário', { Descricao_Original: 'Pagamento Fatura finelo_funding_account:bank' }));
  out.push(row('2026-10-20', 'Despesa', 1500, 'Mercado', { Descricao_Original: 'x finelo_funding_account:bank' }));
  out.push(row('2026-10-25', 'Despesa', 80, 'Mercado'));
  out.push(row('2026-10-26', 'Renda', 70, 'Salário', { ID_Conta: 'card' }));
  return out;
};

const budgets = [{ id: 'b1', user_id: U, Categoria: 'Mercado', Valor_Limite_Mensal: 1000, ano: 2026 }] as unknown as Budget[];
const budgetMonths = [{ id: 'm1', user_id: U, Categoria: 'Mercado', year: 2026, month: 9, amount: 900, created_at: '', updated_at: '' }] as BudgetMonth[];
const range = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59) };

const consumers = (rows: Transaction[]) => ({
  dashboard: computeDashboardPeriodMetrics(rows, categories, range),
  operational: toOperationalChartData(rows, sets),
  monthly: computeMonthlyChange({ transactions: rows, categories, today: '2026-10-07' }),
  annual: computeAnnualEvolution({ transactions: rows, categories, today: '2026-10-07' }),
  upcoming: computeUpcomingEntries({ transactions: rows, categories, accounts, today: '2026-10-07' }),
  recurrences: detectRecurrences({ transactions: rows, categories, accounts, today: '2026-10-07' }),
  budget: computeBudgetLines({
    budgets, budgetMonths, transactions: rows, range, currentUserId: U, getTransactionOwnerId: (t) => t.user_id, referenceDate: new Date(2026, 9, 7),
  }),
});

describe('economic_event_id é no-op em todos os consumidores', () => {
  const plain = dataset();
  // As próprias linhas aparecem em alguns resultados: só a CHAVE economic_event_id é ignorada na comparação.
  const snap = (rows: Transaction[]) => JSON.stringify(consumers(rows), (k, v) => (k === 'economic_event_id' ? undefined : v));
  const baseline = snap(plain);

  it('o dataset exercita os consumidores (não é vazio)', () => {
    const c = consumers(plain);
    expect(c.dashboard.operational.income).toBeGreaterThan(0);
    expect(c.upcoming.entryCount).toBeGreaterThan(0);
    expect(c.recurrences.length).toBeGreaterThan(0);
    expect(c.budget.length).toBeGreaterThan(0);
    expect(c.annual).toBeTruthy();
  });

  it.each([
    ['todas as linhas', () => true],
    ['só as pernas do Pagar', (t: Transaction) => String(t.Descricao_Original).includes('finelo_funding_account:')],
    ['linhas alternadas', (t: Transaction) => Number(String(t.ID_Transacao).slice(1)) % 2 === 0],
  ])('com economic_event_id em %s: resultados idênticos', (_n, pick) => {
    const withIds = plain.map((t) => (pick(t) ? { ...t, economic_event_id: `ev-${t.ID_Transacao}` } : { ...t }));
    expect(snap(withIds)).toBe(baseline);
  });

  it('o Dashboard continua incluindo demo e o Pagar; Upcoming/Recurrences continuam fora do Pagar e do demo', () => {
    const rows = [
      row('2026-09-10', 'Despesa', 100, 'Mercado', { Origem: 'demo.csv' }),
      row('2026-09-11', 'Despesa', 200, 'Salário', { Descricao_Original: 'Pagamento Fatura finelo_funding_account:bank' }),
    ];
    expect(computeDashboardPeriodMetrics(rows, categories, range).operational.expense).toBe(300);
    expect(computeAnnualEvolution({ transactions: rows, categories, today: '2026-10-07' })).toBeTruthy();
    expect(computeMonthlyChange({ transactions: rows, categories, today: '2026-10-07' }).expenseChange.amount).toBe(200); // demo fora, Pagar dentro
  });
});
