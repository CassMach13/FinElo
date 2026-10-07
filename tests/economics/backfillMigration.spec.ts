import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

/**
 * Fase 3C: reserva do source de backfill (policy) + backfill do legado do Pagar, num PostgreSQL descartável.
 * Schema espelha produção: `transactions` NÃO tem coluna `Observacoes`; o marcador vive em `Descricao_Original`.
 */
const read = (p: string) => readFileSync(resolve(p), 'utf8');
const hardening = read('supabase/migrations/20261007180000_harden_transactions_access.sql');
const phase1 = read('supabase/migrations/20261007200000_economic_events_v1.sql');
const migration = read('supabase/migrations/20261007220000_backfill_legacy_invoice_payment_identity.sql');
const rollback = read('supabase/rollbacks/20261007220000_backfill_legacy_invoice_payment_identity_down.sql');
const family = read('supabase/migrations/055_fix_family_bidirectional_access.sql');
const hasFamilyAccessSql = family.slice(family.indexOf('create or replace function public.has_family_access'));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const email = (id: string) => ({ [A]: 'a@example.test', [B]: 'b@example.test' })[id] as string;
const MARK = 'Pagamento Fatura (2026-09) finelo_competence:2026-09 finelo_funding_account:';

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
insert into auth.users (id, email) values ('${A}', '${email(A)}'), ('${B}', '${email(B)}');
create table public.family_members (id uuid default gen_random_uuid() primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  owner_email text, member_email text not null, status text, created_at timestamptz default now());
${hasFamilyAccessSql}
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create table public.contas (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id), "Nome_Conta" text);
create table public.transactions (
  "ID_Transacao" uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  "Data" timestamptz not null default now(), "Data_Pagamento" timestamptz, "Nome_Fantasia" text not null, "Valor" numeric not null,
  "Tipo" text, "Categoria" text, "Origem" text, "Descricao_Original" text, "ID_Conta" uuid
);
alter table public.transactions enable row level security;
create policy "Allow individual full access on transactions" on public.transactions for all to public using (auth.uid() = user_id);
`;

const databases: PGlite[] = [];
const create = async (applyBackfill = false): Promise<PGlite> => {
  const db = new PGlite();
  databases.push(db);
  await db.waitReady;
  await db.exec(baseSchema);
  await db.exec(hardening);
  await db.exec(phase1);
  if (applyBackfill) await db.exec(migration);
  return db;
};
afterEach(async () => { await Promise.all(databases.splice(0).map((d) => d.close())); });

const insertTx = async (db: PGlite, o: Record<string, unknown>) =>
  (await db.query<{ id: string }>(
    `insert into public.transactions (user_id, "Data", "Nome_Fantasia", "Valor", "Tipo", "Categoria", "Origem", "Descricao_Original", economic_event_id)
     values ($1, coalesce($2::timestamptz, now()), $3, $4, $5, $6, 'manual', $7, $8) returning "ID_Transacao" id`,
    [o.user ?? A, o.data ?? null, o.name ?? 'x', o.valor ?? -100, o.tipo ?? 'Despesa', o.cat ?? 'Cat', o.desc ?? null, o.event ?? null]
  )).rows[0].id;
const eventsBySource = async (db: PGlite, source = 'backfill_funding_marker') =>
  (await db.query<Record<string, any>>('select * from public.economic_events where source = $1 order by id', [source])).rows;
const asUser = async (db: PGlite, id: string) => {
  await db.exec('reset role;');
  await db.exec('set role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: id, email: email(id), role: 'authenticated' })]);
};

describe('3C — contrato da policy (source de backfill reservado)', () => {
  it('a migration recria só a policy de INSERT, com `source <> backfill_funding_marker`', () => {
    const sql = migration.replace(/--.*$/gm, '');
    const policy = /create policy "economic_events_insert_own"[\s\S]*?;/i.exec(sql)![0];
    expect(policy).toMatch(/for insert to authenticated/i);
    expect(policy).toMatch(/auth\.uid\(\)\s*=\s*user_id/);
    expect(policy).toMatch(/created_by\s*=\s*auth\.uid\(\)/);
    expect(policy).toMatch(/source\s*<>\s*'backfill_funding_marker'/);
    expect((sql.match(/create policy/gi) ?? [])).toHaveLength(1);
    expect(sql).not.toMatch(/alter table|grant |revoke |create trigger|session_user|current_user/i);
  });

  it('no banco: INSERT de authenticated com source reservado é NEGADO; os demais continuam permitidos', async () => {
    const db = await create(true);
    await asUser(db, A);
    const ins = (source: string) =>
      db.query("insert into public.economic_events (user_id, kind, source) values ($1,'own_account_transfer',$2)", [A, source]);
    await expect(ins('backfill_funding_marker')).rejects.toThrow(/row-level security/);
    await expect(ins('user')).resolves.toBeTruthy();
    await expect(ins('pay_invoice_flow')).resolves.toBeTruthy();
    await expect(ins('transfer_flow')).resolves.toBeTruthy();
  });

  it('SELECT/DELETE familiares, GRANTs e CHECK de source permanecem', async () => {
    const db = await create(true);
    const pol = await db.query<{ policyname: string; cmd: string }>("select policyname, cmd from pg_policies where tablename='economic_events' order by cmd, policyname");
    expect(pol.rows.map((p) => `${p.cmd}:${p.policyname}`)).toEqual([
      'DELETE:economic_events_delete_family', 'INSERT:economic_events_insert_own', 'SELECT:economic_events_select_family',
    ]);
    const grants = await db.query<{ p: string }>("select privilege_type p from information_schema.role_table_grants where table_name='economic_events' and grantee='authenticated' order by 1");
    expect(grants.rows.map((g) => g.p)).toEqual(['DELETE', 'INSERT', 'SELECT']);
    const check = (await db.query<{ d: string }>("select pg_get_constraintdef(oid) d from pg_constraint where conname='economic_events_source_check'")).rows[0].d;
    for (const s of ['pay_invoice_flow', 'transfer_flow', 'user', 'backfill_funding_marker']) expect(check).toContain(s);
  });

  it('o evento de backfill não pode ser criado por um cliente nem desfeito pela regra de undo da 3B (source ≠ user)', async () => {
    const mark = read('src/domain/economics/manualEconomicIdentity.ts');
    expect(mark).toMatch(/event\.kind === 'own_account_transfer' && event\.source === 'user'/);
  });
});

describe('3C — backfill: elegibilidade só pelo marcador', () => {
  it('marcador em Descricao_Original + economic_event_id NULL ⇒ elegível; sem marcador ⇒ não', async () => {
    const db = await create();
    const eligible = await insertTx(db, { desc: `${MARK}acc-1` });
    const plain = await insertTx(db, { desc: 'Pagamento de Fatura' }); // mesmo texto humano, sem marcador
    await db.exec(migration);
    const rows = (await db.query<{ id: string; ev: string | null }>('select "ID_Transacao" id, economic_event_id ev from public.transactions')).rows;
    expect(rows.find((r) => r.id === eligible)!.ev).toBeTruthy();
    expect(rows.find((r) => r.id === plain)!.ev).toBeNull();
  });

  it('o marcador é detectado sem diferenciar maiúsculas e sem exigir um UUID parseável depois dele', async () => {
    const db = await create();
    const upper = await insertTx(db, { desc: 'X FINELO_FUNDING_ACCOUNT:' });
    const junk = await insertTx(db, { desc: 'finelo_funding_account:não-é-uuid' });
    await db.exec(migration);
    const linked = (await db.query('select 1 from public.transactions where "ID_Transacao" = any($1) and economic_event_id is not null', [[upper, junk]])).rows;
    expect(linked).toHaveLength(2);
  });

  it('linha com marcador JÁ vinculada não é tocada (nem ganha outro evento)', async () => {
    const db = await create();
    const existing = (await db.query<{ id: string }>("insert into public.economic_events (user_id, created_by, kind, source) values ($1,$1,'credit_card_payment','pay_invoice_flow') returning id", [A])).rows[0].id;
    const t = await insertTx(db, { desc: `${MARK}acc-1`, event: existing });
    await db.exec(migration);
    expect((await db.query<{ ev: string }>('select economic_event_id ev from public.transactions where "ID_Transacao" = $1', [t])).rows[0].ev).toBe(existing);
    expect(await eventsBySource(db)).toHaveLength(0);
    expect(await eventsBySource(db, 'pay_invoice_flow')).toHaveLength(1);
  });

  it('a seleção ignora valor, data, tipo, categoria e conta: só o marcador decide', async () => {
    const db = await create();
    const a = await insertTx(db, { desc: `${MARK}x`, valor: 100, tipo: 'Renda', cat: 'Pagamento Cartão', data: '2025-01-01' });
    const b = await insertTx(db, { desc: `${MARK}x`, valor: -0.01, tipo: 'Despesa', cat: 'Qualquer', data: '2030-12-31' });
    const c = await insertTx(db, { desc: 'sem marcador', valor: 100, tipo: 'Renda', cat: 'Pagamento Cartão', data: '2025-01-01' }); // idêntico ao a, sem marcador
    await db.exec(migration);
    const ev = async (id: string) => (await db.query<{ ev: string | null }>('select economic_event_id ev from public.transactions where "ID_Transacao" = $1', [id])).rows[0].ev;
    expect(await ev(a)).toBeTruthy();
    expect(await ev(b)).toBeTruthy();
    expect(await ev(c)).toBeNull();
  });
});

describe('3C — backfill: um evento por linha, campos fixos, nada alterado', () => {
  it('duas linhas "iguais" (mesmo usuário, valor, data e conta) ⇒ DOIS eventos, uma perna cada (sem agrupar/parear)', async () => {
    const db = await create();
    const t1 = await insertTx(db, { desc: `${MARK}acc-1`, valor: -500, data: '2026-09-20' });
    const t2 = await insertTx(db, { desc: `${MARK}acc-1`, valor: -500, data: '2026-09-20' });
    await db.exec(migration);
    const events = await eventsBySource(db);
    expect(events).toHaveLength(2);
    const legs = (await db.query<{ ev: string; n: string }>('select economic_event_id ev, count(*) n from public.transactions where economic_event_id is not null group by 1')).rows;
    expect(legs).toHaveLength(2);
    expect(legs.every((l) => Number(l.n) === 1)).toBe(true);
    const evs = (await db.query<{ id: string; ev: string }>('select "ID_Transacao" id, economic_event_id ev from public.transactions where "ID_Transacao" = any($1)', [[t1, t2]])).rows;
    expect(new Set(evs.map((e) => e.ev)).size).toBe(2);
  });

  it('cada evento: credit_card_payment, backfill_funding_marker, contraparte NULL, dono = created_by = user_id da linha', async () => {
    const db = await create();
    await insertTx(db, { desc: `${MARK}a`, user: A });
    await insertTx(db, { desc: `${MARK}b`, user: B });
    await db.exec(migration);
    const events = await eventsBySource(db);
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e).toMatchObject({ kind: 'credit_card_payment', source: 'backfill_funding_marker', counterparty_account_id: null });
      expect(e.created_by).toBe(e.user_id);
    }
    expect(events.map((e) => e.user_id).sort()).toEqual([A, B]);
    // a FK composta garante: a linha de A aponta para evento de A (nunca cruzado)
    const cross = await db.query('select 1 from public.transactions t join public.economic_events e on e.id = t.economic_event_id where e.user_id <> t.user_id');
    expect(cross.rows).toHaveLength(0);
  });

  it('só economic_event_id muda: nenhuma outra coluna, valor ou linha é alterada', async () => {
    const db = await create();
    await insertTx(db, { desc: `${MARK}a`, valor: -123.45, data: '2026-09-20', cat: 'Cartão' });
    await insertTx(db, { desc: 'normal', valor: -7 });
    const snap = async () => (await db.query<Record<string, any>>('select "ID_Transacao","user_id","Data","Data_Pagamento","Nome_Fantasia","Valor","Tipo","Categoria","Origem","Descricao_Original","ID_Conta" from public.transactions order by "ID_Transacao"')).rows;
    const before = JSON.stringify(await snap());
    await db.exec(migration);
    expect(JSON.stringify(await snap())).toBe(before);
    expect(Number((await db.query<{ n: string }>('select count(*) n from public.transactions')).rows[0].n)).toBe(2);
  });

  it('idempotente: reexecutar a migration não cria eventos nem vínculos novos', async () => {
    const db = await create();
    await insertTx(db, { desc: `${MARK}a` });
    await insertTx(db, { desc: `${MARK}b` });
    await db.exec(migration);
    const first = (await db.query<{ n: string }>('select count(*) n from public.economic_events')).rows[0].n;
    await db.exec(migration);
    await db.exec(migration);
    expect((await db.query<{ n: string }>('select count(*) n from public.economic_events')).rows[0].n).toBe(first);
    expect(Number(first)).toBe(2);
  });

  it('sem linhas elegíveis: nenhum evento', async () => {
    const db = await create();
    await insertTx(db, { desc: 'qualquer coisa' });
    await db.exec(migration);
    expect(await eventsBySource(db)).toHaveLength(0);
  });
});

describe('3C — rollback por source', () => {
  it('apaga SÓ os eventos de backfill; as transações permanecem com economic_event_id NULL; os demais eventos ficam', async () => {
    const db = await create();
    const user = (await db.query<{ id: string }>("insert into public.economic_events (user_id, created_by, kind, source) values ($1,$1,'own_account_transfer','user') returning id", [A])).rows[0].id;
    const auto = (await db.query<{ id: string }>("insert into public.economic_events (user_id, created_by, kind, source) values ($1,$1,'credit_card_payment','pay_invoice_flow') returning id", [A])).rows[0].id;
    const tUser = await insertTx(db, { desc: 'manual', event: user });
    const tAuto = await insertTx(db, { desc: `${MARK}auto`, event: auto });
    const legacy = await insertTx(db, { desc: `${MARK}legacy` });
    await db.exec(migration);
    expect(await eventsBySource(db)).toHaveLength(1);
    await db.exec(rollback);
    expect(await eventsBySource(db)).toHaveLength(0);
    const rows = Object.fromEntries((await db.query<{ id: string; ev: string | null }>('select "ID_Transacao" id, economic_event_id ev from public.transactions')).rows.map((r) => [r.id, r.ev]));
    expect(rows[legacy]).toBeNull();
    expect(rows[tUser]).toBe(user);
    expect(rows[tAuto]).toBe(auto);
    expect(Number((await db.query<{ n: string }>('select count(*) n from public.transactions')).rows[0].n)).toBe(3);
  });

  it('o rollback só toca no source reservado e não reabre a policy', () => {
    const sql = rollback.replace(/--.*$/gm, '').trim();
    expect(sql).toBe("DELETE FROM public.economic_events WHERE source = 'backfill_funding_marker';");
    expect(rollback).toContain('NUNCA apague `pay_invoice_flow` nem `user`');
    expect(rollback).toContain('hardening da policy de INSERT permanece');
  });
});

describe('3C — contrato textual da migration (marcador único, campos fixos)', () => {
  const sql = migration.replace(/--.*$/gm, '');
  it('seleciona só por marcador + IS NULL; não olha valor, data, categoria, tipo, nome nem conta', () => {
    const select = /SELECT t\."ID_Transacao"[\s\S]*?ORDER BY/i.exec(sql)![0];
    expect(select).toContain('t.economic_event_id IS NULL');
    expect(select).toContain("'finelo_funding_account:'");
    expect(select).not.toMatch(/Valor|"Data|Categoria|Tipo|Nome_Fantasia|ID_Conta|Origem/);
    expect(sql).not.toMatch(/Observacoes/); // coluna inexistente no banco real
  });
  it('INSERT com kind/source/created_by fixos e UPDATE condicional por id + IS NULL', () => {
    expect(sql).toContain("'credit_card_payment', 'backfill_funding_marker', NULL, r.user_id");
    expect(sql).toContain('(user_id, kind, source, counterparty_account_id, created_by)');
    expect(sql).toMatch(/WHERE "ID_Transacao" = r\."ID_Transacao"\s+AND economic_event_id IS NULL/);
    expect(sql).not.toMatch(/GROUP BY|JOIN|array_agg|\bDISTINCT\b/i);
  });
});

describe('3C — guard do service client', () => {
  it('createEconomicEvent recusa backfill_funding_marker antes de qualquer consulta; os demais sources seguem', async () => {
    const calls = { n: 0 };
    vi.resetModules();
    vi.doMock('../../src/supabaseClient', () => ({
      supabase: {
        auth: { getUser: async () => (calls.n++, { data: { user: { id: A } } }) },
        from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'e', user_id: A }, error: null }) }) }) }),
      },
    }));
    const { createEconomicEvent } = await import('../../src/services/economicEventService');
    await expect(createEconomicEvent({ kind: 'credit_card_payment', source: 'backfill_funding_marker' as never })).rejects.toThrow(/reservado/);
    expect(calls.n).toBe(0);
    for (const source of ['user', 'pay_invoice_flow', 'transfer_flow'] as const) {
      await expect(createEconomicEvent({ kind: 'own_account_transfer', source })).resolves.toBeTruthy();
    }
    vi.doUnmock('../../src/supabaseClient');
  });
});
