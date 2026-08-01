\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, created_at, updated_at)
values (
  '10000000-0000-0000-0000-000000000001',
  'sprint1a-local@example.invalid',
  now(),
  now()
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

insert into public.contas (
  id, user_id, "Nome_Conta", "Tipo_Conta", "Saldo_Inicial", "Data_Saldo_Inicial",
  limite_credito, dia_fechamento, dia_vencimento
)
values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Cartão local Sprint 1A',
  'Cartão de Crédito',
  0,
  '2026-01-01',
  5000,
  19,
  28
);

do $$
declare
  first_result jsonb;
  duplicate_result jsonb;
begin
  select public.import_transactions_atomic(
    repeat('a', 64),
    'fatura-original.csv',
    '20000000-0000-0000-0000-000000000001',
    '[
      {
        "Data":"2026-07-10T12:00:00.000Z",
        "Data_Pagamento":"2026-07-28T12:00:00.000Z",
        "Nome_Fantasia":"CAFÉ",
        "Descricao_Original":"CAFÉ",
        "Categoria":"Alimentação",
        "Fonte":"Teste local",
        "Valor":-35,
        "Tipo":"Despesa"
      },
      {
        "Data":"2026-07-11T12:00:00.000Z",
        "Data_Pagamento":"2026-07-28T12:00:00.000Z",
        "Nome_Fantasia":"CAFÉ",
        "Descricao_Original":"CAFÉ",
        "Categoria":"Alimentação",
        "Fonte":"Teste local",
        "Valor":-35,
        "Tipo":"Despesa"
      }
    ]'::jsonb,
    2,
    '[]'::jsonb,
    '{"Conta_Nome":"Cartão local Sprint 1A","Card_Reference_Label":"2026-07"}'::jsonb
  ) into first_result;

  if first_result->>'duplicate' <> 'false' then
    raise exception 'Primeira importação foi marcada incorretamente como duplicada.';
  end if;
  if jsonb_array_length(first_result->'transactions') <> 2 then
    raise exception 'A importação atômica não retornou exatamente duas transações.';
  end if;

  select public.import_transactions_atomic(
    repeat('a', 64),
    'arquivo-renomeado.csv',
    '20000000-0000-0000-0000-000000000001',
    '[]'::jsonb,
    0,
    '[]'::jsonb,
    '{}'::jsonb
  ) into duplicate_result;

  if duplicate_result->>'duplicate' <> 'true' then
    raise exception 'O mesmo fingerprint renomeado não foi tratado como idempotente.';
  end if;
  if duplicate_result->>'batch_id' is null then
    raise exception 'A repetição idempotente não retornou o lote original.';
  end if;
  if (select count(*) from public.transactions) <> 2 then
    raise exception 'A repetição do lote criou transações extras.';
  end if;
  if (select count(*) from public.import_logs) <> 1 then
    raise exception 'A repetição do lote criou histórico extra.';
  end if;
end;
$$;

insert into public.credit_cards (
  id, user_id, account_id, name, limit_amount, closing_day, due_day
)
values (
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'Cartão local Sprint 1A',
  5000,
  19,
  28
);

insert into public.credit_card_import_lots (
  id, user_id, card_id, account_id, source_file_name,
  statement_due_year, statement_due_month, checksum
)
values (
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'fatura-original.csv',
  2026,
  7,
  'local-checksum'
);

insert into public.credit_card_entries (
  user_id, card_id, account_id, import_lot_id, source_file_name,
  source_row_index, source_row_hash, transaction_id, posted_date,
  description_raw, amount, abs_amount, direction, entry_type
)
select
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'fatura-original.csv',
  1,
  'hash-a',
  "ID_Transacao",
  '2026-07-10',
  'CAFÉ',
  -35,
  35,
  'debit',
  'purchase'
from public.transactions
order by "Data"
limit 1;

do $$
declare
  duplicated_transaction_id uuid;
begin
  select transaction_id into duplicated_transaction_id
  from public.credit_card_entries
  limit 1;

  begin
    insert into public.credit_card_entries (
      user_id, card_id, account_id, import_lot_id, source_file_name,
      source_row_index, source_row_hash, transaction_id, posted_date,
      description_raw, amount, abs_amount, direction, entry_type
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      'outro-arquivo.csv',
      2,
      'hash-b',
      duplicated_transaction_id,
      '2026-07-10',
      'CAFÉ',
      -35,
      35,
      'debit',
      'purchase'
    );
    raise exception 'A guarda aceitou uma segunda projeção para o mesmo transaction_id.';
  exception
    when unique_violation then
      null;
  end;
end;
$$;

insert into public.credit_card_entries (
  user_id, card_id, account_id, import_lot_id, source_file_name,
  source_row_index, source_row_hash, transaction_id, posted_date,
  description_raw, amount, abs_amount, direction, entry_type
)
select
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'fatura-original.csv',
  2,
  'hash-c',
  "ID_Transacao",
  '2026-07-11',
  'CAFÉ',
  -35,
  35,
  'debit',
  'purchase'
from public.transactions
order by "Data" desc
limit 1;

do $$
begin
  if (select count(*) from public.credit_card_entries) <> 2 then
    raise exception 'Valores iguais com transaction_id diferentes não foram preservados.';
  end if;
  if (public.get_finelo_integrity_dry_run()->>'duplicate_card_projection_transaction_ids')::integer <> 0 then
    raise exception 'O relatório dry-run acusou uma duplicidade inexistente.';
  end if;
end;
$$;

rollback;
