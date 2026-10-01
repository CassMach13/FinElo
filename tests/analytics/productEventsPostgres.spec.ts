import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

/**
 * `product_events` num PostgreSQL descartável: o contrato de escrita (RLS + privilégios por
 * coluna), o dedupe dos milestones, as restrições de `properties` e o cascade.
 */
const migration = readFileSync(resolve('supabase/migrations/20261001180000_product_events.sql'), 'utf8');
const rollback = readFileSync(resolve('supabase/rollbacks/20261001180000_product_events_down.sql'), 'utf8');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

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

insert into auth.users (id, email) values
  ('${USER_ID}', 'a@example.test'),
  ('${OTHER_ID}', 'b@example.test');
`;

const databases: PGlite[] = [];

const createDatabase = async (): Promise<PGlite> => {
  const db = new PGlite();
  databases.push(db);
  await db.waitReady;
  await db.exec(baseSchema);
  await db.exec(migration);
  return db;
};

const assume = async (db: PGlite, role: 'anon' | 'authenticated' | 'postgres', userId = '') => {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
};

const insertAs = (db: PGlite, userId: string, name: string, dedupeKey: string | null = null, properties = '{}') =>
  db.query(
    'insert into public.product_events (user_id, event_name, dedupe_key, properties) values ($1, $2, $3, $4::jsonb)',
    [userId, name, dedupeKey, properties]
  );

const total = async (db: PGlite): Promise<number> => {
  await assume(db, 'postgres');
  const r = await db.query<{ n: number | bigint }>('select count(*) as n from public.product_events');
  return Number(r.rows[0].n);
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map((d) => d.close()));
});

describe('product_events — escrita pelo cliente', () => {
  it('a migration é reaplicável sem erro', async () => {
    const db = await createDatabase();
    await expect(db.exec(migration)).resolves.not.toThrow();
  });

  it('usuário autenticado registra o próprio evento e o horário vem do banco', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', USER_ID);
    await insertAs(db, USER_ID, 'import_started');

    await assume(db, 'postgres');
    const row = (await db.query<{ occurred_at: string; id: string; age_s: number }>(
      "select occurred_at, id, extract(epoch from (now() - occurred_at)) as age_s from public.product_events"
    )).rows[0];
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number(row.age_s)).toBeLessThan(5);
  });

  it('não registra evento em nome de outro usuário', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', USER_ID);
    await expect(insertAs(db, OTHER_ID, 'import_started')).rejects.toThrow(/row-level security/i);
    expect(await total(db)).toBe(0);
  });

  it('o cliente não consegue escolher occurred_at nem id (privilégio por coluna)', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', USER_ID);
    await expect(
      db.query(
        "insert into public.product_events (user_id, event_name, occurred_at) values ($1, 'import_started', '2020-01-01')",
        [USER_ID]
      )
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.query(
        "insert into public.product_events (id, user_id, event_name) values (gen_random_uuid(), $1, 'import_started')",
        [USER_ID]
      )
    ).rejects.toThrow(/permission denied/i);
  });

  it('anônimo não registra', async () => {
    const db = await createDatabase();
    await assume(db, 'anon');
    await expect(insertAs(db, USER_ID, 'import_started')).rejects.toThrow(/permission denied/i);
  });

  it('o cliente não lê, não atualiza e não apaga (log append-only)', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', USER_ID);
    await insertAs(db, USER_ID, 'import_started');
    await expect(db.query('select * from public.product_events')).rejects.toThrow(/permission denied/i);
    await expect(db.query("update public.product_events set event_name = 'x_y_z'")).rejects.toThrow(/permission denied/i);
    await expect(db.query('delete from public.product_events')).rejects.toThrow(/permission denied/i);
    expect(await total(db)).toBe(1);
  });
});

describe('product_events — milestones e eventos repetíveis', () => {
  it('o milestone é idempotente por usuário; outro usuário pode ter o mesmo', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', USER_ID);
    await insertAs(db, USER_ID, 'first_dashboard_with_real_data', 'first-dashboard-with-real-data');
    await expect(
      insertAs(db, USER_ID, 'first_dashboard_with_real_data', 'first-dashboard-with-real-data')
    ).rejects.toMatchObject({ code: '23505' });

    await assume(db, 'authenticated', OTHER_ID);
    await insertAs(db, OTHER_ID, 'first_dashboard_with_real_data', 'first-dashboard-with-real-data');
    expect(await total(db)).toBe(2);
  });

  it('evento repetível (dedupe nulo) aceita várias linhas', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', USER_ID);
    for (let i = 0; i < 3; i += 1) await insertAs(db, USER_ID, 'app_session_started');
    expect(await total(db)).toBe(3);
  });
});

describe('product_events — restrições de conteúdo e ciclo de vida', () => {
  it('properties tem que ser objeto pequeno; o nome do evento tem formato fixo', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', USER_ID);
    await expect(insertAs(db, USER_ID, 'import_failed', null, '[1,2]')).rejects.toThrow(/properties_object/);
    await expect(insertAs(db, USER_ID, 'import_failed', null, '"texto"')).rejects.toThrow(/properties_object/);
    const grande = JSON.stringify({ stage: 'x'.repeat(2000) });
    await expect(insertAs(db, USER_ID, 'import_failed', null, grande)).rejects.toThrow(/properties_small/);
    await expect(insertAs(db, USER_ID, 'Evento Livre')).rejects.toThrow(/event_name_format/);
    await insertAs(db, USER_ID, 'import_failed', null, '{"stage":"parse"}');
    expect(await total(db)).toBe(1);
  });

  it('apagar o usuário apaga os seus eventos (cascade)', async () => {
    const db = await createDatabase();
    await assume(db, 'authenticated', USER_ID);
    await insertAs(db, USER_ID, 'import_started');
    await assume(db, 'authenticated', OTHER_ID);
    await insertAs(db, OTHER_ID, 'import_started');

    await assume(db, 'postgres');
    await db.query('delete from auth.users where id = $1', [USER_ID]);
    expect(await total(db)).toBe(1);
  });

  it('o rollback remove a tabela', async () => {
    const db = await createDatabase();
    await db.exec(rollback);
    const r = await db.query<{ t: string | null }>("select to_regclass('public.product_events')::text as t");
    expect(r.rows[0].t).toBeNull();
  });
});
