import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HelpArticleContent, { renderEmphasis } from '../../src/components/help/HelpArticleContent';
import {
  HELP_TOPICS,
  HELP_VIEW_LABELS,
  getNavigateLabel,
  type HelpArticle,
  type HelpImage,
} from '../../src/data/helpCenterContent';

const root = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const topic = (id: string) => {
  const found = HELP_TOPICS.find((t) => t.id === id);
  if (!found) throw new Error(`tópico ${id} não existe`);
  return found;
};
const render = (article: HelpArticle) =>
  renderToStaticMarkup(React.createElement(HelpArticleContent, { article }));

const allImages = (): { topicId: string; image: HelpImage }[] =>
  HELP_TOPICS.flatMap((t) => {
    const images = [
      ...(t.article?.steps ?? []).map((s) => s.image),
      t.article?.resultImage,
    ].filter((img): img is HelpImage => Boolean(img));
    return images.map((image) => ({ topicId: t.id, image }));
  });

describe('Central de Ajuda — artigo com passos e screenshots', () => {
  const article: HelpArticle = {
    before: [{ title: 'Antes de começar', items: ['Tenha o **arquivo** do banco.'] }],
    steps: [
      {
        title: 'Escolha o banco',
        text: 'Clique em **Importar**.',
        image: { src: '/help/x/01-a.webp', alt: 'Tela de seleção do banco', width: 10, height: 5, caption: 'Legenda' },
      },
      { title: 'Envie o arquivo', text: 'Sem imagem neste passo.' },
    ],
    result: 'Aparece **Importação concluída**.',
    after: [{ title: 'Se algo der errado', items: ['Confira o banco.'] }],
  };

  it('renderiza blocos, passos numerados, resultado e a imagem com alt, dimensões e lazy', () => {
    const html = render(article);
    expect(html).toContain('Antes de começar');
    expect(html).toContain('<ol');
    expect(html).toContain('Escolha o banco');
    expect(html).toContain('Envie o arquivo');
    expect(html).toContain('Pronto');
    expect(html).toContain('Se algo der errado');
    expect(html).toContain('src="/help/x/01-a.webp"');
    expect(html).toContain('alt="Tela de seleção do banco"');
    expect(html).toContain('width="10"');
    expect(html).toContain('height="5"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('<figcaption');
    // Ampliar = abrir o próprio arquivo, sem lightbox.
    expect(html).toContain('href="/help/x/01-a.webp"');
    expect(html.match(/<img/g)).toHaveLength(1);
  });

  it('artigo sem imagem continua funcionando', () => {
    const html = render({ steps: [{ title: 'Só texto', text: 'Passo sem screenshot.' }] });
    expect(html).toContain('Só texto');
    expect(html).not.toContain('<img');
  });

  it('negrito vira <strong> e o texto sem marcação passa intacto', () => {
    expect(renderToStaticMarkup(React.createElement('p', null, renderEmphasis('Clique em **Importar** agora')))).toBe(
      '<p>Clique em <strong class="font-semibold text-slate-200">Importar</strong> agora</p>'
    );
    expect(renderEmphasis('sem marcação')).toBe('sem marcação');
  });

  it('tópicos sem article seguem válidos (só resposta curta)', () => {
    const simple = HELP_TOPICS.filter((t) => !t.article);
    expect(simple.length).toBeGreaterThan(20);
    simple.forEach((t) => expect(t.answer.length).toBeGreaterThan(0));
  });
});

describe('Central de Ajuda — screenshots publicadas', () => {
  it('toda imagem existe em public/help, é webp, tem alt útil e dimensões', () => {
    const images = allImages();
    expect(images.length).toBeGreaterThan(0);
    images.forEach(({ topicId, image }) => {
      expect(image.src, topicId).toMatch(/^\/help\/[a-z-]+\/\d{2}-[a-z0-9-]+\.webp$/);
      expect(fs.existsSync(path.join(root, 'public', image.src)), image.src).toBe(true);
      expect(image.alt.length, image.src).toBeGreaterThan(25);
      expect(image.alt.toLowerCase(), image.src).not.toContain('.webp');
      expect(image.alt.toLowerCase(), image.src).not.toMatch(/^(imagem|screenshot|print)\s*\d*$/);
      expect(image.width).toBeGreaterThan(0);
      expect(image.height).toBeGreaterThan(0);
    });
  });

  it('nenhuma screenshot repetida entre artigos', () => {
    const srcs = allImages().map(({ image }) => image.src);
    expect(new Set(srcs).size).toBe(srcs.length);
  });
});

describe('Botão "Ir para…" mostra o destino real', () => {
  it('rótulo vem do navigateTo, com o nome do menu', () => {
    expect(getNavigateLabel('settings')).toBe('Ir para Configurações');
    expect(getNavigateLabel('transactions')).toBe('Ir para Transações');
    expect(getNavigateLabel('import')).toBe('Ir para Importar');
    expect(getNavigateLabel('dashboard')).toBe('Ir para Dashboard');
    expect(getNavigateLabel('pricing')).toBe('Ir para Gerenciar Conta');
  });

  it('os nomes batem com o menu lateral', () => {
    const layout = read('src/layouts/MainLayout.tsx');
    (['dashboard', 'transactions', 'import', 'investments', 'settings'] as const).forEach((view) => {
      expect(layout).toContain(`view="${view}" label="${HELP_VIEW_LABELS[view]}"`);
    });
  });

  it('tópicos cuja seção difere do destino agora dizem o destino', () => {
    expect(getNavigateLabel(topic('tx-closing-due').navigateTo!)).toBe('Ir para Configurações');
    expect(getNavigateLabel(topic('import-rules').navigateTo!)).toBe('Ir para Configurações');
  });

  it('HelpCenterBrowse usa o destino, não a seção, no rótulo', () => {
    const src = read('src/components/help/HelpCenterBrowse.tsx');
    expect(src).toContain('getNavigateLabel(topic.navigateTo)');
    expect(src).not.toContain('`Ir para ${section.label}`');
  });

  it('todo tópico com action navigate tem destino', () => {
    HELP_TOPICS.filter((t) => t.action === 'navigate').forEach((t) => expect(t.navigateTo, t.id).toBeTruthy());
  });
});

describe('Artigos modernizados', () => {
  it('links de outras telas apontam para tópicos que existem', () => {
    const sources = ['src/components/views/ImportView.tsx', 'src/components/views/DashboardView.tsx'].map(read);
    const ids = sources.flatMap((s) => [...s.matchAll(/topicId: '([^']+)'/g)].map((m) => m[1]));
    expect(ids).toContain('import-how');
    ids.forEach((id) => expect(HELP_TOPICS.some((t) => t.id === id), id).toBe(true));
  });

  it('"Como importar meu extrato?" cobre arquivo, limite, passos reais e resultado', () => {
    const t = topic('import-how');
    expect(t.title).toBe('Como importar meu extrato?');
    expect(t.navigateTo).toBe('import');
    const a = t.article!;
    expect(a.before!.map((b) => b.title)).toEqual(['Antes de começar', 'Como consigo o arquivo no meu banco?']);
    expect(a.steps!.map((s) => s.title)).toEqual([
      'Escolha o banco ou cartão',
      'Escolha a conta de destino',
      'Envie o arquivo',
      'Confirme a importação',
    ]);
    const text = JSON.stringify(a);
    // Nomes exatos da interface.
    ['Selecione o Banco ou Cartão', 'Conta de Destino', '+ Nova Conta', 'Confirmar e Importar', 'Importação concluída', 'Conferir transações', 'Ver minha Dashboard'].forEach(
      (label) => expect(text).toContain(label)
    );
    expect(text).toContain('1 importação por mês');
    // Sem etapa inventada nem jargão interno.
    expect(text.toLowerCase()).not.toMatch(/duplicatas|reidratar|parser|mapping|json|metadado/);
    expect(a.steps!.filter((s) => s.image).length + (a.resultImage ? 1 : 0)).toBeGreaterThanOrEqual(4);
  });

  it('"Por onde começo?" segue os Primeiros passos e leva à Dashboard', () => {
    const t = topic('general-start');
    expect(t.navigateTo).toBe('dashboard');
    expect(t.article!.steps!.map((s) => s.title)).toEqual(['Traga seus dados', 'Confira o que entrou', 'Veja seu mês']);
    const text = JSON.stringify(t.article);
    const card = read('src/components/onboarding/FirstStepsCard.tsx');
    ['Importar meu extrato', 'Prefiro lançar manualmente', 'Agora não'].forEach((label) => {
      expect(text).toContain(label);
      expect(card).toContain(label);
    });
    expect(text).not.toContain('Configurações');
    expect(t.article!.steps!.filter((s) => s.image).length).toBeLessThanOrEqual(2);
  });
});
