import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contrato do que controla a impressão da Dashboard ("Exportar PDF"). É teste de
 * texto sobre o CSS e o JSX, não de renderização: o objetivo é que as duas causas do
 * PDF quebrado (chamado 20260905-A902) não voltem sem que alguém perceba.
 */

const read = (path: string) => readFileSync(resolve(path), 'utf8');
const css = read('src/index.css');
const dashboard = read('src/components/views/DashboardView.tsx');

/** Conteúdo do bloco `@media print { … }`, com o balanceamento de chaves. */
function printBlock(source: string): string {
  const start = source.indexOf('@media print');
  expect(start, 'index.css tem que ter um bloco @media print').toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error('bloco @media print sem fechamento');
}

/** Remove comentários, para que um comentário explicando a regra antiga não conte como regra. */
const semComentarios = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');

/** Seletores (lado esquerdo) de cada regra do bloco. */
function selectors(block: string): string[] {
  return [...semComentarios(block).matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].trim());
}

/** Corpo da regra cujo seletor contém `needle`. */
function ruleBody(block: string, needle: string): string {
  const match = [...semComentarios(block).matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) =>
    m[1].includes(needle)
  );
  expect(match, `regra de impressão para ${needle}`).toBeDefined();
  return match![2];
}

describe('CSS de impressão — ícones não podem ser inflados', () => {
  const print = printBlock(css);

  it('nenhum seletor genérico por tag `svg` ou `canvas` no bloco de impressão', () => {
    const tags = selectors(print).flatMap((list) => list.split(',').map((s) => s.trim()));
    const genericos = tags.filter((s) => /^(svg|canvas)$/i.test(s));
    expect(genericos).toEqual([]);
  });

  it('nenhuma regra de impressão fixa 350px de altura', () => {
    expect(semComentarios(print)).not.toMatch(/height:\s*350px/);
  });

  it('a Dashboard não tem gráfico em SVG/canvas que justifique a regra removida', () => {
    // Os gráficos são HTML/CSS. Se alguém introduzir SVG/canvas de gráfico, deve dar a
    // ele uma classe explícita de impressão — e este teste é o lembrete de rever o CSS.
    const charts = ['IncomeExpenseChart', 'CategorySpendChart', 'MonthlyEvolutionChart'].map((n) =>
      read(`src/components/charts/${n}.tsx`)
    );
    for (const source of charts) {
      expect(source).not.toMatch(/<svg|<canvas|recharts/i);
    }
  });
});

describe('CSS de impressão — KPIs', () => {
  const print = printBlock(css);

  it('#dashboard-kpis empilha as seções em bloco, não em grid de colunas', () => {
    const body = ruleBody(print, '#dashboard-kpis');
    expect(body).toMatch(/display:\s*block/);
    expect(body).not.toMatch(/display:\s*grid/);
    expect(body).not.toMatch(/grid-template-columns/);
  });

  it('o contêiner dos KPIs continua ocupando a largura da página', () => {
    expect(ruleBody(print, '#dashboard-kpis')).toMatch(/width:\s*100%/);
  });
});

describe('CSS de impressão — barras dos gráficos', () => {
  const print = printBlock(css);

  it('as regras de cor das barras não mexem na largura (`width: initial` zerava as colunas)', () => {
    const regrasDeCor = [...semComentarios(print).matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) =>
      /\.bg-(emerald-500|rose-500|highlight|success|danger|accent)/.test(m[1])
    );
    expect(regrasDeCor.length).toBeGreaterThan(0);
    for (const [, seletor, corpo] of regrasDeCor) {
      expect(corpo, seletor.trim()).not.toMatch(/(^|[;\s])width\s*:/);
    }
  });
});

describe('CSS de impressão — trilha da barra de categorias', () => {
  const print = printBlock(css);

  it('a trilha `w-full h-2 bg-slate-800` não é tratada como card (senão o preenchimento some)', () => {
    const regra = [...semComentarios(print).matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(
      (m) => m[1].trim() === '.w-full.h-2.bg-slate-800'
    );
    expect(regra, 'regra isolada da trilha').toBeDefined();
    const body = regra![2];
    expect(body).toMatch(/padding:\s*0\s*!important/);
    expect(body).toMatch(/height:\s*0\.5rem\s*!important/);
  });

  it('a Dashboard ainda usa essa trilha (se o markup mudar, revisar o CSS junto)', () => {
    expect(read('src/components/charts/CategorySpendChart.tsx')).toContain('w-full h-2 bg-slate-800');
  });
});

describe('CSS de impressão — o que continua escondido', () => {
  const print = printBlock(css);

  it('navegação, botões e itens `.no-print` seguem fora do documento', () => {
    const escondidos = ruleBody(print, '.no-print');
    expect(escondidos).toMatch(/display:\s*none/);
    const lista = selectors(print).find((s) => s.includes('.no-print'))!;
    for (const alvo of ['header', 'nav', 'aside', 'footer', 'button', '.fixed']) {
      expect(lista).toContain(alvo);
    }
  });

  it('`.no-print` tem a última palavra: vem DEPOIS da regra dos cards, que também usa !important', () => {
    // Sem isto, elementos com `.no-print` E `bg-secondary` (cabeçalho mobile, barra de
    // navegação) perdiam o `display: none` para `.bg-secondary { display: block !important }`
    // e deixavam faixas em branco no topo e no fim do PDF.
    const lista = selectors(print);
    const cards = lista.findIndex((s) => s.includes('.bg-secondary'));
    const ultimaNoPrint = lista.map((s, i) => [s, i] as const).filter(([s]) => s === '.no-print').map(([, i]) => i);
    expect(cards, 'regra dos cards com .bg-secondary').toBeGreaterThanOrEqual(0);
    expect(ultimaNoPrint.length, 'regra isolada .no-print').toBeGreaterThan(0);
    expect(Math.max(...ultimaNoPrint)).toBeGreaterThan(cards);
    expect(ruleBody(print.slice(print.lastIndexOf('.no-print')), '.no-print')).toMatch(
      /display:\s*none\s*!important/
    );
  });

  it('o tema escuro é mantido, sem versão branca', () => {
    expect(semComentarios(print)).toMatch(/background:\s*#1a202c/);
  });
});

describe('DashboardView — cabeçalho só da impressão', () => {
  it('existe um bloco invisível na tela e visível ao imprimir', () => {
    const match = dashboard.match(/<div id="dashboard-print-header" className="([^"]+)">/);
    expect(match, 'bloco #dashboard-print-header').not.toBeNull();
    const classes = match![1].split(/\s+/);
    expect(classes).toContain('hidden');
    expect(classes).toContain('print:block');
  });

  it('mostra o título, o período e, com comparação, a linha comparada', () => {
    expect(dashboard).toContain('{printHeader.title}');
    expect(dashboard).toContain('{printHeader.period}');
    expect(dashboard).toMatch(/printHeader\.compare\s*&&/);
  });

  it('os rótulos vêm dos formatadores da tela, sem segunda lógica de período', () => {
    expect(dashboard).toContain("from '../../utils/dashboardPrintHeader'");
    expect(dashboard).toMatch(/buildDashboardPrintHeader\(\s*\{ label: dateLabel, range: dateRange \}/);
  });

  it('o período interativo continua escondido no print (a informação vem do bloco novo)', () => {
    expect(dashboard).toMatch(/id="dashboard-header"[^>]*print:hidden/);
  });

  it('o banner de identificação de bancos não vai para o documento', () => {
    const banner = dashboard.match(/\{accountsWithMissingBank\.length > 0 && \(\s*<div className="([^"]+)"/);
    expect(banner, 'banner Identifique seus bancos').not.toBeNull();
    expect(banner![1].split(/\s+/)).toContain('no-print');
  });

  it('"Exportar PDF" continua sendo a impressão do navegador — sem relatório novo', () => {
    expect(dashboard).toMatch(/const handlePrint = \(\) => \{\s*window\.print\(\);/);
    expect(dashboard).toContain('Exportar PDF');
  });
});
