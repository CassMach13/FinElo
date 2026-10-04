import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(resolve('supabase/migrations/20261004145953_persist_import_batch_identity.sql'), 'utf8');
const U = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const databases: PGlite[] = [];

// Mirrors staging column types, RLS family visibility, and SET NULL card FKs.
const schema = `
create schema auth;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon,authenticated,service_role;
create table auth.users(id uuid primary key);
insert into auth.users values ('${U}'),('${V}');
create table public.contas(id uuid primary key,user_id uuid,"Nome_Conta" text not null);
insert into public.contas values ('${A}','${U}','A'),('${B}','${U}','B'),('${OTHER}','${V}','Other');
create table public.assets(id uuid primary key,user_id uuid);
create table public.import_logs(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users,
 file_name text not null,import_date timestamptz not null default now(),total_transactions integer not null,
 imported_count integer not null,ignored_count integer not null,ignored_details jsonb,imported_details jsonb default '[]');
create table public.transactions("ID_Transacao" uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users,
 "Data" timestamptz not null,"Data_Pagamento" timestamptz,"Nome_Fantasia" text not null,"Valor" numeric not null,
 "Parcela_Atual" integer,"Total_Parcelas" integer,"Categoria" text,"Fonte" text,"Origem" text,
 "Descricao_Original" text,"Portador" text,"Tipo" text,"ID_Conta" uuid references public.contas,
 pluggy_transaction_id text,linked_asset_id uuid references public.assets);
create table public.import_batches(id uuid primary key default gen_random_uuid(),user_id uuid not null,
 account_id uuid references public.contas,file_name text not null,fingerprint text not null,
 import_log_id uuid references public.import_logs on delete cascade,completed_at timestamptz,unique(user_id,fingerprint));
create table public.credit_card_entries(id uuid primary key default gen_random_uuid(),user_id uuid,
 transaction_id uuid references public.transactions on delete set null,statement_id uuid);
create table public.credit_card_statement_items(like public.credit_card_entries including defaults including constraints);
alter table public.credit_card_statement_items add foreign key(transaction_id) references public.transactions on delete set null;
create table public.credit_card_payments(id uuid primary key default gen_random_uuid(),amount numeric);
grant all on all tables in schema public to anon,authenticated,service_role;
alter table public.import_logs enable row level security;
alter table public.transactions enable row level security;
-- Family policy deliberately broader than RPC ownership: ownership must be explicit.
create policy family on public.import_logs to authenticated using(true) with check(true);
create policy family on public.transactions to authenticated using(true) with check(true);
`;

async function createDB(seed?: (db: PGlite) => Promise<void>) {
  const db = new PGlite(); databases.push(db); await db.waitReady;
  await db.exec(schema); if (seed) await seed(db); await db.exec(migration); return db;
}
async function assume(db: PGlite, user = U, role = 'authenticated') {
  await db.exec(`reset role; set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
}
const row = { Data: '2026-08-10', Nome_Fantasia: 'Fixture', Valor: -10, Fonte: 'XP', Parcela_Atual: 2, Total_Parcelas: 3 };
async function importBatch(db: PGlite, name = 'same.csv', data: unknown[] = [row]) {
  const r = await db.query<{ result: { import_log: { id: string }; transactions: Record<string, unknown>[] } }>(
    'select public.import_transactions_scoped($1,$2,$3::jsonb,$4) as result', [name,A,JSON.stringify(data),data.length]);
  return r.rows[0].result;
}
async function action(db: PGlite, id: string, name: string, account: string | null = null) {
  return (await db.query<{ result: Record<string, unknown> }>(
    'select public.maintain_import_batch_atomic($1,$2,$3) as result',[id,name,account])).rows[0].result;
}
async function physical(db: PGlite) {
  return (await db.query("select md5(coalesce(string_agg((to_jsonb(t)-'import_log_id')::text,'|' order by t.\"ID_Transacao\"),'')) as hash from public.transactions t")).rows[0];
}
afterEach(async () => { await Promise.all(databases.splice(0).map(db => db.close())); });

describe('persistent import batch identity — PostgreSQL', () => {
  it('new same-name imports obtain separate logs and bind at INSERT, ignoring spoofed payload identity', async () => {
    const db=await createDB(); await assume(db);
    const a=await importBatch(db,'same.csv',[{...row,user_id:V,import_log_id:OTHER}]);
    const b=await importBatch(db);
    expect(a.import_log.id).not.toBe(b.import_log.id);
    expect(a.transactions[0].user_id).toBe(U);
    expect(a.transactions[0].import_log_id).toBe(a.import_log.id);
    expect(b.transactions[0].import_log_id).toBe(b.import_log.id);
  });
  it('reassign A cannot alter B despite same filename and account; audit metadata is retained', async () => {
    const db=await createDB(); await assume(db); const a=await importBatch(db); const b=await importBatch(db);
    const before=await db.query('select * from public.transactions where import_log_id=$1',[b.import_log.id]);
    const r=await action(db,a.import_log.id,'reassign',B); expect(r.updated_count).toBe(1);
    expect((await db.query('select * from public.transactions where import_log_id=$1',[b.import_log.id])).rows).toEqual(before.rows);
    const details=r.imported_details as Record<string,unknown>[];
    expect(details[0].Audit_ID_Conta_Original).toBe(A);
    await action(db,a.import_log.id,'reassign',A);
    expect((await action(db,a.import_log.id,'reassign',B)).imported_details).toEqual(details);
  });
  it('delete A removes exact projections first, preserves B, payments and shared statement identity', async () => {
    const db=await createDB(); await assume(db); const a=await importBatch(db); const b=await importBatch(db);
    for (const batch of [a,b]) for (const table of ['credit_card_entries','credit_card_statement_items']) {
      await db.query(`insert into public.${table}(user_id,transaction_id,statement_id) values($1,$2,$3)`,[U,batch.transactions[0].ID_Transacao,OTHER]);
    }
    await db.query('insert into public.credit_card_payments(amount) values(5)');
    const before=await db.query('select * from public.transactions where import_log_id=$1',[b.import_log.id]);
    const r=await action(db,a.import_log.id,'delete'); expect(r.deleted_count).toBe(1); expect(r.affected_statement_ids).toEqual([OTHER]);
    expect((await db.query('select * from public.transactions where import_log_id=$1',[b.import_log.id])).rows).toEqual(before.rows);
    for (const table of ['credit_card_entries','credit_card_statement_items']) {
      const remaining=(await db.query(`select transaction_id from public.${table}`)).rows;
      expect(remaining).toEqual([{transaction_id:b.transactions[0].ID_Transacao}]);
    }
    expect((await db.query('select amount from public.credit_card_payments')).rows).toEqual([{amount:'5'}]);
  });
  it('rehydrate A uses only membership, preserves metadata and missing-row history, is idempotent', async () => {
    const db=await createDB(); await assume(db); const a=await importBatch(db); const b=await importBatch(db);
    const missing='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    await db.query(`update public.import_logs set imported_count=2, imported_details=imported_details || $2::jsonb where id=$1`,[a.import_log.id,JSON.stringify([{ID_Transacao:missing,Card_Reference_Label:'2026-07',history:true}])]);
    await db.query(`update public.import_logs set imported_details=jsonb_set(jsonb_set(imported_details,'{0,Card_Reference_Label}','"2026-08"'),'{0,ID_Transacao}',to_jsonb(upper(imported_details->0->>'ID_Transacao'))) where id=$1`,[a.import_log.id]);
    const before=await db.query('select * from public.import_logs where id=$1',[b.import_log.id]);
    const physicalBefore=await physical(db); const r=await action(db,a.import_log.id,'rehydrate');
    const details=r.imported_details as Record<string,unknown>[];
    expect(details).toHaveLength(2); expect(details[0].Card_Reference_Label).toBe('2026-08'); expect(details[1].history).toBe(true);
    expect((await action(db,a.import_log.id,'rehydrate')).updated_count).toBe(0);
    expect((await db.query('select * from public.import_logs where id=$1',[b.import_log.id])).rows).toEqual(before.rows);
    expect(await physical(db)).toEqual(physicalBefore);
  });
  it('invalid row aborts entire new import including its reserved log', async () => {
    const db=await createDB(); await assume(db);
    await expect(importBatch(db,'same.csv',[row,{...row,Valor:'invalid'}])).rejects.toThrow();
    expect((await db.query('select count(*)::int as n from public.import_logs')).rows[0].n).toBe(0);
    expect((await db.query('select count(*)::int as n from public.transactions')).rows[0].n).toBe(0);
  });
  it('failure deleting log rolls back transaction and projection deletion', async () => {
    const db=await createDB(); await assume(db); const a=await importBatch(db);
    await db.query('insert into public.credit_card_entries(user_id,transaction_id) values($1,$2)',[U,a.transactions[0].ID_Transacao]);
    await assume(db,U,'postgres');
    await db.exec(`create function public.fail_delete_log() returns trigger language plpgsql as $$begin raise exception 'deliberate'; end$$;
      create trigger fail before delete on public.import_logs for each row execute function public.fail_delete_log()`);
    await assume(db); const before=await physical(db);
    await expect(action(db,a.import_log.id,'delete')).rejects.toThrow('deliberate');
    expect(await physical(db)).toEqual(before);
    expect((await db.query('select count(*)::int as n from public.credit_card_entries')).rows[0].n).toBe(1);
  });
  it('other owner cannot maintain visible family log or use another owner account', async () => {
    const db=await createDB(); await assume(db); const a=await importBatch(db);
    await expect(action(db,a.import_log.id,'reassign',OTHER)).rejects.toThrow(/Conta/);
    await assume(db,V);
    for (const name of ['reassign','delete','rehydrate']) await expect(action(db,a.import_log.id,name,OTHER)).rejects.toThrow(/Importação não encontrada/);
  });
  it('composite FK blocks cross-owner membership and update trigger blocks reassociation/detachment', async () => {
    const db=await createDB(); await assume(db); const a=await importBatch(db); const b=await importBatch(db);
    await expect(db.query('update public.transactions set import_log_id=$1 where import_log_id=$2',[b.import_log.id,a.import_log.id])).rejects.toThrow(/immutable/);
    await expect(db.query('update public.transactions set import_log_id=null where import_log_id=$1',[a.import_log.id])).rejects.toThrow(/immutable/);
    await expect(db.query('delete from public.import_logs where id=$1',[a.import_log.id])).rejects.toThrow(/foreign key/);
    await expect(db.query(`insert into public.transactions(user_id,import_log_id,"Data","Nome_Fantasia","Valor") values($1,$2,now(),'spoof',1)`,[V,a.import_log.id])).rejects.toThrow(/foreign key/);
  });
  it('fingerprint retry returns only its own bound rows without duplicate inserts', async () => {
    const db=await createDB(); await assume(db);
    const query='select public.import_transactions_atomic($1,$2,$3,$4::jsonb,1) as result';
    const args=['a'.repeat(64),'same.csv',A,JSON.stringify([row])];
    const first=(await db.query<{result:Record<string,unknown>}>(query,args)).rows[0].result;
    await importBatch(db); const second=(await db.query<{result:Record<string,unknown>}>(query,args)).rows[0].result;
    expect(second.duplicate).toBe(true); expect(second.transactions).toEqual(first.transactions);
    expect((await db.query('select count(*)::int as n from public.transactions')).rows[0].n).toBe(2);
  });
  it('all RPCs are invoker, safe search_path; anon/service role cannot execute; unauthenticated fails', async () => {
    const db=await createDB();
    const rows=(await db.query<{prosecdef:boolean;proconfig:string[];anon:boolean;service:boolean;auth:boolean}>(`select prosecdef,proconfig,
      has_function_privilege('anon',oid,'EXECUTE') anon,has_function_privilege('service_role',oid,'EXECUTE') service,
      has_function_privilege('authenticated',oid,'EXECUTE') auth from pg_proc where proname in
      ('maintain_import_batch_atomic','import_transactions_scoped','import_transactions_atomic',
       'reassign_import_batch_atomic','delete_import_batch_atomic','rehydrate_import_batch_atomic')`)).rows;
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(r).toEqual({prosecdef:false,proconfig:['search_path=""'],anon:false,service:false,auth:true});
    await assume(db,''); await expect(importBatch(db)).rejects.toThrow(/Autenticação/);
    await assume(db,'','anon'); await expect(importBatch(db)).rejects.toThrow(/permission denied/);
  });
});

describe('one-time backfill — exact stored IDs only', () => {
  it('binds unique valid same-owner IDs; shared, missing, cross-owner and filename-only remain unbound', async () => {
    const ids=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000005'];
    const logs=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004',
      '20000000-0000-4000-8000-000000000005'];
    let baseline:unknown;
    const db=await createDB(async db => {
      for (const id of ids) await db.query(`insert into public.transactions("ID_Transacao",user_id,"Data","Nome_Fantasia","Valor","Origem") values($1,$2,now(),'fixture',-10,'same.csv')`,[id,U]);
      for (let i=0;i<logs.length;i++) await db.query(`insert into public.import_logs(id,user_id,file_name,total_transactions,imported_count,ignored_count,imported_details)
        values($1,$2,'same.csv',4,4,0,$3::jsonb)`,[logs[i],i===2?V:U,JSON.stringify(i===0?
          [{ID_Transacao:ids[0]},{ID_Transacao:ids[1]},{ID_Transacao:'bad'},{ID_Transacao:OTHER}]:
          i===1?[{ID_Transacao:ids[1]}]:i===2?[{ID_Transacao:ids[2]}]:i===3?[{ID_Transacao:ids[4]}]:[]) ]);
      baseline=await physical(db);
    });
    expect(await physical(db)).toEqual(baseline);
    const rows=(await db.query<{import_log_id:string|null}>('select import_log_id from public.transactions order by "ID_Transacao"')).rows;
    expect(rows.map(r=>r.import_log_id)).toEqual([logs[0],null,null,null,logs[3]]);
    await assume(db);
    for (const name of ['reassign','delete','rehydrate']) await expect(action(db,logs[1],name,B)).rejects.toThrow(/identidade/);
    for (const name of ['reassign','delete','rehydrate']) await expect(action(db,logs[4],name,B)).rejects.toThrow(/identidade/);
    await expect(action(db,logs[0],'delete')).rejects.toThrow(/ambígua|incompleta/);
    expect(await physical(db)).toEqual(baseline);
  });
});
