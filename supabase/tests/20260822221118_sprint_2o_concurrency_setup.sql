\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_app_meta_data) values (
  '1a000000-0000-0000-0000-000000000001',
  'sprint2o-concurrency@example.invalid',
  '{"atomic_card_statement_conservation_enabled":true}'
);

insert into public.contas (
  id, user_id, "Nome_Conta", "Tipo_Conta", "Saldo_Inicial", "Data_Saldo_Inicial"
) values (
  '2a000000-0000-0000-0000-000000000001',
  '1a000000-0000-0000-0000-000000000001',
  'Cartão Concorrência 2O', 'Cartão de Crédito', 0, '2026-01-01'
);

insert into public.credit_cards (id, user_id, account_id, name, closing_day, due_day) values (
  '3a000000-0000-0000-0000-000000000001',
  '1a000000-0000-0000-0000-000000000001',
  '2a000000-0000-0000-0000-000000000001',
  'Cartão Concorrência 2O', 3, 28
);

insert into public.credit_card_statements (
  id, user_id, card_id, account_id, reference_label, purchase_reference_label,
  due_year, due_month, due_date, status
) values
  (
    '6a000000-0000-0000-0000-000000000001',
    '1a000000-0000-0000-0000-000000000001',
    '3a000000-0000-0000-0000-000000000001',
    '2a000000-0000-0000-0000-000000000001',
    'concurrency-a', '2026-09', 2026, 9, '2026-09-28', 'open'
  ),
  (
    '6a000000-0000-0000-0000-000000000002',
    '1a000000-0000-0000-0000-000000000001',
    '3a000000-0000-0000-0000-000000000001',
    '2a000000-0000-0000-0000-000000000001',
    'concurrency-b', '2026-09', 2026, 9, '2026-09-28', 'open'
  );

create or replace function public.sprint2o_concurrency_pause()
returns trigger
language plpgsql
as $$
begin
  if new.source_origin = 'atomic_statement_conservation' then
    perform pg_sleep(10);
  end if;
  return new;
end;
$$;

create trigger sprint2o_concurrency_pause_trigger
before insert on public.credit_card_statements
for each row execute procedure public.sprint2o_concurrency_pause();
