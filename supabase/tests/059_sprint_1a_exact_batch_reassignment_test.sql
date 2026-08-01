\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, created_at, updated_at)
values (
  '13000000-0000-0000-0000-000000000001',
  'sprint1a-reassign-local@example.invalid',
  now(),
  now()
);

select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000001', true);

insert into public.contas (
  id, user_id, "Nome_Conta", "Tipo_Conta", "Saldo_Inicial", "Data_Saldo_Inicial"
)
values
  (
    '23000000-0000-0000-0000-000000000001',
    '13000000-0000-0000-0000-000000000001',
    'Conta origem local',
    'Conta Corrente',
    0,
    '2026-01-01'
  ),
  (
    '23000000-0000-0000-0000-000000000002',
    '13000000-0000-0000-0000-000000000001',
    'Conta destino local',
    'Conta Corrente',
    0,
    '2026-01-01'
  );

do $$
declare
  first_result jsonb;
  sibling_result jsonb;
  reassign_result jsonb;
  first_log_id uuid;
  active_id uuid;
  deleted_id uuid;
  sibling_id uuid;
  details jsonb;
begin
  select public.import_transactions_atomic(
    repeat('1', 64),
    'mesmo-nome-reassign.csv',
    '23000000-0000-0000-0000-000000000001',
    '[{"Data":"2026-08-01T12:00:00.000Z","Nome_Fantasia":"ATIVA","Descricao_Original":"ATIVA","Valor":-10,"Tipo":"Despesa"},{"Data":"2026-08-02T12:00:00.000Z","Nome_Fantasia":"EXCLUIDA","Descricao_Original":"EXCLUIDA","Valor":-20,"Tipo":"Despesa"}]'::jsonb,
    2,
    '[]'::jsonb,
    jsonb_build_object('Conta_Nome', 'Conta origem local')
  ) into first_result;

  select public.import_transactions_atomic(
    repeat('2', 64),
    'mesmo-nome-reassign.csv',
    '23000000-0000-0000-0000-000000000001',
    '[{"Data":"2026-08-03T12:00:00.000Z","Nome_Fantasia":"IRMA","Descricao_Original":"IRMA","Valor":-30,"Tipo":"Despesa"}]'::jsonb,
    1,
    '[]'::jsonb,
    jsonb_build_object('Conta_Nome', 'Conta origem local')
  ) into sibling_result;

  first_log_id := (first_result->'import_log'->>'id')::uuid;
  active_id := (first_result->'transactions'->0->>'ID_Transacao')::uuid;
  deleted_id := (first_result->'transactions'->1->>'ID_Transacao')::uuid;
  sibling_id := (sibling_result->'transactions'->0->>'ID_Transacao')::uuid;

  delete from public.transactions where "ID_Transacao" = deleted_id;

  select public.reassign_import_batch_atomic(
    first_log_id,
    '23000000-0000-0000-0000-000000000002'
  ) into reassign_result;

  if (reassign_result->>'updated_count')::integer <> 1 then
    raise exception 'A correcao nao atualizou exatamente a linha ativa do lote.';
  end if;
  if not exists (
    select 1 from public.transactions
    where "ID_Transacao" = active_id
      and "ID_Conta" = '23000000-0000-0000-0000-000000000002'
  ) then
    raise exception 'A linha ativa nao foi movida para a conta de destino.';
  end if;
  if not exists (
    select 1 from public.transactions
    where "ID_Transacao" = sibling_id
      and "ID_Conta" = '23000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'O lote homonimo foi alterado indevidamente.';
  end if;

  select imported_details into details from public.import_logs where id = first_log_id;
  if not exists (
    select 1
    from jsonb_array_elements(details) detail
    where detail->>'ID_Transacao' = active_id::text
      and detail->>'ID_Conta' = '23000000-0000-0000-0000-000000000002'
      and detail->>'Audit_ID_Conta_Original' = '23000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'A auditoria da linha ativa nao preservou a conta original.';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(details) detail
    where detail->>'ID_Transacao' = deleted_id::text
      and detail->>'ID_Conta' = '23000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'A linha excluida teve seu historico reescrito.';
  end if;
end;
$$;

rollback;
