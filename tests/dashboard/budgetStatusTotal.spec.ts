import { describe, expect, it } from 'vitest';
import {
  computeBudgetStatus,
  computeBudgetStatusTotal,
  type BudgetStatusItem,
} from '../../src/utils/dashboardBudget';
import type { Budget, Transaction } from '../../src/types';

/**
 * Chamado do usuário: "seria interessante... trazer o orçamento total de
 * todas as categorias mapeadas no monitoramento, assim o usuário poderia
 * saber quanto do total foi consumido além de ter a visão categorizada."
 *
 * `computeBudgetStatusTotal` soma o que `computeBudgetStatus` já calcula por
 * categoria — não é um cálculo novo, é a mesma fonte agregada.
 */

const item = (over: Partial<BudgetStatusItem>): BudgetStatusItem => ({
  id: 'b',
  user_id: 'u',
  Categoria: 'Categoria',
  ano: 2026,
  mes: 1,
  Valor_Limite_Mensal: 100,
  spent: 0,
  adjustedLimit: 100,
  pacingRatio: 1,
  ...over,
} as BudgetStatusItem);

describe('computeBudgetStatusTotal', () => {
  it('soma gasto e limite de todas as categorias', () => {
    const total = computeBudgetStatusTotal([
      item({ Categoria: 'Alimentação', spent: 300, adjustedLimit: 500 }),
      item({ Categoria: 'Lazer', spent: 150, adjustedLimit: 200 }),
      item({ Categoria: 'Transporte', spent: 80, adjustedLimit: 100 }),
    ]);

    expect(total.spent).toBe(530);
    expect(total.limit).toBe(800);
  });

  it('sem nenhum orçamento configurado, devolve zero e ritmo neutro', () => {
    const total = computeBudgetStatusTotal([]);
    expect(total).toEqual({ spent: 0, limit: 0, pacingRatio: 1.0 });
  });

  it('uma única categoria — o total é ela mesma', () => {
    const total = computeBudgetStatusTotal([item({ spent: 42, adjustedLimit: 100, pacingRatio: 0.5 })]);
    expect(total).toEqual({ spent: 42, limit: 100, pacingRatio: 0.5 });
  });

  it('o ritmo do total é o mesmo ritmo de qualquer categoria — não a média', () => {
    // pacingRatio não depende do orçamento, só da data — nunca varia entre
    // itens da mesma chamada. Somá-lo/tirar média seria inventar um número.
    const total = computeBudgetStatusTotal([
      item({ Categoria: 'A', pacingRatio: 0.7 }),
      item({ Categoria: 'B', pacingRatio: 0.7 }),
    ]);
    expect(total.pacingRatio).toBe(0.7);
  });
});

describe('a premissa: pacingRatio é idêntico entre categorias na mesma chamada', () => {
  // Prova a premissa acima contra o cálculo REAL de computeBudgetStatus, não
  // só contra o fixture — se algum dia deixar de ser verdade, este teste
  // quebra antes que o total silenciosamente use o ritmo errado.
  it('duas categorias, mesmo período — mesmo pacingRatio', () => {
    const budgets: Budget[] = [
      { id: 'b1', user_id: 'u', Categoria: 'Alimentação', ano: 2026, mes: 1, Valor_Limite_Mensal: 500 } as Budget,
      { id: 'b2', user_id: 'u', Categoria: 'Lazer', ano: 2026, mes: 1, Valor_Limite_Mensal: 200 } as Budget,
    ];
    const transactions: Transaction[] = [];
    // Construtor y/m/d — não string ISO — para não cair na meia-noite UTC e
    // recuar um dia (e um ano) em fusos negativos, o mesmo cuidado que o
    // resto do projeto já toma ao redor de parsing de data.
    const dateRange = { start: new Date(2026, 0, 1), end: new Date(2026, 0, 31) };
    const referenceDate = new Date(2026, 0, 16);

    const status = computeBudgetStatus(budgets, transactions, 'monthly', dateRange, referenceDate);

    expect(status).toHaveLength(2);
    expect(status[0].pacingRatio).toBe(status[1].pacingRatio);
  });
});
