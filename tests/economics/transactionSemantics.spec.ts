import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Account, Category, Transaction } from '../../src/types';
import {
  TRANSACTION_VIEW_POLICIES,
  buildCategorySets,
  classifyTransaction,
  hasFundingAccountMarker,
  isIncludedByPolicy,
  type TransactionViewPolicy,
} from '../../src/domain/economics/transactionSemantics';
import { buildDirectedPaymentDescription, buildFundingPaymentDescription } from '../../src/services/creditCardDirectedPayment';

/**
 * FASE 2: a classificação é uma só; as políticas preservam as diferenças LEGADAS entre consumidores. A matriz
 * abaixo congela o comportamento ATUAL — na Fase 3 ela mostrará exatamente quais células mudam.
 */
const categories = [
  { id: '1', Nome_Categoria: 'Mercado', Tipo: 'Despesa' },
  { id: '2', Nome_Categoria: 'Salário', Tipo: 'Renda' },
  { id: '3', Nome_Categoria: 'Movimentação', Tipo: 'Ambos' },
  { id: '4', Nome_Categoria: 'Investimentos', Tipo: 'Despesa', is_investment: true },
  { id: '5', Nome_Categoria: 'Aporte Ambos', Tipo: 'Ambos', is_investment: true },
  { id: '6', Nome_Categoria: 'Pagamento Cartão', Tipo: 'Renda' },
] as unknown as Category[];
const accounts = [
  { id: 'card', Tipo_Conta: 'Cartão de Crédito' },
  { id: 'bank', Tipo_Conta: 'Conta Corrente' },
] as unknown as Account[];

const ctx = { categorySets: buildCategorySets(categories), accountById: new Map(accounts.map((a) => [a.id, a])) };
const tx = (extra: Partial<Transaction>): Transaction =>
  ({
    ID_Transacao: 't',
    Data: '2026-09-10',
    Nome_Fantasia: 'Compra',
    Descricao_Original: 'Compra',
    Valor: -100,
    Tipo: 'Despesa',
    Categoria: 'Mercado',
    Origem: 'manual',
    Fonte: 'Manual',
    ID_Conta: 'bank',
    ...extra,
  }) as unknown as Transaction;
const sem = (extra: Partial<Transaction>) => classifyTransaction(tx(extra), ctx);

describe('classifyTransaction — fatos estruturais', () => {
  it('Renda e Despesa; tipo inválido', () => {
    expect(sem({ Tipo: 'Renda', Valor: 10 })).toMatchObject({ validType: true, isIncome: true, isExpense: false });
    expect(sem({})).toMatchObject({ validType: true, isIncome: false, isExpense: true });
    expect(sem({ Tipo: 'Outro' as never })).toMatchObject({ validType: false, isIncome: false, isExpense: false });
    expect(sem({ Tipo: undefined as never }).validType).toBe(false);
  });

  it('valor inválido, zero e finito', () => {
    expect(sem({ Valor: NaN }).validAmount).toBe(false);
    expect(sem({ Valor: Infinity }).validAmount).toBe(false);
    expect(sem({ Valor: 0 }).validAmount).toBe(false);
    expect(sem({ Valor: -0.01 }).validAmount).toBe(true);
  });

  it('demo: Origem demo.csv ou Fonte Demo', () => {
    expect(sem({ Origem: 'demo.csv' }).isDemo).toBe(true);
    expect(sem({ Fonte: 'Demo' }).isDemo).toBe(true);
    expect(sem({}).isDemo).toBe(false);
  });

  it('categoria: operational, ambos, investment (investment tem prioridade sobre ambos)', () => {
    expect(sem({ Categoria: 'Mercado' }).categoryKind).toBe('operational');
    expect(sem({ Categoria: 'Movimentação' }).categoryKind).toBe('ambos');
    expect(sem({ Categoria: 'Investimentos' }).categoryKind).toBe('investment');
    expect(sem({ Categoria: 'Aporte Ambos' }).categoryKind).toBe('investment');
    expect(sem({ Categoria: 'Inexistente' }).categoryKind).toBe('operational');
  });

  it('marcador do Pagar em Descricao_Original e em Observacoes', () => {
    expect(sem({ Descricao_Original: buildDirectedPaymentDescription('2026-09', 'bank') }).hasFundingMarker).toBe(true);
    expect(sem({ Descricao_Original: 'x', Observacoes: 'finelo_funding_account:abc' }).hasFundingMarker).toBe(true);
    expect(sem({ Descricao_Original: 'Pagamento de fatura finelo_competence:2026-09' }).hasFundingMarker).toBe(false);
    expect(hasFundingAccountMarker({ Descricao_Original: undefined as unknown as string, Observacoes: undefined })).toBe(false);
  });

  it('conta de cartão e Renda em cartão (sem a conta, não é cartão)', () => {
    expect(sem({ ID_Conta: 'card' })).toMatchObject({ isCardAccount: true, isCardIncome: false });
    expect(sem({ ID_Conta: 'card', Tipo: 'Renda', Valor: 10 })).toMatchObject({ isCardAccount: true, isCardIncome: true });
    expect(sem({ ID_Conta: 'bank', Tipo: 'Renda', Valor: 10 }).isCardIncome).toBe(false);
    expect(sem({ ID_Conta: undefined, Tipo: 'Renda', Valor: 10 }).isCardAccount).toBe(false);
    expect(classifyTransaction(tx({ ID_Conta: 'card' }), {}).isCardAccount).toBe(false);
  });

  it('compromisso: parcela, financiamento ou (n/m) no nome', () => {
    expect(sem({ Parcela_Atual: 2, Total_Parcelas: 10 }).isCommitment).toBe(true);
    expect(sem({ Total_Parcelas: 12 }).isCommitment).toBe(true);
    expect(sem({ Nome_Fantasia: 'Loja (3/6)' }).isCommitment).toBe(true);
    expect(sem({ Total_Parcelas: 1 }).isCommitment).toBe(false);
  });

  it('economic_event_id é só um fato (presente/ausente)', () => {
    expect(sem({ economic_event_id: 'ev' }).hasEconomicEvent).toBe(true);
    expect(sem({ economic_event_id: null }).hasEconomicEvent).toBe(false);
    expect(sem({}).hasEconomicEvent).toBe(false);
  });

  it('é pura: não muda a transação e é determinística', () => {
    const t = tx({ economic_event_id: 'ev' });
    const copy = JSON.stringify(t);
    expect(classifyTransaction(t, ctx)).toEqual(classifyTransaction(t, ctx));
    expect(JSON.stringify(t)).toBe(copy);
  });
});

type Row = [string, Partial<Transaction>, Record<TransactionViewPolicy, boolean>];
const P = (d: boolean, a: boolean, b: boolean, u: boolean, r: boolean) => ({
  dashboard_operational_legacy: d,
  analysis_operational_legacy: a,
  budget_spend_legacy: b,
  upcoming_legacy: u,
  recurrence_legacy: r,
});
const funding = buildDirectedPaymentDescription('2026-09', 'bank');
const fundingBank = buildFundingPaymentDescription('2026-09', 'Cartão', 'bank');

// Colunas: Dashboard · Análise (mensal/anual) · Orçamento · Próximos lançamentos · Recorrências
export const MATRIX: Row[] = [
  ['renda normal', { Tipo: 'Renda', Valor: 6000, Categoria: 'Salário' }, P(true, true, false, true, false)],
  ['despesa normal', {}, P(true, true, true, true, true)],
  ['despesa demo', { Origem: 'demo.csv' }, P(true, false, false, false, false)],
  ['despesa em Ambos', { Categoria: 'Movimentação' }, P(false, false, true, false, false)],
  ['despesa em investimento', { Categoria: 'Investimentos' }, P(false, false, true, false, false)],
  ['Pagar — perna do cartão', { Tipo: 'Renda', Valor: 100, ID_Conta: 'card', Categoria: 'Pagamento Cartão', Descricao_Original: funding }, P(true, true, false, false, false)],
  ['Pagar — perna bancária', { Valor: -100, Categoria: 'Pagamento Cartão', Descricao_Original: fundingBank }, P(true, true, true, false, false)],
  ['Renda em cartão sem marcador', { Tipo: 'Renda', Valor: 50, ID_Conta: 'card', Categoria: 'Pagamento Cartão' }, P(true, true, false, false, false)],
  ['parcela', { Parcela_Atual: 2, Total_Parcelas: 10 }, P(true, true, true, true, false)],
  ['com economic_event_id (despesa normal)', { economic_event_id: 'ev-1' }, P(true, true, true, true, true)],
  ['Pagar — perna bancária COM economic_event_id', { Valor: -100, Categoria: 'Pagamento Cartão', Descricao_Original: fundingBank, economic_event_id: 'ev-1' }, P(true, true, true, false, false)],
  ['Pagar — perna do cartão COM economic_event_id', { Tipo: 'Renda', Valor: 100, ID_Conta: 'card', Categoria: 'Pagamento Cartão', Descricao_Original: funding, economic_event_id: 'ev-1' }, P(true, true, false, false, false)],
  ['valor zero', { Valor: 0 }, P(true, false, false, false, false)],
  ['tipo inválido', { Tipo: 'Outro' as never }, P(true, false, false, false, false)],
];

describe('matriz caso × política (comportamento ATUAL congelado)', () => {
  it.each(MATRIX)('%s', (_name, extra, expected) => {
    const s = sem(extra);
    for (const policy of Object.keys(expected) as TransactionViewPolicy[]) {
      expect({ policy, in: isIncludedByPolicy(s, policy) }).toEqual({ policy, in: expected[policy] });
    }
  });

  it('o mapa de políticas expõe exatamente as cinco políticas legadas (não existe política "economic")', () => {
    expect(Object.keys(TRANSACTION_VIEW_POLICIES).sort()).toEqual(
      ['analysis_operational_legacy', 'budget_spend_legacy', 'dashboard_operational_legacy', 'recurrence_legacy', 'upcoming_legacy']
    );
  });

  it('assimetria do demo: só o Dashboard ainda o inclui', () => {
    const s = sem({ Origem: 'demo.csv' });
    expect(isIncludedByPolicy(s, 'dashboard_operational_legacy')).toBe(true);
    for (const p of ['analysis_operational_legacy', 'budget_spend_legacy', 'upcoming_legacy', 'recurrence_legacy'] as const) {
      expect(isIncludedByPolicy(s, p)).toBe(false);
    }
  });

  it('assimetria do Pagar: Dashboard e análises contam; Próximos lançamentos e Recorrências excluem', () => {
    const s = sem({ Valor: -100, Categoria: 'Pagamento Cartão', Descricao_Original: fundingBank });
    expect(isIncludedByPolicy(s, 'dashboard_operational_legacy')).toBe(true);
    expect(isIncludedByPolicy(s, 'analysis_operational_legacy')).toBe(true);
    expect(isIncludedByPolicy(s, 'budget_spend_legacy')).toBe(true);
    expect(isIncludedByPolicy(s, 'upcoming_legacy')).toBe(false);
    expect(isIncludedByPolicy(s, 'recurrence_legacy')).toBe(false);
  });

  it('Renda em cartão só é excluída em Próximos lançamentos; parcela só em Recorrências', () => {
    const card = sem({ Tipo: 'Renda', Valor: 50, ID_Conta: 'card' });
    expect(isIncludedByPolicy(card, 'upcoming_legacy')).toBe(false);
    expect(isIncludedByPolicy(card, 'dashboard_operational_legacy')).toBe(true);
    expect(isIncludedByPolicy(card, 'analysis_operational_legacy')).toBe(true);
    const inst = sem({ Parcela_Atual: 1, Total_Parcelas: 3 });
    expect(isIncludedByPolicy(inst, 'recurrence_legacy')).toBe(false);
    for (const p of ['dashboard_operational_legacy', 'analysis_operational_legacy', 'budget_spend_legacy', 'upcoming_legacy'] as const) {
      expect(isIncludedByPolicy(inst, p)).toBe(true);
    }
  });

  it('economic_event_id não altera nenhuma célula da matriz', () => {
    for (const [, extra, expected] of MATRIX) {
      for (const policy of Object.keys(expected) as TransactionViewPolicy[]) {
        const withEvent = isIncludedByPolicy(sem({ ...extra, economic_event_id: 'ev-x' }), policy);
        const without = isIncludedByPolicy(sem({ ...extra, economic_event_id: null }), policy);
        expect(withEvent).toBe(without);
      }
    }
  });
});

describe('guardas estáticas', () => {
  const read = (p: string) => readFileSync(resolve(p), 'utf8');
  const domain = read('src/domain/economics/transactionSemantics.ts');
  const migrated = [
    'src/utils/monthlyChange.ts',
    'src/utils/annualEvolution.ts',
    'src/utils/upcomingEntries.ts',
    'src/domain/recurrences/detectRecurrences.ts',
    'src/domain/budgets/monthlyBudget.ts',
  ];

  it('o marcador do Pagar é detectado em UM lugar (domínio); Próximos lançamentos e Recorrências não duplicam', () => {
    expect(domain.match(/FUNDING_ACCOUNT_OBS_PREFIX\)/g)?.length).toBe(1);
    for (const f of ['src/utils/upcomingEntries.ts', 'src/domain/recurrences/detectRecurrences.ts']) {
      expect(read(f), f).not.toMatch(/FUNDING_ACCOUNT_OBS_PREFIX|finelo_funding_account/);
      expect(read(f), f).not.toMatch(/\.includes\(\s*FUNDING/);
    }
  });

  it('os consumidores migrados não decidem elegibilidade com isDemoTransaction diretamente', () => {
    for (const f of migrated) expect(read(f), f).not.toMatch(/isDemoTransaction/);
  });

  it('nenhuma política decide por economic_event_id (só o fato hasEconomicEvent o lê)', () => {
    expect(domain.match(/economic_event/g)?.length).toBe(1);
    expect(domain).toMatch(/hasEconomicEvent: Boolean\(tx\.economic_event_id\)/);
    const policies = domain.slice(domain.indexOf('Políticas LEGADAS'));
    expect(policies).not.toMatch(/hasEconomicEvent|economic_event/);
    for (const f of [...migrated, 'src/utils/dashboardMetrics.ts', 'src/components/views/DashboardView.tsx']) {
      expect(read(f), f).not.toMatch(/economic_event|economicEvent|hasEconomicEvent/);
    }
  });

  it('o domínio é puro: sem Supabase, store, React nem relógio', () => {
    expect(domain).not.toMatch(/supabase|useAppStore|from 'react'|Date\.now|new Date\(|localTodayIso/);
  });

  it('a Dashboard não classifica de novo: o conjunto sem Ambos/investimento vem do mesmo helper', () => {
    const dash = read('src/components/views/DashboardView.tsx');
    expect(dash).toContain('toOperationalChartData(transactions, categorySets)');
    expect(dash).not.toMatch(/ambosCategories|investmentCategories/);
  });
});
