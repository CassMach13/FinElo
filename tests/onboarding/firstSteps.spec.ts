import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ updateUser: vi.fn(async () => ({ error: null })) }));
vi.mock('../../src/supabaseClient', () => ({ supabase: { auth: { updateUser: mocks.updateUser } } }));

import { useAppStore } from '../../src/hooks/useAppStore';
import FirstStepsCard from '../../src/components/onboarding/FirstStepsCard';
import ImportSuccessPanel from '../../src/components/onboarding/ImportSuccessPanel';
import {
  ONBOARDING_META_KEYS,
  dismissPatch,
  getFirstStepsState,
  resumePatch,
  startedPatch,
} from '../../src/domain/onboarding/firstSteps';

const real = (Categoria = 'Mercado') => ({ Origem: 'extrato.csv', Fonte: 'Nubank', Categoria });
const manual = (Categoria = 'Mercado') => ({ Origem: 'manual', Fonte: 'Manual', Categoria });
const demo = () => ({ Origem: 'demo.csv', Fonte: 'Demo', Categoria: 'Mercado' });

const state = (transactions: object[], metadata: Record<string, unknown> | null = {}, ready = true) =>
  getFirstStepsState({ ready, transactions, metadata });

const card = (phase: 'start' | 'review' | 'view', uncategorizedCount = 0) => {
  const noop = () => {};
  const s = getFirstStepsState({
    ready: true,
    transactions: phase === 'start' ? [] : [real(phase === 'review' ? '-' : 'Mercado')],
    metadata: phase === 'start' ? {} : { [ONBOARDING_META_KEYS.startedAt]: 'x' },
  });
  return renderToStaticMarkup(
    React.createElement(FirstStepsCard, {
      phase: s.phase,
      steps: s.steps,
      uncategorizedCount,
      onImport: noop,
      onManual: noop,
      onHowToDownload: noop,
      onReview: noop,
      onViewMonth: noop,
      onDismiss: noop,
    })
  );
};

describe('Primeiros passos — estado derivado dos dados reais', () => {
  it('A. usuário totalmente novo vê o bloco no passo 1', () => {
    const s = state([]);
    expect(s.visible).toBe(true);
    expect(s.phase).toBe('start');
    expect(s.steps.map((x) => x.status)).toEqual(['active', 'upcoming', 'upcoming']);
    expect(s.shouldMarkStarted).toBe(true);
  });

  it('E. quem tem só demo não é tratado como ativado', () => {
    const s = state([demo(), demo()]);
    expect(s.hasRealData).toBe(false);
    expect(s.visible).toBe(true);
    expect(s.phase).toBe('start');
  });

  it('só os identificadores do seed marcam demo: nome parecido não entra na conta', () => {
    expect(state([{ Origem: 'extrato.csv', Fonte: 'Demo Bank', Categoria: 'X' }]).hasRealData).toBe(true);
    expect(state([{ Origem: 'meu-demo-final.csv', Categoria: 'X' }]).hasRealData).toBe(true);
  });

  it('D. depois de trazer dados o bloco evolui: sem categoria → revisar; tudo categorizado → ver o mês', () => {
    const started = { [ONBOARDING_META_KEYS.startedAt]: '2026-10-01T00:00:00Z' };
    const review = state([real('-'), real('Mercado')], started);
    expect(review.phase).toBe('review');
    expect(review.uncategorizedCount).toBe(1);
    expect(review.steps.map((x) => x.status)).toEqual(['done', 'active', 'upcoming']);
    const view = state([real('Mercado')], started);
    expect(view.phase).toBe('view');
    expect(view.steps.map((x) => x.status)).toEqual(['done', 'done', 'active']);
  });

  it('lançamento manual também conta como dado real', () => {
    expect(state([manual()], { [ONBOARDING_META_KEYS.startedAt]: 'x' }).hasRealData).toBe(true);
  });

  it('nada aparece antes dos dados iniciais carregarem (sem piscar)', () => {
    const s = state([], {}, false);
    expect(s.visible).toBe(false);
    expect(s.shouldMarkStarted).toBe(false);
    expect(s.allowAutoTour).toBe(false);
  });

  it('I. usuário existente com dados, que nunca viu o estado vazio, não recebe o onboarding', () => {
    const s = state([real(), real('-')], {});
    expect(s.visible).toBe(false);
    expect(s.canResume).toBe(false);
    expect(s.shouldMarkStarted).toBe(false);
  });

  it('tour automático: preservado para quem já usa o app, fora do caminho para quem está começando', () => {
    expect(state([real()], {}).allowAutoTour).toBe(true);
    expect(state([], {}).allowAutoTour).toBe(false);
    expect(state([demo()], {}).allowAutoTour).toBe(false);
    expect(state([real()], { [ONBOARDING_META_KEYS.startedAt]: 'x' }).allowAutoTour).toBe(false);
  });

  it('a regra não depende de um número de transações', () => {
    const started = { [ONBOARDING_META_KEYS.startedAt]: 'x' };
    expect(state([real()], started).phase).toBe('view');
    expect(state(Array.from({ length: 50 }, () => real()), started).phase).toBe('view');
  });
});

describe('Primeiros passos — dispensar e retomar (só preferência de exibição)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState(useAppStore.getInitialState(), true);
    useAppStore.setState({ user: { id: 'u1', user_metadata: { full_name: 'Teste' } } } as never);
  });

  it('F+G. "Agora não" some com o bloco e "Retomar" traz de volta, passando pelo store e por user_metadata', async () => {
    const get = () => state([], useAppStore.getState().user?.user_metadata);
    expect(get().visible).toBe(true);

    await useAppStore.getState().updateUserPreferences(dismissPatch());
    expect(get().visible).toBe(false);
    expect(get().canResume).toBe(true);
    expect(mocks.updateUser).toHaveBeenCalledWith({
      data: expect.objectContaining({ [ONBOARDING_META_KEYS.dismissedAt]: expect.any(String), onboarding_version: 1 }),
    });

    await useAppStore.getState().updateUserPreferences(resumePatch());
    expect(get().visible).toBe(true);
    expect(get().canResume).toBe(false);
    expect(useAppStore.getState().user?.user_metadata?.full_name).toBe('Teste');
  });

  it('só preferências vão para user_metadata: nenhuma chave de progresso nem dado financeiro', () => {
    const chaves = [...Object.keys(dismissPatch()), ...Object.keys(startedPatch()), ...Object.keys(resumePatch())];
    expect(new Set(chaves)).toEqual(
      new Set(['onboarding_v1_dismissed_at', 'onboarding_version', 'onboarding_v1_started_at'])
    );
  });

  it('dispensado com dados já revisados não oferece retomar (fim da jornada)', () => {
    const s = state([real()], { [ONBOARDING_META_KEYS.startedAt]: 'x', [ONBOARDING_META_KEYS.dismissedAt]: 'x' });
    expect(s.visible).toBe(false);
    expect(s.canResume).toBe(false);
  });
});

describe('Bloco e painel renderizados', () => {
  it('B+C. sem dados: CTA principal "Importar meu extrato", alternativas e nenhuma menção a demo', () => {
    const html = card('start');
    expect(html).toContain('Vamos começar sua organização financeira');
    expect(html).toContain('Importar meu extrato');
    expect(html).toContain('Prefiro lançar manualmente');
    expect(html).toContain('Não sabe como baixar seu extrato?');
    expect(html).toContain('Agora não');
    for (const passo of ['Traga seus dados', 'Confira o que entrou', 'Veja seu mês']) expect(html).toContain(passo);
    expect(html).not.toMatch(/demo/i);
    expect(html).toContain('aria-current="step"');
  });

  it('o estado de cada passo tem texto, não só cor', () => {
    const html = card('review', 3);
    expect(html).toContain('Concluído');
    expect(html).toContain('Agora');
    expect(html).toContain('Depois');
    expect(html).toContain('Conferir transações (3 sem categoria)');
    expect(html).not.toContain('Importar meu extrato');
  });

  it('com tudo categorizado o bloco fecha a jornada em vez de repetir "Importar"', () => {
    const html = card('view');
    expect(html).toContain('Seu mês está no FinElo');
    expect(html).toContain('Ver meu mês');
    expect(html).toContain('Concluir primeiros passos');
    expect(html).not.toContain('Importar meu extrato');
  });

  it('H. sucesso da importação: quantas entraram, o que fazer agora', () => {
    const noop = () => {};
    const html = renderToStaticMarkup(
      React.createElement(ImportSuccessPanel, {
        imported: 42,
        ignored: 3,
        onReviewTransactions: noop,
        onViewDashboard: noop,
        onImportAnother: noop,
      })
    );
    expect(html).toContain('Importação concluída');
    expect(html).toContain('42 transações adicionadas');
    expect(html).toContain('3 já existiam e foram ignoradas');
    expect(html).toContain('Conferir transações');
    expect(html).toContain('Ver minha Dashboard');
    expect(html).toContain('role="status"');
  });

  it('H2. singular e sem ignoradas', () => {
    const noop = () => {};
    const html = renderToStaticMarkup(
      React.createElement(ImportSuccessPanel, {
        imported: 1,
        ignored: 0,
        onReviewTransactions: noop,
        onViewDashboard: noop,
        onImportAnother: noop,
      })
    );
    expect(html).toContain('1 transação adicionada');
    expect(html).not.toContain('ignorada');
  });
});

describe('Fiação nas telas (contrato)', () => {
  const read = (p: string) => readFileSync(resolve(p), 'utf8');
  const dashboard = read('src/components/views/DashboardView.tsx');
  const imports = read('src/components/views/ImportView.tsx');
  const help = read('src/components/views/HelpView.tsx');

  it('B. a Dashboard não oferece mais "Carregar Demo" nem chama o seed', () => {
    expect(dashboard).not.toContain('Carregar Demo');
    expect(dashboard).not.toContain('loadDemoData');
    expect(dashboard).not.toContain('Novo por aqui?');
  });

  it('C. o CTA principal abre a importação existente e o secundário o lançamento manual', () => {
    expect(dashboard).toContain("onImport={() => setCurrentView('import')}");
    expect(dashboard).toContain('onManual={() => setNewTransactionModalOpen(true)}');
    expect(dashboard).toContain("setHelpIntent({ tab: 'topics', topicId: 'import-how' })");
  });

  it('o tour automático só roda quando o onboarding permite', () => {
    expect(dashboard).toContain('if (firstSteps.allowAutoTour) {');
    expect(dashboard).not.toContain("if (initialDataLoadStatus === 'ready') {\n      autoStartTour");
  });

  it('H. a importação mostra o painel de sucesso e pede o banco pelo suporte do app, sem mailto', () => {
    expect(imports).toContain('<ImportSuccessPanel');
    expect(imports).toContain('summary: { imported: importResult.imported');
    expect(imports).not.toContain('mailto:suporte@finelo.com.br');
    expect(imports).toContain("subject: 'Pedido de suporte a um novo banco'");
    expect(imports).toContain("topicId: 'import-how'");
  });

  it('a Central de Ajuda consome a intenção uma vez e a limpa', () => {
    expect(help).toContain('initialIntent?.tab');
    expect(help).toContain('setHelpIntent(null)');
  });
});
