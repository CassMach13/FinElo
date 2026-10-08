import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]>; selected?: string };
const state = vi.hoisted(() => ({
  user: { id: 'actor-b' } as { id: string } | null,
  calls: [] as Array<{ table: string; op: string; payload?: unknown; filters: Array<[string, unknown]>; selected?: string }>,
  result: { data: null as unknown, error: null as unknown },
}));

vi.mock('../../src/supabaseClient', () => {
  const from = (table: string) => {
    const call = { table, op: 'select', payload: undefined as unknown, filters: [] as Array<[string, unknown]>, selected: undefined as string | undefined };
    const chain: any = {
      select: (cols?: string) => { call.selected = cols; return chain; },
      insert: (p: unknown) => { call.op = 'insert'; call.payload = p; return chain; },
      update: (p: unknown) => { call.op = 'update'; call.payload = p; return chain; },
      eq: (c: string, v: unknown) => { call.filters.push([c, v]); return chain; },
      is: (c: string, v: unknown) => { call.filters.push([`${c} is`, v]); return chain; },
      order: () => chain,
      single: () => { state.calls.push(call); return Promise.resolve(state.result); },
      then: (resolveFn: (v: unknown) => unknown) => { state.calls.push(call); return Promise.resolve(state.result).then(resolveFn); },
    };
    return chain;
  };
  return { supabase: { from, auth: { getUser: async () => ({ data: { user: state.user } }) } } };
});

import {
  InvestmentStructureError,
  archivePortfolio,
  createHolding,
  createPortfolio,
  getActorUserId,
  listHoldings,
  listPortfolios,
  mapStructureError,
  normalizePortfolioName,
  renamePortfolio,
  unarchivePortfolio,
  updateHolding,
} from '../../src/services/investmentStructureService';

const read = (p: string) => readFileSync(resolve(p), 'utf8').replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));

beforeEach(() => {
  state.user = { id: 'actor-b' };
  state.calls = [];
  state.result = { data: { id: 'x' }, error: null };
});

describe('serviço de carteiras e holdings', () => {
  it('proprietário e operador são distintos: user_id = proprietário; created_by NUNCA é enviado', async () => {
    await createPortfolio({ ownerUserId: 'owner-a', name: '  Carteira da Ione  ' });
    const call = state.calls[0] as Call;
    expect(call.table).toBe('investment_portfolios');
    expect(call.payload).toEqual({ user_id: 'owner-a', name: 'Carteira da Ione' });
    expect(JSON.stringify(call.payload)).not.toMatch(/created_by|updated_by|actor/);
    await createHolding({ ownerUserId: 'owner-a', portfolioId: 'p1', displayName: ' CDB ', institutionRef: '  ', productTypeRef: 'Renda Fixa ' });
    expect((state.calls[1] as Call).payload).toEqual({ user_id: 'owner-a', portfolio_id: 'p1', display_name: 'CDB', institution_ref: null, product_type_ref: 'Renda Fixa' });
    expect(JSON.stringify((state.calls[1] as Call).payload)).not.toMatch(/created_by|updated_by/);
  });

  it('o operador vem da sessão: sem sessão nenhuma escrita é feita', async () => {
    state.user = null;
    await expect(getActorUserId()).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(createPortfolio({ ownerUserId: 'a', name: 'x' })).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(renamePortfolio('p', 'x')).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(archivePortfolio('p')).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(createHolding({ ownerUserId: 'a', portfolioId: 'p', displayName: 'x' })).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(state.calls).toHaveLength(0);
    state.user = { id: 'actor-c' };
    expect(await getActorUserId()).toBe('actor-c');
  });

  it('valida o nome antes de consultar o banco', async () => {
    await expect(createPortfolio({ ownerUserId: 'a', name: '   ' })).rejects.toMatchObject({ code: 'invalid_name' });
    await expect(createPortfolio({ ownerUserId: 'a', name: 'x'.repeat(81) })).rejects.toMatchObject({ code: 'invalid_name' });
    expect(normalizePortfolioName('x'.repeat(80))).toHaveLength(80);
    await expect(createHolding({ ownerUserId: 'a', portfolioId: 'p', displayName: '' })).rejects.toMatchObject({ code: 'invalid_name' });
    await expect(updateHolding('h', {})).rejects.toBeInstanceOf(InvestmentStructureError);
    expect(state.calls).toHaveLength(0);
  });

  it('renomear, arquivar e desarquivar só tocam name e archived_at', async () => {
    await renamePortfolio('p1', ' Nova ');
    await archivePortfolio('p1');
    await unarchivePortfolio('p1');
    const [rename, archive, unarchive] = state.calls as Call[];
    expect(rename.payload).toEqual({ name: 'Nova' });
    expect(Object.keys(archive.payload as object)).toEqual(['archived_at']);
    expect(unarchive.payload).toEqual({ archived_at: null });
    for (const c of [rename, archive, unarchive]) expect(c.filters).toEqual([['id', 'p1']]);
  });

  it('updateHolding envia só os campos permitidos (nunca user_id nem portfolio_id)', async () => {
    await updateHolding('h1', { displayName: ' Novo ', institutionRef: null });
    expect((state.calls[0] as Call).payload).toEqual({ display_name: 'Novo', institution_ref: null });
  });

  it('listagens: arquivadas ocultas por padrão; filtros por proprietário e carteira', async () => {
    state.result = { data: [], error: null };
    await listPortfolios({ ownerUserId: 'owner-a' });
    await listPortfolios({ includeArchived: true });
    await listHoldings({ portfolioId: 'p1', ownerUserId: 'owner-a' });
    const [a, b, c] = state.calls as Call[];
    expect(a.filters).toContainEqual(['user_id', 'owner-a']);
    expect(a.filters).toContainEqual(['archived_at is', null]);
    expect(b.filters.some(([k]) => k === 'archived_at is')).toBe(false);
    expect(c.filters).toEqual([['user_id', 'owner-a'], ['portfolio_id', 'p1']]);
  });

  it('erros do banco viram códigos estáveis, sem vazar detalhes', async () => {
    const cases: Array<[string | undefined, string]> = [
      ['23505', 'duplicate_name'],
      ['23503', 'integrity'],
      ['23514', 'invalid_name'],
      ['42501', 'forbidden'],
      ['PGRST116', 'not_found_or_forbidden'],
      ['XX000', 'unknown'],
    ];
    for (const [code, expected] of cases) {
      const err = mapStructureError({ code, message: 'violates constraint "investment_portfolios_active_name_key" Key (user_id)=(abc)' });
      expect(err.code).toBe(expected);
      expect(err.message).not.toMatch(/constraint|user_id|abc|investment_/);
    }
    state.result = { data: null, error: { code: '23505', message: 'dup' } };
    await expect(createPortfolio({ ownerUserId: 'a', name: 'Repetida' })).rejects.toMatchObject({ code: 'duplicate_name' });
  });
});

describe('isolamento da fase: nada da V2-A nem da UI usa as estruturas novas', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
    });

  it('nenhum arquivo de src (além do próprio serviço) importa o serviço de estrutura', () => {
    const offenders = walk('src')
      .filter((f) => !f.endsWith('investmentStructureService.ts'))
      .filter((f) => /investmentStructureService/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('a V2-A, o import, o Dashboard e a Identidade Econômica não referenciam portfolio_id/holding_id', () => {
    const files = [
      'src/components/views/InvestmentsView.tsx',
      'src/services/investmentService.ts',
      'src/services/investmentPortfolioLoader.ts',
      'src/services/parsers/xpInvestmentParser.ts',
      'src/domain/investments/portfolioOverview.ts',
      'src/domain/investments/portfolioInsights.ts',
      'src/components/modals/InvestmentModal.tsx',
      'src/components/modals/InvestmentImportModal.tsx',
      'src/components/modals/investmentImportSession.ts',
      'src/utils/dashboardNetWorth.ts',
      'src/domain/economics/transactionSemantics.ts',
      'src/services/economicEventService.ts',
    ];
    for (const f of files) expect(read(f), f).not.toMatch(/portfolio_id|holding_id|investment_portfolios|investment_holdings/);
  });

  it('não há alteração em economic_events, parser ou serviços da V2-A (arquivos protegidos)', () => {
    expect(read('src/services/investmentService.ts')).not.toMatch(/InvestmentPortfolio|InvestmentHolding/);
  });
});
