import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

/**
 * Hardening de `public.transactions` num PostgreSQL descartável (PGlite): privilégios mínimos e INSERT somente do
 * dono, preservando a semântica familiar de SELECT/UPDATE/DELETE. A `has_family_access` é a REAL da migration 055 e
 * as policies/ACL são as de produção (lidas dos metadados antes de escrever a migration).
 */
const migration = readFileSync(resolve('supabase/migrations/20261007180000_harden_transactions_access.sql'), 'utf8');
const rollback = readFileSync(resolve('supabase/rollbacks/20261007180000_harden_transactions_access_down.sql'), 'utf8');
const familyMigration = readFileSync(resolve('supabase/migrations/055_fix_family_bidirectional_access.sql'), 'utf8');
const hasFamilyAccessSql = familyMigration.slice(familyMigration.indexOf('create or replace function public.has_family_access'));

const A = '11111111-1111-4111-8111-111111111111'; // dono
const B = '22222222-2222-4222-8222-222222222222'; // convidado aceito de A
const C = '33333333-3333-4333-8333-333333333333'; // estranho
const email = (id: string) => ({ [A]: 'a@example.test', [B]: 'b@example.test', [C]: 'c@example.test' })[id] as string;

const baseSchema = `
create schema auth;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role finelo_structural_entry_executor nologin;

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
insert into auth.users (id, email) values ('${A}', '${email(A)}'), ('${B}', '${email(B)}'), ('${C}', '${email(C)}');

create table public.family_members (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  owner_email text,
  member_email text not null,
  status text,
  created_at timestamptz default now()
);
insert into public.family_members (owner_id, owner_email, member_email, status)
  values ('${A}', '${email(A)}', '${email(B)}', 'accepted');

${hasFamilyAccessSql}
grant usage on schema public to anon, authenticated, service_role, finelo_structural_entry_executor;

-- Como no Supabase: tabelas novas nascem com ALL para anon/authenticated/service_role.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

create table public.transactions (
  "ID_Transacao" uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  "Data" timestamptz not null default now(),
  "Nome_Fantasia" text not null,
  "Valor" numeric not null,
  "Tipo" text,
  "Categoria" text
);
grant select on public.transactions to finelo_structural_entry_executor;
alter table public.transactions enable row level security;

-- Policies EXATAS de produção (todas TO public).
create policy "Allow individual full access on transactions" on public.transactions for all to public using (auth.uid() = user_id);
create policy "Allow individual read access on transactions" on public.transactions for select to public using (auth.uid() = user_id);
create policy "Family Delete Transactions" on public.transactions for delete to public using (public.has_family_access(user_id));
create policy "Family Insert Transactions" on public.transactions for insert to public with check (public.has_family_access(user_id));
create policy "Family Read Transactions" on public.transactions for select to public using (public.has_family_access(user_id));
create policy "Family Update Transactions" on public.transactions for update to public using (public.has_family_access(user_id));
create policy "Users can delete their own transactions" on public.transactions for delete to public using (auth.uid() = user_id);
create policy "Users can insert their own transactions" on public.transactions for insert to public with check (auth.uid() = user_id);
create policy "Users can update their own transactions" on public.transactions for update to public using (auth.uid() = user_id);
create policy "Users can view their own transactions" on public.transactions for select to public using (auth.uid() = user_id);

insert into public.transactions (user_id, "Nome_Fantasia", "Valor", "Tipo") values
  ('${A}', 'a1', -10, 'Despesa'), ('${B}', 'b1', -20, 'Despesa');
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

const privileges = async (db: PGlite, grantee: string) => {
  await as(db, 'postgres');
  const r = await db.query<{ p: string }>(
    "select privilege_type p from information_schema.role_table_grants where table_schema='public' and table_name='transactions' and grantee=$1 order by 1",
    [grantee]
  );
  return r.rows.map((x) => x.p);
};

const count = async (db: PGlite, where = 'true') =>
  Number((await db.query<{ n: string }>(`select count(*) n from public.transactions where ${where}`)).rows[0].n);

afterEach(async () => {
  await Promise.all(databases.splice(0).map((d) => d.close()));
});

describe('transactions — privilégios', () => {
  it('antes da migration o ACL está aberto (reproduz o problema)', async () => {
    const db = await createDatabase(false);
    expect(await privileges(db, 'anon')).toContain('TRUNCATE');
    expect(await privileges(db, 'authenticated')).toContain('TRUNCATE');
  });

  it('authenticated fica só com SELECT/INSERT/UPDATE/DELETE', async () => {
    const db = await createDatabase();
    expect(await privileges(db, 'authenticated')).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
    const r = await db.query<{ p: string; ok: boolean }>(
      `select p, has_table_privilege('authenticated','public.transactions',p) ok from unnest(array['TRUNCATE','TRIGGER','REFERENCES']) p`
    );
    expect(r.rows.every((x) => x.ok === false)).toBe(true);
  });

  it('anon e PUBLIC não têm nenhum privilégio de tabela nem de coluna', async () => {
    const db = await createDatabase();
    expect(await privileges(db, 'anon')).toEqual([]);
    expect(await privileges(db, 'PUBLIC')).toEqual([]);
    const r = await db.query<{ any: boolean }>(
      "select has_any_column_privilege('anon','public.transactions','SELECT,INSERT,UPDATE,REFERENCES') any"
    );
    expect(r.rows[0].any).toBe(false);
    const acl = await db.query<{ acl: string }>("select relacl::text acl from pg_class where oid='public.transactions'::regclass");
    expect(acl.rows[0].acl).not.toMatch(/(^|[{,])=/); // sem entrada de PUBLIC
  });

  it('papéis internos não são tocados', async () => {
    const db = await createDatabase();
    expect(await privileges(db, 'service_role')).toContain('TRUNCATE');
    expect(await privileges(db, 'finelo_structural_entry_executor')).toEqual(['SELECT']);
  });

  it('TRUNCATE é negado para authenticated e para anon', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    await expect(db.exec('truncate public.transactions')).rejects.toThrow(/permission denied/);
    await as(db, 'anon');
    await expect(db.exec('truncate public.transactions')).rejects.toThrow(/permission denied/);
    await as(db, 'postgres');
    expect(await count(db)).toBe(2);
  });

  it('anon não lê nem escreve', async () => {
    const db = await createDatabase();
    await as(db, 'anon');
    await expect(db.query('select 1 from public.transactions')).rejects.toThrow(/permission denied/);
    await expect(
      db.query(`insert into public.transactions (user_id, "Nome_Fantasia", "Valor") values ('${A}', 'x', 1)`)
    ).rejects.toThrow(/permission denied/);
  });

  it('a RLS continua habilitada', async () => {
    const db = await createDatabase();
    const r = await db.query<{ r: boolean }>("select relrowsecurity r from pg_class where oid='public.transactions'::regclass");
    expect(r.rows[0].r).toBe(true);
  });
});

describe('transactions — INSERT somente do dono', () => {
  it('A insere em nome de A (inclusive em lote, como o store)', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const r = await db.query(
      `insert into public.transactions (user_id, "Nome_Fantasia", "Valor", "Tipo", "Categoria")
       values ($1,'n1',-1,'Despesa','X'), ($1,'n2',2,'Renda','Y') returning "ID_Transacao"`,
      [A]
    );
    expect(r.rows).toHaveLength(2);
  });

  it('o user_id padrão (auth.uid()) continua funcionando para o cliente antigo', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    await db.query(`insert into public.transactions ("Nome_Fantasia", "Valor") values ('semowner', 5)`);
    await as(db, 'postgres');
    expect(await count(db, `"Nome_Fantasia" = 'semowner' and user_id = '${A}'`)).toBe(1);
  });

  it('A NÃO insere em nome de B mesmo com has_family_access(B) = true', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const access = await db.query<{ ok: boolean }>('select public.has_family_access($1) ok', [B]);
    expect(access.rows[0].ok).toBe(true); // pré-condição: a família alcança B
    await expect(
      db.query(`insert into public.transactions (user_id, "Nome_Fantasia", "Valor") values ($1, 'forjado', -1)`, [B])
    ).rejects.toThrow(/row-level security/);
  });

  it('B NÃO insere em nome de A; um estranho não insere em nome de ninguém', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', B);
    await expect(
      db.query(`insert into public.transactions (user_id, "Nome_Fantasia", "Valor") values ($1, 'forjado', -1)`, [A])
    ).rejects.toThrow(/row-level security/);
    await as(db, 'authenticated', C);
    await expect(
      db.query(`insert into public.transactions (user_id, "Nome_Fantasia", "Valor") values ($1, 'forjado', -1)`, [A])
    ).rejects.toThrow(/row-level security/);
    await as(db, 'postgres');
    expect(await count(db, `"Nome_Fantasia" = 'forjado'`)).toBe(0);
  });

  it('um lote com UMA linha em nome de outro falha inteiro', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    await expect(
      db.query(
        `insert into public.transactions (user_id, "Nome_Fantasia", "Valor") values ($1,'ok',1), ($2,'forjado',1)`,
        [A, B]
      )
    ).rejects.toThrow(/row-level security/);
    await as(db, 'postgres');
    expect(await count(db, `"Nome_Fantasia" in ('ok','forjado')`)).toBe(0);
  });

  it('as policies de INSERT são exatamente a do dono, TO authenticated', async () => {
    const db = await createDatabase();
    const r = await db.query<{ policyname: string; roles: string; with_check: string }>(
      "select policyname, roles::text, with_check from pg_policies where tablename='transactions' and cmd='INSERT' order by policyname"
    );
    const names = r.rows.map((p) => p.policyname);
    expect(names).not.toContain('Family Insert Transactions');
    expect(names).toContain('Users can insert their own transactions');
    const own = r.rows.find((p) => p.policyname === 'Users can insert their own transactions')!;
    expect(own.roles).toBe('{authenticated}');
    expect(own.with_check).toMatch(/auth\.uid\(\) = user_id/);
    expect(own.with_check).not.toMatch(/has_family_access/);
  });
});

describe('transactions — semântica familiar preservada', () => {
  it('A (dono) lê, atualiza e apaga lançamento de B; B faz o mesmo com os de A', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    expect(await count(db)).toBe(2);
    const bId = (await db.query<{ id: string }>(`select "ID_Transacao" id from public.transactions where user_id = '${B}'`)).rows[0].id;
    const up = await db.query(`update public.transactions set "Nome_Fantasia"='editado' where "ID_Transacao" = $1 returning 1`, [bId]);
    expect(up.rows).toHaveLength(1);
    const del = await db.query(`delete from public.transactions where "ID_Transacao" = $1 returning 1`, [bId]);
    expect(del.rows).toHaveLength(1);

    await as(db, 'authenticated', B);
    const aId = (await db.query<{ id: string }>(`select "ID_Transacao" id from public.transactions where user_id = '${A}'`)).rows[0].id;
    const upA = await db.query(`update public.transactions set "Nome_Fantasia"='editado' where "ID_Transacao" = $1 returning 1`, [aId]);
    expect(upA.rows).toHaveLength(1);
    const delA = await db.query(`delete from public.transactions where "ID_Transacao" = $1 returning 1`, [aId]);
    expect(delA.rows).toHaveLength(1);
  });

  it('o próprio usuário continua lendo, atualizando e apagando por ID', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const ins = await db.query<{ id: string }>(
      `insert into public.transactions (user_id, "Nome_Fantasia", "Valor") values ($1,'meu',-3) returning "ID_Transacao" id`,
      [A]
    );
    const id = ins.rows[0].id;
    expect((await db.query(`select 1 from public.transactions where "ID_Transacao" = $1`, [id])).rows).toHaveLength(1);
    expect((await db.query(`update public.transactions set "Valor" = -4 where "ID_Transacao" = $1 returning 1`, [id])).rows).toHaveLength(1);
    expect((await db.query(`delete from public.transactions where "ID_Transacao" = $1 returning 1`, [id])).rows).toHaveLength(1);
  });

  it('um estranho não lê, atualiza nem apaga', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', C);
    expect(await count(db)).toBe(0);
    expect((await db.query(`update public.transactions set "Nome_Fantasia"='x' returning 1`)).rows).toHaveLength(0);
    expect((await db.query(`delete from public.transactions returning 1`)).rows).toHaveLength(0);
    await as(db, 'postgres');
    expect(await count(db)).toBe(2);
  });

  it('as policies de SELECT/UPDATE/DELETE não mudam', async () => {
    const before = await createDatabase(false);
    const after = await createDatabase(true);
    const q = "select policyname, cmd, roles::text, qual, with_check from pg_policies where tablename='transactions' and cmd <> 'INSERT' order by policyname";
    expect((await after.query(q)).rows).toEqual((await before.query(q)).rows);
  }, 60_000);
});

describe('transactions — migration e rollback', () => {
  it('é reaplicável sem erro e não toca em dados', async () => {
    const db = await createDatabase();
    await expect(db.exec(migration)).resolves.not.toThrow();
    expect(await count(db)).toBe(2);
  });

  it('só contém hardening: nenhuma DDL de coluna nem DML', () => {
    const sql = migration.replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/\b(alter\s+table|add\s+column|insert\s+into|update\s+public|delete\s+from|truncate|create\s+table|drop\s+table)\b/i);
    expect(sql).toMatch(/revoke all on public\.transactions from public, anon, authenticated/i);
  });

  it('o rollback documental NÃO restaura anon, TRUNCATE nem INSERT familiar', async () => {
    const db = await createDatabase();
    await db.exec(rollback);
    expect(rollback).toContain('Este hardening de segurança não é revertido automaticamente.');
    expect(await privileges(db, 'anon')).toEqual([]);
    expect(await privileges(db, 'authenticated')).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
    await as(db, 'authenticated', A);
    await expect(
      db.query(`insert into public.transactions (user_id, "Nome_Fantasia", "Valor") values ($1,'forjado',1)`, [B])
    ).rejects.toThrow(/row-level security/);
  });
});
