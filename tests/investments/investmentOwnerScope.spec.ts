import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ownerLabelFor, resolveViewOwner, viewScopeKey, type InvestmentOwnerOption } from '../../src/domain/investments/ownerScope';
import { OwnerSelectorView } from '../../src/components/investments/InvestmentOwnerSelector';
import { createPortfolioFetcher, isSnapshotReady } from '../../src/services/investmentPortfolioLoader';
import { createRequestGuard } from '../../src/domain/investments/portfolioOverview';

/** D3 — seletor de proprietário: um proprietário por vez, nunca misturado, sem duplicar posições. */
const read = (p: string) => readFileSync(resolve(p), 'utf8').replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));
const options: InvestmentOwnerOption[] = [
  { userId: 'me', label: 'Você', isSelf: true },
  { userId: 'ione', label: 'Ione', isSelf: false },
];

describe('proprietário consultado', () => {
  it('sem seleção, seleção desconhecida ou sem flag: a própria sessão (V2-A)', () => {
    expect(resolveViewOwner('me', null, options)).toBe('me');
    expect(resolveViewOwner('me', 'estranho', options)).toBe('me');
    expect(resolveViewOwner('me', 'ione', [])).toBe('me'); // vínculo ainda não carregado/revogado
    expect(resolveViewOwner('me', 'me', options)).toBe('me');
    expect(resolveViewOwner(null, 'ione', options)).toBeNull();
  });

  it('familiar com vínculo listado: passa a ser o proprietário consultado, com rótulo claro', () => {
    expect(resolveViewOwner('me', 'ione', options)).toBe('ione');
    expect(ownerLabelFor('ione', 'me', options)).toBe('Ione');
    expect(ownerLabelFor('me', 'me', options)).toBe('Você');
    expect(ownerLabelFor('x', 'me', options)).toBe('Familiar');
  });

  it('o escopo distingue sessão e proprietário; snapshot de outro escopo nunca fica pronto', () => {
    const mine = viewScopeKey('me', 'me');
    const hers = viewScopeKey('me', 'ione');
    expect(mine).not.toBe(hers);
    expect(viewScopeKey('ione', 'ione')).not.toBe(hers);
    expect(isSnapshotReady({ monthKey: '2026-09-01', userId: mine }, '2026-09-01', hers)).toBe(false);
    expect(isSnapshotReady({ monthKey: '2026-09-01', userId: hers }, '2026-09-01', hers)).toBe(true);
  });

  it('troca de proprietário durante a busca: a resposta antiga é descartada', async () => {
    let live = viewScopeKey('me', 'me');
    const received: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetcher = createPortfolioFetcher(createRequestGuard(), () => live, {
      onLoading: () => {}, onData: (d) => received.push(d.userId), onError: () => {},
    });
    const slow = { getDetail: async () => { await gate; return []; }, getHistory: async () => [], getLatestMonthKey: async () => null };
    const pending = fetcher(slow, live, '2026-09-01');
    live = viewScopeKey('me', 'ione');
    const fast = { getDetail: async () => [], getHistory: async () => [], getLatestMonthKey: async () => null };
    await fetcher(fast, live, '2026-09-01');
    release();
    await pending;
    expect(received).toEqual([viewScopeKey('me', 'ione')]);
  });
});

describe('seletor (apresentação)', () => {
  it('um único proprietário: escopo visível; com familiares, lista com "Você" e o nome do titular', () => {
    expect(renderToStaticMarkup(React.createElement(OwnerSelectorView, { options: [options[0]], value: 'me', onChange: () => {} }))).toContain('Visão:');
    const html = renderToStaticMarkup(React.createElement(OwnerSelectorView, { options, value: 'ione', onChange: () => {} }));
    expect(html).toContain('Visão:');
    expect(html).toContain('<option value="me">Você</option>');
    expect(html).toContain('<option value="ione" selected="">Ione</option>');
  });
});

describe('integração na view', () => {
  const view = read('src/components/views/InvestmentsView.tsx');

  it('só a flag permite outro proprietário; o seletor (e a leitura dos vínculos) só é montado com a flag', () => {
    expect(view).toContain('const viewOwnerId = resolveViewOwner(user?.id, portfoliosEnabled ? selectedOwnerId : null, ownerOptions);');
    expect(view).toContain('{portfoliosEnabled && viewOwnerId && (\n                        <div className="mt-2">\n                            <InvestmentOwnerSelector');
    expect(view).not.toMatch(/useFamilyOwnerContext/);
  });

  it('detalhe, histórico, carteiras e agrupamento usam o MESMO proprietário; nenhum consolidado entre donos', () => {
    expect(view).toContain('await fetcherRef.current(buildDeps(viewOwnerId), viewScope, monthKeyFromDate(date));');
    expect(view).toContain('useInvestmentStructure(portfoliosEnabled, viewOwnerId)');
    expect(view).toContain('ownerUserId: viewOwnerId });');
    expect(view.match(/ownerUserId=\{viewOwnerId\}/g)).toHaveLength(3);
    expect(view).not.toMatch(/ownerUserId=\{user\.id\}/);
  });

  it('consultando um familiar: lançar, importar, limpar, copiar, editar e excluir ficam ocultos; o titular é exibido', () => {
    expect(view).toContain('{!viewingOther && uniqueInstitutions.length > 0 && (');
    expect(view.match(/\{!viewingOther && \(/g)).toHaveLength(6);
    for (const action of ['onClick={() => setIsImportModalOpen(true)}', 'onClick={handleCopyPrevious}', 'onClick={() => handleDelete(inv.id)}']) {
      const at = view.indexOf(action);
      const guard = view.lastIndexOf('{!viewingOther && (', at);
      expect(guard).toBeGreaterThan(-1);
      expect(at - guard).toBeLessThan(1000);
    }
    expect(view).toContain('data-viewing-owner');
  });

  it('nova sessão volta ao próprio titular; troca de proprietário fecha filtro, modais e avisos', () => {
    const sessionEffect = view.slice(view.indexOf('// Nova sessão'), view.indexOf('}, [user?.id]);', view.indexOf('// Nova sessão')));
    expect(sessionEffect).toContain('setSelectedOwnerId(null);');
    const ownerEffect = view.slice(view.indexOf('// Outro proprietário'), view.indexOf('}, [viewOwnerId]);'));
    for (const reset of ['setPortfolioFilter(null)', 'setClassifyingId(null)', 'setManagedPortfolioId(null)', 'setPortfolioForm(null)', 'setPortfolioNotice(null)']) {
      expect(ownerEffect).toContain(reset);
    }
  });
});
