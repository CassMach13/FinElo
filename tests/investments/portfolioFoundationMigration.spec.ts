import { afterEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readSqlFixture } from '../helpers/sqlFixture';

/**
 * Investimentos V2-B1A num PostgreSQL descartável (PGlite): carteiras, holdings, FKs compostas, administração
 * familiar com a `has_family_access` REAL (055), proprietário × operador, privilégios e rollback.
 * O schema legado usa as migrations reais de `investments` + a policy "Family Access Investments", que existe no banco
 * (staging/produção, confirmada na auditoria) mas NÃO está no repositório: é espelhada aqui explicitamente.
 */
// Cada teste sobe um PostgreSQL (PGlite) e aplica o schema real; sob carga isso passa do limite padrão de 5s.
vi.setConfig({ testTimeout: 120_000 });

const migration = readSqlFixture('supabase/migrations/20261008120000_investment_portfolios_holdings.sql');
const rollback = readSqlFixture('supabase/rollbacks/20261008120000_investment_portfolios_holdings_down.sql');
const family = readSqlFixture('supabase/migrations/055_fix_family_bidirectional_access.sql');
const hasFamilyAccessSql = family.slice(family.indexOf('create or replace function public.has_family_access'));
const investmentsMigrations = ['014_create_investments', '015_enrich_investments', '020_add_investment_source_file', '052_investments_application_date', '053_investments_gross_return']
  .map((f) => readSqlFixture(`supabase/migrations/${f}.sql`))
  .join('\n');

const A = '11111111-1111-4111-8111-111111111111'; // proprietário
const B = '22222222-2222-4222-8222-222222222222'; // familiar com vínculo aceito de A
const C = '33333333-3333-4333-8333-333333333333'; // sem relação
const D = '44444444-4444-4444-8444-444444444444'; // convite pendente de A
const E = '55555555-5555-4555-8555-555555555555'; // convite recusado de A
const EMAIL: Record<string, string> = { [A]: 'a@example.test', [B]: 'b@example.test', [C]: 'c@example.test', [D]: 'd@example.test', [E]: 'e@example.test' };

const baseSchema = `
create schema auth;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table auth.users (id uuid primary key, email text not null);
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
${Object.entries(EMAIL).map(([id, e]) => `insert into auth.users (id, email) values ('${id}', '${e}');`).join('\n')}
create table public.family_members (id uuid default gen_random_uuid() primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  owner_email text, member_email text not null, status text, created_at timestamptz default now());
insert into public.family_members (owner_id, owner_email, member_email, status) values
  ('${A}', '${EMAIL[A]}', '${EMAIL[B]}', 'accepted'),
  ('${A}', '${EMAIL[A]}', '${EMAIL[D]}', 'pending'),
  ('${A}', '${EMAIL[A]}', '${EMAIL[E]}', 'declined');
${hasFamilyAccessSql}
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
${investmentsMigrations}
grant select on public.family_members to authenticated; -- fixture: permite que mutações de policy consultem o vínculo (o contrato real passa por has_family_access)
grant all on public.investments to anon, authenticated, service_role;
create policy "Family Access Investments" on public.investments for all to public using (has_family_access(user_id)) with check (has_family_access(user_id));
insert into public.investments (id, user_id, institution, product_type, balance, reference_month, product_name, source_file) values
  ('a0000000-0000-4000-8000-000000000001', '${A}', 'XP', 'Renda Fixa', 1000.10, '2026-08-01', 'CDB X', 'ago.xlsx'),
  ('a0000000-0000-4000-8000-000000000002', '${A}', 'XP', 'Renda Fixa', 1100.20, '2026-09-01', 'CDB X', 'set.xlsx'),
  ('a0000000-0000-4000-8000-000000000003', '${A}', 'XP', 'Ações', 50, '2026-09-01', 'PETR4', 'set.xlsx'),
  ('b0000000-0000-4000-8000-000000000001', '${B}', 'Inter', 'Renda Fixa', 77, '2026-09-01', 'LCI', null);
`;

const databases: PGlite[] = [];
const createDatabase = async (apply = true): Promise<PGlite> => {
  const db = new PGlite();
  databases.push(db);
  await db.waitReady;
  await db.exec(baseSchema);
  if (apply) await db.exec(migration);
  return db;
};
const as = async (db: PGlite, role: 'anon' | 'authenticated' | 'postgres', userId = '') => {
  await db.exec('reset role;');
  if (role !== 'postgres') await db.exec(`set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query("select set_config('request.jwt.claims', $1, false)", [userId ? JSON.stringify({ sub: userId, email: EMAIL[userId], role: 'authenticated' }) : '']);
};
const q = async <T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const newPortfolio = async (db: PGlite, owner: string, name: string) =>
  (await q<{ id: string }>(db, 'insert into public.investment_portfolios (user_id, name) values ($1,$2) returning id', [owner, name]))[0].id;
const newHolding = async (db: PGlite, owner: string, portfolio: string, name = 'CDB Alfa') =>
  (await q<{ id: string }>(db, 'insert into public.investment_holdings (user_id, portfolio_id, display_name) values ($1,$2,$3) returning id', [owner, portfolio, name]))[0].id;
const SNAP = 'a0000000-0000-4000-8000-000000000001';
const SNAP2 = 'a0000000-0000-4000-8000-000000000002';
const SNAP3 = 'a0000000-0000-4000-8000-000000000003';
const legacyHash = async (db: PGlite) => {
  await as(db, 'postgres');
  return (
    await q<{ h: string }>(
      db,
      "select md5(string_agg((to_jsonb(i) - 'portfolio_id' - 'holding_id')::text, '|' order by id)) h from public.investments i"
    )
  )[0].h;
};
const privs = async (db: PGlite, table: string, grantee: string) => {
  await as(db, 'postgres');
  return (await q<{ p: string }>(db, "select privilege_type p from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee=$2 order by 1", [table, grantee])).map((r) => r.p);
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map((d) => d.close()));
});

describe('estrutura e compatibilidade', () => {
  it('cria as tabelas e as colunas opcionais; migration reaplicável', async () => {
    const db = await createDatabase();
    await expect(db.exec(migration)).resolves.not.toThrow();
    const cols = await q<{ column_name: string; is_nullable: string }>(db, "select column_name, is_nullable from information_schema.columns where table_schema='public' and table_name='investments' and column_name in ('portfolio_id','holding_id')");
    expect(cols.map((c) => c.is_nullable)).toEqual(['YES', 'YES']);
    const portfolios = await q<{ column_name: string }>(db, "select column_name from information_schema.columns where table_schema='public' and table_name='investment_portfolios' order by ordinal_position");
    expect(portfolios.map((c) => c.column_name)).toEqual(['id', 'user_id', 'name', 'archived_at', 'created_by', 'created_at', 'updated_by', 'updated_at']);
    const holdings = await q<{ column_name: string }>(db, "select column_name from information_schema.columns where table_schema='public' and table_name='investment_holdings' order by ordinal_position");
    expect(holdings.map((c) => c.column_name)).toEqual(['id', 'user_id', 'portfolio_id', 'display_name', 'institution_ref', 'product_type_ref', 'created_by', 'created_at', 'updated_by', 'updated_at']);
  });

  it('nenhuma linha legada é alterada e todas ficam sem carteira e sem holding', async () => {
    const db = await createDatabase(false);
    const before = await legacyHash(db);
    await db.exec(migration);
    expect(await legacyHash(db)).toBe(before);
    const n = await q<{ n: string }>(db, 'select count(*)::text n from public.investments where portfolio_id is null and holding_id is null');
    expect(n[0].n).toBe('4');
    expect((await q<{ n: string }>(db, 'select count(*)::text n from public.investment_portfolios'))[0].n).toBe('0');
    expect((await q<{ n: string }>(db, 'select count(*)::text n from public.investment_holdings'))[0].n).toBe('0');
    await db.exec(migration);
    expect(await legacyHash(db)).toBe(before);
  });

  it('carteira vazia, holding sem snapshot e snapshots sem carteira são estados válidos', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p = await newPortfolio(db, A, 'Vazia');
    const h = await newHolding(db, A, p);
    expect(h).toBeTruthy();
    expect((await q<{ n: string }>(db, 'select count(*)::text n from public.investments where portfolio_id is null and user_id = $1', [A]))[0].n).toBe('3');
  });

  it('CRUD legítimo de snapshots continua funcionando após o hardening (dono e familiar)', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    await q(db, "insert into public.investments (user_id, institution, product_type, balance, reference_month) values ($1,'XP','Renda Fixa',10,'2026-10-01')", [A]);
    await q(db, "update public.investments set balance = 11 where id = $1", [SNAP]);
    expect((await q<{ balance: string }>(db, 'select balance from public.investments where id = $1', [SNAP]))[0].balance).toBe('11');
    await as(db, 'authenticated', B);
    await q(db, "insert into public.investments (user_id, institution, product_type, balance, reference_month) values ($1,'XP','Renda Fixa',5,'2026-10-01')", [A]);
    const del = await q(db, "delete from public.investments where user_id = $1 and balance = 5 returning id", [A]);
    expect(del).toHaveLength(1);
    await as(db, 'authenticated', C);
    expect(await q(db, 'select id from public.investments')).toHaveLength(0);
    await expect(q(db, "insert into public.investments (user_id, institution, product_type, balance, reference_month) values ($1,'XP','Renda Fixa',5,'2026-10-01')", [A])).rejects.toThrow(/row-level security/i);
  });
});

describe('integridade (constraints do PostgreSQL)', () => {
  it('snapshot só aponta para carteira do mesmo proprietário (mesmo para quem tem acesso aos dois)', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    const pB = await newPortfolio(db, B, 'Minha');
    const pA = await newPortfolio(db, A, 'Do titular');
    await q(db, 'update public.investments set portfolio_id = $1 where id = $2', [pA, SNAP]); // A é dono dos dois: ok
    await expect(q(db, 'update public.investments set portfolio_id = $1 where id = $2', [pB, SNAP2])).rejects.toThrow(/investments_portfolio_owner_fkey/);
    await as(db, 'postgres');
    await expect(q(db, 'update public.investments set portfolio_id = $1 where id = $2', [pB, SNAP2])).rejects.toThrow(/investments_portfolio_owner_fkey/);
  });

  it('holding só pertence a carteira do mesmo proprietário', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    const pB = await newPortfolio(db, B, 'Minha');
    await expect(q(db, 'insert into public.investment_holdings (user_id, portfolio_id, display_name) values ($1,$2,$3)', [A, pB, 'x'])).rejects.toThrow(/investment_holdings_portfolio_owner_fkey/);
    const pA = await newPortfolio(db, A, 'Do titular');
    const h = await newHolding(db, A, pA);
    await expect(q(db, 'update public.investment_holdings set portfolio_id = $1 where id = $2', [pB, h])).rejects.toThrow(/investment_holdings_portfolio_owner_fkey/);
  });

  it('holding_id exige portfolio_id e a carteira do snapshot tem de ser a da holding', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p1 = await newPortfolio(db, A, 'P1');
    const p2 = await newPortfolio(db, A, 'P2');
    const h = await newHolding(db, A, p1);
    await expect(q(db, 'update public.investments set holding_id = $1 where id = $2', [h, SNAP])).rejects.toThrow(/investments_holding_requires_portfolio_check/);
    await expect(q(db, 'update public.investments set holding_id = $1, portfolio_id = $2 where id = $3', [h, p2, SNAP])).rejects.toThrow(/investments_holding_owner_portfolio_fkey/);
    await q(db, 'update public.investments set holding_id = $1, portfolio_id = $2 where id = $3', [h, p1, SNAP]);
    expect((await q<{ holding_id: string }>(db, 'select holding_id from public.investments where id = $1', [SNAP]))[0].holding_id).toBe(h);
  });

  it('uma posição por holding por mês; meses diferentes podem compartilhar a holding', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p = await newPortfolio(db, A, 'P');
    const h = await newHolding(db, A, p);
    await q(db, 'update public.investments set holding_id = $1, portfolio_id = $2 where id = $3', [h, p, SNAP]);
    await q(db, 'update public.investments set holding_id = $1, portfolio_id = $2 where id = $3', [h, p, SNAP2]); // mês diferente
    await expect(q(db, 'update public.investments set holding_id = $1, portfolio_id = $2 where id = $3', [h, p, SNAP3])).rejects.toThrow(/investments_holding_month_key/);
  });

  it('apagar a holding só desvincula (o snapshot e a carteira permanecem)', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p = await newPortfolio(db, A, 'P');
    const h = await newHolding(db, A, p);
    await q(db, 'update public.investments set holding_id = $1, portfolio_id = $2 where id = $3', [h, p, SNAP]);
    await q(db, 'delete from public.investment_holdings where id = $1', [h]);
    const row = (await q<{ holding_id: string | null; portfolio_id: string | null; balance: string }>(db, 'select holding_id, portfolio_id, balance from public.investments where id = $1', [SNAP]))[0];
    expect(row.holding_id).toBeNull();
    expect(row.portfolio_id).toBe(p);
    expect(row.balance).toBe('1000.10');
  });

  it('apagar snapshot não apaga a holding', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p = await newPortfolio(db, A, 'P');
    const h = await newHolding(db, A, p);
    await q(db, 'update public.investments set holding_id = $1, portfolio_id = $2 where id = $3', [h, p, SNAP]);
    await q(db, 'delete from public.investments where id = $1', [SNAP]);
    expect(await q(db, 'select id from public.investment_holdings where id = $1', [h])).toHaveLength(1);
  });

  it('carteira com holdings ou snapshots não pode ser apagada; vazia pode', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const withHolding = await newPortfolio(db, A, 'Com holding');
    await newHolding(db, A, withHolding);
    await expect(q(db, 'delete from public.investment_portfolios where id = $1', [withHolding])).rejects.toThrow(/investment_holdings_portfolio_owner_fkey/);
    const withSnapshot = await newPortfolio(db, A, 'Com snapshot');
    await q(db, 'update public.investments set portfolio_id = $1 where id = $2', [withSnapshot, SNAP]);
    await expect(q(db, 'delete from public.investment_portfolios where id = $1', [withSnapshot])).rejects.toThrow(/investments_portfolio_owner_fkey/);
    const empty = await newPortfolio(db, A, 'Vazia');
    expect(await q(db, 'delete from public.investment_portfolios where id = $1 returning id', [empty])).toHaveLength(1);
  });

  it('mover a holding de carteira move seus snapshots (ON UPDATE CASCADE) dentro do mesmo proprietário', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p1 = await newPortfolio(db, A, 'P1');
    const p2 = await newPortfolio(db, A, 'P2');
    const h = await newHolding(db, A, p1);
    await q(db, 'update public.investments set holding_id = $1, portfolio_id = $2 where id = $3', [h, p1, SNAP]);
    await q(db, 'update public.investments set holding_id = $1, portfolio_id = $2 where id = $3', [h, p1, SNAP2]);
    await q(db, 'update public.investment_holdings set portfolio_id = $1 where id = $2', [p2, h]);
    const rows = await q<{ portfolio_id: string; holding_id: string }>(db, 'select portfolio_id, holding_id from public.investments where holding_id = $1', [h]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.portfolio_id === p2)).toBe(true);
  });
});

describe('nomes e arquivamento', () => {
  it('nome aparado, 1 a 80 caracteres, único entre as ativas sem diferenciar maiúsculas', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const id = await newPortfolio(db, A, '   Carteira Ione  ');
    expect((await q<{ name: string }>(db, 'select name from public.investment_portfolios where id = $1', [id]))[0].name).toBe('Carteira Ione');
    await expect(newPortfolio(db, A, 'carteira IONE')).rejects.toThrow(/investment_portfolios_active_name_key/);
    await expect(newPortfolio(db, A, '   ')).rejects.toThrow(/investment_portfolios_name_check/);
    await expect(newPortfolio(db, A, 'x'.repeat(81))).rejects.toThrow(/investment_portfolios_name_check/);
    expect(await newPortfolio(db, A, 'x'.repeat(80))).toBeTruthy();
    await as(db, 'authenticated', B);
    expect(await newPortfolio(db, B, 'Carteira Ione')).toBeTruthy(); // outro proprietário
  });

  it('arquivar não exclui, libera o nome e a data de arquivamento é do banco', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const id = await newPortfolio(db, A, 'Antiga');
    await q(db, "update public.investment_portfolios set archived_at = '2000-01-01' where id = $1", [id]);
    const row = (await q<{ archived_at: string; recent: boolean }>(db, "select archived_at, archived_at > now() - interval '1 minute' as recent from public.investment_portfolios where id = $1", [id]))[0];
    expect(row.recent).toBe(true);
    const stamp = row.archived_at;
    expect(await newPortfolio(db, A, 'antiga')).toBeTruthy();
    await q(db, "update public.investment_portfolios set name = 'Antiga 2' where id = $1", [id]);
    expect((await q<{ archived_at: string }>(db, 'select archived_at from public.investment_portfolios where id = $1', [id]))[0].archived_at).toEqual(stamp);
    await expect(q(db, 'update public.investment_portfolios set archived_at = null, name = $1 where id = $2', ['Antiga', id])).rejects.toThrow(/investment_portfolios_active_name_key/);
  });

  it('holding: nome aparado e referências vazias viram NULL', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p = await newPortfolio(db, A, 'P');
    const id = (await q<{ id: string }>(db, "insert into public.investment_holdings (user_id, portfolio_id, display_name, institution_ref, product_type_ref) values ($1,$2,'  CDB  ','   ','Renda Fixa ') returning id", [A, p]))[0].id;
    const row = (await q<{ display_name: string; institution_ref: string | null; product_type_ref: string | null }>(db, 'select display_name, institution_ref, product_type_ref from public.investment_holdings where id = $1', [id]))[0];
    expect(row).toEqual({ display_name: 'CDB', institution_ref: null, product_type_ref: 'Renda Fixa' });
    await expect(q(db, "insert into public.investment_holdings (user_id, portfolio_id, display_name) values ($1,$2,'')", [A, p])).rejects.toThrow(/investment_holdings_name_check/);
  });
});

describe('administração familiar: proprietário × operador', () => {
  it('A: o proprietário administra', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const id = await newPortfolio(db, A, 'Minha');
    const row = (await q<{ user_id: string; created_by: string; updated_by: string }>(db, 'select user_id, created_by, updated_by from public.investment_portfolios where id = $1', [id]))[0];
    expect(row).toEqual({ user_id: A, created_by: A, updated_by: A });
  });

  it('B: o familiar aceito cria em nome do proprietário; user_id continua A e o autor é B', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    const id = await newPortfolio(db, A, 'Da família');
    const holding = await newHolding(db, A, id, 'CDB do titular');
    const p = (await q<{ user_id: string; created_by: string; updated_by: string }>(db, 'select user_id, created_by, updated_by from public.investment_portfolios where id = $1', [id]))[0];
    expect(p).toEqual({ user_id: A, created_by: B, updated_by: B });
    await as(db, 'authenticated', A);
    expect((await q(db, 'select id from public.investment_portfolios where id = $1', [id]))).toHaveLength(1);
    expect((await q(db, 'select id from public.investment_holdings where id = $1', [holding]))).toHaveLength(1);
    await q(db, "update public.investment_portfolios set name = 'Renomeada pelo dono' where id = $1", [id]);
    const after = (await q<{ created_by: string; updated_by: string }>(db, 'select created_by, updated_by from public.investment_portfolios where id = $1', [id]))[0];
    expect(after).toEqual({ created_by: B, updated_by: A }); // autoria preservada; último operador atualizado
    await as(db, 'authenticated', B);
    await q(db, "update public.investment_portfolios set name = 'Renomeada por B' where id = $1", [id]);
    expect((await q<{ updated_by: string }>(db, 'select updated_by from public.investment_portfolios where id = $1', [id]))[0].updated_by).toBe(B);
    await q(db, 'delete from public.investment_holdings where id = $1', [holding]);
    expect(await q(db, 'delete from public.investment_portfolios where id = $1 returning id', [id])).toHaveLength(1);
  });

  it('C e D e E e F: pendente, recusado e sem vínculo não leem nem escrevem', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const id = await newPortfolio(db, A, 'Privada');
    const h = await newHolding(db, A, id);
    for (const stranger of [C, D, E]) {
      await as(db, 'authenticated', stranger);
      expect(await q(db, 'select id from public.investment_portfolios')).toHaveLength(0);
      expect(await q(db, 'select id from public.investment_holdings')).toHaveLength(0);
      await expect(newPortfolio(db, A, 'invasão')).rejects.toThrow(/row-level security/i);
      await expect(newHolding(db, A, id)).rejects.toThrow(/row-level security/i);
      expect(await q(db, "update public.investment_portfolios set name = 'x' where id = $1 returning id", [id])).toHaveLength(0);
      expect(await q(db, 'delete from public.investment_holdings where id = $1 returning id', [h])).toHaveLength(0);
      // classificar snapshot de A também é bloqueado
      expect(await q(db, 'update public.investments set portfolio_id = $1 where id = $2 returning id', [id, SNAP])).toHaveLength(0);
    }
    await as(db, 'postgres');
    expect((await q<{ name: string }>(db, 'select name from public.investment_portfolios where id = $1', [id]))[0].name).toBe('Privada');
  });

  it('E: a revogação do vínculo remove o acesso imediatamente (inclusive ao que o familiar criou)', async () => {
    for (const revoke of ["delete from public.family_members where member_email = 'b@example.test'", "update public.family_members set status = 'declined' where member_email = 'b@example.test'"]) {
      const db = await createDatabase();
      await as(db, 'authenticated', B);
      const id = await newPortfolio(db, A, 'Criada pelo familiar');
      expect(await q(db, 'select id from public.investment_portfolios where id = $1', [id])).toHaveLength(1);
      await as(db, 'postgres');
      await db.exec(revoke);
      await as(db, 'authenticated', B);
      expect(await q(db, 'select id from public.investment_portfolios where id = $1', [id])).toHaveLength(0);
      await expect(newPortfolio(db, A, 'depois')).rejects.toThrow(/row-level security/i);
      expect(await q(db, "update public.investment_portfolios set name = 'x' where id = $1 returning id", [id])).toHaveLength(0);
      await as(db, 'authenticated', A);
      expect(await q(db, 'select id from public.investment_portfolios where id = $1', [id])).toHaveLength(1); // o dono segue com tudo
    }
  });

  it('J: trocar de sessão não reaproveita a autorização de outro usuário', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    const id = await newPortfolio(db, A, 'Compartilhada');
    expect(await q(db, 'select id from public.investment_portfolios')).toHaveLength(1);
    await as(db, 'authenticated', C); // mesma conexão, outro usuário
    expect(await q(db, 'select id from public.investment_portfolios')).toHaveLength(0);
    await as(db, 'authenticated', '');
    expect(await q(db, 'select id from public.investment_portfolios where id = $1', [id])).toHaveLength(0);
  });

  it('G: nem o familiar nem o dono transferem a propriedade (user_id imutável) — carteira, holding e snapshot', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    const p = await newPortfolio(db, A, 'P');
    const h = await newHolding(db, A, p);
    await expect(q(db, 'update public.investment_portfolios set user_id = $1 where id = $2', [B, p])).rejects.toThrow(/imutáveis/);
    await expect(q(db, 'update public.investment_holdings set user_id = $1 where id = $2', [B, h])).rejects.toThrow(/imutáveis/);
    await expect(q(db, 'update public.investments set user_id = $1 where id = $2', [B, SNAP])).rejects.toThrow(/imutável/);
    await as(db, 'authenticated', A);
    await expect(q(db, 'update public.investments set user_id = $1 where id = $2', [B, SNAP])).rejects.toThrow(/imutável/);
    await as(db, 'postgres');
    await expect(q(db, 'update public.investments set user_id = $1 where id = $2', [B, SNAP])).rejects.toThrow(/imutável/);
    // atualizar com o mesmo valor (ex.: cliente que reenvia a linha) continua permitido
    await as(db, 'authenticated', A);
    await expect(q(db, 'update public.investments set user_id = user_id, balance = 1 where id = $1', [SNAP])).resolves.toBeDefined();
  });

  it('I: o operador não forja created_by nem altera id, created_by e created_at', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    await expect(q(db, 'insert into public.investment_portfolios (user_id, name, created_by) values ($1,$2,$3)', [A, 'forjada', A])).rejects.toThrow(/created_by|row-level/i);
    const p = await newPortfolio(db, A, 'P');
    await expect(q(db, 'update public.investment_portfolios set created_by = $1 where id = $2', [A, p])).rejects.toThrow(/imutáveis/);
    await expect(q(db, "update public.investment_portfolios set created_at = '2000-01-01' where id = $1", [p])).rejects.toThrow(/imutáveis/);
    await expect(q(db, 'update public.investment_portfolios set id = gen_random_uuid() where id = $1', [p])).rejects.toThrow(/imutáveis/);
    await expect(q(db, 'insert into public.investment_holdings (user_id, portfolio_id, display_name, created_by) values ($1,$2,$3,$4)', [A, p, 'h', A])).rejects.toThrow(/created_by|row-level/i);
    // defesa em profundidade: o trigger recusa a forja mesmo sem a RLS (papel dono da tabela, mas com a sessão de B)
    await as(db, 'postgres', B);
    await expect(q(db, 'insert into public.investment_portfolios (user_id, name, created_by) values ($1,$2,$3)', [A, 'forjada2', A])).rejects.toThrow(/created_by deve ser o operador/);
    await expect(q(db, 'insert into public.investment_holdings (user_id, portfolio_id, display_name, created_by) values ($1,$2,$3,$4)', [A, p, 'h2', A])).rejects.toThrow(/created_by deve ser o operador/);
    await as(db, 'authenticated', B);
    // updated_by não é escolhido pelo cliente
    await q(db, 'update public.investment_portfolios set name = $1, updated_by = $2 where id = $3', ['Nova', A, p]);
    expect((await q<{ updated_by: string }>(db, 'select updated_by from public.investment_portfolios where id = $1', [p]))[0].updated_by).toBe(B);
  });

  it('familiar autorizado classifica o snapshot do proprietário; terceiro não; e a carteira usada é do proprietário', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    const p = await newPortfolio(db, A, 'P');
    expect(await q(db, 'update public.investments set portfolio_id = $1 where id = $2 returning id', [p, SNAP])).toHaveLength(1);
    expect(await q(db, 'update public.investments set portfolio_id = null where id = $1 returning id', [SNAP])).toHaveLength(1); // desfazer
  });

  it('o vínculo é bidirecional como no contrato vigente de has_family_access (documentado)', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    const idB = await newPortfolio(db, B, 'Do convidado');
    await as(db, 'authenticated', A);
    expect(await q(db, 'select id from public.investment_portfolios where id = $1', [idB])).toHaveLength(1);
  });
});

describe('privilégios', () => {
  it('anon não tem nenhum privilégio nas tabelas novas nem em investments', async () => {
    const db = await createDatabase();
    for (const t of ['investment_portfolios', 'investment_holdings', 'investments']) expect(await privs(db, t, 'anon')).toEqual([]);
    await as(db, 'anon');
    await expect(q(db, 'select * from public.investment_portfolios')).rejects.toThrow(/permission denied/);
    await expect(q(db, 'select * from public.investments')).rejects.toThrow(/permission denied/);
  });

  it('authenticated: só CRUD; sem TRUNCATE, TRIGGER nem REFERENCES', async () => {
    const db = await createDatabase();
    for (const t of ['investment_portfolios', 'investment_holdings', 'investments']) {
      expect(await privs(db, t, 'authenticated')).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
    }
    await as(db, 'authenticated', A);
    await expect(db.exec('truncate public.investments')).rejects.toThrow(/permission denied/);
    await expect(db.exec('truncate public.investment_portfolios')).rejects.toThrow(/permission denied/);
  });

  it('service_role e papéis administrativos não são tocados', async () => {
    const db = await createDatabase(false);
    const before = await privs(db, 'investments', 'service_role');
    await db.exec(migration);
    expect(await privs(db, 'investments', 'service_role')).toEqual(before);
    expect(await privs(db, 'investments', 'postgres').then((p) => p.length)).toBeGreaterThan(0);
  });

  it('as policies existentes de investments não foram alteradas', async () => {
    const db = await createDatabase(false);
    const snapshot = async () => (await q<{ p: string }>(db, "select string_agg(policyname||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''), ';' order by policyname) p from pg_policies where tablename='investments'"))[0].p;
    const before = await snapshot();
    await db.exec(migration);
    expect(await snapshot()).toBe(before);
    expect(before).toContain('Family Access Investments');
  });
});

describe('rollback', () => {
  it('remove só o que a fase criou, preserva snapshots e mantém o hardening de privilégios', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const p = await newPortfolio(db, A, 'P');
    await q(db, 'update public.investments set portfolio_id = $1 where id = $2', [p, SNAP]);
    await as(db, 'postgres');
    const hashWith = await legacyHash(db);
    await db.exec(rollback);
    expect(await legacyHash(db)).toBe(hashWith);
    const cols = await q(db, "select 1 from information_schema.columns where table_name='investments' and column_name in ('portfolio_id','holding_id')");
    expect(cols).toHaveLength(0);
    expect(await q(db, "select to_regclass('public.investment_portfolios') r")).toEqual([{ r: null }]);
    expect(await q(db, "select to_regclass('public.investment_holdings') r")).toEqual([{ r: null }]);
    expect(await privs(db, 'investments', 'anon')).toEqual([]);
    expect(await privs(db, 'investments', 'authenticated')).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
    await expect(db.exec(rollback)).resolves.not.toThrow();
    await expect(db.exec(migration)).resolves.not.toThrow();
  });
});

describe('contrato textual da migration', () => {
  const code = migration.replace(/^\s*--.*$/gm, '');

  it('não redefine has_family_access nem altera a policy familiar existente, e não usa SECURITY DEFINER', () => {
    expect(code).not.toMatch(/FUNCTION public\.has_family_access/i);
    expect(code).not.toMatch(/Family Access Investments/);
    expect(code).not.toMatch(/SECURITY DEFINER/i);
    expect(code).not.toMatch(/(CREATE|DROP|ALTER) POLICY[^;]*ON public\.investments\b/i);
  });

  it('não tem bypass por ausência de JWT como autorização e não toca dados existentes', () => {
    expect(code).not.toMatch(/auth\.uid\(\) IS NULL/i);
    expect(code).not.toMatch(/\b(UPDATE|DELETE FROM|INSERT INTO)\s+public\.investments\b/i);
    expect(code).not.toMatch(/INSERT INTO public\.investment_(portfolios|holdings)/i);
  });

  it('toda autorização usa has_family_access e as tabelas novas são só para authenticated', () => {
    const policies = code.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
    expect(policies).toHaveLength(8);
    for (const p of policies) {
      expect(p).toMatch(/TO authenticated/);
      expect(p).toMatch(/public\.has_family_access\(user_id\)/);
    }
    expect(code).toMatch(/REVOKE ALL ON public\.investment_portfolios FROM PUBLIC, anon, authenticated/);
    expect(code).toMatch(/REVOKE ALL ON public\.investment_holdings FROM PUBLIC, anon, authenticated/);
  });
});
