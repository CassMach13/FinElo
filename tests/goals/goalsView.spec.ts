import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/supabaseClient', () => ({ supabase: {} }));
vi.mock('../../src/hooks/useDialogStore', () => ({ appAlert: vi.fn(), appConfirm: vi.fn() }));

import GoalCard from '../../src/components/goals/GoalCard';
import GoalFormModal from '../../src/components/goals/GoalFormModal';
import UpdateGoalValueModal from '../../src/components/goals/UpdateGoalValueModal';
import {
  GOALS_DELETE_MESSAGE,
  GOALS_EMPTY_CTA,
  GOALS_EMPTY_TITLE,
  GOALS_MANUAL_NOTE,
  GoalsPanel,
  type GoalsPanelProps,
} from '../../src/components/views/GoalsView';
import type { FinancialGoal } from '../../src/types';

const TODAY = '2026-10-06';
const goal = (id: string, name: string, extra: Partial<FinancialGoal> = {}): FinancialGoal => ({
  id,
  user_id: 'u',
  name,
  target_amount: 30000,
  current_amount: 12500,
  target_date: '2027-12-31',
  archived_at: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-10-01T10:00:00Z',
  ...extra,
});

const noop = async () => true;
const panel = (over: Partial<GoalsPanelProps> = {}) =>
  renderToStaticMarkup(
    React.createElement(GoalsPanel, {
      goals: [],
      status: 'success',
      today: TODAY,
      onRetry: () => {},
      onCreate: noop,
      onEdit: noop,
      onUpdateCurrent: noop,
      onArchive: noop,
      onUnarchive: noop,
      onDelete: noop,
      ...over,
    })
  );

const card = (g: FinancialGoal, initialMenuOpen = false) =>
  renderToStaticMarkup(
    React.createElement(GoalCard, {
      goal: g,
      today: TODAY,
      onUpdateValue: () => {},
      onEdit: () => {},
      onArchive: () => {},
      onUnarchive: () => {},
      onDelete: () => {},
      initialMenuOpen,
    })
  );

describe('Objetivos — view', () => {
  it('cabeçalho, nota fixa de valores manuais e CTA', () => {
    const html = panel({ goals: [goal('1', 'Reserva')] });
    expect(html).toContain('Objetivos');
    expect(html).toContain('+ Novo objetivo');
    expect(html).toContain(GOALS_MANUAL_NOTE);
    expect(GOALS_MANUAL_NOTE).toBe('Os valores são informados por você. O FinElo não movimenta suas contas.');
  });

  it('estado vazio com CTA, sem linguagem culpabilizante', () => {
    const html = panel();
    expect(html).toContain(GOALS_EMPTY_TITLE);
    expect(html).toContain('Transforme seus planos em objetivos acompanháveis.');
    expect(html).toContain(GOALS_EMPTY_CTA);
    expect(html).toContain('Criar primeiro objetivo');
    expect(html).not.toMatch(/atrasad|falhou|você deveria|culpa/i);
  });

  it('carregando e erro', () => {
    expect(panel({ status: 'loading' })).toContain('Carregando objetivos');
    expect(panel({ status: 'loading' })).not.toContain(GOALS_EMPTY_TITLE);
    const err = panel({ status: 'error' });
    expect(err).toContain('Não foi possível carregar seus objetivos.');
    expect(err).toContain('Tentar novamente');
  });

  it('lista ativos antes de alcançados e separa arquivados em seção recolhida', () => {
    const html = panel({
      goals: [
        goal('r', 'Alcançado', { current_amount: 30000 }),
        goal('a', 'Ativo'),
        goal('z', 'Arquivado 1', { archived_at: '2026-09-01T00:00:00Z' }),
        goal('y', 'Arquivado 2', { archived_at: '2026-09-02T00:00:00Z' }),
      ],
    });
    expect(html.indexOf('Ativo')).toBeLessThan(html.indexOf('Alcançado'));
    expect(html).toContain('Arquivados (2)');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Arquivado 1');
    expect(html).not.toContain('Arquivado 2');
  });

  it('arquivados expandidos aparecem e oferecem Restaurar e Excluir (sem Editar/Arquivar)', () => {
    const html = panel({
      goals: [goal('z', 'Arquivado 1', { archived_at: '2026-09-01T00:00:00Z' })],
      initialShowArchived: true,
    });
    expect(html).toContain('Arquivado 1');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('Atualizar valor');
    const menu = card(goal('z', 'Arq', { archived_at: '2026-09-01T00:00:00Z' }), true);
    expect(menu).toContain('Restaurar');
    expect(menu).toContain('Excluir');
    expect(menu).not.toContain('>Editar<');
    expect(menu).not.toContain('>Arquivar<');
  });

  it('arquivado sozinho não mostra a lista principal nem o estado vazio', () => {
    const html = panel({ goals: [goal('z', 'Arq', { archived_at: '2026-09-01T00:00:00Z' })] });
    expect(html).toContain('Arquivados (1)');
    expect(html).not.toContain(GOALS_EMPTY_TITLE);
  });

  it('confirmação de exclusão explica que contas e transações não mudam', () => {
    expect(GOALS_DELETE_MESSAGE).toBe('Excluir este objetivo? Isso não altera suas contas nem suas transações.');
  });

  it('nenhum texto sugere sincronização automática, conta, aporte ou transferência', () => {
    const html = panel({
      goals: [goal('1', 'Reserva'), goal('2', 'Pronto', { current_amount: 30000 }), goal('3', 'Velho', { target_date: '2026-03-31' })],
    });
    expect(html).not.toMatch(/sincroniz|autom[aá]tic|aporte|dep[óo]sito|transfer[êe]ncia|conectad|vinculad/i);
  });
});

describe('Objetivos — card', () => {
  it('ativo com prazo: valores, percentual, barra, faltam, prazo, mensal e atualizado em', () => {
    const html = card(goal('1', 'Reserva de emergência'));
    expect(html).toContain('Reserva de emergência');
    expect(html).toMatch(/R\$\s?12\.500,00/);
    expect(html).toMatch(/R\$\s?30\.000,00/);
    expect(html).toContain('41,6%'); // 12500/30000 = 41,66… → 41,6 (para baixo)
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toMatch(/Faltam[\s\S]*R\$\s?17\.500,00/);
    expect(html).toContain('até dez/2027');
    expect(html).toContain('Para chegar lá:');
    expect(html).toMatch(/R\$\s?1\.250,00<\/span>\/mês/); // 17.500 / 14
    expect(html).toContain('Atualizar valor');
    expect(html).toContain('Atualizado em 01/10/2026');
  });

  it('sem prazo: progresso e quanto falta, sem valor mensal', () => {
    const html = card(goal('1', 'Reserva', { target_date: null }));
    expect(html).toMatch(/Faltam/);
    expect(html).not.toContain('Para chegar lá');
    expect(html).not.toContain('/mês');
    expect(html).not.toMatch(/até /);
  });

  it('prazo neste mês: "Prazo neste mês" e valor restante, sem dividir', () => {
    const html = card(goal('1', 'Viagem', { target_date: '2026-10-31' }));
    expect(html).toContain('Prazo neste mês');
    expect(html).toMatch(/Faltam[\s\S]*R\$\s?17\.500,00/);
    expect(html).not.toContain('/mês');
    expect(html).not.toMatch(/Infinity|NaN/);
  });

  it('prazo vencido e não alcançado: rótulo "Prazo encerrado", sem mensal', () => {
    const html = card(goal('1', 'Curso', { target_date: '2026-03-31' }));
    expect(html).toContain('Prazo encerrado');
    expect(html).not.toContain('/mês');
    expect(html).toMatch(/Faltam/);
  });

  it('alcançado: selo com texto (não só cor), sem faltam, sem mensal, arquivar disponível', () => {
    const html = card(goal('1', 'Japão', { current_amount: 30000 }));
    expect(html).toContain('Objetivo alcançado');
    expect(html).not.toContain('Faltam');
    expect(html).not.toContain('/mês');
    expect(html).not.toContain('Prazo encerrado');
    expect(card(goal('1', 'Japão', { current_amount: 30000 }), true)).toContain('>Arquivar<');
  });

  it('acima de 100%: barra em 100 e excedente informado', () => {
    const html = card(goal('1', 'Japão', { current_amount: 36000 }));
    expect(html).toContain('120,0%');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toMatch(/R\$\s?6\.000,00 acima do objetivo/);
    expect(html).toMatch(/width:\s*100%/);
  });

  it('prazo vencido mas alcançado não mostra "Prazo encerrado"', () => {
    expect(card(goal('1', 'Ok', { current_amount: 30000, target_date: '2026-03-31' }))).not.toContain('Prazo encerrado');
  });

  it('menu de ativo: Editar, Arquivar e Excluir; botão de menu com nome acessível', () => {
    const html = card(goal('1', 'Reserva'), true);
    expect(html).toContain('role="menu"');
    expect(html).toContain('>Editar<');
    expect(html).toContain('>Arquivar<');
    expect(html).toContain('>Excluir<');
    expect(html).toContain('aria-label="Mais opções do objetivo Reserva"');
    expect(html).toContain('aria-haspopup="menu"');
  });

  it('nome longo e valores grandes quebram sem estourar', () => {
    const html = card(goal('1', 'Entrada do apartamento '.repeat(6), { target_amount: 999999999999.99, current_amount: 123456789012.34 }));
    expect(html).toContain('break-words');
    expect(html).toContain('min-w-0');
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});

describe('Objetivos — formulários', () => {
  const render = (el: React.ReactElement) => renderToStaticMarkup(el);

  it('novo: nome, valor desejado, quanto já tenho e prazo opcional (4 campos)', () => {
    const html = render(React.createElement(GoalFormModal, { today: TODAY, onClose: () => {}, onSave: noop }));
    expect(html).toContain('Novo objetivo');
    expect(html).toContain('Nome');
    expect(html).toContain('Valor desejado (R$)');
    expect(html).toContain('Quanto já tenho (R$)');
    expect(html).toContain('Mês e ano do objetivo (opcional)');
    expect(html).toContain('type="month"');
    expect(html).toContain('min="2026-10"');
    expect(html).toMatch(/<label[^>]*for="goal-name"/);
  });

  it('editar: não pede "quanto já tenho" e remete a "Atualizar valor"; prazo vencido não trava', () => {
    const html = render(
      React.createElement(GoalFormModal, { goal: goal('1', 'Curso', { target_date: '2026-03-31' }), today: TODAY, onClose: () => {}, onSave: noop })
    );
    expect(html).toContain('Editar objetivo');
    expect(html).not.toContain('Quanto já tenho');
    expect(html).toContain('Atualizar valor');
    expect(html).toContain('value="2026-03"');
    expect(html).not.toContain('min="2026-10"');
  });

  it('atualizar valor: pergunta oficial, sem chamar de aporte/depósito/transferência', () => {
    const html = render(React.createElement(UpdateGoalValueModal, { goal: goal('1', 'Reserva'), onClose: () => {}, onSave: noop }));
    expect(html).toContain('Atualizar valor');
    expect(html).toContain('Quanto você tem hoje para este objetivo?');
    expect(html).toContain('value="12500"');
    expect(html).toContain('O FinElo não movimenta suas contas.');
    expect(html).not.toMatch(/aporte|dep[óo]sito|transfer[êe]ncia/i);
  });
});

describe('Objetivos — navegação e integração (contrato de código)', () => {
  const read = (p: string) => readFileSync(resolve(p), 'utf8');
  const layout = read('src/layouts/MainLayout.tsx');

  it('item Objetivos depois de Investimentos e antes de Configurações; abre GoalsView', () => {
    const inv = layout.indexOf('id="nav-investments"');
    const goals = layout.indexOf('id="nav-goals"');
    const settings = layout.indexOf('id="nav-settings"');
    expect(inv).toBeGreaterThan(0);
    expect(goals).toBeGreaterThan(inv);
    expect(settings).toBeGreaterThan(goals);
    expect(layout).toContain("goals: <GoalsView />");
    expect(layout).toContain("setCurrentView('goals')");
    expect(layout).toContain('label="Objetivos"');
  });

  it('navegação mobile com 6 itens: padding horizontal reduzido só abaixo de sm, para caber em 390px', () => {
    const nav = read('src/components/ui/NavItem.tsx');
    expect(nav).toMatch(/px-1 py-1\.5 sm:px-3/);
    expect(nav).not.toMatch(/ px-2 py-1\.5 /);
    expect((layout.match(/<NavItem /g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('a view é aberta para todos os planos: sem Premium, admin ou paywall', () => {
    for (const p of ['src/components/views/GoalsView.tsx', 'src/components/goals/GoalCard.tsx']) {
      expect(read(p)).not.toMatch(/isPremium|isWealth|pricing|Premium/);
    }
    const navLine = layout.split('\n').find((l) => l.includes('id="nav-goals"')) ?? '';
    expect(navLine).not.toMatch(/isPremium|isAdmin/);
  });

  it('tipo de view, rótulo da Central de Ajuda e ícone', () => {
    expect(read('src/types.ts')).toContain("| 'goals'");
    expect(read('src/data/helpCenterContent.ts')).toContain("goals: 'Objetivos'");
    expect(read('src/components/ui/icons.tsx')).toContain('export const GoalsIcon');
  });

  it('sem integração com Dashboard, Transações, investimentos, analytics ou família', () => {
    const files = [
      'src/components/views/GoalsView.tsx',
      'src/components/goals/GoalCard.tsx',
      'src/components/goals/GoalFormModal.tsx',
      'src/components/goals/UpdateGoalValueModal.tsx',
      'src/domain/goals/goalProgress.ts',
    ].map(read).join('\n');
    expect(files).not.toMatch(/trackProductEvent|trackProductMilestone|has_family_access|ownerUserId|addTransaction|investmentService|product_events/);
    const dash = read('src/components/views/DashboardView.tsx');
    expect(dash).not.toMatch(/goals|Goals|Objetivos/);
    const mig = read('supabase/migrations/20261006120000_financial_goals.sql');
    expect(mig.replace(/--.*$/gm, '')).not.toContain('has_family_access');
  });
});
