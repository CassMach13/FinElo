import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readSqlFixture } from '../helpers/sqlFixture';

/**
 * Invariantes de autorização de public.family_members após a migration
 * 20261012180000_family_members_authorization_hardening (PGlite, offline):
 * criação e transição de vínculos, identidade imutável, revogação do recíproco, privilégios e recuperação.
 * Papéis anon/authenticated com claims JWT sobre o schema real das tabelas e `has_family_access` (055).
 */
const MIGRATION = readSqlFixture('supabase/migrations/20261012180000_family_members_authorization_hardening.sql');
const RECOVERY_A = readSqlFixture('supabase/rollbacks/20261012180000_family_members_authorization_hardening_recovery_a.sql');
const RECOVERY_B = readSqlFixture('supabase/rollbacks/20261012180000_family_members_authorization_hardening_recovery_b.sql');
const family055 = readSqlFixture('supabase/migrations/055_fix_family_bidirectional_access.sql');
const HAS_FAMILY_ACCESS_SQL = family055.slice(family055.indexOf('create or replace function public.has_family_access'));
const investmentsMigrations = ['014_create_investments', '015_enrich_investments', '020_add_investment_source_file', '052_investments_application_date', '053_investments_gross_return']
  .map((f) => readSqlFixture(`supabase/migrations/${f}.sql`))
  .join('\n');

const A = '11111111-1111-4111-8111-111111111111'; // dono
const B = '22222222-2222-4222-8222-222222222222'; // familiar
const C = '33333333-3333-4333-8333-333333333333'; // sem relação
const D = '44444444-4444-4444-8444-444444444444'; // convidado
const E = '55555555-5555-4555-8555-555555555555'; // terceiro
const emails: Record<string, string> = {
  [A]: 'a@example.test', [B]: 'b@example.test', [C]: 'c@example.test', [D]: 'd@example.test', [E]: 'e@example.test',
};
const SNAP: Record<string, string> = {
  [A]: 'a0000000-0000-4000-8000-0000000000aa', [B]: 'b0000000-0000-4000-8000-0000000000bb', [C]: 'c0000000-0000-4000-8000-0000000000cc',
};

const BASE = `
create schema auth;
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table auth.users (id uuid primary key, email text not null);
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
${Object.entries(emails).map(([id, e]) => `insert into auth.users (id, email) values ('${id}', '${e}');`).join('\n')}
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
`;

const dbs: PGlite[] = [];
async function build(sqls: string[] = [MIGRATION]) {
  const db = new PGlite();
  dbs.push(db);
  await db.waitReady;
  await db.exec(BASE);
  for (const s of sqls) await db.exec(s);
  return db;
}

type Role = 'anon' | 'authenticated' | 'postgres';
async function as(db: PGlite, role: Role, userId = '') {
  await db.exec('reset role;');
  if (role !== 'postgres') await db.exec(`set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    userId ? JSON.stringify({ sub: userId, email: emails[userId], role: 'authenticated' }) : '',
  ]);
}
async function q<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}
async function attempt(db: PGlite, role: Role, userId: string, sql: string, params: unknown[] = []) {
  await as(db, role, userId);
  try {
    const rows = await q(db, sql, params);
    return { ok: true as const, rows, code: null as string | null };
  } catch (e) {
    return { ok: false as const, rows: [] as Record<string, unknown>[], code: (e as { code?: string }).code ?? 'ERR' };
  }
}
const reset = async (db: PGlite) => {
  await as(db, 'postgres');
  await db.exec('delete from public.family_members; delete from public.investments;');
  for (const id of [A, B, C]) {
    await db.query(
      `insert into public.investments (id, user_id, institution, product_type, balance, reference_month, product_name, source_file)
       values ($1,$2,'XP','Renda Fixa',10,'2026-09-01','p','f.xlsx')`, [SNAP[id], id]);
  }
};
const link = async (db: PGlite, owner: string, member: string, status: string) => {
  await as(db, 'postgres');
  await db.query('insert into public.family_members (owner_id, owner_email, member_email, status) values ($1,$2,$3,$4)', [owner, emails[owner], emails[member], status]);
};
const sees = async (db: PGlite, viewer: string, ownerOfData: string) => {
  await as(db, 'authenticated', viewer);
  return (await q(db, 'select id from public.investments where id = $1', [SNAP[ownerOfData]])).length;
};
const INS = `insert into public.family_members (owner_id, owner_email, member_email, status) values ($1,$2,$3,$4) returning id`;
const rowsOf = async (db: PGlite) => {
  await as(db, 'postgres');
  return (await q<{ o: string; m: string; s: string }>(db, 'select owner_id::text o, member_email m, status s from public.family_members order by 1,2'))
    .map((r) => `${emails[r.o]}>${r.m}:${r.s}`);
};

afterAll(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.close()));
});

describe('invariantes de vínculos familiares', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await build();
  }, 120_000);
  beforeEach(async () => {
    await reset(db);
  });

  it('o vínculo nasce pendente e o e-mail do dono gravado é o canônico', async () => {
    const r = await attempt(db, 'authenticated', A,
      `insert into public.family_members (owner_id, owner_email, member_email) values ($1,'outro@example.test',$2) returning status, owner_email`, [A, 'B@Example.Test']);
    expect(r.rows[0]).toMatchObject({ status: 'pending', owner_email: emails[A] });
    expect((await attempt(db, 'authenticated', A, INS, [A, emails[A], emails[D], 'pending'])).ok).toBe(true);
  });

  it('"accepted" só é aceito como recíproco de um vínculo já aceito para o próprio usuário', async () => {
    expect((await attempt(db, 'authenticated', C, INS, [C, emails[C], emails[A], 'accepted'])).code).toBe('42501');
    await link(db, A, B, 'pending');
    expect((await attempt(db, 'authenticated', B, INS, [B, emails[B], emails[A], 'accepted'])).code).toBe('42501'); // ainda pendente
    await attempt(db, 'authenticated', B, `update public.family_members set status = 'accepted' where member_email = $1`, [emails[B]]);
    expect((await attempt(db, 'authenticated', B, INS, [B, emails[B], emails[A], 'accepted'])).ok).toBe(true);
    // outro destino que não é o dono do vínculo aceito continua rejeitado
    expect((await attempt(db, 'authenticated', B, INS, [B, emails[B], emails[C], 'accepted'])).code).toBe('42501');
  });

  it('o recíproco valida o e-mail canônico do dono, não o texto gravado em owner_email', async () => {
    await as(db, 'postgres');
    await db.query(`insert into public.family_members (owner_id, owner_email, member_email, status) values ($1,$2,$3,'accepted')`, [E, emails[C], emails[D]]);
    expect((await attempt(db, 'authenticated', D, INS, [D, emails[D], emails[C], 'accepted'])).code).toBe('42501');
  });

  it('campos de identidade são imutáveis e o status só vai para accepted/declined', async () => {
    await link(db, A, B, 'pending');
    const upd = (patch: string, params: unknown[] = []) =>
      attempt(db, 'authenticated', B, `update public.family_members set ${patch} where member_email = $1 returning id`, [emails[B], ...params]);
    expect((await upd('owner_id = $2', [C])).code).toBe('42501');
    expect((await upd(`owner_email = 'x@example.test'`)).code).toBe('42501');
    expect((await upd(`created_at = now() - interval '1 year'`)).code).toBe('42501');
    expect((await upd('id = gen_random_uuid()')).code).toBe('42501');
    expect((await upd('member_email = $2', [emails[C]])).ok === false).toBe(true);
    expect((await upd(`status = 'accepted'`)).ok).toBe(true);
    expect((await upd(`status = 'pending'`)).code).toBe('42501');
    expect((await upd('status = null')).code).toBe('42501');
    expect((await upd(`status = 'declined'`)).ok).toBe(true);
    await as(db, 'postgres');
    expect(await rowsOf(db)).toEqual([`${emails[A]}>${emails[B]}:declined`]);
  });

  it('o acesso acompanha o ciclo do vínculo e C permanece sem acesso', async () => {
    await attempt(db, 'authenticated', A, INS, [A, emails[A], emails[B], 'pending']);
    expect(await sees(db, B, A)).toBe(0);
    await attempt(db, 'authenticated', B, `update public.family_members set status = 'accepted' where member_email = $1`, [emails[B]]);
    expect([await sees(db, B, A), await sees(db, A, B), await sees(db, C, A), await sees(db, C, B)]).toEqual([1, 1, 0, 0]);
    const del = await attempt(db, 'authenticated', A, 'delete from public.family_members where owner_id = $1 returning id', [A]);
    expect(del.rows.length).toBe(1);
    expect([await sees(db, B, A), await sees(db, A, B)]).toEqual([0, 0]);
  });

  it('revogar remove somente o recíproco exato, por qualquer um dos lados', async () => {
    await link(db, A, B, 'accepted'); await link(db, B, A, 'accepted');
    await link(db, A, D, 'accepted'); await link(db, D, A, 'accepted');
    await link(db, B, E, 'accepted');
    await link(db, B, C, 'pending');
    await attempt(db, 'authenticated', A, 'delete from public.family_members where owner_id = $1 and member_email = $2', [A, emails[B]]);
    expect(await rowsOf(db)).toEqual([
      `${emails[A]}>${emails[D]}:accepted`, `${emails[B]}>${emails[C]}:pending`, `${emails[B]}>${emails[E]}:accepted`, `${emails[D]}>${emails[A]}:accepted`,
    ].sort());
    await reset(db);
    await link(db, A, B, 'accepted'); await link(db, B, A, 'accepted');
    await attempt(db, 'authenticated', B, `update public.family_members set status = 'declined' where owner_id = $1`, [A]);
    expect(await rowsOf(db)).toEqual([`${emails[A]}>${emails[B]}:declined`]);
    await reset(db);
    await link(db, A, B, 'accepted'); await link(db, B, A, 'accepted');
    await attempt(db, 'authenticated', B, 'delete from public.family_members where owner_id = $1', [B]);
    expect(await rowsOf(db)).toEqual([]);
  });

  it('o vínculo aceito único (sem recíproco) segue funcional e revogável pelos dois lados', async () => {
    await link(db, A, B, 'accepted');
    expect([await sees(db, B, A), await sees(db, A, B)]).toEqual([1, 1]);
    await attempt(db, 'authenticated', B, `update public.family_members set status = 'declined' where owner_id = $1`, [A]);
    expect([await sees(db, B, A), await sees(db, A, B)]).toEqual([0, 0]);
  });

  it('privilégios mínimos: authenticated só CRUD; anon sem acesso', async () => {
    await as(db, 'postgres');
    const p = (await q<Record<string, boolean>>(db, `
      select has_table_privilege('anon','public.family_members','SELECT') anon_select,
             has_table_privilege('anon','public.family_members','TRUNCATE') anon_truncate,
             has_table_privilege('authenticated','public.family_members','TRUNCATE') auth_truncate,
             has_table_privilege('authenticated','public.family_members','TRIGGER') auth_trigger,
             has_table_privilege('authenticated','public.family_members','REFERENCES') auth_references,
             has_table_privilege('authenticated','public.family_members','SELECT') auth_select,
             has_table_privilege('authenticated','public.family_members','INSERT') auth_insert,
             has_table_privilege('authenticated','public.family_members','UPDATE') auth_update,
             has_table_privilege('authenticated','public.family_members','DELETE') auth_delete`))[0];
    expect([p.anon_select, p.anon_truncate, p.auth_truncate, p.auth_trigger, p.auth_references]).toEqual(Array(5).fill(false));
    expect([p.auth_select, p.auth_insert, p.auth_update, p.auth_delete]).toEqual([true, true, true, true]);
    expect((await attempt(db, 'anon', '', 'select id from public.family_members')).code).toBe('42501');
    expect((await attempt(db, 'authenticated', A, 'truncate table public.family_members')).code).toBe('42501');
  });

  it('funções SECURITY DEFINER com search_path fixo e EXECUTE mínimo', async () => {
    await as(db, 'postgres');
    const r = await q<Record<string, unknown>>(db, `
      select p.proname, p.prosecdef, p.proconfig::text cfg,
             has_function_privilege('anon', p.oid, 'EXECUTE') anon_exec,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_exec
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('family_link_accepted_from','family_members_guard','family_members_revoke_mirror') order by 1`);
    expect(r.map((x) => [x.proname, x.prosecdef, x.anon_exec, x.auth_exec])).toEqual([
      ['family_link_accepted_from', true, false, true],
      ['family_members_guard', true, false, false],
      ['family_members_revoke_mirror', true, false, false],
    ]);
    for (const f of r) expect(String(f.cfg).split(String.fromCharCode(92)).join('')).toContain('search_path=""');
  });
});

describe('migration e recuperação', () => {
  it('é idempotente, não altera dados existentes nem has_family_access', async () => {
    const cur = await build([]);
    await as(cur, 'postgres');
    for (const [o, m, s] of [[A, B, 'accepted'], [B, A, 'accepted'], [A, D, 'pending'], [C, A, 'declined']] as const) {
      await cur.query('insert into public.family_members (owner_id, owner_email, member_email, status, created_at) values ($1,$2,$3,$4,$5)',
        [o, emails[o], emails[m], s, '2026-01-01T00:00:00Z']);
    }
    const snap = async () => (await q<{ h: string; f: string }>(cur, `
      select md5(string_agg(owner_id||'|'||coalesce(owner_email,'')||'|'||member_email||'|'||coalesce(status,'')||'|'||created_at::text, ';' order by owner_id, member_email)) h,
             md5(pg_get_functiondef('public.has_family_access(uuid)'::regprocedure)) f from public.family_members`))[0];
    const before = await snap();
    await cur.exec(MIGRATION);
    await cur.exec(MIGRATION);
    expect(await snap()).toEqual(before);
  }, 180_000);

  it('recuperação A isola o recíproco e mantém as demais invariantes', async () => {
    const db = await build([MIGRATION, RECOVERY_A]);
    await reset(db);
    await link(db, A, B, 'pending');
    expect((await attempt(db, 'authenticated', B, `update public.family_members set status = 'accepted' where member_email = $1`, [emails[B]])).ok).toBe(true);
    expect((await attempt(db, 'authenticated', B, INS, [B, emails[B], emails[A], 'accepted'])).code).toBe('42501');
    expect((await attempt(db, 'authenticated', B, `update public.family_members set owner_id = $1 where member_email = $2`, [C, emails[B]])).code).toBe('42501');
  }, 120_000);

  it('recuperação B congela criação e alteração, preservando leitura e revogação', async () => {
    const db = await build([MIGRATION, RECOVERY_B]);
    await reset(db);
    await link(db, A, B, 'accepted');
    expect((await attempt(db, 'authenticated', A, INS, [A, emails[A], emails[D], 'pending'])).code).toBe('42501');
    expect((await attempt(db, 'authenticated', B, `update public.family_members set status = 'declined' where member_email = $1`, [emails[B]])).code).toBe('42501');
    expect(await sees(db, B, A)).toBe(1);
    expect((await attempt(db, 'authenticated', A, 'delete from public.family_members where owner_id = $1 returning id', [A])).rows.length).toBe(1);
    expect(await sees(db, B, A)).toBe(0);
  }, 120_000);
});
