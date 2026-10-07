import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

/**
 * `budget_months` + hardening de `budgets` num PostgreSQL descartável (PGlite): schema, constraints,
 * RLS com família (a `has_family_access` REAL da migration 055), privilégios por coluna, rollback e
 * regressão do cliente antigo. `auth.uid()`/`auth.jwt()` são simulados por `request.jwt.claim*`.
 */
const migration = readFileSync(resolve('supabase/migrations/20261007120000_budget_months.sql'), 'utf8');
const rollback = readFileSync(resolve('supabase/rollbacks/20261007120000_budget_months_down.sql'), 'utf8');
const familyMigration = readFileSync(resolve('supabase/migrations/055_fix_family_bidirectional_access.sql'), 'utf8');
const hasFamilyAccessSql = familyMigration.slice(
  familyMigration.indexOf('create or replace function public.has_family_access')
);

const A = '11111111-1111-4111-8111-111111111111'; // dono
const B = '22222222-2222-4222-8222-222222222222'; // convidado aceito de A
const C = '33333333-3333-4333-8333-333333333333'; // outro convidado aceito de A
const D = '44444444-4444-4444-8444-444444444444'; // estranho
const email = (id: string) => ({ [A]: 'a@example.test', [B]: 'b@example.test', [C]: 'c@example.test', [D]: 'd@example.test' })[id] as string;

const baseSchema = `
create schema auth;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create table auth.users (id uuid primary key, email text not null);
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
insert into auth.users (id, email) values
  ('${A}', '${email(A)}'), ('${B}', '${email(B)}'), ('${C}', '${email(C)}'), ('${D}', '${email(D)}');

create table public.family_members (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  owner_email text,
  member_email text not null,
  status text,
  created_at timestamptz default now()
);
insert into public.family_members (owner_id, owner_email, member_email, status) values
  ('${A}', '${email(A)}', '${email(B)}', 'accepted'),
  ('${A}', '${email(A)}', '${email(C)}', 'accepted');

create function public.handle_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

${hasFamilyAccessSql}
grant usage on schema public to anon, authenticated, service_role;

-- Como no Supabase: tabelas novas nascem com ALL para anon/authenticated/service_role.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

-- Tabela legada, como em produção (policies e ACL).
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  "Categoria" text not null,
  "Valor_Limite_Mensal" numeric not null,
  ano integer not null default (extract(year from now()))::integer,
  constraint unique_category_year unique (user_id, "Categoria", ano)
);
alter table public.budgets enable row level security;
create policy "Allow individual full access on budgets" on public.budgets for all to public using (auth.uid() = user_id);
create policy "Allow individual read access on budgets" on public.budgets for select to public using (auth.uid() = user_id);
create policy "Family Access Budgets" on public.budgets for all to public
  using (public.has_family_access(user_id)) with check (public.has_family_access(user_id));
insert into public.budgets (user_id, "Categoria", "Valor_Limite_Mensal", ano) values ('${A}', 'Alimentação', 1500, 2026);
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
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    userId ? JSON.stringify({ sub: userId, email: email(userId), role: 'authenticated' }) : '',
  ]);
};

const insert = async (db: PGlite, owner: string, categoria = 'Alimentação', year = 2026, month = 10, amount = 1500) => {
  const r = await db.query<{ id: string }>(
    'insert into public.budget_months (user_id, "Categoria", year, month, amount) values ($1,$2,$3,$4,$5) returning id',
    [owner, categoria, year, month, amount]
  );
  return r.rows[0].id;
};

const privileges = async (db: PGlite, table: string, grantee: string) => {
  await as(db, 'postgres');
  const r = await db.query<{ p: string }>(
    "select privilege_type p from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee=$2 order by 1",
    [table, grantee]
  );
  return r.rows.map((x) => x.p);
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map((d) => d.close()));
});

describe('budget_months — schema', () => {
  it('é reaplicável e cria as colunas esperadas', async () => {
    const db = await createDatabase();
    await expect(db.exec(migration)).resolves.not.toThrow();
    const r = await db.query<{ column_name: string; data_type: string; is_nullable: string; numeric_precision: number | null; numeric_scale: number | null }>(
      "select column_name, data_type, is_nullable, numeric_precision, numeric_scale from information_schema.columns where table_schema='public' and table_name='budget_months' order by ordinal_position"
    );
    expect(r.rows.map((c) => c.column_name)).toEqual(['id', 'user_id', 'Categoria', 'year', 'month', 'amount', 'created_at', 'updated_at']);
    const by = Object.fromEntries(r.rows.map((c) => [c.column_name, c]));
    expect(by.year.data_type).toBe('integer');
    expect(by.month.data_type).toBe('smallint');
    expect(by.amount).toMatchObject({ data_type: 'numeric', numeric_precision: 14, numeric_scale: 2 });
    for (const c of ['user_id', 'Categoria', 'year', 'month', 'amount']) expect(by[c].is_nullable).toBe('NO');
  });

  it('constraints: mês 1–12, amount > 0, categoria não vazia, unicidade', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    await expect(insert(db, A, 'X', 2026, 0)).rejects.toThrow();
    await expect(insert(db, A, 'X', 2026, 13)).rejects.toThrow();
    await expect(insert(db, A, 'X', 2026, 12)).resolves.toBeTruthy();
    await expect(insert(db, A, 'Y', 2026, 1, 0)).rejects.toThrow();
    await expect(insert(db, A, 'Y', 2026, 1, -5)).rejects.toThrow();
    await expect(insert(db, A, '', 2026, 1)).rejects.toThrow();
    await expect(insert(db, A, '   ', 2026, 1)).rejects.toThrow();
    await expect(insert(db, A, 'Y', 2026, 1, 0.01)).resolves.toBeTruthy();
    await expect(insert(db, A, 'Y', 2026, 1, 99)).rejects.toThrow(/duplicate|unique/i); // mesmo dono/categoria/ano/mês
    await expect(insert(db, A, 'Y', 2026, 2, 99)).resolves.toBeTruthy(); // outro mês
    await expect(insert(db, A, 'Y', 2027, 1, 99)).resolves.toBeTruthy(); // outro ano
  });

  it('numeric(14,2) arredonda centavos e o amount aceita só 2 casas', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const id = await insert(db, A, 'C', 2026, 5, 10.005);
    const r = await db.query<{ a: string }>('select amount::text a from public.budget_months where id=$1', [id]);
    expect(r.rows[0].a).toBe('10.01');
  });

  it('índice (user_id, year, month) e a unique; trigger atualiza updated_at', async () => {
    const db = await createDatabase();
    const idx = await db.query<{ indexname: string; indexdef: string }>(
      "select indexname, indexdef from pg_indexes where schemaname='public' and tablename='budget_months' order by indexname"
    );
    expect(idx.rows.map((i) => i.indexname)).toEqual([
      'budget_months_owner_category_period_key',
      'budget_months_pkey',
      'budget_months_user_period_idx',
    ]);
    expect(idx.rows.find((i) => i.indexname === 'budget_months_user_period_idx')!.indexdef).toContain('(user_id, year, month)');

    await as(db, 'authenticated', A);
    const id = await insert(db, A);
    const before = await db.query<{ u: string }>('select updated_at::text u from public.budget_months where id=$1', [id]);
    await db.query('select pg_sleep(0.02)');
    await db.query('update public.budget_months set amount = 10 where id = $1', [id]);
    const after = await db.query<{ u: string }>('select updated_at::text u from public.budget_months where id=$1', [id]);
    expect(after.rows[0].u).not.toBe(before.rows[0].u);
  });

  it('FK para auth.users com cascade; sem FK para categories', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    await insert(db, A);
    await as(db, 'postgres');
    const fk = await db.query<{ def: string }>("select pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.budget_months'::regclass and contype='f'");
    expect(fk.rows).toHaveLength(1);
    expect(fk.rows[0].def).toContain('REFERENCES auth.users(id) ON DELETE CASCADE');
    await db.exec(`delete from auth.users where id = '${A}'`);
    const n = await db.query<{ n: number | bigint }>('select count(*) n from public.budget_months');
    expect(Number(n.rows[0].n)).toBe(0);
  });

  it('nasce vazia: nenhum backfill a partir de budgets', async () => {
    const db = await createDatabase();
    await as(db, 'postgres');
    const n = await db.query<{ n: number | bigint }>('select count(*) n from public.budget_months');
    expect(Number(n.rows[0].n)).toBe(0);
    const b = await db.query<{ n: number | bigint }>('select count(*) n from public.budgets');
    expect(Number(b.rows[0].n)).toBe(1); // legado intacto
  });
});

describe('budget_months — RLS familiar', () => {
  it('policies: INSERT só do dono; SELECT/UPDATE/DELETE por has_family_access', async () => {
    const db = await createDatabase();
    const r = await db.query<{ cmd: string; roles: string; qual: string | null; with_check: string | null }>(
      "select cmd, roles::text, qual, with_check from pg_policies where schemaname='public' and tablename='budget_months'"
    );
    const by = Object.fromEntries(r.rows.map((p) => [p.cmd, p]));
    expect(Object.keys(by).sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
    for (const p of r.rows) expect(p.roles).toBe('{authenticated}');
    expect(by.SELECT.qual).toContain('has_family_access(user_id)');
    expect(by.INSERT.with_check).toContain('auth.uid() = user_id');
    expect(by.INSERT.with_check).not.toContain('has_family_access');
    expect(by.UPDATE.qual).toContain('has_family_access(user_id)');
    expect(by.UPDATE.with_check).toContain('has_family_access(user_id)');
    expect(by.DELETE.qual).toContain('has_family_access(user_id)');
    const rls = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid='public.budget_months'::regclass");
    expect(rls.rows[0].relrowsecurity).toBe(true);
  });

  it('A insere para A; A NÃO insere para B (nem o convidado para o dono)', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    await expect(insert(db, A)).resolves.toBeTruthy();
    await expect(insert(db, B, 'Outra')).rejects.toThrow(/row-level security/i);
    await as(db, 'authenticated', B);
    await expect(insert(db, A, 'Forjada')).rejects.toThrow(/row-level security/i);
    await expect(insert(db, B, 'Minha')).resolves.toBeTruthy();
  });

  it('visibilidade familiar: A vê B e B vê A; estranho não vê ninguém', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    await insert(db, A, 'DeA');
    await as(db, 'authenticated', B);
    await insert(db, B, 'DeB');
    const seenByB = await db.query<{ c: string }>('select "Categoria" c from public.budget_months order by 1');
    expect(seenByB.rows.map((r) => r.c)).toEqual(['DeA', 'DeB']);
    await as(db, 'authenticated', A);
    expect((await db.query('select 1 from public.budget_months')).rows).toHaveLength(2);
    await as(db, 'authenticated', D);
    expect((await db.query('select 1 from public.budget_months')).rows).toHaveLength(0);
  });

  it('não transitivo: dois convidados do mesmo dono não se veem', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    await insert(db, B, 'DeB');
    await as(db, 'authenticated', C);
    const seenByC = await db.query<{ c: string }>('select "Categoria" c from public.budget_months');
    expect(seenByC.rows).toHaveLength(0);
    await expect(db.query("update public.budget_months set amount = 1 where \"Categoria\" = 'DeB' returning id")).resolves.toMatchObject({ rows: [] });
    expect((await db.query("delete from public.budget_months where \"Categoria\" = 'DeB' returning id")).rows).toHaveLength(0);
  });

  it('membro da família atualiza amount e exclui a linha de outro; estranho não', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const id = await insert(db, A);
    await as(db, 'authenticated', D);
    expect((await db.query('update public.budget_months set amount = 1 where id = $1 returning id', [id])).rows).toHaveLength(0);
    expect((await db.query('delete from public.budget_months where id = $1 returning id', [id])).rows).toHaveLength(0);
    await as(db, 'authenticated', B);
    expect((await db.query('update public.budget_months set amount = 2222 where id = $1 returning amount::text a', [id])).rows).toEqual([{ a: '2222.00' }]);
    expect((await db.query('delete from public.budget_months where id = $1 returning id', [id])).rows).toHaveLength(1);
  });

  it('UPDATE de dono, categoria, ano ou mês é NEGADO (privilégio por coluna), até pelo dono', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const id = await insert(db, A);
    for (const sql of [
      `update public.budget_months set user_id = '${B}' where id = $1`,
      `update public.budget_months set "Categoria" = 'Outra' where id = $1`,
      `update public.budget_months set year = 2027 where id = $1`,
      `update public.budget_months set month = 11 where id = $1`,
    ]) {
      await expect(db.query(sql, [id]), sql).rejects.toThrow(/permission denied/i);
    }
    await expect(db.query('update public.budget_months set amount = 77 where id = $1', [id])).resolves.toBeTruthy();
  });

  it('anon sem acesso; sem sessão não vê nem grava', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    await insert(db, A);
    await as(db, 'anon');
    await expect(db.query('select * from public.budget_months')).rejects.toThrow(/permission denied/i);
    await as(db, 'authenticated', '');
    expect((await db.query('select * from public.budget_months')).rows).toHaveLength(0);
  });
});

describe('budget_months — privilégios', () => {
  it('authenticated: SELECT/INSERT/DELETE + UPDATE(amount); nada de TRUNCATE/TRIGGER/REFERENCES', async () => {
    const db = await createDatabase();
    // UPDATE é só por coluna: não aparece como privilégio de tabela
    expect(await privileges(db, 'budget_months', 'authenticated')).toEqual(['DELETE', 'INSERT', 'SELECT']);
    const cols = await db.query<{ column_name: string }>(
      "select column_name from information_schema.column_privileges where table_schema='public' and table_name='budget_months' and grantee='authenticated' and privilege_type='UPDATE' order by 1"
    );
    expect(cols.rows.map((c) => c.column_name)).toEqual(['amount']);
    expect(await privileges(db, 'budget_months', 'anon')).toEqual([]);
    expect(await privileges(db, 'budget_months', 'PUBLIC')).toEqual([]);
    await as(db, 'authenticated', A);
    await expect(db.exec('truncate public.budget_months')).rejects.toThrow(/permission denied/i);
  });
});

describe('budgets (legado) — hardening', () => {
  it('antes da migration o legado está aberto como em produção', async () => {
    const db = await createDatabase(false);
    const anon = await privileges(db, 'budgets', 'anon');
    const auth = await privileges(db, 'budgets', 'authenticated');
    expect(anon).toContain('TRUNCATE');
    expect(auth).toEqual(expect.arrayContaining(['TRUNCATE', 'TRIGGER', 'REFERENCES']));
  });

  it('depois: authenticated só CRUD; anon e PUBLIC nada; TRUNCATE negado; dados e policies intactos', async () => {
    const db = await createDatabase();
    expect(await privileges(db, 'budgets', 'authenticated')).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
    expect(await privileges(db, 'budgets', 'anon')).toEqual([]);
    expect(await privileges(db, 'budgets', 'PUBLIC')).toEqual([]);
    await as(db, 'authenticated', A);
    await expect(db.exec('truncate public.budgets')).rejects.toThrow(/permission denied/i);
    await as(db, 'anon');
    await expect(db.query('select * from public.budgets')).rejects.toThrow(/permission denied/i);
    await as(db, 'postgres');
    const pol = await db.query<{ policyname: string }>("select policyname from pg_policies where tablename='budgets' order by 1");
    expect(pol.rows.map((p) => p.policyname)).toEqual([
      'Allow individual full access on budgets',
      'Allow individual read access on budgets',
      'Family Access Budgets',
    ]);
    const n = await db.query<{ n: number | bigint }>('select count(*) n from public.budgets');
    expect(Number(n.rows[0].n)).toBe(1);
  });

  it('cliente antigo: select *, insert, update (payload com user_id) e delete continuam funcionando', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const sel = await db.query('select * from public.budgets');
    expect(sel.rows).toHaveLength(1);
    const ins = await db.query<{ id: string }>(
      `insert into public.budgets (user_id, "Categoria", "Valor_Limite_Mensal", ano) values ('${A}', 'Transporte', 600, 2026) returning id`
    );
    const id = ins.rows[0].id;
    const upd = await db.query(
      `update public.budgets set user_id = '${A}', "Categoria" = 'Transporte', "Valor_Limite_Mensal" = 700, ano = 2026 where id = $1 returning id`,
      [id]
    );
    expect(upd.rows).toHaveLength(1);
    expect((await db.query('delete from public.budgets where id = $1 returning id', [id])).rows).toHaveLength(1);
  });

  it('a migration não altera schema nem dados de budgets (só grants)', () => {
    const sql = migration.replace(/--.*$/gm, '').replace(/'[^']*'/g, "''");
    expect(sql).not.toMatch(/alter\s+table\s+public\.budgets/i);
    expect(sql).not.toMatch(/(insert\s+into|update|delete\s+from)\s+public\.budgets/i);
    const budgetsStatements = sql.split(';').filter((s) => /public\.budgets\b/.test(s)).map((s) => s.trim().replace(/\s+/g, ' '));
    expect(budgetsStatements).toEqual([
      'REVOKE ALL ON public.budgets FROM PUBLIC, anon, authenticated',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.budgets TO authenticated',
    ]);
  });
});

describe('rollback', () => {
  it('remove budget_months e MANTÉM o hardening de budgets e as funções compartilhadas', async () => {
    const db = await createDatabase();
    await db.exec(rollback);
    const t = await db.query("select to_regclass('public.budget_months') as r");
    expect((t.rows[0] as { r: string | null }).r).toBeNull();
    expect(await privileges(db, 'budgets', 'authenticated')).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
    expect(await privileges(db, 'budgets', 'anon')).toEqual([]);
    const fns = await db.query<{ proname: string }>("select proname from pg_proc where proname in ('handle_updated_at','has_family_access') order by 1");
    expect(fns.rows.map((f) => f.proname)).toEqual(['handle_updated_at', 'has_family_access']);
    expect(rollback.replace(/--.*$/gm, '')).not.toMatch(/budgets|GRANT/i);
    expect(rollback).toMatch(/INTENCIONAL E MONOTÔNICO/);
  });

  it('migration → rollback → migration funciona e o rollback é idempotente', async () => {
    const db = await createDatabase();
    await db.exec(rollback);
    await expect(db.exec(rollback)).resolves.not.toThrow();
    await expect(db.exec(migration)).resolves.not.toThrow();
    await as(db, 'authenticated', A);
    await expect(insert(db, A)).resolves.toBeTruthy();
  });
});
