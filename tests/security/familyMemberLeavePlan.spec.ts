import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readSqlFixture } from '../helpers/sqlFixture';
import { removeFamilyLink, type FamilyLinkRemovalClient } from '../../src/utils/familyLinkRemoval';

/**
 * "Sair do plano" (PGlite, offline): policy de DELETE do membro (migration 20261012180100) sobre o schema real,
 * com o endurecimento 20261012180000 já aplicado. Papéis anon/authenticated com claims JWT.
 */
const MIGRATION = readSqlFixture('supabase/migrations/20261012180000_family_members_authorization_hardening.sql');
const LEAVE = readSqlFixture('supabase/migrations/20261012180100_family_members_member_can_leave.sql');
const LEAVE_DOWN = readSqlFixture('supabase/rollbacks/20261012180100_family_members_member_can_leave_down.sql');
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
async function build(sqls: string[] = [MIGRATION, LEAVE]) {
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

const DEL = 'delete from public.family_members where id = $1 returning id';
const idOf = async (db: PGlite, owner: string, member: string) => {
  await as(db, 'postgres');
  return (await q<{ id: string }>(db, 'select id from public.family_members where owner_id = $1 and member_email = $2', [owner, emails[member]]))[0].id;
};
const withClaims = async (db: PGlite, userId: string, claims: Record<string, unknown>) => {
  await as(db, 'authenticated', userId);
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: userId, role: 'authenticated', ...claims })]);
};
/** Cliente supabase-js simulado: `delete().eq('id', x).select('id')` executa o DELETE real sob RLS como `userId`. */
const clientFor = (db: PGlite, userId: string): FamilyLinkRemovalClient => ({
  from: () => ({
    delete: () => ({
      eq: (_column: string, value: string) => ({
        select: async () => {
          const r = await attempt(db, 'authenticated', userId, DEL, [value]);
          return r.ok
            ? { data: r.rows as { id: string }[], error: null }
            : { data: null, error: { message: `SQLSTATE ${r.code}` } };
        },
      }),
    }),
  }),
});

describe('membro sai do plano familiar', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await build();
  }, 120_000);
  beforeEach(async () => {
    await reset(db);
  });

  it('o membro remove o próprio vínculo recebido e o acesso termina nos dois sentidos', async () => {
    await link(db, A, B, 'accepted'); await link(db, B, A, 'accepted');
    expect([await sees(db, B, A), await sees(db, A, B)]).toEqual([1, 1]);
    const out = await attempt(db, 'authenticated', B, DEL, [await idOf(db, A, B)]);
    expect(out.rows.length).toBe(1);
    expect(await rowsOf(db)).toEqual([]); // vínculo e recíproco removidos
    expect([await sees(db, B, A), await sees(db, A, B)]).toEqual([0, 0]);
  });

  it('o acesso termina nos dois sentidos também quando só existe o vínculo recebido', async () => {
    await link(db, A, B, 'accepted');
    expect([await sees(db, B, A), await sees(db, A, B)]).toEqual([1, 1]);
    expect((await attempt(db, 'authenticated', B, DEL, [await idOf(db, A, B)])).rows.length).toBe(1);
    expect([await sees(db, B, A), await sees(db, A, B)]).toEqual([0, 0]);
  });

  it('convites pendentes e recusados também podem ser apagados pelo próprio membro', async () => {
    await link(db, A, B, 'pending'); await link(db, A, D, 'declined');
    expect((await attempt(db, 'authenticated', B, DEL, [await idOf(db, A, B)])).rows.length).toBe(1);
    expect((await attempt(db, 'authenticated', D, DEL, [await idOf(db, A, D)])).rows.length).toBe(1);
    expect(await rowsOf(db)).toEqual([]);
  });

  it('vínculos de terceiros permanecem intactos', async () => {
    await link(db, A, B, 'accepted'); await link(db, B, A, 'accepted');
    await link(db, A, D, 'accepted'); await link(db, D, A, 'accepted');
    await link(db, B, E, 'accepted'); await link(db, B, C, 'pending');
    await link(db, C, E, 'accepted');
    const before = (await rowsOf(db)).filter(
      (r) => !r.startsWith(`${emails[A]}>${emails[B]}:`) && !r.startsWith(`${emails[B]}>${emails[A]}:`),
    );
    expect((await attempt(db, 'authenticated', B, DEL, [await idOf(db, A, B)])).rows.length).toBe(1);
    expect(await rowsOf(db)).toEqual(before);
    expect([await sees(db, D, A), await sees(db, E, B)]).toEqual([1, 1]);
    expect([await sees(db, B, A), await sees(db, A, B)]).toEqual([0, 0]);
  });

  it('quem não é parte do vínculo não consegue apagá-lo, por nenhum caminho', async () => {
    await link(db, A, B, 'accepted'); await link(db, B, A, 'accepted'); await link(db, B, E, 'accepted');
    const before = await rowsOf(db);
    const target = await idOf(db, A, B);
    const other = await idOf(db, B, E);
    for (const stranger of [C, D]) {
      for (const id of [target, other]) {
        expect((await attempt(db, 'authenticated', stranger, DEL, [id])).rows.length).toBe(0);
      }
      expect((await attempt(db, 'authenticated', stranger, 'delete from public.family_members returning id')).rows.length).toBe(0);
    }
    // membro de OUTRO vínculo (E é membro de B>E) não apaga o vínculo alheio A>B
    expect((await attempt(db, 'authenticated', E, DEL, [target])).rows.length).toBe(0);
    // e-mail parecido, e-mail ausente no JWT e anon não casam
    await withClaims(db, C, { email: 'xb@example.test' });
    expect((await q(db, 'delete from public.family_members returning id')).length).toBe(0);
    await withClaims(db, C, {});
    expect((await q(db, 'delete from public.family_members returning id')).length).toBe(0);
    expect((await attempt(db, 'anon', '', DEL, [target])).code).toBe('42501');
    expect(await rowsOf(db)).toEqual(before);
  });

  it('a policy de DELETE do membro isola por si só, mesmo se um SELECT mais amplo for adicionado no futuro', async () => {
    const wide = await build();
    await as(wide, 'postgres');
    await wide.exec('create policy tmp_select_all on public.family_members for select using (true);');
    await reset(wide);
    await link(wide, A, B, 'accepted'); await link(wide, B, E, 'accepted');
    const before = await rowsOf(wide);
    const target = await idOf(wide, A, B);
    for (const stranger of [C, D]) {
      expect((await attempt(wide, 'authenticated', stranger, DEL, [target])).rows.length).toBe(0);
      expect((await attempt(wide, 'authenticated', stranger, 'delete from public.family_members returning id')).rows.length).toBe(0);
    }
    expect((await attempt(wide, 'authenticated', E, DEL, [target])).rows.length).toBe(0);
    expect(await rowsOf(wide)).toEqual(before);
    expect((await attempt(wide, 'authenticated', B, DEL, [target])).rows.length).toBe(1);
  }, 120_000);

  it('e-mail do JWT com caixa diferente da gravada não amplia o alcance (falha segura, sem efeito)', async () => {
    await link(db, A, B, 'accepted');
    const target = await idOf(db, A, B);
    await withClaims(db, B, { email: 'B@Example.Test' });
    const r = await q(db, DEL, [target]);
    expect([0, 1]).toContain(r.length); // hoje 0 (SELECT do membro é sensível à caixa); a UI trata 0 como erro
    expect(r.length === 1 ? (await rowsOf(db)).length : (await rowsOf(db)).length).toBe(r.length === 1 ? 0 : 1);
  });

  it('a policy nova é só de DELETE: não abre INSERT nem UPDATE', async () => {
    await link(db, A, B, 'accepted');
    expect((await attempt(db, 'authenticated', B, 'update public.family_members set owner_id = $1 where member_email = $2', [C, emails[B]])).code).toBe('42501');
    expect((await attempt(db, 'authenticated', B, INS, [A, emails[A], emails[C], 'accepted'])).code).toBe('42501');
    await as(db, 'postgres');
    const pol = await q<{ polname: string; polcmd: string }>(
      db, `select polname, polcmd::text from pg_policy where polrelid = 'public.family_members'::regclass order by polname`);
    expect(pol.filter((p) => p.polname === 'Membro sai do vínculo')).toEqual([{ polname: 'Membro sai do vínculo', polcmd: 'd' }]);
  });
});

describe('interface: DELETE sem efeito não é sucesso', () => {
  it('sem a policy do membro o DELETE afeta 0 linhas e o helper não reporta sucesso; com a policy remove 1', async () => {
    const legacy = await build([MIGRATION]);
    await reset(legacy);
    await link(legacy, A, B, 'accepted'); await link(legacy, B, A, 'accepted');
    const id = await idOf(legacy, A, B);
    expect(await removeFamilyLink(clientFor(legacy, B), id)).toEqual({ status: 'not_removed' });
    expect(await rowsOf(legacy)).toEqual([`${emails[A]}>${emails[B]}:accepted`, `${emails[B]}>${emails[A]}:accepted`].sort());

    const fixed = await build();
    await reset(fixed);
    await link(fixed, A, B, 'accepted'); await link(fixed, B, A, 'accepted');
    expect(await removeFamilyLink(clientFor(fixed, B), await idOf(fixed, A, B))).toEqual({ status: 'removed' });
    expect(await rowsOf(fixed)).toEqual([]);
    // o dono removendo o próprio convite continua funcionando; repetir com a linha já inexistente não é sucesso
    await link(fixed, A, D, 'pending');
    const inv = await idOf(fixed, A, D);
    expect(await removeFamilyLink(clientFor(fixed, A), inv)).toEqual({ status: 'removed' });
    expect(await removeFamilyLink(clientFor(fixed, A), inv)).toEqual({ status: 'not_removed' });
  }, 180_000);

  it('erro do banco e exceção são "error"; 0 ou 2+ linhas não são sucesso', async () => {
    const stub = (res: { data: { id: string }[] | null; error: { message: string } | null }): FamilyLinkRemovalClient => ({
      from: () => ({ delete: () => ({ eq: () => ({ select: async () => res }) }) }),
    });
    expect(await removeFamilyLink(stub({ data: null, error: { message: 'permission denied' } }), 'x')).toEqual({ status: 'error', message: 'permission denied' });
    expect(await removeFamilyLink(stub({ data: [], error: null }), 'x')).toEqual({ status: 'not_removed' });
    expect(await removeFamilyLink(stub({ data: null, error: null }), 'x')).toEqual({ status: 'not_removed' });
    expect(await removeFamilyLink(stub({ data: [{ id: '1' }], error: null }), 'x')).toEqual({ status: 'removed' });
    expect(await removeFamilyLink(stub({ data: [{ id: '1' }, { id: '2' }], error: null }), 'x')).toEqual({ status: 'not_removed' });
    const throwing: FamilyLinkRemovalClient = { from: () => { throw new Error('offline'); } };
    expect(await removeFamilyLink(throwing, 'x')).toEqual({ status: 'error', message: 'offline' });
  });

  it('SettingsView usa o helper e só segue o fluxo de sucesso quando 1 linha foi removida', () => {
    const view = readFileSync('src/components/views/SettingsView.tsx', 'utf8').replace(/\r\n/g, '\n');
    expect(view).toContain("import { removeFamilyLink } from '../../utils/familyLinkRemoval';");
    expect(view).not.toMatch(/from\('family_members'\)\s*\.delete\(\)/);
    const call = view.indexOf('await removeFamilyLink(supabase, member.id)');
    const guard = view.indexOf("removal.status !== 'removed'", call);
    const alertAt = view.indexOf("'Erro',", guard);
    const early = view.indexOf('return;', alertAt);
    const subscription = view.indexOf('useAppStore.getState().fetchSubscription()', call);
    expect(call).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(call);
    expect(alertAt).toBeGreaterThan(guard);
    expect(early).toBeGreaterThan(alertAt);
    expect(subscription).toBeGreaterThan(early); // o fluxo de sucesso vem depois do retorno antecipado
    expect(view).toContain('Sair do plano compartilhado de ${member.owner_email}?'); // confirmação preservada
  });
});

describe('migration e recuperação', () => {
  it('é idempotente e não altera dados, triggers nem has_family_access', async () => {
    const cur = await build([MIGRATION]);
    await as(cur, 'postgres');
    for (const [o, m, s] of [[A, B, 'accepted'], [B, A, 'accepted'], [A, D, 'pending'], [C, A, 'declined']] as const) {
      await cur.query('insert into public.family_members (owner_id, owner_email, member_email, status, created_at) values ($1,$2,$3,$4,$5)',
        [o, emails[o], emails[m], s, '2026-01-01T00:00:00Z']);
    }
    const snap = async () => (await q<{ h: string; f: string; t: string }>(cur, `
      select md5(string_agg(owner_id||'|'||coalesce(owner_email,'')||'|'||member_email||'|'||coalesce(status,'')||'|'||created_at::text, ';' order by owner_id, member_email)) h,
             md5(pg_get_functiondef('public.has_family_access(uuid)'::regprocedure)) f,
             (select string_agg(tgname||':'||tgenabled::text, ',' order by tgname) from pg_trigger
               where tgrelid = 'public.family_members'::regclass and not tgisinternal) t
        from public.family_members`))[0];
    const before = await snap();
    await cur.exec(LEAVE);
    await cur.exec(LEAVE);
    expect(await snap()).toEqual(before);
    const n = await q<{ n: number }>(cur, `select count(*)::int n from pg_policy where polrelid = 'public.family_members'::regclass and polname = 'Membro sai do vínculo'`);
    expect(n[0].n).toBe(1);
  }, 180_000);

  it('aborta sem o trigger de revogação recíproca e não cria a policy', async () => {
    const bare = await build([]);
    await expect(bare.exec(LEAVE)).rejects.toThrow(/FAMILY_LEAVE_REQUIRES_REVOKE_MIRROR_TRIGGER/);
    await as(bare, 'postgres');
    expect((await q(bare, `select 1 from pg_policy where polname = 'Membro sai do vínculo'`)).length).toBe(0);
  }, 120_000);

  it('a recuperação remove só a policy do membro: o dono continua revogando e o espelho segue ativo', async () => {
    const back = await build([MIGRATION, LEAVE, LEAVE_DOWN]);
    await reset(back);
    await link(back, A, B, 'accepted'); await link(back, B, A, 'accepted');
    expect((await attempt(back, 'authenticated', B, DEL, [await idOf(back, A, B)])).rows.length).toBe(0);
    expect((await attempt(back, 'authenticated', A, DEL, [await idOf(back, A, B)])).rows.length).toBe(1);
    expect(await rowsOf(back)).toEqual([]); // espelho do hotfix preservado
  }, 120_000);

  it('não edita a migration de endurecimento já aplicada e não abre transação própria', () => {
    expect(createHash('sha256').update(MIGRATION).digest('hex'))
      .toBe('d05334fb10579a998b06c8d1bd11364f42c6972bd7b2ece2b707ecc608c6264a');
    expect(LEAVE).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/m);
  });
});
