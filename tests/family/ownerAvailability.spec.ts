import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverOwnerContext, createOwnerOptionsLoader, selfOwnerDiscovery, type OwnerDiscoveryDeps } from '../../src/services/investmentOwnerDiscovery';
import { DashboardOwnerSelectorView } from '../../src/components/dashboard/DashboardOwnerSelector';
import { OwnerSelectorView } from '../../src/components/investments/InvestmentOwnerSelector';
import { familyAvailabilityMessage } from '../../src/components/family/OwnerScopeControl';
import { SELF_SCOPE } from '../../src/domain/dashboard/dashboardOwnerScope';
import { isDashboardOwnerScopeEnabled, isInvestmentPortfoliosEnabled } from '../../src/services/featureFlagService';
import { readFileSync } from 'node:fs';

const session = { userId: 'me', email: 'me@test.local' };
const link = (owner: string, member: string, status = 'accepted', email = `${owner}@test.local`) =>
  ({ id: `${owner}:${member}`, owner_id: owner, owner_email: email, member_email: member, status }) as any;
const deps = (links: any[], owners: string[] = []): OwnerDiscoveryDeps => ({
  listFamilyLinks: async () => links,
  findVisibleInvestmentOwner: async (excluding) => owners.find((id) => !excluding.includes(id)) ?? null,
});
const incoming = link('ana', session.email);
const outgoing = link(session.userId, 'ana@test.local');
const discovery = (links: any[], owners: string[] = [], nicknames = {}) => discoverOwnerContext(deps(links, owners), session, nicknames);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('vínculos aceitos e disponibilidade financeira são independentes', () => {
  it('sem familiares: Você visível, nenhum consolidado ou SELECT financeiro', async () => {
    const probe = vi.fn(async () => null);
    const result = await discoverOwnerContext({ ...deps([]), findVisibleInvestmentOwner: probe }, session);
    expect(result).toEqual(selfOwnerDiscovery('me', 'ready'));
    expect(probe).not.toHaveBeenCalled();
    for (const View of [DashboardOwnerSelectorView, OwnerSelectorView]) {
      const html = renderToStaticMarkup(React.createElement(View, { options: result.options, value: SELF_SCOPE, onChange: () => {}, context: result }));
      expect(html).toContain('Visão:');
      expect(html).toContain('Você');
      expect(html).toContain('Nenhum familiar vinculado');
      expect(html).not.toContain('<select');
      expect(html).not.toContain('Família (consolidado)');
    }
  });

  it.each([{ links: [outgoing] }, { links: [incoming] }, { links: [outgoing, incoming] }])('aceito sem dados: conta uma pessoa, sem inventar opção financeira ($links)', async ({ links }) => {
    const result = await discovery(links);
    expect(result.linkedFamilyCount).toBe(1);
    expect(result.unavailableFamilyCount).toBe(1);
    expect(result.options.map((o) => o.userId)).toEqual(['me']);
    const html = renderToStaticMarkup(React.createElement(DashboardOwnerSelectorView, { options: result.options, value: SELF_SCOPE, onChange: () => {}, context: result }));
    expect(html).toContain('1 familiar vinculado — sem dados financeiros disponíveis');
    expect(html).not.toContain('<select');
  });

  it('Investimentos permite titular direto aceito sem posições, preservando mensagem de indisponibilidade', async () => {
    const result = await discoverOwnerContext({ ...deps([incoming]), allowEmptyLinkedOwners: true }, session, { 'ana@test.local': 'Ione' });
    expect(result.options.map((o) => [o.userId, o.label])).toEqual([['me', 'Você'], ['ana', 'Ione']]);
    expect(result.unavailableFamilyCount).toBe(1);
    expect(familyAvailabilityMessage(result)).toBe('1 familiar vinculado — sem dados financeiros disponíveis');
    const html = renderToStaticMarkup(React.createElement(OwnerSelectorView, { options: result.options, value: 'ana', onChange: () => {}, context: result }));
    expect(html).toContain('<option value="ana" selected="">Ione</option>');
    expect(html).not.toContain('consolidado');
  });

  it('estado vazio nunca resolve identidade só por e-mail, ambiguidade, vínculo não aceito ou terceiro', async () => {
    for (const links of [[outgoing], [link('me', 'ana@test.local'), link('me', 'bia@test.local')], [link('ana', session.email, 'pending')], [link('ana', 'other@test.local')]]) {
      const result = await discoverOwnerContext({ ...deps(links), allowEmptyLinkedOwners: true }, session);
      expect(result.options.map((o) => o.userId)).toEqual(['me']);
    }
  });

  it('aceito com dados: mantém apelido e escolha explícita; Investimentos nunca oferece consolidado', async () => {
    const result = await discovery([incoming, outgoing], ['ana'], { 'ana@test.local': 'Minha família' });
    expect(result.linkedFamilyCount).toBe(1);
    expect(result.unavailableFamilyCount).toBe(0);
    expect(result.options.map((o) => o.label)).toEqual(['Você', 'Minha família']);
    const dash = renderToStaticMarkup(React.createElement(DashboardOwnerSelectorView, { options: result.options, value: SELF_SCOPE, onChange: () => {}, context: result }));
    expect(dash).toContain(`<option value="${SELF_SCOPE}" selected="">Você</option>`);
    expect(dash).toContain('<option value="ana">Minha família</option>');
    expect(dash).toContain('Família (consolidado)');
    const investments = renderToStaticMarkup(React.createElement(OwnerSelectorView, { options: result.options, value: 'me', onChange: () => {}, context: result }));
    expect(investments).toContain('<option value="me" selected="">Você</option>');
    expect(investments).not.toContain('consolidado');
  });

  it.each(['pending', 'declined', 'revoked'])('%s não é familiar autorizado, mesmo com linhas antigas carregadas', async (status) => {
    const probe = vi.fn(async () => 'ana');
    const result = await discoverOwnerContext({ ...deps([link('ana', session.email, status)]), findVisibleInvestmentOwner: probe }, session, {}, [{ userId: 'ana', label: 'antigo' }]);
    expect(result.linkedFamilyCount).toBe(0);
    expect(result.options.map((o) => o.userId)).toEqual(['me']);
    expect(probe).not.toHaveBeenCalled();
  });

  it('não usa vínculos de terceiros, e-mails vazios ou autorreferências', async () => {
    expect((await discovery([link('ana', 'beto@test.local'), link('me', session.email)])).linkedFamilyCount).toBe(0);
    expect((await discoverOwnerContext(deps([incoming], ['ana']), { userId: 'me', email: '' })).options).toHaveLength(1);
  });

  it('não atribui dois IDs a dois e-mails pela ordem da consulta', async () => {
    const links = [outgoing, link('me', 'bia@test.local')];
    const first = await discovery(links, ['bia', 'ana']);
    const second = await discovery(links, ['ana', 'bia']);
    expect(first.options).toEqual(second.options);
    expect(first.options).toHaveLength(1);
    expect(first.linkedFamilyCount).toBe(2);
    expect(first.unavailableFamilyCount).toBe(2);
    expect(first.unresolvedFamilyCount).toBe(2);
  });

  it('dois familiares, somente um com dados e sem identidade resolvida: não adivinha quem é', async () => {
    const result = await discovery([outgoing, link('me', 'bia@test.local')], ['ana']);
    expect(result.options).toHaveLength(1);
    expect(familyAvailabilityMessage(result)).toBe('2 familiares vinculados — sem dados financeiros disponíveis');
  });

  it('recíprocos resolvem vários titulares e preservam cada apelido, sem depender da ordem', async () => {
    const result = await discovery([outgoing, incoming, link('me', 'bia@test.local'), link('bia', session.email)], ['bia', 'ana'], {
      'ana@test.local': 'Zélia', 'bia@test.local': 'Bia',
    });
    expect(result.options.map((o) => [o.userId, o.label])).toEqual([['me', 'Você'], ['bia', 'Bia'], ['ana', 'Zélia']]);
    expect(result.linkedFamilyCount).toBe(2);
  });

  it('vínculo aceito sem e-mail resolvido continua contado, mas nunca vira opção financeira', async () => {
    const result = await discovery([{ ...incoming, owner_email: '' }], ['ana']);
    expect(result.linkedFamilyCount).toBe(1);
    expect(result.unavailableFamilyCount).toBe(1);
    expect(result.options.map((o) => o.userId)).toEqual(['me']);
  });

  it('contradição na identidade não produz visão financeira selecionável', async () => {
    const result = await discovery([incoming, link('ana', session.email, 'accepted', 'outra@test.local')], ['ana']);
    expect(result.options).toHaveLength(1);
  });

  it('titular conhecido só por transação precisa de vínculo com identidade direta; stale ID não alimenta inferência', async () => {
    const known = [{ userId: 'ana', label: 'obsoleto' }];
    const direct = await discoverOwnerContext(deps([incoming]), session, { 'ana@test.local': 'Ione' }, known);
    expect(direct.options[1].label).toBe('Ione');
    const stale = await discoverOwnerContext(deps([link('me', 'bia@test.local')]), session, {}, known);
    expect(stale.options).toHaveLength(1);
  });

  it('mistura de familiar disponível e sem dados usa contagens reais, com pluralização', async () => {
    const result = await discovery([incoming, outgoing, link('me', 'bia@test.local')], ['ana']);
    expect(result.options.map((o) => o.userId)).toEqual(['me', 'ana']);
    expect(familyAvailabilityMessage(result)).toBe('2 familiares vinculados — 1 sem dados financeiros disponíveis');
  });

  it('erro e carga não afirmam que o usuário está sem família', () => {
    expect(familyAvailabilityMessage(selfOwnerDiscovery('me', 'loading'))).toBe('Verificando vínculos familiares…');
    expect(familyAvailabilityMessage(selfOwnerDiscovery('me', 'error'))).toBe('Não foi possível verificar os familiares vinculados.');
  });
});

describe('sessões e falhas na consulta assíncrona', () => {
  it('A → B: descarta contagem e opções da resposta antiga', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const shown: string[] = [];
    const loader = createOwnerOptionsLoader({
      ...deps([incoming], ['ana']), listFamilyLinks: async () => { await gate; return [incoming]; },
    }, (id, _options, context) => shown.push(`${id}:${context.linkedFamilyCount}`));
    const a = loader(session);
    const b = loader({ userId: 'other', email: 'other@test.local' });
    release();
    await Promise.all([a, b]);
    expect(shown).toEqual(['other:0']);
  });

  it('logout/unmount seguido de A novamente: a resposta anterior não reaparece', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const shown: string[] = [];
    const loader = createOwnerOptionsLoader({
      ...deps([incoming], ['ana']), listFamilyLinks: async () => { await gate; return [incoming]; },
    }, (_id, _options, context) => shown.push(context.status));
    const pending = loader(session);
    loader.invalidate();
    release();
    await pending;
    expect(shown).toEqual([]);
    await loader(session);
    expect(shown).toEqual(['ready']);
  });

  it.each(['links', 'finance'])('falha em %s: mantém Você, sinaliza erro e não mostra dados da consulta anterior', async (where) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state: any[] = [];
    const loader = createOwnerOptionsLoader({
      listFamilyLinks: async () => { if (where === 'links') throw new Error('offline'); return [incoming]; },
      findVisibleInvestmentOwner: async () => { throw new Error('offline'); },
    }, (_id, _options, result) => state.push(result));
    await loader(session);
    expect(state).toEqual([selfOwnerDiscovery('me', 'error')]);
  });
});

describe('flags independentes e sessão de apresentação', () => {
  it('sessão com app_metadata da flag ligada é reconhecida, independentemente da quantidade de titulares', () => {
    const user = { id: 'pilot', app_metadata: { dashboard_owner_scope_enabled: true }, user_metadata: {} };
    expect(isDashboardOwnerScopeEnabled(user)).toBe(true);
    expect(isInvestmentPortfoliosEnabled(user)).toBe(false);
    expect(isDashboardOwnerScopeEnabled({ ...user, app_metadata: { investment_portfolios_enabled: true } })).toBe(false);
    expect(isInvestmentPortfoliosEnabled({ ...user, app_metadata: { investment_portfolios_enabled: true } })).toBe(true);
  });

  it('flag desligada não monta seletor nem adiciona descoberta nas telas; opt-out continua prioritário', () => {
    vi.stubEnv('VITE_DASHBOARD_OWNER_SCOPE_ENABLED', 'false');
    expect(isDashboardOwnerScopeEnabled({ id: 'me', app_metadata: {} })).toBe(false);
    expect(isDashboardOwnerScopeEnabled({ id: 'me', app_metadata: { dashboard_owner_scope_enabled: true }, user_metadata: { dashboard_owner_scope_disabled: true } })).toBe(false);
    const dash = readFileSync('src/components/views/DashboardView.tsx', 'utf8');
    const investments = readFileSync('src/components/views/InvestmentsView.tsx', 'utf8');
    expect(dash).toMatch(/ownerScope && \([\s\S]*?<DashboardOwnerSelector/);
    expect(investments).toContain('portfoliosEnabled && viewOwnerId && (');
    expect(investments).toContain('ownerSessionState?.sessionUserId === user?.id ? ownerSessionState : null');
  });
});
