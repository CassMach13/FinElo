\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, created_at, updated_at)
values (
  '11000000-0000-0000-0000-000000000001',
  'sprint1a-delete-local@example.invalid',
  now(),
  now()
);

select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);

insert into public.contas (
  id, user_id, "Nome_Conta", "Tipo_Conta", "Saldo_Inicial", "Data_Saldo_Inicial"
)
values (
  '21000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'Conta local exclusão exata',
  'Conta Corrente',
  0,
  '2026-01-01'
);

do $$
declare
  first_result jsonb;
  second_result jsonb;
  delete_result jsonb;
  first_log_id uuid;
  second_transaction_id uuid;
begin
  select public.import_transactions_atomic(
    repeat('b', 64),
    'mesmo-nome.csv',
    '21000000-0000-0000-0000-000000000001',
    '[{"Data":"2026-08-02T12:00:00.000Z","Nome_Fantasia":"LOTE UM","Descricao_Original":"LOTE UM","Valor":-120,"Tipo":"Despesa"}]'::jsonb,
    1,
    '[]'::jsonb,
    '{}'::jsonb
  ) into first_result;

  select public.import_transactions_atomic(
    repeat('c', 64),
    'mesmo-nome.csv',
    '21000000-0000-0000-0000-000000000001',
    '[{"Data":"2026-08-03T12:00:00.000Z","Nome_Fantasia":"LOTE DOIS","Descricao_Original":"LOTE DOIS","Valor":-120,"Tipo":"Despesa"}]'::jsonb,
    1,
    '[]'::jsonb,
    '{}'::jsonb
  ) into second_result;

  first_log_id := (first_result->'import_log'->>'id')::uuid;
  second_transaction_id := (second_result->'transactions'->0->>'ID_Transacao')::uuid;

  select public.delete_import_batch_atomic(first_log_id) into delete_result;

  if (delete_result->>'deleted_count')::integer <> 1 then
    raise exception 'A exclusão exata não removeu exatamente uma transação.';
  end if;
  if (select count(*) from public.transactions) <> 1 then
    raise exception 'A exclusão por lote afetou transações do outro lote com o mesmo nome.';
  end if;
  if not exists (
    select 1 from public.transactions where "ID_Transacao" = second_transaction_id
  ) then
    raise exception 'A transação do segundo lote com o mesmo nome foi removida.';
  end if;
  if (select count(*) from public.import_logs) <> 1 then
    raise exception 'A exclusão por lote removeu o log incorreto.';
  end if;
  if (select count(*) from public.import_batches) <> 1 then
    raise exception 'A reserva idempotente do lote excluído não acompanhou o log.';
  end if;
end;
$$;

rollback;
