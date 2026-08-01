-- Sprint 1A - permite excluir o restante exato de um lote parcialmente removido.

create or replace function public.delete_import_batch_atomic(p_import_log_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_log public.import_logs%rowtype;
  v_transaction_ids uuid[] := array[]::uuid[];
  v_detail_id_count integer := 0;
  v_persisted_count integer := 0;
  v_deleted jsonb := '[]'::jsonb;
  v_orphan_cleanup boolean := false;
begin
  if v_user_id is null then
    raise exception 'Autenticacao obrigatoria para excluir um lote.' using errcode = '28000';
  end if;

  select l.*
    into v_log
  from public.import_logs l
  where l.id = p_import_log_id
    and l.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Lote nao encontrado para o usuario autenticado.' using errcode = 'P0002';
  end if;

  select
    coalesce(array_agg(distinct (detail->>'ID_Transacao')::uuid), array[]::uuid[]),
    count(distinct detail->>'ID_Transacao')::integer
  into v_transaction_ids, v_detail_id_count
  from jsonb_array_elements(coalesce(v_log.imported_details, '[]'::jsonb)) detail
  where detail ? 'ID_Transacao'
    and coalesce(detail->>'ID_Transacao', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  if v_detail_id_count <> coalesce(v_log.imported_count, 0) then
    raise exception
      'Exclusao cancelada: o lote possui % transacoes, mas somente % IDs exatos validos no historico.',
      coalesce(v_log.imported_count, 0),
      v_detail_id_count
      using errcode = 'P0001';
  end if;

  if v_detail_id_count > 0 then
    select count(*)::integer
      into v_persisted_count
    from public.transactions t
    where t.user_id = v_user_id
      and t."ID_Transacao" = any(v_transaction_ids);

    if v_persisted_count = 0 then
      v_orphan_cleanup := true;
    else
      perform set_config('finelo.atomic_batch_delete', 'on', true);
      with deleted as (
        delete from public.transactions t
        where t.user_id = v_user_id
          and t."ID_Transacao" = any(v_transaction_ids)
        returning t.*
      )
      select coalesce(jsonb_agg(to_jsonb(deleted) order by "ID_Transacao"), '[]'::jsonb)
        into v_deleted
      from deleted;
    end if;
  end if;

  delete from public.import_logs l
  where l.id = v_log.id
    and l.user_id = v_user_id;

  return jsonb_build_object(
    'deleted_count', jsonb_array_length(v_deleted),
    'previously_missing_count', greatest(v_detail_id_count - v_persisted_count, 0),
    'deleted_transactions', v_deleted,
    'deleted_log_id', v_log.id,
    'file_name', v_log.file_name,
    'orphan_cleanup', v_orphan_cleanup
  );
end;
$$;

revoke all on function public.delete_import_batch_atomic(uuid) from public;
grant execute on function public.delete_import_batch_atomic(uuid) to authenticated;
