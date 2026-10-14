import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import PortfolioShelf from '../../src/components/investments/PortfolioShelf';
import ClassificationBadge from '../../src/components/investments/ClassificationBadge';
import { groupPositionsByPortfolio } from '../../src/domain/investments/portfolioGrouping';
import { STRUCTURE_OFF, createStructureLoader, structureFor, type StructureState } from '../../src/services/investmentStructureLoader';

const read = (p: string) => readFileSync(resolve(p), 'utf8').replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));
const OWNER = 'owner-a';
const MONTH = '2026-09-01';
const pf = (id: string, name: string, archived_at: string | null = null) => ({ id, user_id: OWNER, name, archived_at, created_by: OWNER, created_at: '', updated_by: null, updated_at: '' });
const pos = (id: string, balance: number, portfolio_id: string | null = null) => ({ id, user_id: OWNER, balance, reference_month: MONTH, portfolio_id });

/** Executa o carregador e devolve o estado final, aplicando as atualizações em ordem. */
const harness = () => {
  let state: StructureState = STRUCTURE_OFF;
  const calls: string[] = [];
  const pending: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];
  const deferred = () => new Promise<any>((resolve, reject) => pending.push({ resolve, reject }));
  const load = createStructureLoader(
    {
      listPortfolios: (o) => { calls.push(`portfolios:${o}`); return deferred(); },
      listHoldings: (o) => { calls.push(`holdings:${o}`); return deferred(); },
    },
    (update) => { state = update(state); }
  );
  return { load, calls, pending, get state() { return state; } };
};

describe('carregamento de carteiras', () => {
  it('flag desligada: nenhuma consulta às tabelas novas', async () => {
    const h = harness();
    await h.load(false, OWNER);
    await h.load(false, null);
    expect(h.calls).toEqual([]);
    expect(h.state).toEqual(STRUCTURE_OFF);
  });

  it('carrega carteiras (inclusive arquivadas) e holdings do proprietário consultado', async () => {
    const h = harness();
    const p = h.load(true, OWNER);
    expect(h.calls).toEqual([`portfolios:${OWNER}`, `holdings:${OWNER}`]);
    expect(h.state.status).toBe('loading');
    h.pending[0].resolve([pf('p1', 'A')]);
    h.pending[1].resolve([]);
    await p;
    expect(h.state).toMatchObject({ ownerUserId: OWNER, status: 'ready', loaded: true });
    expect(read('src/hooks/useInvestmentStructure.ts')).toContain('listPortfolios({ ownerUserId: owner, includeArchived: true })');
  });

  it('resposta atrasada de outro proprietário não sobrescreve a consulta atual', async () => {
    const h = harness();
    const first = h.load(true, OWNER);
    const second = h.load(true, 'owner-b');
    h.pending[2].resolve([]);
    h.pending[3].resolve([]);
    await second;
    h.pending[0].resolve([pf('p1', 'De A')]);
    h.pending[1].resolve([]);
    await first;
    expect(h.state).toMatchObject({ ownerUserId: 'owner-b', portfolios: [] });
    expect(structureFor(h.state, OWNER)).toMatchObject({ portfolios: [], loaded: false });
  });

  it('erro mantém os dados já carregados do mesmo proprietário', async () => {
    const h = harness();
    const ok = h.load(true, OWNER);
    h.pending[0].resolve([pf('p1', 'A')]);
    h.pending[1].resolve([]);
    await ok;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ko = h.load(true, OWNER);
    h.pending[2].reject(new Error('rede'));
    h.pending[3].resolve([]);
    await ko;
    expect(h.state).toMatchObject({ status: 'error', loaded: true });
    expect(h.state.portfolios).toHaveLength(1);
  });
});

describe('faixa de carteiras (apresentação)', () => {
  const base = { monthLabel: 'setembro de 2026', ownerLabel: 'Você', filter: null, onFilterChange: () => {}, onRetry: () => {} };
  const grouping = groupPositionsByPortfolio({
    positions: [pos('1', 1000.1, 'p1'), pos('2', 20, 'p2'), pos('3', 5)],
    portfolios: [pf('p1', 'Longo prazo'), pf('p2', 'Antiga', '2026-10-01'), pf('p3', 'Vazia')],
    monthKey: MONTH, ownerUserId: OWNER,
  });

  it('cartões: todas, carteiras ativas (mesmo vazias), arquivada com posição e Sem carteira, com totais do mês', () => {
    const html = renderToStaticMarkup(React.createElement(PortfolioShelf, { ...base, status: 'ready', grouping })).replace(/ /g, ' ');
    for (const t of ['Todas as posições', 'Longo prazo', 'Vazia', 'Antiga', 'Arquivada', 'Sem carteira', 'R$ 1.025,10', 'R$ 1.000,10', 'R$ 20,00', 'R$ 5,00', 'Organizar posições não altera saldos', 'setembro de 2026']) {
      expect(html).toContain(t);
    }
    expect(html).toMatch(/data-portfolio-card="archived"/);
    expect(html).toContain('aria-pressed="true"');
  });

  it('estados: carregando, erro sem dados, erro com dados, vazio', () => {
    expect(renderToStaticMarkup(React.createElement(PortfolioShelf, { ...base, status: 'loading', grouping: null }))).toContain('Carregando carteiras');
    const err = renderToStaticMarkup(React.createElement(PortfolioShelf, { ...base, status: 'error', grouping: null }));
    expect(err).toContain('Não foi possível carregar as carteiras. As posições abaixo continuam disponíveis.');
    expect(err).toContain('Tentar novamente');
    expect(renderToStaticMarkup(React.createElement(PortfolioShelf, { ...base, status: 'error', grouping }))).toContain('Exibindo o último resultado carregado');
    const empty = groupPositionsByPortfolio({ positions: [pos('1', 1)], portfolios: [], monthKey: MONTH, ownerUserId: OWNER });
    const html = renderToStaticMarkup(React.createElement(PortfolioShelf, { ...base, status: 'ready', grouping: empty, onCreatePortfolio: () => {} }));
    expect(html).toContain('data-portfolio-empty');
    expect(html).toContain('Nova carteira');
  });

  it('sem ação de gestão quando a tela não a oferece; responsivo (rolagem própria no celular)', () => {
    const html = renderToStaticMarkup(React.createElement(PortfolioShelf, { ...base, status: 'ready', grouping }));
    expect(html).not.toContain('Nova carteira');
    expect(html).not.toContain('Gerenciar carteira');
    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('sm:flex-row');
    // compacta: total e contagem na mesma linha; a partir de sm quebra linha em vez de rolar na horizontal
    expect(html).toContain('sm:flex-wrap');
    expect(html).toContain('sm:overflow-x-visible');
    expect(html).not.toMatch(/text-lg font-semibold text-white">R\$/);
    expect(html).toContain('· 1 posição');
  });

  it('etiqueta: Sem carteira, carteira, arquivada e holding', () => {
    expect(renderToStaticMarkup(React.createElement(ClassificationBadge, { portfolioName: null }))).toContain('Sem carteira');
    const a = renderToStaticMarkup(React.createElement(ClassificationBadge, { portfolioName: 'Reserva', archived: true, holdingName: 'CDB X' }));
    expect(a).toContain('Reserva');
    expect(a).toContain('arquivada');
    expect(a).toContain('CDB X');
    expect(a).not.toContain('<button');
    expect(renderToStaticMarkup(React.createElement(ClassificationBadge, { portfolioName: null, onAction: () => {} }))).toContain('<button');
  });
});

describe('integração na view: flag desligada = tela atual', () => {
  const view = read('src/components/views/InvestmentsView.tsx');

  it('a flag depende do plano Wealth e da conta; a carga só é habilitada pela flag', () => {
    expect(view).toContain('const portfoliosEnabled = isWealth && isInvestmentPortfoliosEnabled(user);');
    expect(view).toMatch(/useInvestmentStructure\(portfoliosEnabled, /);
  });

  it('faixa e etiquetas só existem com a flag e o snapshot validado; a lista sem flag é exatamente `investments`', () => {
    expect(view).toContain('{portfoliosEnabled && viewReady && (\n                <PortfolioShelf');
    expect(view).toContain('if (!portfoliosEnabled || !viewReady');
    expect(view).toContain('const listedInvestments = portfolioGrouping ? filterPositions(investments, portfolioGrouping, portfolioFilter) : investments;');
    // cartão do celular (linha própria, largura total) e coluna "Ativo" da tabela: ambos só com a flag
    expect(view.match(/\{portfolioGrouping && renderClassification\(inv\)\}/g)).toHaveLength(1);
    expect(view).toContain('{portfolioGrouping && <div className="pl-2">{renderClassification(inv)}</div>}');
  });

  it('totais, resumo, gráficos e alocações continuam sobre o mês inteiro (o filtro só afeta a lista)', () => {
    expect(view).toContain('const totalBalance = investments.reduce(');
    expect(view).toContain('selectMonthPositions(investments, currentKey)');
    expect(view).not.toMatch(/summarizePortfolio\([^)]*listedInvestments|selectMonthPositions\(listedInvestments/);
  });
});

describe('CRUD de carteiras e ativos (apresentação e regras)', () => {
  const portfolio = pf('p1', 'Reserva');
  const drawerBase = { holdings: [], ownerUserId: OWNER, ownerLabel: 'Você', monthLabel: 'setembro de 2026', positionsThisMonth: 2, onClose: () => {}, onRename: () => {}, onChanged: () => {} };
  const holding = { id: 'h1', user_id: OWNER, portfolio_id: 'p1', display_name: 'CDB Banco X', institution_ref: 'XP', product_type_ref: null, created_by: OWNER, created_at: '', updated_by: null, updated_at: '' };

  it('formulário: criar (vazio, botão desabilitado) e renomear (nome atual, sem mudança = desabilitado)', async () => {
    const { default: PortfolioFormModal } = await import('../../src/components/investments/PortfolioFormModal');
    const props = { isOpen: true, ownerUserId: OWNER, ownerLabel: 'Ione', onClose: () => {}, onSaved: () => {} };
    const create = renderToStaticMarkup(React.createElement(PortfolioFormModal, props));
    expect(create).toContain('Nova carteira');
    expect(create).toContain('Ione');
    expect(create).toMatch(/<button type="submit" disabled=""/);
    expect(create).toContain('maxLength="80"');
    const rename = renderToStaticMarkup(React.createElement(PortfolioFormModal, { ...props, portfolio }));
    expect(rename).toContain('Renomear carteira');
    expect(rename).toContain('value="Reserva"');
    expect(rename).toMatch(/<button type="submit" disabled=""/);
    expect(renderToStaticMarkup(React.createElement(PortfolioFormModal, { ...props, isOpen: false }))).toBe('');
  });

  it('gestão: ativa oferece arquivar e novo ativo; arquivada oferece desarquivar e não aceita ativos novos; nada é excluído', async () => {
    const { default: Drawer } = await import('../../src/components/investments/PortfolioManagerDrawer');
    const active = renderToStaticMarkup(React.createElement(Drawer, { ...drawerBase, portfolio, holdings: [holding] }));
    expect(active).toContain('Arquivar');
    expect(active).toContain('Novo ativo');
    expect(active).toContain('CDB Banco X');
    expect(active).toContain('XP');
    expect(active).toContain('2 posições em setembro de 2026');
    const archived = renderToStaticMarkup(React.createElement(Drawer, { ...drawerBase, portfolio: pf('p1', 'Reserva', '2026-10-01') }));
    expect(archived).toContain('Desarquivar');
    expect(archived).not.toContain('Novo ativo');
    expect(archived).toContain('data-holdings-empty');
    for (const html of [active, archived]) expect(html).not.toMatch(/Excluir|Apagar|delete/i);
  });

  it('arquivar só depois da confirmação, com aviso das posições; o componente nunca escreve em investments', () => {
    const src = read('src/components/investments/PortfolioManagerDrawer.tsx');
    const handler = src.slice(src.indexOf('const handleArchive'), src.indexOf('const handleSaveHolding'));
    expect(handler.indexOf('appConfirm(archiveConfirmation(')).toBeGreaterThan(-1);
    expect(handler.indexOf('if (ok)')).toBeGreaterThan(handler.indexOf('appConfirm('));
    expect(handler.indexOf('archivePortfolio(')).toBeGreaterThan(handler.indexOf('if (ok)'));
    for (const f of ['PortfolioManagerDrawer', 'PortfolioFormModal']) {
      expect(read(`src/components/investments/${f}.tsx`)).not.toMatch(/from\('investments'\)|investmentService|supabase/);
    }
  });

  it('mensagens: aviso de arquivamento conta as posições do mês e garante a preservação; erros não vazam detalhes', async () => {
    const { archiveConfirmation, structureErrorMessage } = await import('../../src/components/investments/portfolioMessages');
    const { InvestmentStructureError } = await import('../../src/services/investmentStructureService');
    expect(archiveConfirmation('Reserva', 3, 'setembro de 2026')).toContain('3 posições de setembro de 2026 continuam nela');
    expect(archiveConfirmation('Reserva', 1, 'setembro de 2026')).toContain('1 posição de setembro de 2026 continua nela');
    expect(archiveConfirmation('Reserva', 0, 'setembro de 2026')).toContain('preservadas');
    expect(archiveConfirmation('Reserva', 2, 'x')).toContain('poderá ser desarquivada');
    expect(structureErrorMessage(new InvestmentStructureError('duplicate_name'))).toBe('Já existe uma carteira ativa com esse nome.');
    expect(structureErrorMessage(new Error('violates constraint "investments_pkey"'))).not.toMatch(/constraint|investments/);
  });

  it('faixa: arquivadas sem posições no mês ficam acessíveis para desarquivar', () => {
    const grouping = groupPositionsByPortfolio({ positions: [], portfolios: [], monthKey: MONTH, ownerUserId: OWNER });
    const html = renderToStaticMarkup(React.createElement(PortfolioShelf, {
      status: 'ready', grouping, monthLabel: 'setembro de 2026', ownerLabel: 'Você', filter: null, onFilterChange: () => {}, onRetry: () => {},
      onManagePortfolio: () => {}, hiddenArchived: [{ id: 'p9', name: 'Viagem 2024' }],
    }));
    expect(html).toContain('Carteiras arquivadas sem posições em setembro de 2026 (1)');
    expect(html).toContain('Viagem 2024');
  });
});
