\set ON_ERROR_STOP on

-- Executar somente em banco local descartavel. dblink abre duas sessoes reais
-- para provar que tentativas simultaneas convergem para uma unica decisao.
create extension if not exists dblink;

insert into auth.users (id, email) values (
  '1d000000-0000-4000-8000-000000000001',
  'structural-retirement-concurrency@example.invalid'
);
insert into public.contas (
  id, user_id, "Nome_Conta", "Tipo_Conta", "Saldo_Inicial", "Data_Saldo_Inicial"
) values (
  '2d000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000001',
  'Cartao concorrencia aposentadoria', 'Cartão de Crédito', 0, '2026-01-01'
);
insert into public.credit_cards (id, user_id, account_id, name, closing_day, due_day)
values (
  '3d000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000001',
  '2d000000-0000-4000-8000-000000000001',
  'Cartao concorrencia aposentadoria', 3, 10
);

alter table finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  disable trigger trg_reject_legacy_snapshot_mutation;
insert into finelo_structural_internal.credit_card_entry_reconciliation_snapshots (
  id, user_id, account_id, card_id, operation_kind, shadow_checksum,
  before_revision, after_revision, before_rows, after_rows, entry_count,
  identity_update_count, competence_update_count, type_update_count
) values (
  '4d000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000001',
  '2d000000-0000-4000-8000-000000000001',
  '3d000000-0000-4000-8000-000000000001',
  'structural_entry_reconciliation', 'shadow-v1-concurrency',
  'before-concurrency', 'after-concurrency',
  '[{"rowId":"5d000000-0000-4000-8000-000000000001","transactionId":"6d000000-0000-4000-8000-000000000001","statementRowId":"7d000000-0000-4000-8000-000000000001","entryType":"purchase"}]',
  '[{"rowId":"5d000000-0000-4000-8000-000000000001","transactionId":"6d000000-0000-4000-8000-000000000001","statementRowId":"7d000000-0000-4000-8000-000000000001","entryType":"purchase"}]',
  1, 0, 0, 0
);
alter table finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  enable trigger trg_reject_legacy_snapshot_mutation;

select dblink_connect('retire_a', 'dbname=' || current_database());
select dblink_connect('retire_b', 'dbname=' || current_database());
select dblink_exec(
  'retire_a',
  'set request.jwt.claims = ''{"role":"service_role","sub":"concurrency-a"}''; set request.jwt.claim.role = ''service_role'';'
);
select dblink_exec(
  'retire_b',
  'set request.jwt.claims = ''{"role":"service_role","sub":"concurrency-b"}''; set request.jwt.claim.role = ''service_role'';'
);

select dblink_send_query(
  'retire_a',
  $query$
    select public.retire_credit_card_structural_snapshot_v1(
      '4d000000-0000-4000-8000-000000000001',
      '2d000000-0000-4000-8000-000000000001',
      '3d000000-0000-4000-8000-000000000001',
      'after-concurrency', 1,
      'Duas sessoes concorrentes devem registrar uma unica decisao auditavel.',
      '8d000000-0000-4000-8000-000000000001'
    )::text
  $query$
);
select dblink_send_query(
  'retire_b',
  $query$
    select public.retire_credit_card_structural_snapshot_v1(
      '4d000000-0000-4000-8000-000000000001',
      '2d000000-0000-4000-8000-000000000001',
      '3d000000-0000-4000-8000-000000000001',
      'after-concurrency', 1,
      'Duas sessoes concorrentes devem registrar uma unica decisao auditavel.',
      '8d000000-0000-4000-8000-000000000001'
    )::text
  $query$
);

create temporary table structural_retirement_concurrency_results (
  result jsonb not null
);
insert into structural_retirement_concurrency_results (result)
select result::jsonb
from dblink_get_result('retire_a') as response(result text);
insert into structural_retirement_concurrency_results (result)
select result::jsonb
from dblink_get_result('retire_b') as response(result text);

do $assert_concurrency$
begin
  if (select pg_catalog.count(*) from structural_retirement_concurrency_results) <> 2
     or (
       select pg_catalog.count(*)
       from structural_retirement_concurrency_results r
       where (r.result ->> 'idempotent_replay')::boolean
     ) <> 1
     or (
       select pg_catalog.count(*)
       from structural_retirement_concurrency_results r
       where not (r.result ->> 'idempotent_replay')::boolean
     ) <> 1
     or (
       select pg_catalog.count(*)
       from finelo_structural_internal.credit_card_entry_reconciliation_retirements r
       where r.snapshot_id = '4d000000-0000-4000-8000-000000000001'
     ) <> 1 then
    raise exception 'Tentativas concorrentes nao convergiram para uma unica decisao.';
  end if;
end;
$assert_concurrency$;

select dblink_disconnect('retire_a');
select dblink_disconnect('retire_b');

-- Limpeza exclusiva do fixture local.
alter table finelo_structural_internal.credit_card_entry_reconciliation_retirements
  disable trigger trg_reject_retirement_update_delete;
delete from finelo_structural_internal.credit_card_entry_reconciliation_retirements
where snapshot_id = '4d000000-0000-4000-8000-000000000001';
alter table finelo_structural_internal.credit_card_entry_reconciliation_retirements
  enable trigger trg_reject_retirement_update_delete;

alter table finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  disable trigger trg_reject_legacy_snapshot_mutation;
delete from finelo_structural_internal.credit_card_entry_reconciliation_snapshots
where id = '4d000000-0000-4000-8000-000000000001';
alter table finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  enable trigger trg_reject_legacy_snapshot_mutation;

delete from public.credit_cards
where id = '3d000000-0000-4000-8000-000000000001';
delete from public.contas
where id = '2d000000-0000-4000-8000-000000000001';
delete from auth.users
where id = '1d000000-0000-4000-8000-000000000001';
