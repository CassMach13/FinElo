\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, created_at, updated_at)
values (
  '14000000-0000-0000-0000-000000000001',
  'sprint1a-partial-cleanup-local@example.invalid',
  now(),
  now()
);

select set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-000000000001', true);

insert into public.contas (
  id, user_id, "Nome_Conta", "Tipo_Conta", "Saldo_Inicial", "Data_Saldo_Inicial"
)
values (
  '24000000-0000-0000-0000-000000000001',
  '14000000-0000-0000-0000-000000000001',
  'Conta local lote parcial',
  'Conta Corrente',
  0,
  '2026-01-01'
);

do $$
declare
  import_result jsonb;
  delete_result jsonb;
  log_id uuid;
  first_id uuid;
begin
  select public.import_transactions_atomic(
    repeat('3', 64),
    'lote-parcial.csv',
    '24000000-0000-0000-0000-000000000001',
    '[{"Data":"2026-08-01T12:00:00.000Z","Nome_Fantasia":"UM","Descricao_Original":"UM","Valor":-10,"Tipo":"Despesa"},{"Data":"2026-08-02T12:00:00.000Z","Nome_Fantasia":"DOIS","Descricao_Original":"DOIS","Valor":-20,"Tipo":"Despesa"}]'::jsonb,
    2,
    '[]'::jsonb,
    '{}'::jsonb
  ) into import_result;

  log_id := (import_result->'import_log'->>'id')::uuid;
  first_id := (import_result->'transactions'->0->>'ID_Transacao')::uuid;

  delete from public.transactions where "ID_Transacao" = first_id;
  select public.delete_import_batch_atomic(log_id) into delete_result;

  if (delete_result->>'deleted_count')::integer <> 1 then
    raise exception 'A limpeza parcial nao removeu exatamente a linha restante.';
  end if;
  if (delete_result->>'previously_missing_count')::integer <> 1 then
    raise exception 'A limpeza parcial nao informou a linha isolada previamente excluida.';
  end if;
  if exists (select 1 from public.transactions where user_id = '14000000-0000-0000-0000-000000000001') then
    raise exception 'Restaram transacoes do lote parcial.';
  end if;
  if exists (select 1 from public.import_logs where id = log_id) then
    raise exception 'O log do lote parcial nao foi removido.';
  end if;
  if exists (select 1 from public.import_batches where import_log_id = log_id) then
    raise exception 'A reserva idempotente do lote parcial nao foi liberada.';
  end if;
end;
$$;

rollback;
