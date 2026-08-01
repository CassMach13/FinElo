-- Sprint 1A — bloqueia exclusão ampla por clientes antigos quando há colisão
-- de nomes e permite remover somente o log de um lote totalmente órfão.

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
    raise exception 'Autenticação obrigatória para excluir um lote.' using errcode = '28000';
  end if;

  select l.*
    into v_log
  from public.import_logs l
  where l.id = p_import_log_id
    and l.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Lote não encontrado para o usuário autenticado.' using errcode = 'P0002';
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
      'Exclusão cancelada: o lote possui % transações, mas somente % IDs exatos válidos no histórico.',
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
      -- Recuperação conservadora: todas as transações já sumiram. Remove apenas
      -- o log órfão e sua reserva idempotente (FK cascade), sem tocar no ledger.
      v_orphan_cleanup := true;
    elsif v_persisted_count <> v_detail_id_count then
      raise exception
        'Exclusão cancelada: foram localizadas % de % transações esperadas. Nenhum dado foi alterado.',
        v_persisted_count,
        v_detail_id_count
        using errcode = 'P0001';
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
    'deleted_transactions', v_deleted,
    'deleted_log_id', v_log.id,
    'file_name', v_log.file_name,
    'orphan_cleanup', v_orphan_cleanup
  );
end;
$$;

revoke all on function public.delete_import_batch_atomic(uuid) from public;
grant execute on function public.delete_import_batch_atomic(uuid) to authenticated;

create or replace function public.prevent_unsafe_import_origin_delete()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_setting('finelo.atomic_batch_delete', true) = 'on' then
    return null;
  end if;

  if exists (
    select 1
    from finelo_deleted_rows deleted
    join public.import_batches batch
      on batch.user_id = deleted.user_id
    join public.import_logs protected_log
      on protected_log.id = batch.import_log_id
     and protected_log.user_id = deleted.user_id
    cross join lateral jsonb_array_elements(
      coalesce(protected_log.imported_details, '[]'::jsonb)
    ) deleted_detail
    where deleted_detail->>'ID_Transacao' = deleted."ID_Transacao"::text
      and exists (
        select 1
        from finelo_deleted_rows sibling
        where sibling.user_id = deleted.user_id
          and sibling."Origem" = deleted."Origem"
          and sibling."ID_Transacao" <> deleted."ID_Transacao"
          and not exists (
            select 1
            from jsonb_array_elements(
              coalesce(protected_log.imported_details, '[]'::jsonb)
            ) protected_detail
            where protected_detail->>'ID_Transacao' = sibling."ID_Transacao"::text
          )
      )
  ) then
    raise exception
      'Exclusão ampla bloqueada: existem lotes diferentes com a mesma origem. Atualize o aplicativo e exclua pelo histórico do lote.'
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

drop trigger if exists trg_prevent_unsafe_import_origin_delete on public.transactions;
create trigger trg_prevent_unsafe_import_origin_delete
after delete on public.transactions
referencing old table as finelo_deleted_rows
for each statement execute procedure public.prevent_unsafe_import_origin_delete();
