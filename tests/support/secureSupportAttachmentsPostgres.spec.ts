import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  resolve('supabase/migrations/20260913135022_secure_support_attachments.sql'),
  'utf8'
);
const rollback = readFileSync(
  resolve('supabase/rollbacks/20260913135022_secure_support_attachments_down.sql'),
  'utf8'
);

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TICKET_ID = '33333333-3333-4333-8333-333333333333';
const MESSAGE_ID = '44444444-4444-4444-8444-444444444444';
const OBJECT_ID = '55555555-5555-4555-8555-555555555555';
const SECOND_MESSAGE_ID = '66666666-6666-4666-8666-666666666666';
const SECOND_OBJECT_ID = '77777777-7777-4777-8777-777777777777';

const databases: PGlite[] = [];

const baseSchema = `
create schema auth;
create schema storage;

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

create function auth.jwt()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'email', nullif(current_setting('request.jwt.claim.email', true), '')
  )
$$;

create table auth.users (
  id uuid primary key,
  email text not null
);

create table public.support_tickets (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  type text not null,
  subject text not null,
  description text not null,
  status text not null default 'open',
  attachment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.support_messages (
  id uuid primary key,
  ticket_id uuid not null references public.support_tickets(id),
  sender_id uuid not null references auth.users(id),
  message text not null,
  attachment_url text,
  created_at timestamptz not null default now()
);

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;

create policy "Users can view own tickets"
on public.support_tickets for select to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own tickets"
on public.support_tickets for insert to authenticated
with check (auth.uid() = user_id);

create policy "Admins can view all tickets"
on public.support_tickets for select to authenticated
using (lower(auth.jwt() ->> 'email') = 'cassiomq@gmail.com');

create policy "Admins can update all tickets"
on public.support_tickets for update to authenticated
using (lower(auth.jwt() ->> 'email') = 'cassiomq@gmail.com');

create policy "Users view messages of own tickets"
on public.support_messages for select to authenticated
using (
  exists (
    select 1 from public.support_tickets
    where id = ticket_id and user_id = auth.uid()
  )
);

create policy "Users insert messages to own tickets"
on public.support_messages for insert to authenticated
with check (
  exists (
    select 1 from public.support_tickets
    where id = ticket_id and user_id = auth.uid()
  )
);

create policy "Admins view all messages"
on public.support_messages for select to authenticated
using (lower(auth.jwt() ->> 'email') = 'cassiomq@gmail.com');

create policy "Admins insert messages"
on public.support_messages for insert to authenticated
with check (lower(auth.jwt() ->> 'email') = 'cassiomq@gmail.com');

create table storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id bigint generated always as identity primary key,
  bucket_id text not null references storage.buckets(id),
  name text not null,
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;

create function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/')
$$;

create function storage.filename(name text)
returns text
language sql
immutable
as $$
  select (regexp_match(name, '([^/]+)$'))[1]
$$;

grant usage on schema auth, storage to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
grant execute on function storage.foldername(text), storage.filename(text) to anon, authenticated, service_role;
grant select on public.support_tickets, public.support_messages to authenticated;
grant insert on public.support_tickets, public.support_messages to authenticated;
grant update on public.support_tickets to authenticated;
grant select, insert, delete on storage.objects to authenticated;
grant select on storage.objects to anon;
grant all on public.support_tickets, public.support_messages, storage.objects to service_role;

insert into auth.users (id, email) values
  ('${USER_ID}', 'owner@example.test'),
  ('${OTHER_ID}', 'other@example.test'),
  ('${ADMIN_ID}', 'cassiomq@gmail.com');
`;

const createDatabase = async (): Promise<PGlite> => {
  const db = new PGlite();
  databases.push(db);
  await db.waitReady;
  await db.exec(baseSchema);
  return db;
};

const assumeIdentity = async (
  db: PGlite,
  role: 'anon' | 'authenticated' | 'postgres',
  userId = '',
  email = ''
) => {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query("select set_config('request.jwt.claim.email', $1, false)", [email]);
};

const count = async (db: PGlite, sql: string): Promise<number> => {
  const result = await db.query<{ value: number | bigint | string }>(sql);
  return Number(result.rows[0].value);
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe('secure support attachment policies in disposable PostgreSQL 17', () => {
  it('applies the migration and enforces owner/admin/other/anon isolation', async () => {
    const db = await createDatabase();
    const version = await db.query<{ version: string }>('select version() as version');
    expect(version.rows[0].version).toContain('PostgreSQL 17');

    await db.exec(migration);
    await db.exec(migration);
    expect(await count(db, `
      select count(*) as value
      from pg_policies
      where (schemaname, tablename, policyname) in (
        ('public', 'support_tickets', 'support ticket attachment namespace guard'),
        ('public', 'support_messages', 'support message attachment namespace guard'),
        ('storage', 'objects', 'support attachments insert own namespace'),
        ('storage', 'objects', 'support attachments select authorized'),
        ('storage', 'objects', 'support attachments cleanup own unreferenced')
      )
    `)).toBe(5);

    const bucket = await db.query<{
      public: boolean;
      file_size_limit: bigint;
      mime_count: number;
    }>(`
      select public, file_size_limit, cardinality(allowed_mime_types) as mime_count
      from storage.buckets
      where id = 'support-attachments'
    `);
    expect(bucket.rows).toEqual([expect.objectContaining({
      public: false,
      file_size_limit: 10485760,
      mime_count: 5,
    })]);

    const ownerPath = `${USER_ID}/tickets/${TICKET_ID}/${OBJECT_ID}.pdf`;
    await assumeIdentity(db, 'authenticated', USER_ID, 'owner@example.test');
    await db.query(
      'insert into storage.objects (bucket_id, name) values ($1, $2)',
      ['support-attachments', ownerPath]
    );
    await db.query(`
      insert into public.support_tickets (
        id, user_id, type, subject, description, attachment_path
      ) values ($1, $2, 'bug', 'Fixture', 'Policy fixture', $3)
    `, [TICKET_ID, USER_ID, ownerPath]);

    await expect(db.query(
      'insert into storage.objects (bucket_id, name) values ($1, $2)',
      ['support-attachments', `${OTHER_ID}/tickets/${TICKET_ID}/${OBJECT_ID}.pdf`]
    )).rejects.toThrow(/row-level security policy/i);

    await expect(db.query(`
      insert into public.support_tickets (
        id, user_id, type, subject, description, attachment_path
      ) values ($1, $2, 'bug', 'Malicious', 'Cross-user reference', $3)
    `, [OBJECT_ID, USER_ID, `${OTHER_ID}/tickets/${OBJECT_ID}/${MESSAGE_ID}.pdf`]))
      .rejects.toThrow(/row-level security policy/i);

    await expect(db.query(`
      insert into public.support_messages (
        id, ticket_id, sender_id, message, attachment_path
      ) values ($1, $2, $3, 'Spoofed sender', $4)
    `, [
      SECOND_MESSAGE_ID,
      TICKET_ID,
      OTHER_ID,
      `${USER_ID}/messages/${SECOND_MESSAGE_ID}/${SECOND_OBJECT_ID}.pdf`,
    ])).rejects.toThrow(/row-level security policy/i);

    const adminPath = `${ADMIN_ID}/messages/${MESSAGE_ID}/${OBJECT_ID}.docx`;
    await assumeIdentity(db, 'authenticated', ADMIN_ID, 'cassiomq@gmail.com');
    await db.query(
      'insert into storage.objects (bucket_id, name) values ($1, $2)',
      ['support-attachments', adminPath]
    );
    await db.query(`
      insert into public.support_messages (
        id, ticket_id, sender_id, message, attachment_path
      ) values ($1, $2, $3, 'Admin fixture reply', $4)
    `, [MESSAGE_ID, TICKET_ID, ADMIN_ID, adminPath]);
    expect(await count(db, `
      select count(*) as value from storage.objects
      where bucket_id = 'support-attachments'
    `)).toBe(2);

    await assumeIdentity(db, 'authenticated', USER_ID, 'owner@example.test');
    expect(await count(db, `
      select count(*) as value from storage.objects where name = '${adminPath}'
    `)).toBe(1);

    await assumeIdentity(db, 'authenticated', OTHER_ID, 'other@example.test');
    expect(await count(db, `
      select count(*) as value from storage.objects
      where bucket_id = 'support-attachments'
    `)).toBe(0);

    await assumeIdentity(db, 'authenticated', ADMIN_ID, 'cassiomq@gmail.com');
    expect(await count(db, `
      select count(*) as value from storage.objects where name = '${ownerPath}'
    `)).toBe(1);

    await assumeIdentity(db, 'anon');
    expect(await count(db, `
      select count(*) as value from storage.objects
      where bucket_id = 'support-attachments'
    `)).toBe(0);
    await expect(db.query(
      'insert into storage.objects (bucket_id, name) values ($1, $2)',
      ['support-attachments', `${USER_ID}/tickets/${TICKET_ID}/${SECOND_OBJECT_ID}.pdf`]
    )).rejects.toThrow(/permission denied/i);
  });

  it('keeps persisted objects immutable to ordinary cleanup and fails rollback closed', async () => {
    const db = await createDatabase();
    await db.exec(migration);
    const ownerPath = `${USER_ID}/tickets/${TICKET_ID}/${OBJECT_ID}.png`;

    await assumeIdentity(db, 'authenticated', USER_ID, 'owner@example.test');
    await db.query(
      'insert into storage.objects (bucket_id, name) values ($1, $2)',
      ['support-attachments', ownerPath]
    );
    await db.query(`
      insert into public.support_tickets (
        id, user_id, type, subject, description, attachment_path
      ) values ($1, $2, 'bug', 'Fixture', 'Rollback fixture', $3)
    `, [TICKET_ID, USER_ID, ownerPath]);
    await db.query('delete from storage.objects where name = $1', [ownerPath]);
    expect(await count(db, `select count(*) as value from storage.objects`)).toBe(1);

    await assumeIdentity(db, 'postgres');
    await expect(db.exec(rollback)).rejects.toThrow(/rollback recusado/i);
    await db.exec('rollback;');
    expect(await count(db, `
      select count(*) as value from storage.buckets where id = 'support-attachments'
    `)).toBe(1);
    expect(await count(db, `
      select count(*) as value from public.support_tickets where attachment_path is not null
    `)).toBe(1);
  });

  it('rolls back an unused installation without dropping compatibility columns', async () => {
    const db = await createDatabase();
    await db.exec(migration);
    await db.exec(rollback);

    expect(await count(db, `
      select count(*) as value from storage.buckets where id = 'support-attachments'
    `)).toBe(0);
    expect(await count(db, `
      select count(*) as value
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('support_tickets', 'support_messages')
        and column_name = 'attachment_path'
    `)).toBe(2);
  });
});
