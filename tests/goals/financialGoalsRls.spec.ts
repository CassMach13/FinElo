import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

/**
 * `financial_goals` num PostgreSQL descartável (PGlite): constraints, índice, trigger, RLS com dois
 * usuários, privilégios, rollback e reaplicação. `auth.uid()` é simulado por `request.jwt.claim.sub`,
 * como nos demais testes de migration do projeto; o PGlite aplica RLS de verdade para os roles
 * `authenticated`/`anon`, mas não é o Supabase: a verificação final é feita no staging.
 */
const migration = readFileSync(resolve('supabase/migrations/20261006120000_financial_goals.sql'), 'utf8');
const rollback = readFileSync(resolve('supabase/rollbacks/20261006120000_financial_goals_down.sql'), 'utf8');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const baseSchema = `
create schema auth;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table auth.users (id uuid primary key, email text not null);
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
insert into auth.users (id, email) values ('${A}', 'a@example.test'), ('${B}', 'b@example.test');

-- Função compartilhada (criada em 023_enable_subscriptions.sql); a migration só a usa.
create function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Sentinela: uma função de família NÃO pode ser usada pelas policies de objetivos.
create function public.has_family_access(record_user_id uuid) returns boolean
language sql as $$ select true $$;
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

const assume = async (db: PGlite, role: 'anon' | 'authenticated' | 'postgres', userId = '') => {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
};

const insertGoal = async (db: PGlite, userId: string, name = 'Viagem', target = 1000, current = 0) => {
  const r = await db.query<{ id: string }>(
    'insert into public.financial_goals (user_id, name, target_amount, current_amount) values ($1,$2,$3,$4) returning id',
    [userId, name, target, current]
  );
  return r.rows[0].id;
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map((d) => d.close()));
});

describe('financial_goals — schema', () => {
  it('a migration é reaplicável', async () => {
    const db = await createDatabase();
    await expect(db.exec(migration)).resolves.not.toThrow();
  });

  it('colunas, tipos e defaults', async () => {
    const db = await createDatabase();
    const r = await db.query<{ column_name: string; data_type: string; is_nullable: string; numeric_precision: number | null; numeric_scale: number | null }>(
      `select column_name, data_type, is_nullable, numeric_precision, numeric_scale
         from information_schema.columns where table_schema='public' and table_name='financial_goals' order by ordinal_position`
    );
    expect(r.rows.map((c) => c.column_name)).toEqual([
      'id', 'user_id', 'name', 'target_amount', 'current_amount', 'target_date', 'archived_at', 'created_at', 'updated_at',
    ]);
    const by = Object.fromEntries(r.rows.map((c) => [c.column_name, c]));
    expect(by.target_amount).toMatchObject({ data_type: 'numeric', numeric_precision: 14, numeric_scale: 2, is_nullable: 'NO' });
    expect(by.current_amount).toMatchObject({ data_type: 'numeric', numeric_precision: 14, numeric_scale: 2, is_nullable: 'NO' });
    expect(by.target_date).toMatchObject({ data_type: 'date', is_nullable: 'YES' });
    expect(by.archived_at).toMatchObject({ is_nullable: 'YES' });
    expect(by.user_id.is_nullable).toBe('NO');
  });

  it('constraints: nome 1–80 após trim, alvo > 0, atual ≥ 0', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', A);
    await expect(insertGoal(db, A, '')).rejects.toThrow();
    await expect(insertGoal(db, A, '   ')).rejects.toThrow();
    await expect(insertGoal(db, A, 'x'.repeat(81))).rejects.toThrow();
    await expect(insertGoal(db, A, 'x'.repeat(80))).resolves.toBeTruthy();
    await expect(insertGoal(db, A, 'ok', 0)).rejects.toThrow();
    await expect(insertGoal(db, A, 'ok', -5)).rejects.toThrow();
    await expect(insertGoal(db, A, 'ok', 100, -0.01)).rejects.toThrow();
    await expect(insertGoal(db, A, 'ok', 100, 0)).resolves.toBeTruthy();
  });

  it('atual maior que o alvo e prazo no passado são aceitos pelo banco', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', A);
    await expect(insertGoal(db, A, 'Passou do alvo', 1000, 5000)).resolves.toBeTruthy();
    await expect(
      db.query("insert into public.financial_goals (user_id, name, target_amount, target_date) values ($1,'Prazo antigo',10,'2020-01-31')", [A])
    ).resolves.toBeTruthy();
  });

  it('numeric(14,2) arredonda centavos e recusa estouro', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', A);
    const id = await insertGoal(db, A, 'cent', 10.005, 0.1 + 0.2);
    const r = await db.query<{ t: string; c: string }>('select target_amount::text t, current_amount::text c from public.financial_goals where id=$1', [id]);
    expect(r.rows[0].c).toBe('0.30');
    await expect(insertGoal(db, A, 'big', 1e12)).rejects.toThrow();
  });

  it('índice (user_id, archived_at) existe e não há índice extra além da PK', async () => {
    const db = await createDatabase();
    const r = await db.query<{ indexname: string; indexdef: string }>(
      "select indexname, indexdef from pg_indexes where schemaname='public' and tablename='financial_goals' order by indexname"
    );
    expect(r.rows.map((i) => i.indexname)).toEqual(['financial_goals_pkey', 'financial_goals_user_archived_idx']);
    expect(r.rows[1].indexdef).toContain('(user_id, archived_at)');
  });

  it('trigger atualiza updated_at', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', A);
    const id = await insertGoal(db, A);
    const before = await db.query<{ u: string }>('select updated_at::text u from public.financial_goals where id=$1', [id]);
    await db.query('select pg_sleep(0.02)');
    await db.query("update public.financial_goals set current_amount = 10 where id = $1", [id]);
    const after = await db.query<{ u: string; c: string }>('select updated_at::text u, created_at::text c from public.financial_goals where id=$1', [id]);
    expect(after.rows[0].u).not.toBe(before.rows[0].u);
    expect(after.rows[0].c).toBe(before.rows[0].u);
  });

  it('o usuário removido leva os objetivos junto (cascade)', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', A);
    await insertGoal(db, A);
    await assume(db, 'postgres');
    await db.exec(`delete from auth.users where id = '${A}'`);
    const r = await db.query<{ n: number | bigint }>('select count(*) n from public.financial_goals');
    expect(Number(r.rows[0].n)).toBe(0);
  });
});

describe('financial_goals — RLS owner-only', () => {
  it('quatro policies, todas por auth.uid(), nenhuma de família; WITH CHECK no UPDATE', async () => {
    const db = await createDatabase();
    const r = await db.query<{ policyname: string; cmd: string; roles: string; qual: string | null; with_check: string | null }>(
      "select policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname='public' and tablename='financial_goals' order by cmd"
    );
    expect(r.rows.map((p) => p.cmd).sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
    for (const p of r.rows) {
      expect(p.roles).toContain('authenticated');
      expect(`${p.qual ?? ''} ${p.with_check ?? ''}`).toContain('auth.uid()');
      expect(`${p.qual ?? ''} ${p.with_check ?? ''}`).not.toContain('family');
    }
    const update = r.rows.find((p) => p.cmd === 'UPDATE')!;
    expect(update.qual).toContain('auth.uid() = user_id');
    expect(update.with_check).toContain('auth.uid() = user_id');
    expect(r.rows.find((p) => p.cmd === 'INSERT')!.with_check).toContain('auth.uid() = user_id');
    expect(migration).not.toMatch(/has_family_access\s*\(/);
    const rls = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid = 'public.financial_goals'::regclass");
    expect(rls.rows[0].relrowsecurity).toBe(true);
  });

  it('A lê só os próprios; B não vê os de A', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', A);
    await insertGoal(db, A, 'De A');
    await assume(db, 'authenticated', B);
    await insertGoal(db, B, 'De B');
    const seenByB = await db.query<{ name: string }>('select name from public.financial_goals order by name');
    expect(seenByB.rows.map((r) => r.name)).toEqual(['De B']);
    await assume(db, 'authenticated', A);
    const seenByA = await db.query<{ name: string }>('select name from public.financial_goals');
    expect(seenByA.rows.map((r) => r.name)).toEqual(['De A']);
  });

  it('B não edita nem exclui objetivo de A (0 linhas afetadas)', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', A);
    const id = await insertGoal(db, A, 'De A', 1000, 100);
    await assume(db, 'authenticated', B);
    const upd = await db.query('update public.financial_goals set current_amount = 999 where id = $1 returning id', [id]);
    expect(upd.rows).toHaveLength(0);
    const del = await db.query('delete from public.financial_goals where id = $1 returning id', [id]);
    expect(del.rows).toHaveLength(0);
    await assume(db, 'authenticated', A);
    const r = await db.query<{ c: string }>('select current_amount::text c from public.financial_goals where id = $1', [id]);
    expect(r.rows[0].c).toBe('100.00');
  });

  it('INSERT só com o próprio user_id', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', B);
    await expect(insertGoal(db, A, 'Forjado por B')).rejects.toThrow(/row-level security/i);
    await expect(insertGoal(db, B, 'Meu')).resolves.toBeTruthy();
  });

  it('UPDATE não troca o dono (WITH CHECK)', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', A);
    const id = await insertGoal(db, A);
    await expect(db.query('update public.financial_goals set user_id = $1 where id = $2', [B, id])).rejects.toThrow(/row-level security/i);
    await assume(db, 'authenticated', B);
    const stolen = await db.query('select id from public.financial_goals where id = $1', [id]);
    expect(stolen.rows).toHaveLength(0);
  });

  it('o dono edita, arquiva, restaura e exclui o próprio objetivo', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', A);
    const id = await insertGoal(db, A);
    expect((await db.query('update public.financial_goals set name = $1, current_amount = 50 where id = $2 returning id', ['Novo', id])).rows).toHaveLength(1);
    expect((await db.query('update public.financial_goals set archived_at = now() where id = $1 returning id', [id])).rows).toHaveLength(1);
    expect((await db.query('update public.financial_goals set archived_at = null where id = $1 returning id', [id])).rows).toHaveLength(1);
    expect((await db.query('delete from public.financial_goals where id = $1 returning id', [id])).rows).toHaveLength(1);
  });

  it('anon não tem acesso; sem sessão (sub vazio) não vê nem grava', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', A);
    await insertGoal(db, A);
    await assume(db, 'anon');
    await expect(db.query('select * from public.financial_goals')).rejects.toThrow(/permission denied/i);
    await expect(insertGoal(db, A)).rejects.toThrow(/permission denied/i);
    await assume(db, 'authenticated', '');
    expect((await db.query('select * from public.financial_goals')).rows).toHaveLength(0);
    await expect(insertGoal(db, A)).rejects.toThrow();
  });
});

describe('financial_goals — privilégios', () => {
  it('authenticated só tem SELECT/INSERT/UPDATE/DELETE, mesmo com privilégios padrão do Supabase', async () => {
    // Imita o `ALTER DEFAULT PRIVILEGES ... GRANT ALL` do Supabase em tabelas novas.
    const db = new PGlite();
    databases.push(db);
    await db.waitReady;
    await db.exec(baseSchema);
    await db.exec('alter default privileges in schema public grant all on tables to anon, authenticated, service_role;');
    await db.exec(migration);
    const r = await db.query<{ grantee: string; privilege_type: string }>(
      "select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='financial_goals' and grantee in ('anon','authenticated','PUBLIC') order by 1,2"
    );
    expect(r.rows.filter((g) => g.grantee === 'anon' || g.grantee === 'PUBLIC')).toEqual([]);
    expect(r.rows.filter((g) => g.grantee === 'authenticated').map((g) => g.privilege_type)).toEqual([
      'DELETE', 'INSERT', 'SELECT', 'UPDATE',
    ]);
    await assume(db, 'authenticated', A);
    await expect(db.exec('truncate public.financial_goals')).rejects.toThrow(/permission denied/i);
  });
});

describe('financial_goals — rollback', () => {
  it('remove a tabela, o índice, o trigger e as policies, e preserva handle_updated_at', async () => {
    const db = await createDatabase();
    await db.exec(rollback);
    const t = await db.query("select to_regclass('public.financial_goals') as r");
    expect((t.rows[0] as { r: string | null }).r).toBeNull();
    const idx = await db.query("select count(*) n from pg_indexes where tablename='financial_goals'");
    expect(Number((idx.rows[0] as { n: number | bigint }).n)).toBe(0);
    const pol = await db.query("select count(*) n from pg_policies where tablename='financial_goals'");
    expect(Number((pol.rows[0] as { n: number | bigint }).n)).toBe(0);
    const trg = await db.query("select count(*) n from pg_trigger where tgname='trg_financial_goals_updated_at'");
    expect(Number((trg.rows[0] as { n: number | bigint }).n)).toBe(0);
    const fn = await db.query("select count(*) n from pg_proc where proname='handle_updated_at'");
    expect(Number((fn.rows[0] as { n: number | bigint }).n)).toBe(1);
  });

  it('migration → rollback → migration funciona e o rollback é idempotente', async () => {
    const db = await createDatabase();
    await db.exec(rollback);
    await expect(db.exec(rollback)).resolves.not.toThrow();
    await expect(db.exec(migration)).resolves.not.toThrow();
    await assume(db, 'authenticated', A);
    await expect(insertGoal(db, A)).resolves.toBeTruthy();
  });
});

describe('financial_goals — escopo da migration', () => {
  it('só cria a tabela nova: não mexe em transactions, contas, cartão, investimentos ou product_events', () => {
    const sql = migration.replace(/--.*$/gm, '').replace(/'[^']*'/g, "''");
    expect(sql).not.toMatch(/alter\s+table\s+(?!public\.financial_goals)/i);
    expect(sql).not.toMatch(/\b(transactions|contas|investments|product_events|credit_card)\b/i);
    expect(sql).not.toMatch(/drop\s+table|truncate|delete\s+from|create\s+or\s+replace\s+function/i);
  });
});
