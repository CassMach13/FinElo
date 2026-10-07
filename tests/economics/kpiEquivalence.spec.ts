import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Account, Budget, BudgetMonth, Category, Transaction } from '../../src/types';
import { computeDashboardPeriodMetrics } from '../../src/utils/dashboardMetrics';
import { computeMonthlyChange } from '../../src/utils/monthlyChange';
import { computeAnnualEvolution } from '../../src/utils/annualEvolution';
import { computeUpcomingEntries } from '../../src/utils/upcomingEntries';
import { detectRecurrences } from '../../src/domain/recurrences/detectRecurrences';
import { computeBudgetLines } from '../../src/domain/budgets/monthlyBudget';
import { buildDirectedPaymentDescription, buildFundingPaymentDescription } from '../../src/services/creditCardDirectedPayment';

/**
 * Fase 1 é só metadata: gravar `economic_event_id` NÃO pode mudar nenhum número. Os mesmos lançamentos, com e sem
 * o id (nas pernas do Pagar e em todas as demais), têm que produzir resultados idênticos em todos os consumidores.
 */
const U = '11111111-1111-4111-8111-111111111111';
const CARD = 'card-1';
const BANK = 'bank-1';
const EV = '99999999-9999-4999-8999-999999999999';

const accounts = [
  { id: CARD, user_id: U, Nome_Conta: 'Cartão', Tipo_Conta: 'Cartão de Crédito', Saldo_Inicial: 0, Data_Saldo_Inicial: '2025-01-01' },
  { id: BANK, user_id: U, Nome_Conta: 'Banco', Tipo_Conta: 'Conta Corrente', Saldo_Inicial: 0, Data_Saldo_Inicial: '2025-01-01' },
] as unknown as Account[];
const categories = [
  { id: 'c1', Nome_Categoria: 'Mercado', Tipo: 'Despesa' },
  { id: 'c2', Nome_Categoria: 'Pagamento Cartão', Tipo: 'Renda' },
  { id: 'c3', Nome_Categoria: 'Movimentação', Tipo: 'Ambos' },
  { id: 'c4', Nome_Categoria: 'Investimentos', Tipo: 'Despesa', is_investment: true },
  { id: 'c5', Nome_Categoria: 'Salário', Tipo: 'Renda' },
] as unknown as Category[];

let n = 0;
const tx = (data: string, tipo: 'Renda' | 'Despesa', valor: number, cat: string, extra: Partial<Transaction> = {}): Transaction =>
  ({
    ID_Transacao: `t${++n}`,
    user_id: U,
    Data: data,
    Nome_Fantasia: extra.Nome_Fantasia ?? cat,
    Descricao_Original: extra.Descricao_Original ?? cat,
    Valor: tipo === 'Despesa' ? -Math.abs(valor) : Math.abs(valor),
    Tipo: tipo,
    Categoria: cat,
    Origem: 'manual',
    Fonte: 'Manual',
    ID_Conta: BANK,
    ...extra,
  }) as unknown as Transaction;

const payCard = (data: string, valor: number) =>
  tx(data, 'Renda', valor, 'Pagamento Cartão', {
    Nome_Fantasia: 'Pagamento de Fatura',
    Descricao_Original: buildDirectedPaymentDescription('2026-09', BANK),
    ID_Conta: CARD,
  });
const payBank = (data: string, valor: number) =>
  tx(data, 'Despesa', valor, 'Pagamento Cartão', {
    Nome_Fantasia: 'Pagamento Fatura — Cartão',
    Descricao_Original: buildFundingPaymentDescription('2026-09', 'Cartão', BANK),
    ID_Conta: BANK,
  });

const baseTransactions = (): Transaction[] => {
  n = 0;
  const rows: Transaction[] = [];
  for (const m of ['2025-04', '2025-05', '2025-06', '2025-07', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']) {
    rows.push(tx(`${m}-05`, 'Renda', 6000, 'Salário'));
    rows.push(tx(`${m}-10`, 'Despesa', 700, 'Mercado'));
    rows.push(tx(`${m}-12`, 'Despesa', 39.9, 'Mercado', { Nome_Fantasia: 'Streaming', Descricao_Original: 'Streaming' }));
    rows.push(tx(`${m}-15`, 'Despesa', 300, 'Investimentos'));
    rows.push(tx(`${m}-20`, 'Despesa', 500, 'Movimentação'));
  }
  rows.push(payCard('2026-09-20', 2000), payBank('2026-09-20', 2000));
  rows.push(payCard('2026-10-20', 1500), payBank('2026-10-20', 1500)); // futuros (Próximos lançamentos)
  rows.push(tx('2026-10-25', 'Despesa', 80, 'Mercado'));
  return rows;
};

/** Mesmos lançamentos; só as pernas do Pagar (ou TODAS) ganham `economic_event_id`. */
const withEventIds = (rows: Transaction[], scope: 'pagar' | 'all'): Transaction[] =>
  rows.map((t) =>
    scope === 'all' || t.Descricao_Original.includes('finelo_funding_account:') ? { ...t, economic_event_id: EV } : { ...t }
  );

const budgets = [{ id: 'b1', user_id: U, Categoria: 'Mercado', Valor_Limite_Mensal: 1000, ano: 2026 }] as unknown as Budget[];
const budgetMonths = [{ id: 'm1', user_id: U, Categoria: 'Mercado', year: 2026, month: 9, amount: 900, created_at: '', updated_at: '' }] as BudgetMonth[];
const range = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59) };

const everything = (rows: Transaction[]) => ({
  dashboard: computeDashboardPeriodMetrics(rows, categories, range),
  dashboardYear: computeDashboardPeriodMetrics(rows, categories, { start: new Date(2026, 0, 1), end: new Date(2026, 11, 31, 23, 59, 59) }),
  monthly: computeMonthlyChange({ transactions: rows, categories, today: '2026-10-07' }),
  annual: computeAnnualEvolution({ transactions: rows, categories, today: '2026-10-07' }),
  upcoming: computeUpcomingEntries({ transactions: rows, categories, accounts, today: '2026-10-07' }),
  recurrences: detectRecurrences({ transactions: rows, categories, accounts, today: '2026-10-07' }),
  budget: computeBudgetLines({
    budgets,
    budgetMonths,
    transactions: rows,
    range,
    currentUserId: U,
    getTransactionOwnerId: (t) => t.user_id,
    referenceDate: new Date(2026, 9, 7),
  }),
});

describe('Fase 1 — KPIs idênticos com economic_event_id', () => {
  const plain = baseTransactions();
  const baseline = JSON.stringify(everything(plain));

  it('o fixture exercita o Pagar de verdade (as pernas contam hoje como entrada e saída)', () => {
    const d = computeDashboardPeriodMetrics(plain, categories, range);
    // set/2026: salário 6000 + perna do cartão 2000 (Renda em categoria operacional)
    expect(d.operational.income).toBe(8000);
    expect(d.operational.expense).toBeGreaterThan(2000);
  });

  it.each(['pagar', 'all'] as const)('resultados idênticos em todos os consumidores (id em %s)', (scope) => {
    expect(JSON.stringify(everything(withEventIds(plain, scope)))).toBe(baseline);
  });

  it('ids diferentes por perna também não alteram nada', () => {
    const rows = plain.map((t, i) => ({ ...t, economic_event_id: `ev-${i}` }));
    expect(JSON.stringify(everything(rows))).toBe(baseline);
  });

  it('guarda estática: nenhum consumidor econômico lê economic_event_id', () => {
    const files = [
      'src/utils/dashboardMetrics.ts',
      'src/domain/budgets/monthlyBudget.ts',
      'src/utils/dashboardBudget.ts',
      'src/utils/monthlyChange.ts',
      'src/utils/annualEvolution.ts',
      'src/utils/upcomingEntries.ts',
      'src/domain/recurrences/detectRecurrences.ts',
      'src/domain/export/transactionExport.ts',
      'src/components/views/DashboardView.tsx',
    ];
    for (const f of files) expect(readFileSync(resolve(f), 'utf8'), f).not.toMatch(/economic_event|economicEvent/);
  });
});
