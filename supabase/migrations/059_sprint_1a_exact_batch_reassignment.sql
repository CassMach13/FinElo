-- Sprint 1A - corrige a conta somente das linhas ativas de um lote rastreavel.

create or replace function public.reassign_import_batch_atomic(
  p_import_log_id uuid,
  p_account_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_log public.import_logs%rowtype;
  v_account public.contas%rowtype;
  v_transaction_ids uuid[] := array[]::uuid[];
  v_active_ids uuid[] := array[]::uuid[];
  v_detail_id_count integer := 0;
  v_updated_count integer := 0;
  v_updated_details jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Autenticacao obrigatoria para corrigir a conta do lote.' using errcode = '28000';
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

  select c.*
    into v_account
  from public.contas c
  where c.id = p_account_id
    and c.user_id = v_user_id;

  if not found then
    raise exception 'Conta de destino nao encontrada para o usuario autenticado.' using errcode = 'P0002';
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
      'Correcao cancelada: o lote possui % transacoes, mas somente % IDs exatos validos no historico.',
      coalesce(v_log.imported_count, 0),
      v_detail_id_count
      using errcode = 'P0001';
  end if;

  select coalesce(array_agg(t."ID_Transacao"), array[]::uuid[])
    into v_active_ids
  from public.transactions t
  where t.user_id = v_user_id
    and t."ID_Transacao" = any(v_transaction_ids);

  if coalesce(array_length(v_active_ids, 1), 0) = 0 then
    raise exception 'Correcao cancelada: nenhuma linha ativa deste lote foi localizada.' using errcode = 'P0001';
  end if;

  update public.transactions t
  set "ID_Conta" = p_account_id
  where t.user_id = v_user_id
    and t."ID_Transacao" = any(v_active_ids);
  get diagnostics v_updated_count = row_count;

  select coalesce(
    jsonb_agg(
      case
        when detail ? 'ID_Transacao'
          and coalesce(detail->>'ID_Transacao', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          and (detail->>'ID_Transacao')::uuid = any(v_active_ids)
        then detail || jsonb_build_object(
          'Audit_ID_Conta_Original', coalesce(detail->'Audit_ID_Conta_Original', detail->'ID_Conta'),
          'Audit_Conta_Nome_Original', coalesce(detail->'Audit_Conta_Nome_Original', detail->'Conta_Nome'),
          'ID_Conta', p_account_id::text,
          'Conta_Nome', v_account."Nome_Conta"
        )
        else detail
      end
      order by ordinality
    ),
    '[]'::jsonb
  )
  into v_updated_details
  from jsonb_array_elements(coalesce(v_log.imported_details, '[]'::jsonb)) with ordinality as rows(detail, ordinality);

  update public.import_logs l
  set imported_details = v_updated_details
  where l.id = v_log.id
    and l.user_id = v_user_id;

  return jsonb_build_object(
    'updated_count', v_updated_count,
    'import_log_id', v_log.id,
    'file_name', v_log.file_name,
    'account_id', p_account_id,
    'account_name', v_account."Nome_Conta",
    'active_transaction_ids', to_jsonb(v_active_ids),
    'imported_details', v_updated_details
  );
end;
$$;

revoke all on function public.reassign_import_batch_atomic(uuid, uuid) from public;
grant execute on function public.reassign_import_batch_atomic(uuid, uuid) to authenticated;
