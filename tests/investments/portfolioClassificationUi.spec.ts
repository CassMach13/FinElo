import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ClassifyInvestmentModal from '../../src/components/investments/ClassifyInvestmentModal';
import { NEW_HOLDING, draftChanges, holdingOptions, initialDraft, offersNoHolding } from '../../src/domain/investments/classificationDraft';

const read = (p: string) => readFileSync(resolve(p), 'utf8').replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));
const OWNER = 'owner-a';
const MONTH = '2026-09-01';
const pf = (id: string, name: string, archived_at: string | null = null, user_id = OWNER) => ({ id, user_id, name, archived_at, created_by: OWNER, created_at: '', updated_by: null, updated_at: '' });
const inv = (over: Record<string, unknown> = {}) => ({
  id: 's1', user_id: OWNER, institution: 'XP', product_type: 'Renda Fixa', product_name: 'CDB X', balance: 1000.1, reference_month: MONTH,
  portfolio_id: null, holding_id: null, ...over,
}) as any;
const hold = (id: string, portfolio_id: string, display_name: string) => ({ id, user_id: OWNER, portfolio_id, display_name, institution_ref: null, product_type_ref: null, created_by: OWNER, created_at: '', updated_by: null, updated_at: '' });
const holdings = [hold('h1', 'p1', 'CDB X 2027'), hold('h2', 'p1', 'LCI Y'), hold('h3', 'p2', 'Outra')];
const norm = (html: string) => html.replace(/ /g, ' ');

describe('rascunho de classificação (regras puras)', () => {
  it('começa na carteira atual ativa; arquivada ou sem carteira começa na primeira ativa', () => {
    const active = [pf('p1', 'A'), pf('p2', 'B')];
    expect(initialDraft(inv({ portfolio_id: 'p2', holding_id: 'h3' }), active)).toEqual({ portfolioId: 'p2', holdingChoice: 'h3' });
    expect(initialDraft(inv({ portfolio_id: 'p-arq' }), active)).toEqual({ portfolioId: 'p1', holdingChoice: '' });
    expect(initialDraft(inv(), [])).toEqual({ portfolioId: '', holdingChoice: '' });
  });

  it('só há o que gravar quando algo muda (reenviar a mesma classificação não é mudança)', () => {
    expect(draftChanges(inv({ portfolio_id: 'p1' }), { portfolioId: 'p1', holdingChoice: '' })).toBe(false);
    expect(draftChanges(inv({ portfolio_id: 'p1', holding_id: 'h1' }), { portfolioId: 'p1', holdingChoice: 'h1' })).toBe(false);
    expect(draftChanges(inv({ portfolio_id: 'p1' }), { portfolioId: 'p1', holdingChoice: 'h1' })).toBe(true);
    expect(draftChanges(inv({ portfolio_id: 'p1', holding_id: 'h1' }), { portfolioId: 'p1', holdingChoice: '' })).toBe(true);
    expect(draftChanges(inv(), { portfolioId: 'p1', holdingChoice: '' })).toBe(true);
    expect(draftChanges(inv(), { portfolioId: '', holdingChoice: '' })).toBe(false);
    expect(draftChanges(inv({ portfolio_id: 'p1' }), { portfolioId: 'p1', holdingChoice: NEW_HOLDING })).toBe(true);
  });

  it('um ativo por mês: o usado por OUTRA posição do mês fica indisponível; o da própria posição, não', () => {
    const month = [inv({ id: 's1', holding_id: 'h2' }), inv({ id: 's2', holding_id: 'h1' }), inv({ id: 's3', holding_id: 'h3' })];
    expect(holdingOptions(holdings, 'p1', month, 's1')).toEqual([
      { id: 'h1', name: 'CDB X 2027', takenBy: 's2' },
      { id: 'h2', name: 'LCI Y', takenBy: null },
    ]);
  });
});

describe('modal de classificação', () => {
  const base = { ownerUserId: OWNER, ownerLabel: 'Você', monthLabel: 'setembro de 2026', holdings, monthPositions: [] as any[], onClose: () => {}, onCreatePortfolio: () => {}, onDone: () => {} };
  const render = (props: Record<string, unknown>) => norm(renderToStaticMarkup(React.createElement(ClassifyInvestmentModal, { ...base, ...props } as any)));

  it('posição sem carteira: destinos só ativos do proprietário, ativo opcional, botão habilitado', () => {
    const html = render({
      investment: inv(), portfolios: [pf('p1', 'Longo prazo'), pf('p2', 'Antiga', '2026-10-01'), pf('pb', 'De B', null, 'owner-b')],
      monthPositions: [inv(), inv({ id: 's2', holding_id: 'h1' })],
    });
    expect(html).toContain('Classificar em uma carteira');
    expect(html).toContain('<option value="p1" selected="">Longo prazo</option>');
    expect(html).not.toContain('Antiga');
    expect(html).not.toContain('De B');
    expect(html).toContain('Sem ativo');
    expect(html).toContain('<option value="h1" disabled="">CDB X 2027 (já usado em setembro de 2026)</option>');
    expect(html).toContain('+ Criar ativo novo');
    expect(html).toContain('R$ 1.000,10');
    expect(html).toContain('Classificar não altera saldo, mês nem proprietário.');
    expect(html).toMatch(/<button type="submit" class="[^"]*">Classificar<\/button>/);
    expect(html).not.toContain('Remover da carteira');
  });

  it('já classificada: o botão começa desabilitado e há "Remover da carteira"; proprietário visível', () => {
    const html = render({ ownerLabel: 'Ione', investment: inv({ portfolio_id: 'p1' }), portfolios: [pf('p1', 'Longo prazo'), pf('p3', 'Reserva')] });
    expect(html).toContain('Mover ou remover da carteira');
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*>Salvar<\/button>/);
    expect(html).toContain('Remover da carteira');
    expect(html).toContain('Ione');
  });

  it('em carteira arquivada: sinaliza, sugere uma ativa e permite desfazer', () => {
    const html = render({ investment: inv({ portfolio_id: 'p2' }), portfolios: [pf('p2', 'Antiga', '2026-10-01'), pf('p3', 'Reserva')] });
    expect(html).toContain('arquivada — não recebe novas classificações');
    expect(html).toContain('<option value="p3" selected="">Reserva</option>');
    expect(html).not.toContain('<option value="p2"');
    expect(html).toContain('Remover da carteira');
  });

  it('sem carteira ativa: convida a criar uma e não oferece gravar', () => {
    const html = render({ investment: inv(), portfolios: [pf('p2', 'Antiga', '2026-10-01')] });
    expect(html).toContain('data-no-active-portfolio');
    expect(html).toContain('Criar carteira');
    expect(html).not.toMatch(/type="submit"/);
  });

  it('só grava pelo serviço restrito; desfazer só depois da confirmação', () => {
    const src = read('src/components/investments/ClassifyInvestmentModal.tsx');
    expect(src).not.toMatch(/investmentService|supabase|updateInvestment|from\('investments'\)/);
    expect(src).toContain('classifyInvestment({ investmentId: investment.id, ownerUserId, portfolioId: draft.portfolioId, holdingId })');
    expect(src).toContain('unclassifyInvestment({ investmentId: investment.id, ownerUserId })');
    const undo = src.slice(src.indexOf('const handleUnclassify'), src.indexOf('  return (\n'));
    expect(undo.indexOf('appConfirm(unclassifyConfirmation(')).toBeGreaterThan(-1);
    expect(undo.indexOf('if (!ok) return;')).toBeGreaterThan(undo.indexOf('appConfirm(unclassifyConfirmation('));
    expect(undo.indexOf('unclassifyInvestment(')).toBeGreaterThan(undo.indexOf('if (!ok) return;'));
  });

  it('view: só posições do snapshot validado abrem o modal; depois de gravar, o mês é recarregado', () => {
    const view = read('src/components/views/InvestmentsView.tsx');
    expect(view).toContain('const classifyingInvestment = classifyingId && portfolioGrouping ? investments.find((inv) => inv.id === classifyingId) ?? null : null;');
    expect(view).toContain('onAction={() => setClassifyingId(inv.id)}');
    expect(view).toContain('void fetchInvestments(currentDate);');
  });
});

describe('D1 na tela', () => {
  it('a cópia só preserva classificação com a flag ligada e avisa o resultado', async () => {
    const view = read('src/components/views/InvestmentsView.tsx');
    expect(view).toContain('investmentService.copyFromPreviousMonth(user.id, currentDate, { preserveClassification: portfoliosEnabled })');
    const { copyClassificationNotice } = await import('../../src/components/investments/portfolioMessages');
    expect(copyClassificationNotice({ copied: 3, classified: 0, leftUnclassified: 0 })).toBeNull();
    expect(copyClassificationNotice({ copied: 3, classified: 2, leftUnclassified: 1 })).toBe(
      '3 posições copiadas do mês anterior. 2 mantiveram a carteira. 1 ficou em Sem carteira (carteira arquivada ou indisponível).'
    );
    expect(copyClassificationNotice({ copied: 1, classified: 1, leftUnclassified: 0 })).toBe('1 posição copiada do mês anterior. 1 manteve a carteira.');
  });
});

describe('feedback do modal quando não há o que salvar (achado do teste no staging)', () => {
  const base = { ownerUserId: OWNER, ownerLabel: 'Você', monthLabel: 'outubro de 2026', monthPositions: [] as any[], onClose: () => {}, onCreatePortfolio: () => {}, onDone: () => {} };
  const render = (props: Record<string, unknown>) => norm(renderToStaticMarkup(React.createElement(ClassifyInvestmentModal, { ...base, ...props } as any)));

  it('posição na carteira SEM ativo: "Sem ativo (atual)", botão desabilitado e explicação do que fazer', () => {
    const html = render({ investment: inv({ portfolio_id: 'p1' }), portfolios: [pf('p1', 'Reserva')], holdings: [hold('h1', 'p1', 'CDB X')] });
    expect(html).toContain('Sem ativo (atual)');
    expect(html).toContain('data-no-changes');
    expect(html).toContain('Nada para salvar ainda');
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*>Salvar<\/button>/);
  });

  it('posição que JÁ tem ativo, na mesma carteira: a opção "Sem ativo" não é oferecida; em outra carteira, sim', () => {
    const draftSame = { portfolioId: 'p1', holdingChoice: 'h1' };
    const draftOther = { portfolioId: 'p2', holdingChoice: '' };
    const position = inv({ portfolio_id: 'p1', holding_id: 'h1' });
    expect(offersNoHolding(position, draftSame)).toBe(false);
    expect(offersNoHolding(position, draftOther)).toBe(true);
    expect(offersNoHolding(inv({ portfolio_id: 'p1' }), draftSame)).toBe(true);
    expect(offersNoHolding(inv(), { portfolioId: 'p1', holdingChoice: '' })).toBe(true);
    const html = render({ investment: position, portfolios: [pf('p1', 'Reserva'), pf('p2', 'Outra')], holdings });
    expect(html).not.toContain('>Sem ativo');
    expect(html).toContain('<option value="h1" selected="">CDB X 2027</option>');
  });

  it('nomes do botão: Classificar (sem carteira), Mover (outra carteira) e Salvar (só o ativo)', () => {
    const src = read('src/components/investments/ClassifyInvestmentModal.tsx');
    expect(src).toContain("const saveLabel = !current ? 'Classificar' : portfolioChanges ? 'Mover' : 'Salvar';");
    expect(src).toContain("holdingChoice: e.target.value === investment.portfolio_id ? investment.holding_id ?? '' : ''");
  });
});
