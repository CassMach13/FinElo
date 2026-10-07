import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Account, Budget, BudgetMonth, Category, EconomicEvent, EconomicEventKind, Transaction } from '../../src/types';
import {
  ACTIVE_TRANSACTION_VIEW_POLICIES,
  TRANSACTION_VIEW_POLICIES,
  buildCategorySets,
  buildEconomicKindByEventId,
  classifyTransaction,
  isIncludedByActivePolicy,
  isIncludedByPolicy,
  type ActiveTransactionViewPolicy,
  type TransactionViewPolicy,
} from '../../src/domain/economics/transactionSemantics';
import {
  computeDashboardPeriodMetrics,
  computeInvestmentSummary,
  computeOperationalSummary,
  toInvestmentData,
  toOperationalChartData,
} from '../../src/utils/dashboardMetrics';
import { computeMonthlyChange } from '../../src/utils/monthlyChange';
import { computeAnnualEvolution } from '../../src/utils/annualEvolution';
import { computeUpcomingEntries } from '../../src/utils/upcomingEntries';
import { detectRecurrences } from '../../src/domain/recurrences/detectRecurrences';
import { computeBudgetLines } from '../../src/domain/budgets/monthlyBudget';
import { computeAccountBalanceAsOf, computeAccountsTotalAsOf } from '../../src/utils/dashboardNetWorth';
import { buildTransactionExportRows } from '../../src/domain/export/transactionExport';
import { registerInvoicePayment } from '../../src/services/payInvoiceRegistration';
import { buildDirectedPaymentDescription, buildFundingPaymentDescription } from '../../src/services/creditCardDirectedPayment';
import { useAppStore } from '../../src/hooks/useAppStore';

const U = 'u';
const CARD = 'card';
const BANK = 'bank';
const accounts = [
  { id: CARD, user_id: U, Nome_Conta: 'Cartão', Tipo_Conta: 'Cartão de Crédito', Saldo_Inicial: 0, Data_Saldo_Inicial: '2025-01-01' },
  { id: BANK, user_id: U, Nome_Conta: 'Banco', Tipo_Conta: 'Conta Corrente', Saldo_Inicial: 1000, Data_Saldo_Inicial: '2025-01-01' },
] as unknown as Account[];
const categories = [
  { id: '1', Nome_Categoria: 'Mercado', Tipo: 'Despesa' },
  { id: '2', Nome_Categoria: 'Salário', Tipo: 'Renda' },
  { id: '3', Nome_Categoria: 'Movimentação', Tipo: 'Ambos' },
  { id: '4', Nome_Categoria: 'Investimentos', Tipo: 'Despesa', is_investment: true },
  { id: '5', Nome_Categoria: 'Pagamento Cartão', Tipo: 'Renda' },
] as unknown as Category[];
const sets = buildCategorySets(categories);
const accountById = new Map(accounts.map((a) => [a.id, a]));

const mapOf = (entries: Array<[string, EconomicEventKind]>) => new Map(entries) as ReadonlyMap<string, EconomicEventKind>;
const KNOWN = mapOf([['ev-pay', 'credit_card_payment'], ['ev-tr', 'own_account_transfer']]);

let n = 0;
const tx = (Data: string, Tipo: 'Renda' | 'Despesa', abs: number, Categoria: string, extra: Partial<Transaction> = {}): Transaction =>
  ({
    ID_Transacao: `t${++n}`, user_id: U, Data, Nome_Fantasia: extra.Nome_Fantasia ?? Categoria, Descricao_Original: extra.Descricao_Original ?? Categoria,
    Valor: Tipo === 'Despesa' ? -abs : abs, Tipo, Categoria, Origem: 'manual', Fonte: 'Manual', ID_Conta: BANK, ...extra,
  }) as unknown as Transaction;

const funding = buildDirectedPaymentDescription('2026-09', BANK);
const fundingBank = buildFundingPaymentDescription('2026-09', 'Cartão', BANK);
const payCard = (d: string, v: number, eventId?: string) =>
  tx(d, 'Renda', v, 'Pagamento Cartão', { ID_Conta: CARD, Nome_Fantasia: 'Pagamento de Fatura', Descricao_Original: funding, economic_event_id: eventId });
const payBank = (d: string, v: number, eventId?: string) =>
  tx(d, 'Despesa', v, 'Pagamento Cartão', { Nome_Fantasia: 'Pagamento Fatura — Cartão', Descricao_Original: fundingBank, economic_event_id: eventId });

const sem = (t: Transaction, map?: ReadonlyMap<string, EconomicEventKind>) => classifyTransaction(t, { categorySets: sets, accountById, economicKindByEventId: map });

// ----------------------------------------------------------------------------------------------------------
describe('semântica econômica — kind conhecido é obrigatório para neutralizar', () => {
  it('credit_card_payment e own_account_transfer conhecidos ⇒ neutro', () => {
    expect(sem(tx('2026-09-10', 'Despesa', 10, 'Mercado', { economic_event_id: 'ev-pay' }), KNOWN)).toMatchObject({ economicKind: 'credit_card_payment', isEconomicallyNeutral: true });
    expect(sem(tx('2026-09-10', 'Despesa', 10, 'Mercado', { economic_event_id: 'ev-tr' }), KNOWN)).toMatchObject({ economicKind: 'own_account_transfer', isEconomicallyNeutral: true });
  });

  it('id DESCONHECIDO (fora do mapa) ⇒ não neutraliza (hasEconomicEvent não decide)', () => {
    const s = sem(tx('2026-09-10', 'Despesa', 10, 'Mercado', { economic_event_id: 'ev-x' }), KNOWN);
    expect(s).toMatchObject({ hasEconomicEvent: true, economicKind: null, isEconomicallyNeutral: false });
  });

  it('sem mapa algum ⇒ nada é neutro; sem id ⇒ nada é neutro; kind no mapa sem id na transação não afeta', () => {
    expect(sem(tx('2026-09-10', 'Despesa', 10, 'Mercado', { economic_event_id: 'ev-pay' })).isEconomicallyNeutral).toBe(false);
    expect(sem(tx('2026-09-10', 'Despesa', 10, 'Mercado'), KNOWN).isEconomicallyNeutral).toBe(false);
    expect(sem(tx('2026-09-10', 'Despesa', 10, 'Mercado', { economic_event_id: null }), KNOWN).isEconomicallyNeutral).toBe(false);
  });

  it('o mapa vem só de eventos com kind conhecido; kind desconhecido é ignorado', () => {
    const map = buildEconomicKindByEventId([
      { id: 'a', kind: 'credit_card_payment' },
      { id: 'b', kind: 'own_account_transfer' },
      { id: 'c', kind: 'refund' as never },
    ]);
    expect([...map.entries()]).toEqual([['a', 'credit_card_payment'], ['b', 'own_account_transfer']]);
  });

  it('o demo é independente do evento', () => {
    const s = sem(tx('2026-09-10', 'Despesa', 10, 'Mercado', { Origem: 'demo.csv', economic_event_id: 'ev-x' }), KNOWN);
    expect(s).toMatchObject({ isDemo: true, isEconomicallyNeutral: false });
  });
});

// ----------------------------------------------------------------------------------------------------------
const A = (d: boolean, inv: boolean, a: boolean, b: boolean, u: boolean, r: boolean): Record<ActiveTransactionViewPolicy, boolean> => ({
  dashboard_operational: d, investment_summary: inv, analysis_operational: a, budget_spend: b, upcoming: u, recurrence: r,
});

const CASES: Array<[string, Transaction, Record<ActiveTransactionViewPolicy, boolean>, Record<TransactionViewPolicy, boolean>]> = [
  ['renda normal', tx('2026-09-05', 'Renda', 6000, 'Salário'), A(true, false, true, false, true, false),
    { dashboard_operational_legacy: true, analysis_operational_legacy: true, budget_spend_legacy: false, upcoming_legacy: true, recurrence_legacy: false }],
  ['despesa normal', tx('2026-09-10', 'Despesa', 100, 'Mercado'), A(true, false, true, true, true, true),
    { dashboard_operational_legacy: true, analysis_operational_legacy: true, budget_spend_legacy: true, upcoming_legacy: true, recurrence_legacy: true }],
  ['demo (operacional)', tx('2026-09-10', 'Despesa', 100, 'Mercado', { Origem: 'demo.csv' }), A(false, false, false, false, false, false),
    { dashboard_operational_legacy: true, analysis_operational_legacy: false, budget_spend_legacy: false, upcoming_legacy: false, recurrence_legacy: false }],
  ['Ambos', tx('2026-09-10', 'Despesa', 100, 'Movimentação'), A(false, false, false, true, false, false),
    { dashboard_operational_legacy: false, analysis_operational_legacy: false, budget_spend_legacy: true, upcoming_legacy: false, recurrence_legacy: false }],
  ['investimento real', tx('2026-09-10', 'Despesa', 100, 'Investimentos'), A(false, true, false, true, false, false),
    { dashboard_operational_legacy: false, analysis_operational_legacy: false, budget_spend_legacy: true, upcoming_legacy: false, recurrence_legacy: false }],
  ['demo em investimento', tx('2026-09-10', 'Despesa', 100, 'Investimentos', { Fonte: 'Demo' }), A(false, false, false, false, false, false),
    { dashboard_operational_legacy: false, analysis_operational_legacy: false, budget_spend_legacy: false, upcoming_legacy: false, recurrence_legacy: false }],
  ['investimento COM evento conhecido (não neutraliza o resumo)', tx('2026-09-10', 'Despesa', 100, 'Investimentos', { economic_event_id: 'ev-tr' }), A(false, true, false, false, false, false),
    { dashboard_operational_legacy: false, analysis_operational_legacy: false, budget_spend_legacy: true, upcoming_legacy: false, recurrence_legacy: false }],
  ['Pagar com marcador, SEM evento — perna bancária', payBank('2026-09-20', 2000), A(true, false, true, true, false, false),
    { dashboard_operational_legacy: true, analysis_operational_legacy: true, budget_spend_legacy: true, upcoming_legacy: false, recurrence_legacy: false }],
  ['Pagar + credit_card_payment — perna bancária', payBank('2026-09-20', 2000, 'ev-pay'), A(false, false, false, false, false, false),
    { dashboard_operational_legacy: true, analysis_operational_legacy: true, budget_spend_legacy: true, upcoming_legacy: false, recurrence_legacy: false }],
  ['Pagar + credit_card_payment — perna do cartão', payCard('2026-09-20', 2000, 'ev-pay'), A(false, false, false, false, false, false),
    { dashboard_operational_legacy: true, analysis_operational_legacy: true, budget_spend_legacy: false, upcoming_legacy: false, recurrence_legacy: false }],
  ['own_account_transfer — despesa', tx('2026-09-10', 'Despesa', 100, 'Mercado', { economic_event_id: 'ev-tr' }), A(false, false, false, false, false, false),
    { dashboard_operational_legacy: true, analysis_operational_legacy: true, budget_spend_legacy: true, upcoming_legacy: true, recurrence_legacy: true }],
  ['own_account_transfer — receita', tx('2026-09-10', 'Renda', 100, 'Salário', { economic_event_id: 'ev-tr' }), A(false, false, false, false, false, false),
    { dashboard_operational_legacy: true, analysis_operational_legacy: true, budget_spend_legacy: false, upcoming_legacy: true, recurrence_legacy: false }],
  ['id de evento DESCONHECIDO', tx('2026-09-10', 'Despesa', 100, 'Mercado', { economic_event_id: 'ev-x' }), A(true, false, true, true, true, true),
    { dashboard_operational_legacy: true, analysis_operational_legacy: true, budget_spend_legacy: true, upcoming_legacy: true, recurrence_legacy: true }],
  ['Renda em cartão (sem marcador/evento)', tx('2026-09-10', 'Renda', 50, 'Pagamento Cartão', { ID_Conta: CARD }), A(true, false, true, false, false, false),
    { dashboard_operational_legacy: true, analysis_operational_legacy: true, budget_spend_legacy: false, upcoming_legacy: false, recurrence_legacy: false }],
  ['parcela', tx('2026-09-10', 'Despesa', 100, 'Mercado', { Parcela_Atual: 2, Total_Parcelas: 10 }), A(true, false, true, true, true, false),
    { dashboard_operational_legacy: true, analysis_operational_legacy: true, budget_spend_legacy: true, upcoming_legacy: true, recurrence_legacy: false }],
];

const PAIRS: Array<[ActiveTransactionViewPolicy, TransactionViewPolicy]> = [
  ['dashboard_operational', 'dashboard_operational_legacy'],
  ['analysis_operational', 'analysis_operational_legacy'],
  ['budget_spend', 'budget_spend_legacy'],
  ['upcoming', 'upcoming_legacy'],
  ['recurrence', 'recurrence_legacy'],
];

describe('matriz ATIVA (3A) × legado: o que mudou', () => {
  it.each(CASES)('%s', (_name, t, active, legacy) => {
    const s = sem(t, KNOWN);
    for (const p of Object.keys(active) as ActiveTransactionViewPolicy[]) {
      expect({ p, v: isIncludedByActivePolicy(s, p) }).toEqual({ p, v: active[p] });
    }
    for (const p of Object.keys(legacy) as TransactionViewPolicy[]) {
      expect({ p, v: isIncludedByPolicy(s, p) }).toEqual({ p, v: legacy[p] });
    }
  });

  it('as células que mudaram são EXATAMENTE as esperadas (demo, evento conhecido); o resto é idêntico ao legado', () => {
    const changes: string[] = [];
    for (const [name, t] of CASES.map((c) => [c[0], c[1]] as const)) {
      const s = sem(t, KNOWN);
      for (const [a, l] of PAIRS) {
        const was = isIncludedByPolicy(s, l);
        const now = isIncludedByActivePolicy(s, a);
        if (was !== now) changes.push(`${name} | ${a}: ${was}→${now}`);
      }
    }
    expect(changes.sort()).toEqual(
      [
        'Pagar + credit_card_payment — perna bancária | budget_spend: true→false',
        'Pagar + credit_card_payment — perna bancária | dashboard_operational: true→false',
        'Pagar + credit_card_payment — perna bancária | analysis_operational: true→false',
        'Pagar + credit_card_payment — perna do cartão | analysis_operational: true→false',
        'Pagar + credit_card_payment — perna do cartão | dashboard_operational: true→false',
        'demo (operacional) | dashboard_operational: true→false',
        'investimento COM evento conhecido (não neutraliza o resumo) | budget_spend: true→false',
        'own_account_transfer — despesa | analysis_operational: true→false',
        'own_account_transfer — despesa | budget_spend: true→false',
        'own_account_transfer — despesa | dashboard_operational: true→false',
        'own_account_transfer — despesa | recurrence: true→false',
        'own_account_transfer — despesa | upcoming: true→false',
        'own_account_transfer — receita | analysis_operational: true→false',
        'own_account_transfer — receita | dashboard_operational: true→false',
        'own_account_transfer — receita | upcoming: true→false',
      ].sort()
    );
  });

  it('id desconhecido ou sem mapa = igual a não ter evento (nenhuma política muda)', () => {
    const base = tx('2026-09-10', 'Despesa', 100, 'Mercado');
    for (const map of [undefined, KNOWN, mapOf([])]) {
      for (const p of Object.keys(ACTIVE_TRANSACTION_VIEW_POLICIES) as ActiveTransactionViewPolicy[]) {
        expect(isIncludedByActivePolicy(sem({ ...base, economic_event_id: 'ev-x' }, map), p)).toBe(isIncludedByActivePolicy(sem(base, map), p));
      }
    }
  });

  it('as cinco políticas legadas continuam intactas', () => {
    expect(Object.keys(TRANSACTION_VIEW_POLICIES).sort()).toEqual(
      ['analysis_operational_legacy', 'budget_spend_legacy', 'dashboard_operational_legacy', 'recurrence_legacy', 'upcoming_legacy']
    );
    expect(Object.keys(ACTIVE_TRANSACTION_VIEW_POLICIES).sort()).toEqual(
      ['analysis_operational', 'budget_spend', 'dashboard_operational', 'investment_summary', 'recurrence', 'upcoming']
    );
  });
});

// ----------------------------------------------------------------------------------------------------------
const range = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59) };
const sep = (rows: Transaction[], map?: ReadonlyMap<string, EconomicEventKind>) => computeDashboardPeriodMetrics(rows, categories, range, map);

describe('KPIs — fixtures exatas', () => {
  it('A. só dados normais: antes/depois idênticos (mapa vazio, parcial ou cheio)', () => {
    const rows = [tx('2026-09-05', 'Renda', 6000, 'Salário'), tx('2026-09-10', 'Despesa', 700, 'Mercado'), tx('2026-09-15', 'Despesa', 300, 'Investimentos')];
    const base = JSON.stringify(sep(rows));
    expect(JSON.stringify(sep(rows, KNOWN))).toBe(base);
    expect(JSON.stringify(sep(rows, mapOf([])))).toBe(base);
    expect(sep(rows).operational).toMatchObject({ income: 6000, expense: 700 });
  });

  it('B. demo: a Dashboard passa a excluí-lo (mudança intencional); o resumo de investimentos também', () => {
    const rows = [
      tx('2026-09-05', 'Renda', 6000, 'Salário'),
      tx('2026-09-06', 'Despesa', 500, 'Mercado', { Origem: 'demo.csv' }),
      tx('2026-09-07', 'Renda', 900, 'Salário', { Fonte: 'Demo' }),
      tx('2026-09-08', 'Despesa', 200, 'Investimentos', { Fonte: 'Demo' }),
      tx('2026-09-09', 'Despesa', 100, 'Investimentos'),
    ];
    const m = sep(rows);
    expect(m.operational).toMatchObject({ income: 6000, expense: 0 });
    expect(m.investment.invested).toBeGreaterThanOrEqual(0);
    expect(toInvestmentData(rows, sets).map((t) => t.Valor)).toEqual([-100]); // só o investimento real
  });

  it('C. credit_card_payment: entrada E saída neutralizadas (Dashboard)', () => {
    const rows = [tx('2026-09-05', 'Renda', 6000, 'Salário'), tx('2026-09-10', 'Despesa', 700, 'Mercado'), payCard('2026-09-20', 1000, 'ev-pay'), payBank('2026-09-20', 1000, 'ev-pay')];
    expect(sep(rows).operational).toMatchObject({ income: 7000, expense: 1700 }); // sem mapa: legado
    expect(sep(rows, KNOWN).operational).toMatchObject({ income: 6000, expense: 700 });
  });

  it('D. own_account_transfer: neutralizada', () => {
    const rows = [tx('2026-09-05', 'Renda', 6000, 'Salário'), tx('2026-09-12', 'Despesa', 800, 'Mercado', { economic_event_id: 'ev-tr' })];
    expect(sep(rows).operational.expense).toBe(800);
    expect(sep(rows, KNOWN).operational.expense).toBe(0);
  });

  it('E. evento desconhecido: fallback legado', () => {
    const rows = [tx('2026-09-12', 'Despesa', 800, 'Mercado', { economic_event_id: 'ev-fantasma' })];
    expect(sep(rows, KNOWN).operational.expense).toBe(800);
  });

  it('mapa PARCIAL: só o evento conhecido é neutralizado (o desconhecido segue legado)', () => {
    const rows = [
      tx('2026-09-12', 'Despesa', 800, 'Mercado', { economic_event_id: 'ev-pay' }),
      tx('2026-09-13', 'Despesa', 300, 'Mercado', { economic_event_id: 'ev-B-ausente' }),
    ];
    expect(sep(rows, KNOWN).operational.expense).toBe(300);
  });

  it('falha ao carregar os eventos: sobrecontagem temporária, nunca subcontagem (nada é inferido)', () => {
    const rows = [payCard('2026-09-20', 1000, 'ev-pay'), payBank('2026-09-20', 1000, 'ev-pay')];
    expect(sep(rows, undefined).operational).toMatchObject({ income: 1000, expense: 1000 });
    expect(sep(rows, mapOf([])).operational).toMatchObject({ income: 1000, expense: 1000 });
  });

  it('par do Pagar: contribuição zero nos KPIs; ledger e Orçamento também', () => {
    const card = payCard('2026-09-20', 1000, 'ev-pay');
    const bank = payBank('2026-09-20', 1000, 'ev-pay');
    expect(sep([card, bank], KNOWN).operational).toMatchObject({ income: 0, expense: 0 });
    // Orçamento: a perna bancária não consome
    const lines = (map?: ReadonlyMap<string, EconomicEventKind>) =>
      computeBudgetLines({
        budgets: [{ id: 'b', user_id: U, Categoria: 'Pagamento Cartão', Valor_Limite_Mensal: 5000, ano: 2026 }] as unknown as Budget[],
        budgetMonths: [] as BudgetMonth[], transactions: [card, bank], range, currentUserId: U, getTransactionOwnerId: (t) => t.user_id,
        referenceDate: new Date(2026, 8, 30), economicKindByEventId: map,
      });
    expect(lines()[0].spent).toBe(1000);
    expect(lines(KNOWN)[0].spent).toBe(0);
  });

  it('50-30-20: o conjunto operacional que alimenta o widget já vem sem neutros e sem demo', () => {
    const rows = [
      tx('2026-09-05', 'Renda', 6000, 'Salário'), tx('2026-09-10', 'Despesa', 700, 'Mercado'),
      tx('2026-09-11', 'Despesa', 900, 'Mercado', { economic_event_id: 'ev-tr' }),
      tx('2026-09-12', 'Renda', 500, 'Salário', { economic_event_id: 'ev-tr' }),
      tx('2026-09-13', 'Despesa', 400, 'Mercado', { Origem: 'demo.csv' }),
    ];
    const chartData = toOperationalChartData(rows, sets, KNOWN);
    const s = computeOperationalSummary(chartData);
    expect({ income: s.income, expense: s.expense }).toEqual({ income: 6000, expense: 700 });
    expect(computeInvestmentSummary(toInvestmentData(rows, sets))).toMatchObject({ invested: 0 });
  });
});

describe('MonthlyChange e AnnualEvolution', () => {
  it('"O que mudou": eventos conhecidos saem; desconhecidos participam', () => {
    const rows = [
      tx('2026-08-05', 'Renda', 6000, 'Salário'), tx('2026-08-10', 'Despesa', 1000, 'Mercado'),
      tx('2026-09-05', 'Renda', 6000, 'Salário'), tx('2026-09-10', 'Despesa', 1000, 'Mercado'),
      payCard('2026-09-20', 2000, 'ev-pay'), payBank('2026-09-20', 2000, 'ev-pay'),
      tx('2026-09-21', 'Despesa', 50, 'Mercado', { economic_event_id: 'ev-x' }),
    ];
    const run = (map?: ReadonlyMap<string, EconomicEventKind>) => computeMonthlyChange({ transactions: rows, categories, today: '2026-10-07', economicKindByEventId: map });
    const before = run();
    const after = run(KNOWN);
    expect(before.incomeChange.amount).toBe(2000);
    expect(before.expenseChange.amount).toBe(2050);
    expect(after.incomeChange.amount).toBe(0);
    expect(after.expenseChange.amount).toBe(50); // o desconhecido (50) participa
  });

  it('Evolução anual: um mês só com eventos neutros deixa de ser mês pareado', () => {
    const rows: Transaction[] = [];
    for (const y of [2025, 2026]) {
      for (const m of ['03', '04', '05']) rows.push(tx(`${y}-${m}-10`, 'Despesa', 100, 'Mercado'));
      rows.push(payBank(`${y}-06-20`, 500, 'ev-pay')); // junho: SÓ evento neutro
    }
    const run = (map?: ReadonlyMap<string, EconomicEventKind>) =>
      computeAnnualEvolution({ transactions: rows, categories, today: '2026-10-07', economicKindByEventId: map });
    const before = run();
    const after = run(KNOWN);
    expect(before.pairedMonths).toEqual([3, 4, 5, 6]);
    expect(after.pairedMonths).toEqual([3, 4, 5]);
    if (before.status === 'eligible' && after.status === 'eligible') {
      expect(before.totals.expenseCurrent).toBe(800);
      expect(after.totals.expenseCurrent).toBe(300);
    } else throw new Error('esperava elegível');
  });

  it('Evolução anual com id desconhecido: igual ao legado', () => {
    const rows: Transaction[] = [];
    for (const y of [2025, 2026]) for (const m of ['03', '04', '05']) rows.push(tx(`${y}-${m}-10`, 'Despesa', 100, 'Mercado', { economic_event_id: 'ev-x' }));
    const a = computeAnnualEvolution({ transactions: rows, categories, today: '2026-10-07', economicKindByEventId: KNOWN });
    const b = computeAnnualEvolution({ transactions: rows, categories, today: '2026-10-07' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('Orçamento, Próximos lançamentos e Recorrências', () => {
  const budgetSpent = (rows: Transaction[], map?: ReadonlyMap<string, EconomicEventKind>) =>
    computeBudgetLines({
      budgets: [{ id: 'b', user_id: U, Categoria: 'Mercado', Valor_Limite_Mensal: 5000, ano: 2026 }] as unknown as Budget[],
      budgetMonths: [] as BudgetMonth[], transactions: rows, range, currentUserId: U, getTransactionOwnerId: (t) => t.user_id,
      referenceDate: new Date(2026, 8, 30), economicKindByEventId: map,
    })[0].spent;

  it('Orçamento: despesa neutra não consome; normal e desconhecida consomem; demo segue fora', () => {
    const rows = [
      tx('2026-09-10', 'Despesa', 100, 'Mercado'),
      tx('2026-09-11', 'Despesa', 200, 'Mercado', { economic_event_id: 'ev-tr' }),
      tx('2026-09-12', 'Despesa', 40, 'Mercado', { economic_event_id: 'ev-x' }),
      tx('2026-09-13', 'Despesa', 999, 'Mercado', { Origem: 'demo.csv' }),
    ];
    expect(budgetSpent(rows)).toBe(340);
    expect(budgetSpent(rows, KNOWN)).toBe(140);
  });

  const upcoming = (rows: Transaction[], map?: ReadonlyMap<string, EconomicEventKind>) =>
    computeUpcomingEntries({ transactions: rows, categories, accounts, today: '2026-10-07', economicKindByEventId: map });

  it('Próximos: evento neutro conhecido sai; marcador legado sem evento CONTINUA fora; desconhecido sem marcador = legado', () => {
    const rows = [
      tx('2026-10-20', 'Despesa', 100, 'Mercado'),
      tx('2026-10-21', 'Despesa', 300, 'Mercado', { economic_event_id: 'ev-tr' }),
      payBank('2026-10-22', 700), // marcador, sem evento
      tx('2026-10-23', 'Despesa', 55, 'Mercado', { economic_event_id: 'ev-x' }),
    ];
    expect(upcoming(rows).expenseTotal).toBe(455); // o marcador já saía; a transferência marcada ainda conta sem mapa
    expect(upcoming(rows, KNOWN).expenseTotal).toBe(155);
  });

  it('Recorrências: evento neutro sai; marcador legado e parcela continuam fora', () => {
    const rows: Transaction[] = [];
    for (const m of ['2026-06', '2026-07', '2026-08', '2026-09']) {
      rows.push(tx(`${m}-10`, 'Despesa', 40, 'Mercado', { Nome_Fantasia: 'Streaming', Descricao_Original: 'Streaming' }));
      rows.push(tx(`${m}-12`, 'Despesa', 300, 'Mercado', { Nome_Fantasia: 'Transferência', Descricao_Original: 'Transferência', economic_event_id: 'ev-tr' }));
      rows.push(tx(`${m}-14`, 'Despesa', 200, 'Mercado', { Nome_Fantasia: 'Fatura marcada', Descricao_Original: fundingBank }));
      rows.push(tx(`${m}-16`, 'Despesa', 90, 'Mercado', { Nome_Fantasia: 'Parcelado', Descricao_Original: 'Parcelado', Parcela_Atual: 2, Total_Parcelas: 6 }));
    }
    const names = (map?: ReadonlyMap<string, EconomicEventKind>) =>
      detectRecurrences({ transactions: rows, categories, accounts, today: '2026-10-07', economicKindByEventId: map }).map((c) => c.displayName).sort();
    expect(names()).toEqual(['Streaming', 'Transferência']);
    expect(names(KNOWN)).toEqual(['Streaming']);
  });
});

// ----------------------------------------------------------------------------------------------------------
describe('ledger, saldo, patrimônio e export NÃO mudam', () => {
  const rows = [
    tx('2026-09-05', 'Renda', 6000, 'Salário'),
    payBank('2026-09-20', 2000, 'ev-pay'),
    tx('2026-09-22', 'Despesa', 800, 'Mercado', { economic_event_id: 'ev-tr' }),
    payCard('2026-09-20', 2000, 'ev-pay'),
  ];

  it('o saldo por conta é igual com ou sem eventos (o movimento interno continua alterando a conta)', () => {
    const asOf = new Date(2026, 9, 7);
    const withIds = rows.map((t) => ({ ...t }));
    const withoutIds = rows.map((t) => ({ ...t, economic_event_id: undefined }));
    for (const a of accounts) expect(computeAccountBalanceAsOf(a, withIds, asOf)).toBe(computeAccountBalanceAsOf(a, withoutIds, asOf));
    expect(computeAccountBalanceAsOf(accounts[1], rows, asOf)).toBe(1000 + 6000 - 2000 - 800);
    expect(computeAccountsTotalAsOf(accounts, withIds, asOf)).toBe(computeAccountsTotalAsOf(accounts, withoutIds, asOf));
  });

  it('o export continua com TODAS as transações (movimento interno não é escondido)', () => {
    const exported = buildTransactionExportRows(rows, { accounts });
    expect(exported).toHaveLength(rows.length);
  });

  it('os helpers de saldo, patrimônio e export não importam o domínio econômico', () => {
    for (const f of ['src/utils/dashboardNetWorth.ts', 'src/domain/export/transactionExport.ts']) {
      expect(readFileSync(resolve(f), 'utf8'), f).not.toMatch(/transactionSemantics|economicKind|economic_event/);
    }
  });
});

// ----------------------------------------------------------------------------------------------------------
describe('Pagar: o evento vale imediatamente (sem reload)', () => {
  const EVENT: EconomicEvent = { id: 'ev-live', user_id: U, kind: 'credit_card_payment', source: 'pay_invoice_flow', counterparty_account_id: null, created_by: U, created_at: 't' };

  it('após registerInvoicePayment + rememberEconomicEvent, as duas pernas recém-gravadas já são neutras', async () => {
    useAppStore.setState({ economicEvents: [], user: { id: U } as never }); // sessão do dono do evento
    const added: Transaction[] = [];
    const registration = await registerInvoicePayment({
      userId: U, cardAccount: { id: CARD, user_id: U }, sourceAccount: { id: BANK, user_id: U },
      legs: [
        { Data: '2026-09-20', ID_Conta: CARD, Nome_Fantasia: 'Pagamento de Fatura', Categoria: 'Pagamento Cartão', Tipo: 'Renda', Valor: 1000, Descricao_Original: funding },
        { Data: '2026-09-20', ID_Conta: BANK, Nome_Fantasia: 'Pagamento Fatura', Categoria: 'Pagamento Cartão', Tipo: 'Despesa', Valor: -1000, Descricao_Original: fundingBank },
      ] as never,
      addTransaction: async (legs) => {
        const rowsOut = legs.map((l, i) => ({ ...l, ID_Transacao: `live-${i}`, user_id: U, Origem: 'manual' })) as unknown as Transaction[];
        added.push(...rowsOut);
        return rowsOut;
      },
      createEvent: async () => EVENT,
      deleteEvent: vi.fn(),
    });
    // O que a TransactionsView faz no sucesso:
    if (registration.event) useAppStore.getState().rememberEconomicEvent(registration.event);

    const map = buildEconomicKindByEventId(useAppStore.getState().economicEvents);
    expect(map.get('ev-live')).toBe('credit_card_payment');
    expect(added.every((t) => sem(t, map).isEconomicallyNeutral)).toBe(true);
    expect(sep(added, map).operational).toMatchObject({ income: 0, expense: 0 });
    expect(sep(added).operational).toMatchObject({ income: 1000, expense: 1000 }); // sem o evento lembrado: sobrecontagem (mutação H)
  });

  it('a TransactionsView lembra o evento logo após o registro, antes do alerta de sucesso', () => {
    const view = readFileSync(resolve('src/components/views/TransactionsView.tsx'), 'utf8');
    const remember = view.indexOf('if (registration.event) rememberEconomicEvent(registration.event);');
    expect(remember).toBeGreaterThan(view.indexOf('const registration = await registerInvoicePayment'));
    expect(remember).toBeLessThan(view.indexOf("await appAlert('Pagamento registrado com sucesso.'"));
  });
});

// ----------------------------------------------------------------------------------------------------------
describe('guardas estáticas da 3A', () => {
  const read = (p: string) => readFileSync(resolve(p), 'utf8');
  const domain = read('src/domain/economics/transactionSemantics.ts');
  const activeSection = domain.slice(domain.indexOf('Políticas ATIVAS'));

  it('as políticas ativas só usam isEconomicallyNeutral — nunca o id nem hasEconomicEvent', () => {
    expect(activeSection).toContain('isEconomicallyNeutral');
    expect(activeSection).not.toMatch(/hasEconomicEvent|economic_event_id|economicKindByEventId/);
  });

  it('a neutralidade depende de kind conhecido', () => {
    expect(domain).toMatch(/isEconomicallyNeutral: economicKind !== null && NEUTRAL_KINDS\.has\(economicKind\)/);
  });

  it('os consumidores usam as políticas ativas e passam o mapa; as legadas ficam só nos testes', () => {
    const consumers: Record<string, RegExp> = {
      'src/utils/dashboardMetrics.ts': /isDashboardEconomicTransaction[\s\S]*isInvestmentSummaryTransaction/,
      'src/utils/monthlyChange.ts': /isAnalysisEconomicTransaction/,
      'src/utils/annualEvolution.ts': /isAnalysisEconomicTransaction/,
      'src/domain/budgets/monthlyBudget.ts': /isBudgetSpendEconomicTransaction/,
      'src/utils/upcomingEntries.ts': /isUpcomingEconomicTransaction/,
      'src/domain/recurrences/detectRecurrences.ts': /isRecurrenceEconomicTransaction/,
    };
    for (const [f, re] of Object.entries(consumers)) {
      const src = read(f);
      expect(src, f).toMatch(re);
      expect(src, f).not.toMatch(/_legacy|isDashboardOperationalTransaction|isAnalysisOperationalTransaction|isBudgetSpendTransaction\b|isUpcomingEligibleTransaction|isRecurrenceBaseEligibleTransaction/);
    }
  });

  it('o marcador legado do Pagar continua nas políticas de Próximos e Recorrências', () => {
    expect(domain).toMatch(/isUpcomingEligibleTransaction[\s\S]*!s\.hasFundingMarker/);
    expect(domain).toMatch(/isRecurrenceBaseEligibleTransaction[\s\S]*!s\.hasFundingMarker/);
  });

  it('a Dashboard, a lista de Próximos e as Recorrências passam o mapa de eventos', () => {
    const dash = read('src/components/views/DashboardView.tsx');
    expect(dash.match(/economicKindByEventId/g)!.length).toBeGreaterThanOrEqual(10);
    expect(dash).toContain('buildEconomicKindByEventId(economicEvents)');
    expect(read('src/components/views/TransactionsView.tsx')).toContain('economicKindByEventId: buildEconomicKindByEventId(economicEvents)');
    expect(read('src/components/dashboard/UpcomingEntriesCard.tsx')).toContain('economicKindByEventId');
  });

  it('o saldo e os helpers de ledger não recebem a política econômica', () => {
    expect(read('src/hooks/useAppStore.ts')).not.toMatch(/transactionSemantics|isEconomicallyNeutral/);
  });

  it('as políticas econômicas e o domínio de semântica não conhecem a marcação manual (3B só cria/remove eventos)', () => {
    for (const f of ['src/domain/economics/transactionSemantics.ts', 'src/utils/dashboardMetrics.ts', 'src/utils/upcomingEntries.ts']) {
      expect(read(f), f).not.toMatch(/markTransactionAsInternalMovement|manualEconomicIdentity|Marcar como movimentação interna/);
    }
  });
});
