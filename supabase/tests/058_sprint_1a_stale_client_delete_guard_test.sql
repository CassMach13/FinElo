\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, created_at, updated_at)
values (
  '12000000-0000-0000-0000-000000000001',
  'sprint1a-stale-client-local@example.invalid',
  now(),
  now()
);

select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000001', true);

insert into public.contas (
  id, user_id, "Nome_Conta", "Tipo_Conta", "Saldo_Inicial", "Data_Saldo_Inicial"
)
values (
  '22000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  'Conta local cliente antigo',
  'Conta Corrente',
  0,
  '2026-01-01'
);

do $$
declare
  atomic_result jsonb;
  orphan_result jsonb;
  individual_result jsonb;
  atomic_log_id uuid;
  orphan_log_id uuid;
  orphan_transaction_id uuid;
  individual_transaction_id uuid;
begin
  select public.import_transactions_atomic(
    repeat('d', 64),
    'colisao.csv',
    '22000000-0000-0000-0000-000000000001',
    '[{"Data":"2026-08-02T12:00:00.000Z","Nome_Fantasia":"ATOMICO","Descricao_Original":"ATOMICO","Valor":-120,"Tipo":"Despesa"}]'::jsonb,
    1,
    '[]'::jsonb,
    '{}'::jsonb
  ) into atomic_result;
  atomic_log_id := (atomic_result->'import_log'->>'id')::uuid;

  insert into public.transactions (
    user_id, "Data", "Nome_Fantasia", "Valor", "Origem", "Tipo", "ID_Conta"
  ) values (
    '12000000-0000-0000-0000-000000000001',
    '2026-08-02T12:00:00.000Z',
    'LEGADO',
    -120,
    'colisao.csv',
    'Despesa',
    '22000000-0000-0000-0000-000000000001'
  );

  begin
    delete from public.transactions
    where user_id = '12000000-0000-0000-0000-000000000001'
      and "Origem" = 'colisao.csv';
    raise exception 'O cliente antigo conseguiu excluir lotes colidentes por origem.';
  exception
    when raise_exception then
      if sqlerrm not like 'Exclusão ampla bloqueada:%' then
        raise;
      end if;
  end;

  if (select count(*) from public.transactions where "Origem" = 'colisao.csv') <> 2 then
    raise exception 'A tentativa bloqueada alterou o ledger.';
  end if;

  perform public.delete_import_batch_atomic(atomic_log_id);
  if (select count(*) from public.transactions where "Origem" = 'colisao.csv') <> 1 then
    raise exception 'A exclusão exata não preservou a transação legada.';
  end if;

  select public.import_transactions_atomic(
    repeat('f', 64),
    'individual.csv',
    '22000000-0000-0000-0000-000000000001',
    '[{"Data":"2026-08-03T12:00:00.000Z","Nome_Fantasia":"INDIVIDUAL","Descricao_Original":"INDIVIDUAL","Valor":-31.31,"Tipo":"Despesa"}]'::jsonb,
    1,
    '[]'::jsonb,
    '{}'::jsonb
  ) into individual_result;
  individual_transaction_id := (individual_result->'transactions'->0->>'ID_Transacao')::uuid;

  insert into public.transactions (
    user_id, "Data", "Nome_Fantasia", "Valor", "Origem", "Tipo", "ID_Conta"
  ) values (
    '12000000-0000-0000-0000-000000000001',
    '2026-08-03T12:00:00.000Z',
    'LEGADO INDIVIDUAL',
    -31.31,
    'individual.csv',
    'Despesa',
    '22000000-0000-0000-0000-000000000001'
  );

  delete from public.transactions
  where "ID_Transacao" = individual_transaction_id;
  if (select count(*) from public.transactions where "Origem" = 'individual.csv') <> 1 then
    raise exception 'A protecao bloqueou ou afetou uma exclusao manual isolada.';
  end if;

  select public.import_transactions_atomic(
    repeat('e', 64),
    'orfao.csv',
    '22000000-0000-0000-0000-000000000001',
    '[{"Data":"2026-08-04T12:00:00.000Z","Nome_Fantasia":"ORFAO","Descricao_Original":"ORFAO","Valor":-49.9,"Tipo":"Despesa"}]'::jsonb,
    1,
    '[]'::jsonb,
    '{}'::jsonb
  ) into atomic_result;
  orphan_log_id := (atomic_result->'import_log'->>'id')::uuid;
  orphan_transaction_id := (atomic_result->'transactions'->0->>'ID_Transacao')::uuid;

  perform set_config('finelo.atomic_batch_delete', 'on', true);
  delete from public.transactions where "ID_Transacao" = orphan_transaction_id;
  perform set_config('finelo.atomic_batch_delete', 'off', true);

  select public.delete_import_batch_atomic(orphan_log_id) into orphan_result;
  if coalesce((orphan_result->>'orphan_cleanup')::boolean, false) is not true then
    raise exception 'O log totalmente órfão não foi identificado.';
  end if;
  if (orphan_result->>'deleted_count')::integer <> 0 then
    raise exception 'A limpeza do log órfão removeu uma transação adicional.';
  end if;
  if exists (select 1 from public.import_logs where id = orphan_log_id) then
    raise exception 'O log órfão permaneceu após a limpeza segura.';
  end if;
end;
$$;

rollback;
