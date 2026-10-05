-- Content/account idempotency is mandatory in both feature-flag paths.
-- Forward-only: apply before the client that sends p_fingerprint to scoped.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
begin
  if pg_catalog.to_regprocedure('public.import_transactions_scoped(text,uuid,jsonb,integer,jsonb,jsonb)') is null
    or pg_catalog.to_regprocedure('public.import_transactions_atomic(text,text,uuid,jsonb,integer,jsonb,jsonb)') is null
    or not exists (
      select 1 from pg_catalog.pg_constraint c
      where c.conrelid = 'public.import_batches'::regclass and c.contype = 'u'
        and pg_catalog.pg_get_constraintdef(c.oid) = 'UNIQUE (user_id, fingerprint)'
    ) then
    raise exception 'Unexpected import idempotency contract; migration aborted.';
  end if;
end;
$preflight$;

-- Remove the unprotected signature, not an overload/fallback reachable by old clients.
-- RESTRICT deliberately aborts if an unexpected dependent object exists.
drop function public.import_transactions_scoped(text,uuid,jsonb,integer,jsonb,jsonb);

create function public.import_transactions_scoped(
  p_fingerprint text, p_file_name text, p_account_id uuid, p_transactions jsonb, p_total_transactions integer,
  p_ignored_details jsonb default '[]'::jsonb, p_detail_context jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security invoker set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_batch_id uuid;
  v_result jsonb;
  v_log_id uuid;
  v_inserted jsonb;
  v_details jsonb;
  v_log jsonb;
begin
  if v_user_id is null then raise exception 'Autenticação obrigatória.' using errcode = '28000'; end if;
  if p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Fingerprint inválido.' using errcode = '22023';
  end if;
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

  -- Unique constraint serializes competing fingerprints before any log/row insert.
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
  update public.import_batches set import_log_id = v_log_id,completed_at = pg_catalog.now()
    where id = v_batch_id and user_id = v_user_id;
  return pg_catalog.jsonb_build_object('duplicate',false,'batch_id',v_batch_id,
    'transactions',v_inserted,'import_log',v_log);
end;
$function$;
revoke all on function public.import_transactions_scoped(text,text,uuid,jsonb,integer,jsonb,jsonb)
  from public, anon, service_role;
grant execute on function public.import_transactions_scoped(text,text,uuid,jsonb,integer,jsonb,jsonb) to authenticated;

-- Keep the enabled RPC signature/result contract; both paths share one reservation.
create or replace function public.import_transactions_atomic(
  p_fingerprint text,p_file_name text,p_account_id uuid,p_transactions jsonb,p_total_transactions integer,
  p_ignored_details jsonb default '[]'::jsonb,p_detail_context jsonb default '{}'::jsonb
)
returns jsonb language sql security invoker set search_path = ''
as $function$
  select public.import_transactions_scoped(p_fingerprint,p_file_name,p_account_id,
    p_transactions,p_total_transactions,p_ignored_details,p_detail_context)
$function$;
revoke all on function public.import_transactions_atomic(text,text,uuid,jsonb,integer,jsonb,jsonb)
  from public, anon, service_role;
grant execute on function public.import_transactions_atomic(text,text,uuid,jsonb,integer,jsonb,jsonb) to authenticated;
commit;
