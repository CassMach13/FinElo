-- Import history: persistent ownership-safe identity, never inferred from filename.
-- Forward-only; deployment must apply this migration before the new client.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
begin
  if not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.import_logs'::regclass
    and attname = 'id' and atttypid = 'uuid'::regtype and not attisdropped)
    or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.transactions'::regclass
      and attname = 'ID_Transacao' and atttypid = 'uuid'::regtype and not attisdropped) then
    raise exception 'Unexpected import identity schema; migration aborted.';
  end if;
end;
$preflight$;

lock table public.import_logs, public.transactions in share row exclusive mode;
alter table public.transactions add column import_log_id uuid;
alter table public.import_logs add constraint import_logs_owner_identity_unique unique (user_id, id);
alter table public.transactions add constraint transactions_import_log_owner_fkey
  foreign key (user_id, import_log_id) references public.import_logs (user_id, id) on delete restrict;
create index idx_transactions_user_import_log on public.transactions (user_id, import_log_id)
  where import_log_id is not null;

-- Count references globally, including cross-user references. Never choose a winner.
with references_by_id as (
  select l.id as log_id, l.user_id,
    (d->>'ID_Transacao')::uuid as transaction_id
  from public.import_logs l
  cross join lateral pg_catalog.jsonb_array_elements(
    case when pg_catalog.jsonb_typeof(l.imported_details) = 'array'
      then l.imported_details else '[]'::jsonb end) d
  where d->>'ID_Transacao' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
), unambiguous as (
  select transaction_id from references_by_id group by transaction_id having count(distinct log_id) = 1
)
update public.transactions t set import_log_id = r.log_id
from references_by_id r join unambiguous u using (transaction_id)
where t."ID_Transacao" = r.transaction_id and t.user_id = r.user_id
  and t.import_log_id is null;

-- Membership is immutable after the one-time proven backfill.
create function public.guard_import_batch_identity()
returns trigger language plpgsql security invoker set search_path = ''
as $function$
begin
  if new.import_log_id is distinct from old.import_log_id then
    raise exception 'Import batch identity is immutable.' using errcode = '23514';
  end if;
  return new;
end;
$function$;
revoke all on function public.guard_import_batch_identity() from public, anon, authenticated, service_role;
create trigger trg_guard_import_batch_identity before update of import_log_id on public.transactions
for each row execute function public.guard_import_batch_identity();

-- Same signature: existing clients using the exact RPC keep working.
-- Reserve the log before inserting any row; every row receives its identity at INSERT.
create function public.import_transactions_scoped(
  p_file_name text, p_account_id uuid, p_transactions jsonb, p_total_transactions integer,
  p_ignored_details jsonb default '[]'::jsonb, p_detail_context jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security invoker set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_log_id uuid;
  v_inserted jsonb;
  v_details jsonb;
  v_log jsonb;
begin
  if v_user_id is null then raise exception 'Autenticação obrigatória.' using errcode = '28000'; end if;
  if p_file_name is null or length(trim(p_file_name)) = 0 or length(p_file_name) > 255
    or p_transactions is null or pg_catalog.jsonb_typeof(p_transactions) <> 'array'
    or p_ignored_details is null or pg_catalog.jsonb_typeof(p_ignored_details) <> 'array'
    or p_detail_context is null or pg_catalog.jsonb_typeof(p_detail_context) <> 'object' then
    raise exception 'Formato de importação inválido.' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_transactions) > 10000 then
    raise exception 'Limite de 10.000 transações excedido.' using errcode = '54000';
  end if;
  if p_total_transactions is null or p_total_transactions < pg_catalog.jsonb_array_length(p_transactions) then
    raise exception 'Contagem de importação inválida.' using errcode = '22023';
  end if;
  if p_account_id is not null and not exists (
    select 1 from public.contas c where c.id = p_account_id and c.user_id = v_user_id
  ) then raise exception 'Conta não encontrada para o usuário.' using errcode = 'P0002'; end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_transactions) r
    where nullif(r->>'linked_asset_id','') is not null and not exists (
      select 1 from public.assets a where a.id = (r->>'linked_asset_id')::uuid and a.user_id = v_user_id
    )
  ) then raise exception 'Patrimônio não encontrado para o usuário.' using errcode = 'P0002'; end if;

  insert into public.import_logs (user_id,file_name,total_transactions,imported_count,
    ignored_count,ignored_details,imported_details)
  values (v_user_id,p_file_name,p_total_transactions,0,
    pg_catalog.jsonb_array_length(p_ignored_details),p_ignored_details,'[]'::jsonb)
  returning id into v_log_id;

  with inserted as (
    insert into public.transactions (user_id,import_log_id,"Data","Data_Pagamento","Nome_Fantasia",
      "Parcela_Atual","Total_Parcelas","Categoria","Fonte","Valor","Origem","Descricao_Original",
      "Portador","Tipo","ID_Conta",pluggy_transaction_id,linked_asset_id)
    select v_user_id,v_log_id,(r->>'Data')::timestamptz,
      nullif(r->>'Data_Pagamento','')::timestamptz,r->>'Nome_Fantasia',
      nullif(r->>'Parcela_Atual','')::integer,nullif(r->>'Total_Parcelas','')::integer,
      nullif(r->>'Categoria',''),nullif(r->>'Fonte',''),(r->>'Valor')::numeric,p_file_name,
      nullif(r->>'Descricao_Original',''),nullif(r->>'Portador',''),nullif(r->>'Tipo',''),
      p_account_id,nullif(r->>'pluggy_transaction_id',''),nullif(r->>'linked_asset_id','')::uuid
    from pg_catalog.jsonb_array_elements(p_transactions) with ordinality as input(r,n)
    order by n returning *
  ) select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) order by i."ID_Transacao"),'[]'::jsonb)
    into v_inserted from inserted i;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'ID_Transacao',r->>'ID_Transacao','Origem',r->>'Origem','Data',r->'Data',
    'Descricao',r->>'Descricao_Original','Nome_Fantasia',r->>'Nome_Fantasia',
    'Valor',r->'Valor','Categoria',r->>'Categoria','ID_Conta',r->>'ID_Conta',
    'Conta_Nome',p_detail_context->>'Conta_Nome',
    'Card_Cycle_Mode',p_detail_context->>'Card_Cycle_Mode',
    'Card_Reference_Label',p_detail_context->>'Card_Reference_Label',
    'Card_Due_Date',p_detail_context->>'Card_Due_Date'
  )),'[]'::jsonb) into v_details from pg_catalog.jsonb_array_elements(v_inserted) r;
  update public.import_logs set imported_count = pg_catalog.jsonb_array_length(v_inserted),
    imported_details = v_details where id = v_log_id and user_id = v_user_id;
  select pg_catalog.to_jsonb(l) into v_log from public.import_logs l where l.id = v_log_id;
  return pg_catalog.jsonb_build_object('duplicate',false,'transactions',v_inserted,'import_log',v_log);
end;
$function$;
revoke all on function public.import_transactions_scoped(text,uuid,jsonb,integer,jsonb,jsonb)
  from public, anon, service_role;
grant execute on function public.import_transactions_scoped(text,uuid,jsonb,integer,jsonb,jsonb) to authenticated;

create or replace function public.import_transactions_atomic(
  p_fingerprint text,p_file_name text,p_account_id uuid,p_transactions jsonb,p_total_transactions integer,
  p_ignored_details jsonb default '[]'::jsonb,p_detail_context jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security invoker set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_batch_id uuid;
  v_log_id uuid;
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'Autenticação obrigatória.' using errcode = '28000'; end if;
  if p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Fingerprint inválido.' using errcode = '22023';
  end if;
  insert into public.import_batches (user_id,account_id,file_name,fingerprint)
  values (v_user_id,p_account_id,p_file_name,p_fingerprint)
  on conflict (user_id,fingerprint) do nothing returning id into v_batch_id;
  if v_batch_id is null then
    select b.id,b.import_log_id into v_batch_id,v_log_id from public.import_batches b
      where b.user_id = v_user_id and b.fingerprint = p_fingerprint;
    if v_log_id is null then raise exception 'Lote idempotente sem conclusão.' using errcode = 'P0001'; end if;
    select pg_catalog.jsonb_build_object('duplicate',true,'batch_id',v_batch_id,
      'transactions',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t."ID_Transacao"),'[]'::jsonb)
        from public.transactions t where t.user_id = v_user_id and t.import_log_id = v_log_id),
      'import_log',pg_catalog.to_jsonb(l))
    into v_result from public.import_logs l where l.id = v_log_id and l.user_id = v_user_id;
    if v_result is null then raise exception 'Histórico idempotente ausente.' using errcode = 'P0001'; end if;
    return v_result;
  end if;
  v_result := public.import_transactions_scoped(p_file_name,p_account_id,p_transactions,
    p_total_transactions,p_ignored_details,p_detail_context);
  v_log_id := (v_result->'import_log'->>'id')::uuid;
  update public.import_batches set import_log_id = v_log_id,completed_at = pg_catalog.now()
    where id = v_batch_id and user_id = v_user_id;
  return v_result || pg_catalog.jsonb_build_object('batch_id',v_batch_id);
end;
$function$;
revoke all on function public.import_transactions_atomic(text,text,uuid,jsonb,integer,jsonb,jsonb)
  from public, anon, service_role;
grant execute on function public.import_transactions_atomic(text,text,uuid,jsonb,integer,jsonb,jsonb) to authenticated;

-- One lock/validation/mutation boundary for all three maintenance actions.
create function public.maintain_import_batch_atomic(p_import_log_id uuid,p_action text,p_account_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_log public.import_logs%rowtype;
  v_account public.contas%rowtype;
  v_ids uuid[];
  v_count integer;
  v_missing integer;
  v_details jsonb;
  v_deleted jsonb;
  v_statement_ids uuid[];
  v_updated integer;
begin
  if v_user_id is null then raise exception 'Autenticação obrigatória.' using errcode = '28000'; end if;
  if p_action is null or p_action not in ('reassign','delete','rehydrate') then
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;
  select l.* into v_log from public.import_logs l
    where l.id = p_import_log_id and l.user_id = v_user_id for update;
  if not found then raise exception 'Importação não encontrada para o usuário.' using errcode = 'P0002'; end if;
  perform 1 from public.transactions t where t.user_id = v_user_id
    and t.import_log_id = v_log.id order by t."ID_Transacao" for update;
  select coalesce(pg_catalog.array_agg(t."ID_Transacao"),array[]::uuid[]),count(*)::integer
    into v_ids,v_count from public.transactions t where t.user_id = v_user_id and t.import_log_id = v_log.id;

  -- Partial/deleted lots may keep absent IDs as history, never borrow existing unbound rows.
  select count(distinct d->>'ID_Transacao')::integer into v_missing
  from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(v_log.imported_details) = 'array'
    then v_log.imported_details else '[]'::jsonb end) d
  where d->>'ID_Transacao' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and not exists (select 1 from public.transactions t where t."ID_Transacao" = (d->>'ID_Transacao')::uuid);
  if v_count = 0 and v_log.imported_count > 0 then
    raise exception 'Importação sem identidade persistida comprovável.' using errcode = 'P0001';
  end if;
  if v_count + v_missing < v_log.imported_count or exists (
    select 1 from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(v_log.imported_details) = 'array'
      then v_log.imported_details else '[]'::jsonb end) d
    join public.transactions t on t."ID_Transacao"::text = pg_catalog.lower(d->>'ID_Transacao')
    where t.user_id <> v_user_id or t.import_log_id is distinct from v_log.id
  ) then raise exception 'Importação com identidade incompleta ou ambígua.' using errcode = 'P0001'; end if;

  if p_action = 'delete' then
    perform pg_catalog.set_config('finelo.atomic_batch_delete','on',true);
    -- These FKs use SET NULL on physical deletion. Remove only the proven
    -- transaction projections first, never a source-wide/homonymous lot.
    select coalesce(pg_catalog.array_agg(distinct statement_id),array[]::uuid[]) into v_statement_ids
    from (
      select statement_id from public.credit_card_entries where user_id = v_user_id and transaction_id = any(v_ids)
      union
      select statement_id from public.credit_card_statement_items where user_id = v_user_id and transaction_id = any(v_ids)
    ) affected;
    delete from public.credit_card_entries where user_id = v_user_id and transaction_id = any(v_ids);
    delete from public.credit_card_statement_items where user_id = v_user_id and transaction_id = any(v_ids);
    with deleted as (
      delete from public.transactions t where t.user_id = v_user_id and t.import_log_id = v_log.id returning *
    ) select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(d) order by d."ID_Transacao"),'[]'::jsonb)
      into v_deleted from deleted d;
    delete from public.import_logs where id = v_log.id and user_id = v_user_id;
    return pg_catalog.jsonb_build_object('deleted_count',pg_catalog.jsonb_array_length(v_deleted),
      'deleted_transactions',v_deleted,'deleted_log_id',v_log.id,'file_name',v_log.file_name,
      'affected_statement_ids',pg_catalog.to_jsonb(v_statement_ids));
  end if;

  if p_action = 'reassign' then
    select c.* into v_account from public.contas c where c.id = p_account_id and c.user_id = v_user_id;
    if not found then raise exception 'Conta não encontrada para o usuário.' using errcode = 'P0002'; end if;
    if v_count = 0 then raise exception 'Nenhuma linha ativa vinculada.' using errcode = 'P0001'; end if;
    update public.transactions set "ID_Conta" = p_account_id
      where user_id = v_user_id and import_log_id = v_log.id;
    select coalesce(pg_catalog.jsonb_agg(
      case when pg_catalog.lower(d->>'ID_Transacao') = any(v_ids::text[]) then d || pg_catalog.jsonb_build_object(
        'Audit_ID_Conta_Original',coalesce(d->'Audit_ID_Conta_Original',d->'ID_Conta'),
        'Audit_Conta_Nome_Original',coalesce(d->'Audit_Conta_Nome_Original',d->'Conta_Nome'),
        'ID_Conta',p_account_id::text,'Conta_Nome',v_account."Nome_Conta")
      else d end order by n),'[]'::jsonb) into v_details
    from pg_catalog.jsonb_array_elements(coalesce(v_log.imported_details,'[]'::jsonb)) with ordinality as rows(d,n);
  else
    -- Merge current bound rows with original row metadata; retain deleted/history-only rows.
    select coalesce(pg_catalog.jsonb_agg(
      coalesce((select d from pg_catalog.jsonb_array_elements(coalesce(v_log.imported_details,'[]'::jsonb)) d
        where pg_catalog.lower(d->>'ID_Transacao') = t."ID_Transacao"::text limit 1),'{}'::jsonb)
      || pg_catalog.jsonb_build_object('ID_Transacao',t."ID_Transacao"::text,'Origem',t."Origem",
        'Data',t."Data",'Descricao',t."Descricao_Original",'Nome_Fantasia',t."Nome_Fantasia",
        'Valor',t."Valor",'Categoria',t."Categoria",'ID_Conta',t."ID_Conta",
        'Conta_Nome',c."Nome_Conta")
      order by t."Data",t."ID_Transacao"),'[]'::jsonb) into v_details
    from public.transactions t left join public.contas c on c.id = t."ID_Conta" and c.user_id = v_user_id
    where t.user_id = v_user_id and t.import_log_id = v_log.id;
    select v_details || coalesce(pg_catalog.jsonb_agg(d order by n),'[]'::jsonb) into v_details
    from pg_catalog.jsonb_array_elements(coalesce(v_log.imported_details,'[]'::jsonb)) with ordinality as rows(d,n)
    where coalesce(pg_catalog.lower(d->>'ID_Transacao'),'') <> all(v_ids::text[]);
  end if;
  update public.import_logs set imported_details = v_details where id = v_log.id and user_id = v_user_id
    and imported_details is distinct from v_details;
  get diagnostics v_updated = row_count;
  return pg_catalog.jsonb_build_object('updated_count',case when p_action = 'rehydrate' then v_updated else v_count end,
    'active_transaction_ids',pg_catalog.to_jsonb(v_ids),'imported_details',v_details);
end;
$function$;
revoke all on function public.maintain_import_batch_atomic(uuid,text,uuid) from public, anon, service_role;
grant execute on function public.maintain_import_batch_atomic(uuid,text,uuid) to authenticated;

create or replace function public.reassign_import_batch_atomic(p_import_log_id uuid,p_account_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select public.maintain_import_batch_atomic(p_import_log_id,'reassign',p_account_id) $$;
create or replace function public.delete_import_batch_atomic(p_import_log_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select public.maintain_import_batch_atomic(p_import_log_id,'delete') $$;
create function public.rehydrate_import_batch_atomic(p_import_log_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select public.maintain_import_batch_atomic(p_import_log_id,'rehydrate') $$;
revoke all on function public.reassign_import_batch_atomic(uuid,uuid) from public, anon, service_role;
revoke all on function public.delete_import_batch_atomic(uuid) from public, anon, service_role;
revoke all on function public.rehydrate_import_batch_atomic(uuid) from public, anon, service_role;
grant execute on function public.reassign_import_batch_atomic(uuid,uuid) to authenticated;
grant execute on function public.delete_import_batch_atomic(uuid) to authenticated;
grant execute on function public.rehydrate_import_batch_atomic(uuid) to authenticated;

comment on column public.transactions.import_log_id is
  'Persistent import membership. NULL legacy identity is unknown; never infer from filename.';
commit;
