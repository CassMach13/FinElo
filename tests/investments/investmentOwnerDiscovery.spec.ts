import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { discoverInvestmentOwners, type OwnerDiscoveryDeps } from '../../src/services/investmentOwnerDiscovery';
import { createOwnerOptionsLoader } from '../../src/components/investments/InvestmentOwnerSelector';
import { createPortfolioFetcher } from '../../src/services/investmentPortfolioLoader';
import { createRequestGuard } from '../../src/domain/investments/portfolioOverview';
import { viewScopeKey } from '../../src/domain/investments/ownerScope';
import { A, B, C, D, E, EMAIL, as, closeDatabases, createDatabase, q } from '../helpers/investmentsPgFixture';

/**
 * D3 — descoberta de proprietários sem depender de contas/transações: contrato familiar (`accepted`, bidirecional) +
 * RLS de `investments`. Recusado, pendente, revogado e terceiro não viram opção.
 */
const link = (owner_id: string, member_email: string, status: string, owner_email = EMAIL[owner_id]) =>
  ({ id: `${owner_id}-${member_email}`, owner_id, owner_email, member_email, status }) as any;

const fakeDeps = (links: any[], visibleOwners: string[]) => {
  const calls: string[][] = [];
  const deps: OwnerDiscoveryDeps = {
    listFamilyLinks: async () => links,
    findVisibleInvestmentOwner: async (excluding) => {
      calls.push(excluding);
      return visibleOwners.find((o) => !excluding.includes(o)) ?? null;
    },
  };
  return { deps, calls };
};

describe('descoberta de proprietários (contrato)', () => {
  it('proprietário sem contas nem transações: quem me convidou aparece direto pelo vínculo aceito', async () => {
    const { deps } = fakeDeps([link(A, EMAIL[B], 'accepted')], []);
    const options = await discoverInvestmentOwners(deps, { userId: B, email: EMAIL[B] });
    expect(options.map((o) => [o.userId, o.isSelf])).toEqual([[B, true], [A, false]]);
    expect(options[1].label).toBe('A');
  });

  it('familiar que eu convidei e só tem investimentos: o id vem das posições que a RLS libera; o rótulo, do vínculo', async () => {
    const { deps, calls } = fakeDeps([link(A, EMAIL[B], 'accepted')], [B]);
    const options = await discoverInvestmentOwners(deps, { userId: A, email: EMAIL[A] });
    expect(options.map((o) => o.userId)).toEqual([A, B]);
    expect(options[1].label).toBe('B');
    expect(calls).toEqual([[A]]);
  });

  it('usa o apelido cadastrado em Configurações; sem apelido, o nome derivado do e-mail', async () => {
    const { deps } = fakeDeps([link(A, EMAIL[B], 'accepted')], [B]);
    const withNick = await discoverInvestmentOwners(deps, { userId: A, email: EMAIL[A] }, { [EMAIL[B]]: 'Ione' });
    expect(withNick[1].label).toBe('Ione');
    const without = await discoverInvestmentOwners(deps, { userId: A, email: EMAIL[A] }, {});
    expect(without[1].label).toBe('B');
  });

  it('recusado, pendente, revogado ou nenhum vínculo: só a própria sessão e nenhuma leitura de investimentos', async () => {
    for (const links of [[link(A, EMAIL[E], 'declined')], [link(A, EMAIL[D], 'pending')], []]) {
      const { deps, calls } = fakeDeps(links, [B, C]);
      for (const me of [A, D, E]) {
        expect((await discoverInvestmentOwners(deps, { userId: me, email: EMAIL[me] })).map((o) => o.userId)).toEqual([me]);
      }
      expect(calls).toEqual([]);
    }
  });

  it('vínculo de outras pessoas não serve para mim (terceiro)', async () => {
    const { deps, calls } = fakeDeps([link(A, EMAIL[B], 'accepted')], [A, B]);
    expect((await discoverInvestmentOwners(deps, { userId: C, email: EMAIL[C] })).map((o) => o.userId)).toEqual([C]);
    expect(calls).toEqual([]);
  });

  it('número de leituras limitado aos vínculos aceitos (nunca varre o banco)', async () => {
    const { deps, calls } = fakeDeps([link(A, EMAIL[B], 'accepted')], ['x1', 'x2', 'x3', 'x4']);
    const options = await discoverInvestmentOwners(deps, { userId: A, email: EMAIL[A] });
    expect(calls).toHaveLength(1);
    expect(options).toHaveLength(2);
  });

  it('falha na descoberta: só a própria sessão; resposta de uma sessão anterior é descartada', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const got: Array<[string, string[]]> = [];
    const failing = createOwnerOptionsLoader({ listFamilyLinks: async () => { throw new Error('rede'); }, findVisibleInvestmentOwner: async () => null }, (s, o) => got.push([s, o.map((x) => x.userId)]));
    await failing({ userId: A, email: EMAIL[A] });
    expect(got).toEqual([[A, [A]]]);

    got.length = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slowLinks = [link(A, EMAIL[B], 'accepted')];
    const loader = createOwnerOptionsLoader(
      { listFamilyLinks: async () => { await gate; return slowLinks; }, findVisibleInvestmentOwner: async () => B },
      (s, o) => got.push([s, o.map((x) => x.userId)])
    );
    const first = loader({ userId: A, email: EMAIL[A] });
    const second = loader({ userId: C, email: EMAIL[C] });
    release();
    await Promise.all([first, second]);
    expect(got).toEqual([[C, [C]]]);
  });
});

describe('trocas rápidas de proprietário', () => {
  it('A → B → A com respostas fora de ordem: só a última consulta é exibida', async () => {
    let live = '';
    const shown: string[] = [];
    const fetcher = createPortfolioFetcher(createRequestGuard(), () => live, { onLoading: () => {}, onData: (d) => shown.push(d.userId), onError: () => {} });
    const releases: Array<() => void> = [];
    const deps = () => {
      const gate = new Promise<void>((r) => releases.push(r));
      return { getDetail: async () => { await gate; return []; }, getHistory: async () => [], getLatestMonthKey: async () => null };
    };
    const runs: Promise<void>[] = [];
    for (const owner of [A, B, A]) {
      live = viewScopeKey(A, owner);
      runs.push(fetcher(deps(), live, '2026-09-01'));
    }
    releases[2]();
    releases[0]();
    releases[1]();
    await Promise.all(runs);
    expect(shown).toEqual([viewScopeKey(A, A)]);
    expect(shown).toHaveLength(1);
  });
});

describe('a leitura que a descoberta usa, contra a RLS real (has_family_access)', () => {
  afterEach(closeDatabases);
  vi.setConfig({ testTimeout: 120_000 });

  /** Exatamente o que `findVisibleInvestmentOwner` pede: um user_id visível fora da lista. */
  const visibleOwner = async (db: PGlite, me: string, excluding: string[]) => {
    await as(db, 'authenticated', me);
    const rows = await q<{ user_id: string }>(db, 'select user_id from public.investments where not (user_id = any($1::uuid[])) limit 1', [excluding]);
    return rows[0]?.user_id ?? null;
  };

  it('aceito (nos dois sentidos) encontra o outro proprietário — B só tem investimentos, sem contas; pendente, recusado, terceiro e revogado não', async () => {
    const db = await createDatabase();
    expect(await visibleOwner(db, A, [A])).toBe(B); // A convidou B (accepted): B só tem uma posição
    expect(await visibleOwner(db, A, [A, B])).toBeNull();
    expect(await visibleOwner(db, B, [B])).toBe(A); // B foi convidado por A
    expect(await visibleOwner(db, C, [C])).toBeNull(); // terceiro
    expect(await visibleOwner(db, D, [D])).toBeNull(); // pendente
    expect(await visibleOwner(db, E, [E])).toBeNull(); // recusado
    await as(db, 'postgres');
    await q(db, `delete from public.family_members where owner_id = $1 and member_email = $2`, [A, EMAIL[B]]); // revogação
    expect(await visibleOwner(db, A, [A])).toBeNull();
    expect(await visibleOwner(db, B, [B])).toBeNull();
  });
});
