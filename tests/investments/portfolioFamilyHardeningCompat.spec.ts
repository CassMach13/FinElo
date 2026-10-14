import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it } from 'vitest';
import { readSqlFixture } from '../helpers/sqlFixture';

/**
 * V2-B1A × endurecimento de `family_members` (20261012180000) e saída do membro (20261012180100).
 *
 * As tabelas de carteiras/holdings e a classificação de snapshots autorizam pelo `has_family_access`, que confia nas
 * linhas `accepted` de `family_members`. A fixture original da B1A usa um `family_members` simplificado (sem RLS);
 * aqui o schema, as policies e os triggers são os reais, e os vínculos nascem pelo fluxo do usuário.
 */
const RECONCILE = readSqlFixture('supabase/migrations/20261008115900_reconcile_investments_family_policy.sql');
const B1A = readSqlFixture('supabase/migrations/20261008120000_investment_portfolios_holdings.sql');
const B1A_DOWN = readSqlFixture('supabase/rollbacks/20261008120000_investment_portfolios_holdings_down.sql');
const HARDENING = readSqlFixture('supabase/migrations/20261012180000_family_members_authorization_hardening.sql');
const LEAVE = readSqlFixture('supabase/migrations/20261012180100_family_members_member_can_leave.sql');
const family055 = readSqlFixture('supabase/migrations/055_fix_family_bidirectional_access.sql');
const HAS_FAMILY_ACCESS_SQL = family055.slice(family055.indexOf('create or replace function public.has_family_access'));
const investmentsMigrations = ['014_create_investments', '015_enrich_investments', '020_add_investment_source_file', '052_investments_application_date', '053_investments_gross_return']
  .map((f) => readSqlFixture(`supabase/migrations/${f}.sql`))
  .join('\n');

const A = '11111111-1111-4111-8111-111111111111'; // proprietário
const B = '22222222-2222-4222-8222-222222222222'; // familiar convidado por A
const C = '33333333-3333-4333-8333-333333333333'; // sem relação
const EMAIL: Record<string, string> = { [A]: 'a@example.test', [B]: 'b@example.test', [C]: 'c@example.test' };
const SNAP_A = 'a0000000-0000-4000-8000-000000000001';

// Estado dos ambientes reais antes de qualquer uma das migrations: family_members com as policies originais e a
// policy familiar de investments já existente (fora das migrations).
const BASE = `
create schema auth;
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table auth.users (id uuid primary key, email text not null);
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
${Object.entries(EMAIL).map(([id, e]) => `insert into auth.users (id, email) values ('${id}', '${e}');`).join('\n')}
create table public.family_members (
  id uuid not null default gen_random_uuid() primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  member_email text not null, owner_email text, status text default 'pending', created_at timestamptz default now(),
  constraint family_members_owner_id_member_email_key unique (owner_id, member_email),
  constraint family_members_status_check check (status = any (array['pending','accepted','declined'])),
  constraint member_not_owner check (member_email <> owner_email));
create function public.normalize_family_emails() returns trigger language plpgsql as $$
begin new.member_email := lower(trim(new.member_email)); new.owner_email := lower(trim(new.owner_email)); return new; end; $$;
create trigger tr_normalize_family_emails before insert or update on public.family_members
  for each row execute function public.normalize_family_emails();
alter table public.family_members enable row level security;
create policy "Dono adiciona membros" on public.family_members for insert with check (auth.uid() = owner_id);
create policy "Dono remove membros" on public.family_members for delete using (auth.uid() = owner_id);
create policy "Dono vê seus membros" on public.family_members for select using (auth.uid() = owner_id);
create policy "Membro responde ao convite" on public.family_members for update using (member_email = (auth.jwt() ->> 'email'));
create policy "Membro vê se foi adicionado" on public.family_members for select using (member_email = (auth.jwt() ->> 'email'));
grant usage on schema public to anon, authenticated, service_role;
grant all on public.family_members to anon, authenticated, service_role;
${HAS_FAMILY_ACCESS_SQL}
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
${investmentsMigrations}
grant all on public.investments to anon, authenticated, service_role;
create policy "Family Access Investments" on public.investments for all
  using (public.has_family_access(user_id)) with check (public.has_family_access(user_id));
insert into public.investments (id, user_id, institution, product_type, balance, reference_month, product_name, source_file)
  values ('${SNAP_A}', '${A}', 'XP', 'Renda Fixa', 1000.10, '2026-08-01', 'CDB X', 'ago.xlsx');
`;

const PRODUCTION_ORDER = [HARDENING, LEAVE, RECONCILE, B1A]; // produção: hotfix já aplicado, B1A depois
const STAGING_ORDER = [RECONCILE, B1A, HARDENING, LEAVE]; // staging: B1A em 08/10, hotfix em 12–13/10

const dbs: PGlite[] = [];
async function build(sqls: string[]) {
  const db = new PGlite();
  dbs.push(db);
  await db.waitReady;
  await db.exec(BASE);
  for (const s of sqls) await db.exec(s);
  return db;
}
afterAll(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.close()));
});

type Role = 'anon' | 'authenticated' | 'postgres';
async function as(db: PGlite, role: Role, userId = '') {
  await db.exec('reset role;');
  if (role !== 'postgres') await db.exec(`set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    userId ? JSON.stringify({ sub: userId, email: EMAIL[userId], role: 'authenticated' }) : '',
  ]);
}
async function attempt(db: PGlite, userId: string, sql: string, params: unknown[] = []) {
  await as(db, 'authenticated', userId);
  try {
    return { ok: true as const, rows: (await db.query<Record<string, unknown>>(sql, params)).rows, code: null as string | null };
  } catch (e) {
    return { ok: false as const, rows: [] as Record<string, unknown>[], code: (e as { code?: string }).code ?? 'ERR' };
  }
}
const INVITE = `insert into public.family_members (owner_id, owner_email, member_email, status) values ($1,$2,$3,$4) returning id`;
const NEW_PORTFOLIO = `insert into public.investment_portfolios (user_id, name) values ($1,$2) returning id, user_id, created_by`;
const portfoliosOf = async (db: PGlite, viewer: string, owner: string) =>
  (await attempt(db, viewer, 'select id from public.investment_portfolios where user_id = $1', [owner])).rows.length;

/** Catálogo de segurança das tabelas envolvidas, para comparar ordens de aplicação. */
async function securityCatalog(db: PGlite) {
  await as(db, 'postgres');
  const one = async (sql: string) => (await db.query<{ v: string | null }>(sql)).rows[0].v;
  return {
    policies: await one(`select string_agg(c.relname || '|' || p.polname || '|' || p.polcmd::text || '|' || p.polpermissive::text || '|' || p.polroles::regrole[]::text || '|' || coalesce(pg_get_expr(p.polqual, p.polrelid),'') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid),''), ';' order by c.relname, p.polname) v
                          from pg_policy p join pg_class c on c.oid = p.polrelid
                         where c.relname in ('family_members','investments','investment_portfolios','investment_holdings')`),
    triggers: await one(`select string_agg(c.relname || '|' || t.tgname || '|' || t.tgenabled::text, ';' order by c.relname, t.tgname) v
                          from pg_trigger t join pg_class c on c.oid = t.tgrelid
                         where not t.tgisinternal and c.relname in ('family_members','investments','investment_portfolios','investment_holdings')`),
    grants: await one(`select string_agg(table_name || '|' || grantee || '|' || privilege_type, ';' order by table_name, grantee, privilege_type) v
                         from information_schema.role_table_grants
                        where table_schema = 'public' and grantee in ('anon','authenticated','PUBLIC')
                          and table_name in ('family_members','investments','investment_portfolios','investment_holdings')`),
    hasFamilyAccess: await one(`select md5(pg_get_functiondef('public.has_family_access(uuid)'::regprocedure)) v`),
  };
}

describe('B1A e o endurecimento familiar convivem, em qualquer ordem de aplicação', () => {
  it('ordem de produção e ordem de staging chegam ao MESMO catálogo de segurança', async () => {
    const production = await securityCatalog(await build(PRODUCTION_ORDER));
    const staging = await securityCatalog(await build(STAGING_ORDER));
    expect(production).toEqual(staging);
    expect(production.policies).toContain('family_members|Membro sai do vínculo|d');
    expect(production.policies).toContain('investment_portfolios|investment_portfolios_select|r');
    expect(production.triggers).toContain('family_members|trg_family_members_revoke_mirror|O');
    expect(production.triggers).toContain('investments|trg_investments_user_id_immutable|O');
  }, 240_000);

  it('a B1A não altera family_members nem has_family_access; o hotfix não altera as tabelas da B1A', async () => {
    const hotfixOnly = await securityCatalog(await build([HARDENING, LEAVE]));
    const withB1a = await securityCatalog(await build(PRODUCTION_ORDER));
    const family = (c: { policies: string | null; triggers: string | null; grants: string | null }) => ({
      policies: (c.policies ?? '').split(';').filter((p) => p.startsWith('family_members|')),
      triggers: (c.triggers ?? '').split(';').filter((t) => t.startsWith('family_members|')),
      grants: (c.grants ?? '').split(';').filter((g) => g.startsWith('family_members|')),
    });
    expect(family(withB1a)).toEqual(family(hotfixOnly));
    expect(withB1a.hasFamilyAccess).toBe(hotfixOnly.hasFamilyAccess);

    const b1aOnly = await securityCatalog(await build([RECONCILE, B1A]));
    const novas = (c: { policies: string | null }) => (c.policies ?? '').split(';').filter((p) => p.startsWith('investment'));
    expect(novas(withB1a)).toEqual(novas(b1aOnly));
  }, 240_000);

  it('a reconciliação reconhece a policy familiar existente depois do hotfix (caso B: nada muda)', async () => {
    const db = await build([HARDENING, LEAVE]);
    const before = await securityCatalog(db);
    await db.exec(RECONCILE);
    expect(await securityCatalog(db)).toEqual(before);
  }, 120_000);
});

describe('carteiras sob o vínculo familiar REAL (fluxo do usuário, family_members endurecido)', () => {
  it('convite pendente não dá acesso; depois do aceite o familiar administra a carteira e classifica o snapshot do dono', async () => {
    const db = await build(PRODUCTION_ORDER);
    expect((await attempt(db, A, INVITE, [A, EMAIL[A], EMAIL[B], 'pending'])).ok).toBe(true);
    const carteira = (await attempt(db, A, NEW_PORTFOLIO, [A, 'Principal'])).rows[0];

    expect(await portfoliosOf(db, B, A)).toBe(0);
    expect((await attempt(db, B, NEW_PORTFOLIO, [A, 'Indevida'])).code).toBe('42501');

    expect((await attempt(db, B, `update public.family_members set status = 'accepted' where member_email = $1 returning id`, [EMAIL[B]])).rows).toHaveLength(1);
    expect(await portfoliosOf(db, B, A)).toBe(1);

    const criadaPorB = (await attempt(db, B, NEW_PORTFOLIO, [A, 'Reserva'])).rows[0];
    expect(criadaPorB).toMatchObject({ user_id: A, created_by: B }); // propriedade com A, autoria de B

    const classificado = await attempt(db, B, 'update public.investments set portfolio_id = $1 where id = $2 returning user_id, portfolio_id, classified_by', [carteira.id, SNAP_A]);
    expect(classificado.rows[0]).toMatchObject({ user_id: A, portfolio_id: carteira.id, classified_by: B });
  }, 120_000);

  it('vínculo "accepted" forjado por um terceiro é recusado e não abre carteiras nem snapshots do dono', async () => {
    const db = await build(PRODUCTION_ORDER);
    await attempt(db, A, NEW_PORTFOLIO, [A, 'Principal']);

    // C tenta se declarar titular de um vínculo já aceito com A (o has_family_access é bidirecional).
    expect((await attempt(db, C, INVITE, [C, EMAIL[C], EMAIL[A], 'accepted'])).code).toBe('42501');
    expect(await portfoliosOf(db, C, A)).toBe(0);
    expect((await attempt(db, C, NEW_PORTFOLIO, [A, 'Invasora'])).code).toBe('42501');
    expect((await attempt(db, C, 'select id from public.investments where id = $1', [SNAP_A])).rows).toHaveLength(0);

    // Controle: SEM o endurecimento a mesma linha forjada abriria as carteiras de A — é o hotfix que fecha isso.
    const vulneravel = await build([RECONCILE, B1A]);
    await attempt(vulneravel, A, NEW_PORTFOLIO, [A, 'Principal']);
    expect((await attempt(vulneravel, C, INVITE, [C, EMAIL[C], EMAIL[A], 'accepted'])).ok).toBe(true);
    expect(await portfoliosOf(vulneravel, C, A)).toBe(1);
  }, 240_000);

  it('revogar pelo dono ou sair pelo membro encerra o acesso às carteiras; a classificação feita antes permanece', async () => {
    for (const encerrar of ['dono-remove', 'membro-sai'] as const) {
      const db = await build(PRODUCTION_ORDER);
      await attempt(db, A, INVITE, [A, EMAIL[A], EMAIL[B], 'pending']);
      await attempt(db, B, `update public.family_members set status = 'accepted' where member_email = $1`, [EMAIL[B]]);
      // B cria o vínculo recíproco, como o aplicativo faz ao aceitar.
      expect((await attempt(db, B, INVITE, [B, EMAIL[B], EMAIL[A], 'accepted'])).ok).toBe(true);
      const carteira = (await attempt(db, A, NEW_PORTFOLIO, [A, 'Principal'])).rows[0];
      await attempt(db, B, 'update public.investments set portfolio_id = $1 where id = $2', [carteira.id, SNAP_A]);
      expect(await portfoliosOf(db, B, A)).toBe(1);

      const removido =
        encerrar === 'dono-remove'
          ? await attempt(db, A, 'delete from public.family_members where owner_id = $1 returning id', [A])
          : await attempt(db, B, 'delete from public.family_members where owner_id = $1 returning id', [A]);
      expect(removido.rows).toHaveLength(1);

      await as(db, 'postgres');
      expect((await db.query('select 1 from public.family_members')).rows).toHaveLength(0); // recíproco também saiu
      expect(await portfoliosOf(db, B, A)).toBe(0);
      expect((await attempt(db, B, NEW_PORTFOLIO, [A, 'Depois'])).code).toBe('42501');
      expect((await attempt(db, B, 'update public.investments set portfolio_id = null where id = $1 returning id', [SNAP_A])).rows).toHaveLength(0);

      const visto = await attempt(db, A, 'select portfolio_id, classified_by from public.investments where id = $1', [SNAP_A]);
      expect(visto.rows[0]).toMatchObject({ portfolio_id: carteira.id, classified_by: B });
    }
  }, 240_000);

  it('o rollback da B1A não desfaz o endurecimento familiar nem a policy familiar de investments', async () => {
    const db = await build(PRODUCTION_ORDER);
    const before = await securityCatalog(db);
    await as(db, 'postgres');
    await db.exec(B1A_DOWN);
    const after = await securityCatalog(db);

    const family = (v: string | null) => (v ?? '').split(';').filter((x) => x.startsWith('family_members|'));
    expect(family(after.policies)).toEqual(family(before.policies));
    expect(family(after.triggers)).toEqual(family(before.triggers));
    expect(family(after.grants)).toEqual(family(before.grants));
    expect(after.hasFamilyAccess).toBe(before.hasFamilyAccess);
    expect(after.policies).toContain('investments|Family Access Investments|*');
    expect((await attempt(db, C, INVITE, [C, EMAIL[C], EMAIL[A], 'accepted'])).code).toBe('42501');
  }, 120_000);
});
