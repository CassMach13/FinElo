import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Rule503020Widget from '../../src/components/widgets/Rule503020Widget';
import type { Category, Transaction } from '../../src/types';
import {
  formatPercentOfIncome,
  hasValidIncomeBase,
  percentOfIncome,
} from '../../src/utils/rule503020Percentages';

const categories: Category[] = [
  { id: '1', Nome_Categoria: 'Moradia', Tipo: 'Despesa', is_essential: true },
  { id: '2', Nome_Categoria: 'Lazer', Tipo: 'Despesa', is_essential: false },
];
const expense = (Categoria: string, Valor: number): Transaction =>
  ({ Tipo: 'Despesa', Categoria, Valor: -Valor }) as Transaction;

const render = (income: number, expenses: Transaction[], savings = 0) =>
  renderToStaticMarkup(
    React.createElement(Rule503020Widget, { income, operationalExpenses: expenses, savings, categories })
  );

const MENSAGEM = 'Sem renda no período para calcular os percentuais do método 50-30-20.';

describe('Método 50-30-20 — percentuais só com base de renda válida', () => {
  it('A. renda positiva: percentuais iguais ao cálculo de sempre', () => {
    const html = render(1000, [expense('Moradia', 500), expense('Lazer', 300)], 200);
    expect(html).toContain('50.0% da Renda');
    expect(html).toContain('30.0% da Renda');
    expect(html).toContain('20.0% da Renda');
    expect(html).not.toContain(MENSAGEM);
  });

  it('A2. renda positiva e gastos acima dela: o aviso de soma > 100% continua', () => {
    const html = render(1000, [expense('Moradia', 900), expense('Lazer', 300)], 0);
    expect(html).toContain('Total Utilizado: 120.0%');
  });

  it('B. renda 0 com gastos: sem percentual absurdo, NaN ou Infinity; valores absolutos visíveis', () => {
    const html = render(0, [expense('Moradia', 4958.63), expense('Lazer', 2607.37)]);
    expect(html).not.toMatch(/\d{4,}(\.\d)?% da Renda/);
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
    expect(html).toContain(MENSAGEM);
    expect(html).toContain('—');
    expect(html).toContain('4.958,63');
    expect(html).toContain('2.607,37');
  });

  it('C. renda 0 e gastos 0: estado coerente', () => {
    const html = render(0, []);
    expect(html).toContain(MENSAGEM);
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('0.0% da Renda');
  });

  it('D. renda negativa é "sem base válida", não proporção', () => {
    const html = render(-500, [expense('Lazer', 100)]);
    expect(html).toContain(MENSAGEM);
    expect(html).not.toContain('-20000');
    expect(html).not.toContain('% da Renda');
  });

  it('com comparação: período sem renda não gera diferença em p.p. nem percentual falso', () => {
    const html = renderToStaticMarkup(
      React.createElement(Rule503020Widget, {
        income: 1000,
        operationalExpenses: [expense('Moradia', 500)],
        savings: 0,
        categories,
        compare: { label: 'Anterior', income: 0, operationalExpenses: [expense('Moradia', 800)], savings: 0 },
      })
    );
    expect(html).toContain('50.0% da Renda');
    expect(html).not.toContain('p.p.');
    expect(html).not.toMatch(/\d{4,}(\.\d)?% da Renda/);
  });
});

describe('rule503020Percentages', () => {
  it('só renda finita e positiva é base', () => {
    expect(hasValidIncomeBase(1)).toBe(true);
    for (const ruim of [0, -1, NaN, Infinity, undefined, null]) {
      expect(hasValidIncomeBase(ruim as number), String(ruim)).toBe(false);
    }
  });

  it('percentual indisponível é null e aparece como travessão', () => {
    expect(percentOfIncome(500, 0)).toBeNull();
    expect(percentOfIncome(500, 1000)).toBe(50);
    expect(formatPercentOfIncome(null)).toBe('—');
    expect(formatPercentOfIncome(12.34)).toBe('12.3% da Renda');
  });
});
