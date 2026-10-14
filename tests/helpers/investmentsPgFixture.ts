import { PGlite } from '@electric-sql/pglite';
import { readSqlFixture } from './sqlFixture';

/**
 * Fixture PGlite compartilhada pelos testes de investimentos (V2-B1A): schema real de `investments` (migrations
 * 014/015/020/052/053), `has_family_access` REAL (055), papéis `anon`/`authenticated`/`service_role` e os privilégios
 * padrão do Supabase. A policy "Family Access Investments" NÃO é criada aqui: ela vem da migration de reconciliação.
 */
export const MIGRATIONS = {
  reconcile: readSqlFixture('supabase/migrations/20261008115900_reconcile_investments_family_policy.sql'),
  b1a: readSqlFixture('supabase/migrations/20261008120000_investment_portfolios_holdings.sql'),
};
export const ROLLBACKS = {
  reconcile: readSqlFixture('supabase/rollbacks/20261008115900_reconcile_investments_family_policy_down.sql'),
  b1a: readSqlFixture('supabase/rollbacks/20261008120000_investment_portfolios_holdings_down.sql'),
};

const family = readSqlFixture('supabase/migrations/055_fix_family_bidirectional_access.sql');
export const HAS_FAMILY_ACCESS_SQL = family.slice(family.indexOf('create or replace function public.has_family_access'));
const investmentsMigrations = ['014_create_investments', '015_enrich_investments', '020_add_investment_source_file', '052_investments_application_date', '053_investments_gross_return']
  .map((f) => readSqlFixture(`supabase/migrations/${f}.sql`))
  .join('\n');

export const A = '11111111-1111-4111-8111-111111111111'; // proprietário
export const B = '22222222-2222-4222-8222-222222222222'; // familiar com vínculo aceito de A
export const C = '33333333-3333-4333-8333-333333333333'; // sem relação
export const D = '44444444-4444-4444-8444-444444444444'; // convite pendente de A
export const E = '55555555-5555-4555-8555-555555555555'; // convite recusado de A
export const EMAIL: Record<string, string> = { [A]: 'a@example.test', [B]: 'b@example.test', [C]: 'c@example.test', [D]: 'd@example.test', [E]: 'e@example.test' };

export const SNAP = 'a0000000-0000-4000-8000-000000000001';
export const SNAP2 = 'a0000000-0000-4000-8000-000000000002';
export const SNAP3 = 'a0000000-0000-4000-8000-000000000003';

export const BASE_SCHEMA = `
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
${HAS_FAMILY_ACCESS_SQL}
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
${investmentsMigrations}
grant select on public.family_members to authenticated; -- fixture: mutações de policy podem consultar o vínculo
grant all on public.investments to anon, authenticated, service_role;
insert into public.investments (id, user_id, institution, product_type, balance, reference_month, product_name, source_file) values
  ('${SNAP}', '${A}', 'XP', 'Renda Fixa', 1000.10, '2026-08-01', 'CDB X', 'ago.xlsx'),
  ('${SNAP2}', '${A}', 'XP', 'Renda Fixa', 1100.20, '2026-09-01', 'CDB X', 'set.xlsx'),
  ('${SNAP3}', '${A}', 'XP', 'Ações', 50, '2026-09-01', 'PETR4', 'set.xlsx'),
  ('b0000000-0000-4000-8000-000000000001', '${B}', 'Inter', 'Renda Fixa', 77, '2026-09-01', 'LCI', null);
`;

const databases: PGlite[] = [];
export const closeDatabases = async () => {
  await Promise.all(databases.splice(0).map((d) => d.close()));
};

/** `reconcile`/`b1a` controlam quais migrations são aplicadas (na ordem real de instalação). */
export const createDatabase = async (opts: { reconcile?: boolean; b1a?: boolean } = {}): Promise<PGlite> => {
  const { reconcile = true, b1a = true } = opts;
  const db = new PGlite();
  databases.push(db);
  await db.waitReady;
  await db.exec(BASE_SCHEMA);
  if (reconcile) await db.exec(MIGRATIONS.reconcile);
  if (b1a) await db.exec(MIGRATIONS.b1a);
  return db;
};

export const as = async (db: PGlite, role: 'anon' | 'authenticated' | 'postgres', userId = '') => {
  await db.exec('reset role;');
  if (role !== 'postgres') await db.exec(`set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query("select set_config('request.jwt.claims', $1, false)", [userId ? JSON.stringify({ sub: userId, email: EMAIL[userId], role: 'authenticated' }) : '']);
};

export const q = async <T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

export const newPortfolio = async (db: PGlite, owner: string, name: string) =>
  (await q<{ id: string }>(db, 'insert into public.investment_portfolios (user_id, name) values ($1,$2) returning id', [owner, name]))[0].id;
export const newHolding = async (db: PGlite, owner: string, portfolio: string, name = 'CDB Alfa') =>
  (await q<{ id: string }>(db, 'insert into public.investment_holdings (user_id, portfolio_id, display_name) values ($1,$2,$3) returning id', [owner, portfolio, name]))[0].id;

/** Estado de segurança das policies, para provar que uma migration não alterou nenhuma delas. */
export const policySnapshot = async (db: PGlite, table = 'investments') => {
  await as(db, 'postgres');
  return (
    await q<{ p: string | null }>(
      db,
      `select string_agg(polname || '|' || polcmd::text || '|' || polpermissive::text || '|' || polroles::text || '|' || coalesce(pg_get_expr(polqual, polrelid),'') || '|' || coalesce(pg_get_expr(polwithcheck, polrelid),''), ';' order by polname) p
         from pg_policy where polrelid = ('public.' || $1)::regclass`,
      [table]
    )
  )[0].p;
};
