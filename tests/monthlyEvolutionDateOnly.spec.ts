import { describe, expect, it } from 'vitest';
import { buildMonthBuckets } from '../src/components/charts/MonthlyEvolutionChart';
import type { Transaction } from '../src/types';

describe('MonthlyEvolutionChart date-only', () => {
  it('mantém a transação do primeiro dia no mês civil correto', () => {
    const transaction = {
      Data: '2026-08-01',
      Valor: -25,
      Tipo: 'Despesa',
      Categoria: 'Alimentação',
    } as unknown as Transaction;

    const buckets = buildMonthBuckets([transaction], 'monthly', new Date(2026, 7, 15, 12));

    expect(buckets).toHaveLength(6);
    expect(buckets.at(-2)?.Despesa).toBe(0);
    expect(buckets.at(-1)?.Despesa).toBe(25);
  });
});
