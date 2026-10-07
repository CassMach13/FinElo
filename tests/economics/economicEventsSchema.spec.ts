import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

/**
 * Identidade econômica V1 (Fase 1) num PostgreSQL descartável: schema, FK composta (mesmo dono garantido
 * pelo banco), RLS familiar com a `has_family_access` REAL, grants, compatibilidade com cliente antigo e
 * rollback. O hardening de `transactions` (20261007180000) é aplicado antes e não pode ser reaberto.
 */
const read = (p: string) => readFileSync(resolve(p), 'utf8');
const hardening = read('supabase/migrations/20261007180000_harden_transactions_access.sql');
const migration = read('supabase/migrations/20261007200000_economic_events_v1.sql');
const rollback = read('supabase/rollbacks/20261007200000_economic_events_v1_down.sql');
const family = read('supabase/migrations/055_fix_family_bidirectional_access.sql');
const hasFamilyAccessSql = family.slice(family.indexOf('create or replace function public.has_family_access'));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222'; // convidado aceito de A
const C = '33333333-3333-4333-8333-333333333333'; // estranho
const email = (id: string) => ({ [A]: 'a@example.test', [B]: 'b@example.test', [C]: 'c@example.test' })[id] as string;
const ACC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACC_NULL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const baseSchema = `
create schema auth;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role finelo_structural_entry_executor nologin;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table auth.users (id uuid primary key, email text not null);
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
insert into auth.users (id, email) values ('${A}', '${email(A)}'), ('${B}', '${email(B)}'), ('${C}', '${email(C)}');
create table public.family_members (id uuid default gen_random_uuid() primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  owner_email text, member_email text not null, status text, created_at timestamptz default now());
insert into public.family_members (owner_id, owner_email, member_email, status) values ('${A}', '${email(A)}', '${email(B)}', 'accepted');
${hasFamilyAccessSql}
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

create table public.contas (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id), "Nome_Conta" text);
insert into public.contas (id, user_id, "Nome_Conta") values ('${ACC_A}','${A}','a'), ('${ACC_B}','${B}','b'), ('${ACC_NULL}', null, 'orfa');

create table public.transactions (
  "ID_Transacao" uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  "Data" timestamptz not null default now(), "Nome_Fantasia" text not null, "Valor" numeric not null, "Tipo" text, "Categoria" text
);
alter table public.transactions enable row level security;
create policy "Allow individual full access on transactions" on public.transactions for all to public using (auth.uid() = user_id);
create policy "Family Read Transactions" on public.transactions for select to public using (public.has_family_access(user_id));
create policy "Family Update Transactions" on public.transactions for update to public using (public.has_family_access(user_id));
create policy "Family Delete Transactions" on public.transactions for delete to public using (public.has_family_access(user_id));
create policy "Family Insert Transactions" on public.transactions for insert to public with check (public.has_family_access(user_id));
create policy "Users can insert their own transactions" on public.transactions for insert to public with check (auth.uid() = user_id);
insert into public.transactions (user_id, "Nome_Fantasia", "Valor", "Tipo") values ('${A}', 'antiga-a', -10, 'Despesa'), ('${B}', 'antiga-b', -20, 'Despesa');
`;

const databases: PGlite[] = [];
const createDatabase = async (apply = true): Promise<PGlite> => {
  const db = new PGlite();
  databases.push(db);
  await db.waitReady;
  await db.exec(baseSchema);
  await db.exec(hardening);
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
const newEvent = async (db: PGlite, owner = A, kind = 'credit_card_payment', source = 'pay_invoice_flow') =>
  (
    await db.query<{ id: string }>('insert into public.economic_events (user_id, created_by, kind, source) values ($1,$1,$2,$3) returning id', [
      owner,
      kind,
      source,
    ])
  ).rows[0].id;
const newTx = async (db: PGlite, owner: string, eventId: string | null, name = 'perna') =>
  (
    await db.query<{ id: string }>(
      `insert into public.transactions (user_id, "Nome_Fantasia", "Valor", "Tipo", economic_event_id) values ($1,$2,-1,'Despesa',$3) returning "ID_Transacao" id`,
      [owner, name, eventId]
    )
  ).rows[0].id;
const privs = async (db: PGlite, table: string, grantee: string) => {
  await as(db, 'postgres');
  return (
    await db.query<{ p: string }>(
      "select privilege_type p from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee=$2 order by 1",
      [table, grantee]
    )
  ).rows.map((r) => r.p);
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map((d) => d.close()));
});

describe('economic_events — schema', () => {
  it('colunas, CHECKs, FK e UNIQUE(user_id,id); migration reaplicável', async () => {
    const db = await createDatabase();
    await expect(db.exec(migration)).resolves.not.toThrow();
    const cols = await db.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
      "select column_name, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='economic_events' order by ordinal_position"
    );
    expect(cols.rows.map((c) => c.column_name)).toEqual([
      'id',
      'user_id',
      'kind',
      'source',
      'counterparty_account_id',
      'created_by',
      'created_at',
    ]);
    const by = Object.fromEntries(cols.rows.map((c) => [c.column_name, c]));
    for (const c of ['id', 'user_id', 'kind', 'source', 'created_by', 'created_at']) expect(by[c].is_nullable).toBe('NO');
    expect(by.counterparty_account_id.is_nullable).toBe('YES');
    expect(by.created_by.column_default).toMatch(/auth\.uid\(\)/);
    const cons = (
      await db.query<{ conname: string; def: string }>(
        "select conname, pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.economic_events'::regclass"
      )
    ).rows;
    const d = Object.fromEntries(cons.map((c) => [c.conname, c.def]));
    expect(d.economic_events_user_id_id_key).toMatch(/UNIQUE \(user_id, id\)/);
    expect(d.economic_events_kind_check).toMatch(/own_account_transfer.*credit_card_payment/s);
    expect(d.economic_events_source_check).toMatch(/pay_invoice_flow.*transfer_flow.*user.*backfill_funding_marker/s);
    expect(Object.values(d).some((x) => /FOREIGN KEY \(user_id\) REFERENCES auth\.users\(id\) ON DELETE CASCADE/.test(x))).toBe(true);
    expect(
      Object.values(d).some((x) => /FOREIGN KEY \(counterparty_account_id\) REFERENCES (public\.)?contas\(id\) ON DELETE SET NULL/.test(x))
    ).toBe(true);
  });

  it('kind e source fora da lista são recusados (refund/investment/other/generic não existem na V1)', async () => {
    const db = await createDatabase();
    for (const kind of ['refund', 'investment_contribution', 'other_internal', 'generic']) {
      await expect(newEvent(db, A, kind)).rejects.toThrow(/economic_events_kind_check/);
    }
    await expect(newEvent(db, A, 'credit_card_payment', 'heuristic')).rejects.toThrow(/economic_events_source_check/);
    await expect(newEvent(db, A, 'own_account_transfer', 'transfer_flow')).resolves.toBeTruthy();
  });

  it('transactions.economic_event_id é nullable, sem default, e a FK composta + índice existem', async () => {
    const db = await createDatabase();
    const col = await db.query<{ is_nullable: string; column_default: string | null; data_type: string }>(
      "select is_nullable, column_default, data_type from information_schema.columns where table_name='transactions' and column_name='economic_event_id'"
    );
    expect(col.rows[0]).toMatchObject({ is_nullable: 'YES', column_default: null, data_type: 'uuid' });
    const fk = (
      await db.query<{ def: string }>(
        "select pg_get_constraintdef(oid) def from pg_constraint where conname='transactions_economic_event_owner_fkey'"
      )
    ).rows[0].def;
    expect(fk).toMatch(
      /FOREIGN KEY \(user_id, economic_event_id\) REFERENCES (public\.)?economic_events\(user_id, id\) ON DELETE SET NULL \(economic_event_id\)/
    );
    const idx = (await db.query<{ indexdef: string }>("select indexdef from pg_indexes where indexname='idx_transactions_economic_event'")).rows[0]
      .indexdef;
    expect(idx).toMatch(/\(economic_event_id\) WHERE \(economic_event_id IS NOT NULL\)/);
  });

  it('as linhas existentes ficam com economic_event_id = NULL (sem backfill)', async () => {
    const db = await createDatabase();
    const r = await db.query<{ n: string }>('select count(*) n from public.transactions where economic_event_id is not null');
    expect(Number(r.rows[0].n)).toBe(0);
  });
});

describe('economic_events — mesmo dono garantido pelo banco', () => {
  it('transação de A → evento de A: ok; transação de B → evento de A: NEGADA pela FK (não pela RLS)', async () => {
    const db = await createDatabase();
    const ev = await newEvent(db, A); // como postgres: a RLS não participa
    await expect(newTx(db, A, ev)).resolves.toBeTruthy();
    await expect(newTx(db, B, ev)).rejects.toThrow(/transactions_economic_event_owner_fkey/);
  });

  it('A não consegue apontar uma transação sua para o evento de B', async () => {
    const db = await createDatabase();
    const evB = await newEvent(db, B);
    await as(db, 'authenticated', A);
    await expect(newTx(db, A, evB)).rejects.toThrow(/violates foreign key|row-level security/);
  });

  it('apagar o evento NÃO apaga a transação: só economic_event_id vira NULL e user_id permanece', async () => {
    const db = await createDatabase();
    const ev = await newEvent(db, A);
    const tx = await newTx(db, A, ev);
    await db.query('delete from public.economic_events where id = $1', [ev]);
    const r = await db.query<{ user_id: string; economic_event_id: string | null }>(
      'select user_id, economic_event_id from public.transactions where "ID_Transacao" = $1',
      [tx]
    );
    expect(r.rows).toEqual([{ user_id: A, economic_event_id: null }]);
  });

  it('excluir UMA perna não apaga a outra nem o evento', async () => {
    const db = await createDatabase();
    const ev = await newEvent(db, A);
    const t1 = await newTx(db, A, ev, 'cartao');
    const t2 = await newTx(db, A, ev, 'banco');
    await db.query('delete from public.transactions where "ID_Transacao" = $1', [t1]);
    const other = await db.query<{ economic_event_id: string }>('select economic_event_id from public.transactions where "ID_Transacao" = $1', [t2]);
    expect(other.rows[0].economic_event_id).toBe(ev);
    expect((await db.query('select 1 from public.economic_events where id = $1', [ev])).rows).toHaveLength(1);
  });

  it('counterparty: conta do mesmo dono ok; de outro dono ou sem dono recusada; conta apagada → NULL', async () => {
    const db = await createDatabase();
    const ins = (acc: string) =>
      db.query<{ id: string }>(
        "insert into public.economic_events (user_id, created_by, kind, source, counterparty_account_id) values ($1,$1,'own_account_transfer','user',$2) returning id",
        [A, acc]
      );
    const ok = await ins(ACC_A);
    await expect(ins(ACC_B)).rejects.toThrow(/mesmo usuário/);
    await expect(ins(ACC_NULL)).rejects.toThrow(/mesmo usuário/);
    await db.query('delete from public.contas where id = $1', [ACC_A]);
    const r = await db.query<{ counterparty_account_id: string | null }>(
      'select counterparty_account_id from public.economic_events where id = $1',
      [ok.rows[0].id]
    );
    expect(r.rows[0].counterparty_account_id).toBeNull();
  });
});

describe('economic_events — RLS e grants', () => {
  it('A cria evento próprio; em nome de B é negado; created_by arbitrário é negado', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    await expect(newEvent(db, A)).resolves.toBeTruthy();
    await expect(newEvent(db, B)).rejects.toThrow(/row-level security/);
    await expect(
      db.query("insert into public.economic_events (user_id, created_by, kind, source) values ($1,$2,'credit_card_payment','pay_invoice_flow')", [A, B])
    ).rejects.toThrow(/row-level security/);
  });

  it('created_by usa auth.uid() por padrão', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const r = await db.query<{ created_by: string }>(
      "insert into public.economic_events (user_id, kind, source) values ($1,'credit_card_payment','pay_invoice_flow') returning created_by",
      [A]
    );
    expect(r.rows[0].created_by).toBe(A);
  });

  it('família: B (convidado de A) vê e apaga evento de A; estranho vê 0 e apaga 0', async () => {
    const db = await createDatabase();
    const ev = await newEvent(db, A);
    await as(db, 'authenticated', C);
    expect((await db.query('select 1 from public.economic_events')).rows).toHaveLength(0);
    expect((await db.query('delete from public.economic_events returning 1')).rows).toHaveLength(0);
    await as(db, 'authenticated', B);
    expect((await db.query('select 1 from public.economic_events where id = $1', [ev])).rows).toHaveLength(1);
    expect((await db.query('delete from public.economic_events where id = $1 returning 1', [ev])).rows).toHaveLength(1);
  });

  it('não há UPDATE: nem privilégio, nem policy', async () => {
    const db = await createDatabase();
    const ev = await newEvent(db, A);
    await as(db, 'authenticated', A);
    await expect(db.query("update public.economic_events set kind = 'own_account_transfer' where id = $1", [ev])).rejects.toThrow(/permission denied/);
    await as(db, 'postgres');
    const pol = await db.query<{ cmd: string }>("select cmd from pg_policies where tablename='economic_events' order by cmd");
    expect(pol.rows.map((p) => p.cmd)).toEqual(['DELETE', 'INSERT', 'SELECT']);
  });

  it('grants: authenticated só SELECT/INSERT/DELETE; anon e PUBLIC nada; RLS ligada', async () => {
    const db = await createDatabase();
    expect(await privs(db, 'economic_events', 'authenticated')).toEqual(['DELETE', 'INSERT', 'SELECT']);
    expect(await privs(db, 'economic_events', 'anon')).toEqual([]);
    expect(await privs(db, 'economic_events', 'PUBLIC')).toEqual([]);
    const r = await db.query<{ p: string; ok: boolean }>(
      "select p, has_table_privilege('authenticated','public.economic_events',p) ok from unnest(array['UPDATE','TRUNCATE','TRIGGER','REFERENCES']) p"
    );
    expect(r.rows.every((x) => !x.ok)).toBe(true);
    expect((await db.query<{ r: boolean }>("select relrowsecurity r from pg_class where oid='public.economic_events'::regclass")).rows[0].r).toBe(true);
    await as(db, 'anon');
    await expect(db.query('select 1 from public.economic_events')).rejects.toThrow(/permission denied/);
  });
});

describe('transactions — hardening preservado e cliente antigo', () => {
  it('a coluna nova NÃO reabre privilégios de transactions', async () => {
    const db = await createDatabase();
    expect(await privs(db, 'transactions', 'authenticated')).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
    expect(await privs(db, 'transactions', 'anon')).toEqual([]);
    expect(await privs(db, 'transactions', 'PUBLIC')).toEqual([]);
    const r = await db.query<{ ok: boolean }>(
      "select bool_or(has_table_privilege('authenticated','public.transactions',p)) ok from unnest(array['TRUNCATE','TRIGGER','REFERENCES']) p"
    );
    expect(r.rows[0].ok).toBe(false);
  });

  it('cliente antigo: INSERT/SELECT */UPDATE/DELETE sem economic_event_id continuam funcionando', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const ins = await db.query<{ id: string }>(
      `insert into public.transactions ("Nome_Fantasia", "Valor", "Tipo") values ('velha', -5, 'Despesa') returning "ID_Transacao" id`
    );
    const id = ins.rows[0].id;
    const sel = await db.query<{ economic_event_id: string | null }>('select * from public.transactions where "ID_Transacao" = $1', [id]);
    expect(sel.rows[0].economic_event_id).toBeNull();
    expect((await db.query(`update public.transactions set "Valor" = -6 where "ID_Transacao" = $1 returning 1`, [id])).rows).toHaveLength(1);
    expect((await db.query('delete from public.transactions where "ID_Transacao" = $1 returning 1', [id])).rows).toHaveLength(1);
  });

  it('editar campos normais de uma perna com evento preserva o economic_event_id (update parcial)', async () => {
    const db = await createDatabase();
    const ev = await newEvent(db, A);
    const tx = await newTx(db, A, ev);
    await as(db, 'authenticated', A);
    await db.query(`update public.transactions set "Nome_Fantasia"='editado', "Valor"=-9, "Categoria"='Z', "Data"=now() where "ID_Transacao" = $1`, [tx]);
    const r = await db.query<{ economic_event_id: string }>('select economic_event_id from public.transactions where "ID_Transacao" = $1', [tx]);
    expect(r.rows[0].economic_event_id).toBe(ev);
  });

  it('INSERT de lote com o mesmo evento nas duas pernas (como o Pagar) é atômico', async () => {
    const db = await createDatabase();
    await as(db, 'authenticated', A);
    const ev = await newEvent(db, A);
    const r = await db.query<{ economic_event_id: string }>(
      `insert into public.transactions (user_id, "Nome_Fantasia", "Valor", "Tipo", economic_event_id)
       values ($1,'cartao',10,'Renda',$2), ($1,'banco',-10,'Despesa',$2) returning economic_event_id`,
      [A, ev]
    );
    expect(r.rows.map((x) => x.economic_event_id)).toEqual([ev, ev]);
  });
});

describe('migration e rollback', () => {
  it('é aditiva: nenhum DML, nenhum DROP de dados; não mexe no hardening de transactions', () => {
    const sql = migration.replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/\b(insert\s+into\s+public\.transactions|update\s+public\.transactions|delete\s+from|truncate|drop\s+table|drop\s+column)\b/i);
    expect(sql).not.toMatch(/(grant|revoke)[^;]*public\.transactions/i);
    expect(sql).not.toMatch(/create\s+policy[^;]*on\s+public\.transactions/i);
  });

  it('rollback remove economic_events e a coluna, preserva as transações e o hardening', async () => {
    const db = await createDatabase();
    const ev = await newEvent(db, A);
    await newTx(db, A, ev);
    await db.exec(rollback);
    expect((await db.query("select to_regclass('public.economic_events') t")).rows[0]).toEqual({ t: null });
    const col = await db.query("select 1 from information_schema.columns where table_name='transactions' and column_name='economic_event_id'");
    expect(col.rows).toHaveLength(0);
    expect(Number((await db.query<{ n: string }>('select count(*) n from public.transactions')).rows[0].n)).toBe(3);
    expect(await privs(db, 'transactions', 'anon')).toEqual([]);
    expect(await privs(db, 'transactions', 'authenticated')).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
  });
});
