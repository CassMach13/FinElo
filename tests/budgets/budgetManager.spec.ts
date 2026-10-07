import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/supabaseClient', () => ({ supabase: {} }));
vi.mock('../../src/hooks/useDialogStore', () => ({ appAlert: vi.fn(), appConfirm: vi.fn() }));

import BudgetManagerPanel, {
  BUDGET_ONLY_OWNER_CREATES,
  copyResultMessage,
  monthTitle,
  sourceLabel,
} from '../../src/components/budgets/BudgetManagerPanel';
import type { Budget, BudgetMonth, Category } from '../../src/types';

const A = '11111111-aaaa-4aaa-8aaa-111111111111';
const B = '22222222-bbbb-4bbb-8bbb-222222222222';

const cats: Category[] = [
  { id: '1', Nome_Categoria: 'Alimentação', Tipo: 'Despesa' },
  { id: '2', Nome_Categoria: 'Transporte', Tipo: 'Despesa' },
  { id: '3', Nome_Categoria: 'Salário', Tipo: 'Renda' },
  { id: '4', Nome_Categoria: 'Movimentação', Tipo: 'Ambos' },
  { id: '5', Nome_Categoria: 'Aportes', Tipo: 'Despesa', is_investment: true },
];
const annual = (owner: string, Categoria: string, v: number, ano = 2026): Budget => ({ id: `a-${owner}-${Categoria}`, user_id: owner, Categoria, Valor_Limite_Mensal: v, ano });
const bm = (owner: string, Categoria: string, year: number, month: number, amount: number): BudgetMonth => ({
  id: `m-${owner}-${Categoria}-${year}-${month}`, user_id: owner, Categoria, year, month, amount, created_at: '', updated_at: '',
});

const noop = async () => true;
const render = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    React.createElement(BudgetManagerPanel, {
      isOpen: true,
      onClose: () => {},
      initialMonth: { year: 2026, month: 10 },
      currentMonth: { year: 2026, month: 10 },
      currentUserId: A,
      categories: cats,
      budgets: [],
      budgetMonths: [],
      onCreateMany: noop,
      onUpdateAmount: noop,
      onDeleteMonth: noop,
      ...over,
    } as never)
  );

describe('Gerenciar orçamento — mês e navegação', () => {
  it('título, mês atual e botões de mês', () => {
    const html = render();
    expect(html).toContain('Gerenciar orçamento');
    expect(html).toContain('outubro/2026');
    expect(monthTitle({ year: 2026, month: 10 })).toBe('outubro/2026');
    expect(html).toContain('aria-label="Mês anterior"');
    expect(html).toContain('aria-label="Próximo mês"');
  });

  it('mês passado e próximo mês abrem; "próximo" fica desabilitado no limite', () => {
    expect(render({ initialMonth: { year: 2026, month: 3 } })).toContain('março/2026');
    const next = render({ initialMonth: { year: 2026, month: 11 } });
    expect(next).toContain('novembro/2026');
    expect(next).toMatch(/aria-label="Próximo mês"[^>]*disabled=""/);
    expect(render()).not.toMatch(/aria-label="Próximo mês"[^>]*disabled=""/); // de outubro ainda dá para ir a novembro
  });

  it('dezembro mostra janeiro como próximo e "Copiar de dezembro" em janeiro', () => {
    const html = render({ initialMonth: { year: 2027, month: 1 }, currentMonth: { year: 2026, month: 12 }, budgets: [annual(A, 'Alimentação', 1000)] });
    expect(html).toContain('janeiro/2027');
    expect(html).toContain('Copiar de dezembro');
  });
});

describe('Gerenciar orçamento — linhas e origem', () => {
  it('"Deste mês", "Padrão de 2026" e "Sem orçamento", só categorias elegíveis', () => {
    const html = render({
      budgets: [annual(A, 'Transporte', 600)],
      budgetMonths: [bm(A, 'Alimentação', 2026, 10, 1500)],
    });
    expect(html).toContain('Deste mês');
    expect(html).toContain('Padrão de 2026');
    expect(html).not.toContain('Sem orçamento'); // as duas elegíveis têm valor efetivo
    expect(html).not.toMatch(/>Salário</);
    expect(html).not.toMatch(/>Aportes</);
    const none = render();
    expect(none).toContain('Sem orçamento');
  });

  it('fallback anual NÃO preenche o campo como se fosse mensal', () => {
    const html = render({ budgets: [annual(A, 'Transporte', 600)] });
    expect(html).toContain('Padrão de 2026');
    expect(html).toContain('Definir valor para este mês');
    expect(html).not.toMatch(/value="600"/);
  });

  it('linha mensal vem preenchida com o valor e rótulo "Valor deste mês"', () => {
    const html = render({ budgetMonths: [bm(A, 'Alimentação', 2026, 10, 1500)] });
    expect(html).toContain('Valor deste mês');
    expect(html).toContain('value="1500"');
    expect(html).toContain('aria-label="Remover o orçamento de Alimentação deste mês"');
  });

  it('rótulos de origem (função pura)', () => {
    expect(sourceLabel({ Categoria: 'X', eligible: true, effective: null, monthly: null }, 2026)).toBe('Sem orçamento');
    expect(sourceLabel({ Categoria: 'X', eligible: true, effective: { amount: 1, source: 'annual' }, monthly: null }, 2027)).toBe('Padrão de 2027');
    expect(sourceLabel({ Categoria: 'X', eligible: true, effective: { amount: 1, source: 'monthly' }, monthly: bm(A, 'X', 2026, 1, 1) }, 2026)).toBe('Deste mês');
  });

  it('estado vazio sem categorias', () => {
    expect(render({ categories: [] })).toContain('Nenhuma categoria de despesa disponível');
  });

  it('erro de validação aparece no campo', () => {
    // rascunho inválido é validado ao salvar; aqui só garantimos que o campo recebe o rascunho
    const html = render({ initialDrafts: { Alimentação: 'abc' } });
    expect(html).toContain('value="abc"');
  });
});

describe('Gerenciar orçamento — cópia', () => {
  it('mostra quantas categorias e o total planejado a copiar', () => {
    const html = render({ budgets: [annual(A, 'Transporte', 600)], budgetMonths: [bm(A, 'Alimentação', 2026, 9, 1500)] });
    expect(html).toContain('Copiar de setembro');
    expect(html).toContain('2 categorias');
    expect(html).toMatch(/R\$\s?2\.100,00 planejados/);
  });

  it('destino parcial: informa as já definidas e não as conta', () => {
    const html = render({
      budgetMonths: [bm(A, 'Alimentação', 2026, 9, 1500), bm(A, 'Alimentação', 2026, 10, 1800), bm(A, 'Transporte', 2026, 9, 600)],
    });
    expect(html).toContain('1 categoria');
    expect(html).toContain('1 já definidas neste mês');
  });

  it('sem nada na origem: botão desabilitado', () => {
    expect(render()).toMatch(/<button[^>]*disabled[^>]*>Copiar de setembro<\/button>/);
  });

  it('mensagem do resultado', () => {
    expect(copyResultMessage(6, 0)).toBe('6 categorias copiadas.');
    expect(copyResultMessage(1, 0)).toBe('1 categoria copiada.');
    expect(copyResultMessage(6, 2)).toBe('6 copiadas · 2 já estavam definidas.');
    expect(copyResultMessage(6, 1)).toBe('6 copiadas · 1 já estava definida.');
  });
});

describe('Gerenciar orçamento — família', () => {
  const owners = [{ userId: A, label: 'Cássio' }, { userId: B, label: 'Marina' }];
  const base = { owners, budgets: [annual(B, 'Transporte', 400)], budgetMonths: [bm(B, 'Alimentação', 2026, 10, 800)] };

  it('usuário solo: sem seletor de responsável', () => {
    expect(render()).not.toContain('Responsável');
    expect(render({ owners: [{ userId: A, label: 'Você' }] })).not.toContain('Responsável');
  });

  it('família ativa: seletor com "Você" e o rótulo do outro; nunca UUID', () => {
    const html = render(base);
    expect(html).toContain('Responsável');
    expect(html).toContain('>Você<');
    expect(html).toContain('>Marina<');
    expect(html.replace(/value="[^"]*"/g, '')).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('outro responsável: aviso, sem criar valor novo, sem copiar; edita e remove a linha existente', () => {
    const html = render({ ...base, initialOwnerId: B });
    expect(html).toContain(BUDGET_ONLY_OWNER_CREATES);
    expect(BUDGET_ONLY_OWNER_CREATES).toBe('Somente o responsável pode criar o orçamento deste mês.');
    // Alimentação (mensal do B): campo editável e Remover
    expect(html).toContain('Valor deste mês');
    expect(html).toContain('value="800"');
    expect(html).toContain('aria-label="Remover o orçamento de Alimentação deste mês"');
    // Transporte (só padrão anual do B): mostra valor e origem, mas não oferece criar override
    expect(html).toContain('Padrão de 2026');
    expect(html).not.toContain('Definir valor para este mês');
    // copiar desabilitado
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Copiar de setembro<\/button>/);
  });

  it('o responsável é o usuário atual por padrão: pode criar e copiar', () => {
    const html = render(base);
    expect(html).not.toContain(BUDGET_ONLY_OWNER_CREATES);
  });
});

describe('Integração (contrato de código)', () => {
  const read = (p: string) => readFileSync(resolve(p), 'utf8');
  const dash = read('src/components/views/DashboardView.tsx');
  const settings = read('src/components/views/SettingsView.tsx');
  const panel = read('src/components/budgets/BudgetManagerPanel.tsx');

  it('Dashboard: restante/excedido, rótulo "Categorias com orçamento", CTA também no vazio, mês inicial', () => {
    expect(dash).toContain('Categorias com orçamento');
    expect(dash).toContain('Gerenciar orçamento');
    expect(dash).toMatch(/Restam \$\{formatCurrency/);
    expect(dash).toMatch(/\$\{formatCurrency\(budgetTotalRemaining\.amount\)\} acima/);
    // o botão fica FORA da ramificação "budgetStatus.length > 0": existe com e sem orçamento
    const card = dash.slice(dash.indexOf('<Card title="Monitoramento de Orçamento">'));
    expect(card.indexOf('Gerenciar orçamento')).toBeLessThan(card.indexOf('{budgetStatus.length > 0 ? ('));
    expect(dash).toContain("viewMode === 'monthly'");
    expect(dash).toContain('selectedDate.getMonth() + 1');
    expect(dash).toContain('currentMonth={todayCivil}');
  });

  it('Dashboard: linhas e comparação por dono + categoria; owner label só em família', () => {
    expect(dash).toContain('compareBudgetMap.get(item.key)');
    expect(dash).toContain("new Map(compareBudgetLines.map((item) => [item.key, item.spent]))");
    expect(dash).toContain('familyOwnerContext.showAttribution');
    expect(dash).toContain('getTransactionOwnerId: familyOwnerContext.getTransactionOwnerId');
    expect(dash).not.toMatch(/computeBudgetStatus\(/);
  });

  it('Dashboard consome o pedido transitório do Gerenciador, sem localStorage', () => {
    expect(dash).toContain('budgetManagerRequested');
    expect(dash).toContain('clearBudgetManagerRequest()');
    for (const src of [panel, read('src/domain/budgets/monthlyBudget.ts')]) expect(src).not.toMatch(/localStorage|sessionStorage/);
  });

  it('Settings mantém o CRUD anual e ganha o atalho e a nota de padrão anual', () => {
    expect(settings).toContain('Gerenciar Orçamentos');
    expect(settings).toContain('onAdd={openNewBudgetModal}');
    expect(settings).toContain('deleteBudget(id)');
    expect(settings).toContain('Gerenciar orçamento mensal');
    expect(settings).toContain('funciona como padrão quando não há um orçamento específico para o mês');
    expect(settings).toContain('requestBudgetManager();');
    expect(settings).toContain("setCurrentView('dashboard');");
  });

  it('sem Premium, analytics, novo item de navegação nem integração com outras features', () => {
    for (const src of [panel, read('src/domain/budgets/monthlyBudget.ts')]) {
      expect(src).not.toMatch(/isPremium|trackProductEvent|Recorr|upcoming|Goals/);
    }
    expect(read('src/layouts/MainLayout.tsx')).not.toMatch(/Orçamento/);
    expect(read('src/types.ts')).not.toMatch(/\| 'budgets'/);
  });

  it('o manager não alonga a Dashboard: abre em modal', () => {
    expect(panel).toContain("import Modal from '../ui/Modal'");
    expect(dash).toContain('{isBudgetManagerOpen && (');
  });
});
