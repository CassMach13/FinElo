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

describe('Lote 2 — duplicatas, competência e lançamento manual', () => {
  const sources = (files: string[]) => files.map(read).join(' ');
  const articleText = (id: string) => JSON.stringify(topic(id).article);
  const stepTitles = (id: string) => topic(id).article!.steps!.map((s) => s.title);

  it('os três tópicos têm artigo estruturado, com imagens que existem', () => {
    ['import-duplicate', 'import-competence', 'tx-add-manual'].forEach((id) => {
      const t = topic(id);
      expect(t.article, id).toBeTruthy();
      expect(t.article!.steps!.length, id).toBeGreaterThanOrEqual(3);
      const images = [...t.article!.steps!.map((s) => s.image), t.article!.resultImage].filter(Boolean) as HelpImage[];
      expect(images.length, id).toBeGreaterThanOrEqual(2);
      images.forEach((img) => expect(fs.existsSync(path.join(root, 'public', img.src)), img.src).toBe(true));
    });
  });

  it('duplicatas: recusa por nome, limite honesto e como desfazer, sem a revisão inexistente', () => {
    expect(topic('import-duplicate').title).toBe('O FinElo pode importar a mesma transação duas vezes?');
    expect(stepTitles('import-duplicate')).toEqual([
      'Se você repetir o arquivo',
      'Se o mesmo extrato voltar com outro nome',
      'Para desfazer a importação repetida',
    ]);
    const text = articleText('import-duplicate') + topic('import-duplicate').answer;
    expect(text).toContain('Arquivo já importado anteriormente');
    expect(text).toContain('Histórico de Importações');
    expect(text).toContain('Excluir Tudo');
    expect(text.toLowerCase()).not.toMatch(/marque|na revisão|fingerprint|hash|parser/);
    const code = sources(['src/hooks/useAppStore.ts', 'src/components/views/SettingsView.tsx']);
    ['Arquivo já importado anteriormente', 'Histórico de Importações', 'Excluir Importação', 'Excluir Tudo'].forEach((label) =>
      expect(code, label).toContain(label)
    );
  });

  it('competência: exemplo real, formatos da interface e onde ajustar', () => {
    expect(stepTitles('import-competence')).toEqual(['O que ela significa', 'Na importação do cartão', 'No histórico do cartão']);
    const text = articleText('import-competence');
    expect(text).toContain('2026-09');
    expect(text).toContain('09/2026');
    expect(text).not.toContain('03/2025');
    const code = sources(['src/components/views/ImportView.tsx', 'src/components/views/TransactionsView.tsx', 'src/components/transactions/AccountBalanceCard.tsx']);
    [
      'Vencimento da Fatura',
      'Competência da fatura',
      'Definir manualmente',
      'Competência (AAAA-MM)',
      'Confirmar Competência Automática',
      'Confirmar Importação',
      'Ajustar competências por arquivo',
      'Histórico',
    ].forEach((label) => expect(code, label).toContain(label));
    // Sem ação: é um conceito, não um caminho.
    expect(topic('import-competence').action).toBeUndefined();
  });

  it('a regra do exemplo bate com o código: vencimento − 1 mês', () => {
    const code = read('src/utils/cardImportReference.ts');
    expect(code).toContain('previousMonth(Number(dueMatch[1]), Number(dueMatch[2]))');
  });

  it('lançamento manual: passos na ordem do formulário e nomes exatos', () => {
    expect(stepTitles('tx-add-manual')).toEqual(['Abra o formulário', 'Preencha os campos', 'Salve']);
    const text = articleText('tx-add-manual');
    const form = read('src/components/modals/NewTransactionModal.tsx');
    [
      'Adicionar Lançamento',
      'Data da Compra',
      'Conta',
      'Descrição',
      'Despesa (Saída)',
      'Renda (Entrada)',
      'Categoria',
      'Valor (R$)',
      'Repetir este lançamento?',
      'Parcelado (Compra 10x)',
      'Fixo Mensal (Recorrente)',
      'Tipo de lançamento no cartão',
      '+ Conta',
      '+ Categoria',
    ].forEach((label) => {
      expect(text, label).toContain(label);
      expect(form + read('src/components/views/TransactionsView.tsx'), label).toContain(label);
    });
    // Os campos obrigatórios descritos são os que a validação exige.
    ['Data', 'ID_Conta', 'Nome_Fantasia', 'Categoria', 'Valor', 'Tipo'].forEach((field) => expect(form).toContain('newErrors.' + field));
  });

  it('CTAs: rótulo e destino coerentes', () => {
    expect(getNavigateLabel(topic('tx-add-manual').navigateTo!)).toBe('Ir para Transações');
    expect(getNavigateLabel(topic('import-duplicate').navigateTo!)).toBe('Ir para Configurações');
  });

  it('assets do lote ficam fora do precache do PWA e dentro do orçamento de peso', () => {
    expect(read('vite.config.ts')).toContain("'help/**'");
    const dir = path.join(root, 'public/help');
    const files = fs.readdirSync(dir, { recursive: true, withFileTypes: false } as never) as unknown as string[];
    const sizes = files.filter((f) => String(f).endsWith('.webp')).map((f) => fs.statSync(path.join(dir, String(f))).size);
    expect(sizes.length).toBeGreaterThanOrEqual(12);
    expect(Math.max(...sizes)).toBeLessThan(60 * 1024);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThan(400 * 1024);
  });
});

describe('Lote 3 — pagar fatura do cartão', () => {
  const t = () => topic('tx-pay-invoice');
  const text = () => JSON.stringify(t().article) + t().answer;
  const code = () =>
    [
      'src/components/modals/PayCreditCardInvoiceModal.tsx',
      'src/components/views/TransactionsView.tsx',
      'src/components/transactions/AccountBalanceCard.tsx',
      'src/components/modals/CategoryModal.tsx',
      'src/components/views/SettingsView.tsx',
    ]
      .map(read)
      .join(' ');

  it('artigo estruturado, passos na ordem do fluxo e imagens existentes', () => {
    expect(t().title).toBe('Como pago a fatura do meu cartão no FinElo?');
    expect(t().article!.steps!.map((s) => s.title)).toEqual([
      'Localize o cartão',
      'Escolha a fatura e a conta',
      'Confirme categoria, data e valor',
      'Registre o pagamento',
    ]);
    expect(t().article!.before![0].title).toBe('Antes de começar');
    const images = [...t().article!.steps!.map((s) => s.image), t().article!.resultImage].filter(Boolean) as HelpImage[];
    expect(images).toHaveLength(3);
    images.forEach((img) => {
      expect(fs.existsSync(path.join(root, 'public', img.src)), img.src).toBe(true);
      expect(img.alt.length).toBeGreaterThan(25);
    });
  });

  it('todos os nomes da interface citados existem no código', () => {
    [
      'Pagar',
      'Fatura atual',
      'Fatura a pagar',
      'Conta de origem do pagamento',
      'Categoria do pagamento',
      'Data do pagamento',
      'Valor pago (R$)',
      'Registrar pagamento',
      'Pagamento registrado com sucesso.',
      'Entrada (Renda)',
      'Gerenciar Categorias',
      'Cartões de crédito',
      'Pagamento de Fatura',
      'Pagamento Fatura',
    ].forEach((label) => expect(code(), label).toContain(label));
  });

  it('descreve o que o produto grava: duas linhas, entrada no cartão e saída na conta', () => {
    const src = read('src/components/views/TransactionsView.tsx');
    expect(src).toContain("Nome_Fantasia: 'Pagamento de Fatura'");
    expect(src).toContain('Nome_Fantasia: `Pagamento Fatura — ${account.Nome_Conta}`');
    expect(text()).toContain('dois lançamentos');
    expect(text()).toContain('exclua as duas linhas');
  });

  it('o botão Pagar só existe com fatura em aberto, como o texto diz', () => {
    expect(read('src/components/transactions/AccountBalanceCard.tsx')).toContain('faturaAtual > 0 && onPayInvoice');
    expect(text()).toContain('maior que zero');
  });

  it('não ensina mais a lançar o pagamento como Renda; o app redireciona para Pagar', () => {
    expect(text()).not.toMatch(/lance manualmente como Renda/i);
    expect(text()).toContain('Não lance como Renda');
    expect(read('src/components/modals/NewTransactionModal.tsx')).toContain('Usar fluxo Pagar fatura?');
  });

  it('CTA leva a Transações', () => {
    expect(t().action).toBe('navigate');
    expect(getNavigateLabel(t().navigateTo!)).toBe('Ir para Transações');
  });
});

describe('Lote 3 — estorno no cartão', () => {
  const t = () => topic('tx-refund');
  const text = () => JSON.stringify(t().article) + t().answer;
  const code = () =>
    ['src/components/modals/NewTransactionModal.tsx', 'src/components/views/TransactionsView.tsx', 'src/components/views/SettingsView.tsx', 'src/components/modals/CategoryModal.tsx']
      .map(read)
      .join(' ');

  it('artigo estruturado, passos na ordem do formulário e imagens existentes', () => {
    expect(t().title).toBe('Como registro um estorno no cartão?');
    expect(t().article!.before![0].title).toBe('Antes de começar');
    expect(t().article!.steps!.map((s) => s.title)).toEqual([
      'Abra o formulário e escolha o cartão',
      'Escolha Estorno',
      'Escolha a fatura que recebe o crédito',
      'Preencha e salve',
    ]);
    const images = [...t().article!.steps!.map((s) => s.image), t().article!.resultImage].filter(Boolean) as HelpImage[];
    expect(images).toHaveLength(2);
    images.forEach((img) => {
      expect(fs.existsSync(path.join(root, 'public', img.src)), img.src).toBe(true);
      expect(img.alt.length).toBeGreaterThan(25);
    });
  });

  it('todos os nomes da interface citados existem no código', () => {
    [
      'Adicionar Lançamento',
      'Conta',
      'Tipo de lançamento no cartão',
      'Estorno ou crédito na fatura',
      'Competência da fatura (estorno)',
      'Data da Compra',
      'Descrição',
      'Categoria',
      'Valor (R$)',
      'Salvar',
      'Entrada (Renda)',
      'Gerenciar Categorias',
      'Histórico',
      'Compras e encargos',
      'Estornos e créditos',
      'Total da fatura',
      'Pagar',
    ].forEach((label) => {
      expect(text(), label).toContain(label);
    });
    const all = code() + read('src/components/transactions/AccountBalanceCard.tsx') + read('src/components/modals/CreditCardInvoiceCyclesModal.tsx');
    ['Tipo de lançamento no cartão', 'Estorno ou crédito na fatura', 'Competência da fatura (estorno)', 'Data da Compra', 'Valor (R$)', 'Entrada (Renda)', 'Gerenciar Categorias', 'Histórico', 'Compras e encargos', 'Estornos e créditos'].forEach(
      (label) => expect(all.toLowerCase(), label).toContain(label.toLowerCase())
    );
  });

  it('a competência escolhida é o ponto do artigo, com o exemplo validado', () => {
    expect(text()).toContain('mesmo que a data do crédito seja de outro mês');
    expect(text()).toContain('02/10');
    expect(text()).toContain('09/2026');
    expect(text()).toContain('valor positivo');
    expect(text()).not.toMatch(/finelo_competence|marcador|heurística|payload|ledger/i);
  });

  it('não manda lançar como Renda e não chama estorno de pagamento', () => {
    expect(text()).not.toMatch(/lance (manualmente )?como Renda|cadastre como Renda/i);
    expect(text()).toContain('Não é pagamento da fatura');
    expect(text()).not.toMatch(/pagamento de fatura(?! )/i);
  });

  it('o formulário trava o Tipo e o estorno não se liga à compra original', () => {
    const form = read('src/components/modals/NewTransactionModal.tsx');
    expect(form).toContain("disabled={isImportedEdit || cardEntryKind === 'refund'}");
    expect(text()).toContain('não fica ligado a ela');
  });

  it('CTA leva a Transações', () => {
    expect(t().action).toBe('navigate');
    expect(getNavigateLabel(t().navigateTo!)).toBe('Ir para Transações');
  });
});
