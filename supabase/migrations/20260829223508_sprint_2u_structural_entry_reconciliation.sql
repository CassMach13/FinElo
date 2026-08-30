-- Sprint 2U: contrato reversível para a etapa estrutural anterior à Sprint 2T.
--
-- Escopo permitido por execução:
--   * credit_card_entries.transaction_id (identidade comprovada pela origem);
--   * credit_card_entries.statement_id (competência confirmada no histórico);
--   * credit_card_entries.entry_type (uma classificação técnica comprovada).
--
-- O contrato não cria nem remove linhas e não altera transactions, datas,
-- valores, proveniência, faturas, pagamentos ou metadados protegidos. A flag
-- individual nasce desligada e rollback não depende dela.

begin;

do $finelo_2u_preflight$
begin
  if pg_catalog.to_regnamespace('finelo_internal') is null
     or pg_catalog.to_regprocedure(
       'finelo_internal.get_credit_card_projection_revision_for_user(uuid,uuid)'
     ) is null then
    raise exception 'O checksum privado da projeção não está disponível.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'finelo_structural_entry_executor'
  ) then
    create role finelo_structural_entry_executor;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'finelo_structural_entry_gateway'
  ) then
    create role finelo_structural_entry_gateway;
  end if;
end;
$finelo_2u_preflight$;

alter role finelo_structural_entry_executor
  nologin noinherit nobypassrls connection limit 0;
alter role finelo_structural_entry_gateway
  nologin noinherit nobypassrls connection limit 0;

create schema if not exists finelo_structural_internal authorization postgres;
alter schema finelo_structural_internal owner to postgres;
revoke all on schema finelo_structural_internal
  from public, anon, authenticated, service_role,
    finelo_structural_entry_executor, finelo_structural_entry_gateway;

grant usage on schema public to finelo_structural_entry_executor;
grant usage on schema finelo_internal to finelo_structural_entry_executor;
grant usage on schema finelo_structural_internal
  to finelo_structural_entry_executor;

create table if not exists finelo_structural_internal.credit_card_entry_reconciliation_snapshots (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  account_id uuid references public.contas(id) on delete cascade not null,
  card_id uuid references public.credit_cards(id) on delete cascade not null,
  operation_kind text not null
    check (operation_kind = 'structural_entry_reconciliation'),
  shadow_checksum text not null,
  before_revision text not null,
  after_revision text,
  before_rows jsonb not null,
  after_rows jsonb not null,
  entry_count integer not null check (entry_count between 1 and 5000),
  identity_update_count integer not null check (identity_update_count >= 0),
  competence_update_count integer not null check (competence_update_count >= 0),
  type_update_count integer not null check (type_update_count >= 0),
  applied_at timestamptz not null default pg_catalog.now(),
  rolled_back_at timestamptz,
  rollback_revision text,
  created_at timestamptz not null default pg_catalog.now()
);

create index if not exists idx_cc_entry_reconciliation_account_applied
  on finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  (account_id, applied_at desc);
create index if not exists idx_cc_entry_reconciliation_user
  on finelo_structural_internal.credit_card_entry_reconciliation_snapshots (user_id);
create index if not exists idx_cc_entry_reconciliation_card
  on finelo_structural_internal.credit_card_entry_reconciliation_snapshots (card_id);

alter table finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  enable row level security;
alter table finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  force row level security;

drop policy if exists "Sprint 2U executor owns authenticated snapshots"
  on finelo_structural_internal.credit_card_entry_reconciliation_snapshots;
create policy "Sprint 2U executor owns authenticated snapshots"
  on finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  for all
  to finelo_structural_entry_executor
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on table finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  from public, anon, authenticated, service_role;

grant select, insert
  on table finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  to finelo_structural_entry_executor;
grant update (after_revision, rolled_back_at, rollback_revision)
  on table finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  to finelo_structural_entry_executor;
grant select on table public.contas to finelo_structural_entry_executor;
grant select on table public.credit_cards to finelo_structural_entry_executor;
grant select on table public.transactions to finelo_structural_entry_executor;
grant select on table public.credit_card_statements to finelo_structural_entry_executor;
grant select on table public.credit_card_entries to finelo_structural_entry_executor;
grant select on table public.credit_card_payments to finelo_structural_entry_executor;
grant update (transaction_id, statement_id, entry_type)
  on table public.credit_card_entries
  to finelo_structural_entry_executor;
grant finelo_statement_conservation_executor to postgres
  with set true, inherit false;
set local role finelo_statement_conservation_executor;
grant execute on function
  finelo_internal.get_credit_card_projection_revision_for_user(uuid, uuid)
  to finelo_structural_entry_executor;
reset role;
revoke finelo_statement_conservation_executor from postgres;

create or replace function finelo_structural_internal.get_atomic_card_structural_entry_feature_state_impl()
returns text
language sql
stable
security invoker
set search_path = ''
as $feature$
  select case
    when pg_catalog.jsonb_extract_path_text(
      coalesce(
        nullif(pg_catalog.current_setting('request.jwt.claims', true), ''),
        '{}'
      )::jsonb,
      'app_metadata',
      'atomic_card_structural_entry_reconciliation_disabled'
    ) = 'true'
      then 'disabled'
    when pg_catalog.jsonb_extract_path_text(
      coalesce(
        nullif(pg_catalog.current_setting('request.jwt.claims', true), ''),
        '{}'
      )::jsonb,
      'app_metadata',
      'atomic_card_structural_entry_reconciliation_enabled'
    ) = 'true'
      then 'enabled'
    else 'unset'
  end;
$feature$;

revoke all on function
  finelo_structural_internal.get_atomic_card_structural_entry_feature_state_impl()
  from public, anon, authenticated, service_role, finelo_structural_entry_gateway;
grant execute on function
  finelo_structural_internal.get_atomic_card_structural_entry_feature_state_impl()
  to finelo_structural_entry_executor;

create or replace function finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(
  p_account_id uuid,
  p_expected_revision text,
  p_shadow_checksum text,
  p_entry_updates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
set statement_timeout = '60s'
as $apply$
declare
  v_user_id uuid := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
  v_card_id uuid;
  v_current_revision text;
  v_after_revision text;
  v_snapshot_id uuid := pg_catalog.gen_random_uuid();
  v_requested_count integer;
  v_target_count integer;
  v_updated_count integer;
  v_identity_update_count integer;
  v_competence_update_count integer;
  v_type_update_count integer;
  v_before_rows jsonb;
  v_after_rows jsonb;
  v_final_entry_count integer;
  v_final_identity_count integer;
begin
  if v_user_id is null then
    raise exception 'Autenticação obrigatória.' using errcode = '28000';
  end if;
  if coalesce(
    finelo_structural_internal.get_atomic_card_structural_entry_feature_state_impl(),
    'unset'
  ) <> 'enabled' then
    raise exception 'A reconciliação estrutural Sprint 2U está desabilitada para esta conta.'
      using errcode = '42501';
  end if;
  if coalesce(p_expected_revision, '') !~ '^[a-f0-9]{32}$'
     or coalesce(p_shadow_checksum, '') !~ '^shadow-v1-[a-f0-9]{8}$' then
    raise exception 'Revisão ou checksum inválido.' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_entry_updates) <> 'array' then
    raise exception 'A lista de atualizações deve ser um array JSON.' using errcode = '22023';
  end if;

  v_requested_count := pg_catalog.jsonb_array_length(p_entry_updates);
  if v_requested_count < 1 or v_requested_count > 5000 then
    raise exception 'Quantidade de linhas fora do limite do contrato.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_entry_updates) u(item)
    where pg_catalog.jsonb_typeof(u.item) <> 'object'
       or coalesce(u.item ->> 'rowId', '') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       or coalesce(u.item ->> 'expectedTransactionId', '') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       or coalesce(u.item ->> 'desiredTransactionId', '') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       or coalesce(u.item ->> 'expectedStatementRowId', '') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       or coalesce(u.item ->> 'desiredStatementRowId', '') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       or coalesce(u.item ->> 'expectedStatementKey', '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
       or coalesce(u.item ->> 'desiredStatementKey', '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
       or coalesce(u.item ->> 'expectedEntryType', '') not in (
         'purchase', 'installment_purchase', 'refund', 'invoice_payment',
         'fee', 'interest', 'adjustment', 'ignored', 'needs_review'
       )
       or coalesce(u.item ->> 'desiredEntryType', '') not in (
         'purchase', 'installment_purchase', 'refund', 'invoice_payment',
         'fee', 'interest', 'adjustment', 'ignored', 'needs_review'
       )
       or coalesce(u.item ->> 'expectedAmountCents', '') !~ '^-?[0-9]+$'
       or coalesce(u.item ->> 'expectedSourceFileName', '') = ''
       or coalesce(u.item ->> 'expectedSourceRowHash', '') = ''
       or coalesce(u.item ->> 'expectedSourceRowIndex', '') !~ '^[0-9]+$'
       or coalesce(u.item ->> 'expectedImportLotId', '') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  ) then
    raise exception 'O payload contém uma linha inválida.' using errcode = '22023';
  end if;

  if (
    select pg_catalog.count(distinct (u.item ->> 'rowId')::uuid)
    from pg_catalog.jsonb_array_elements(p_entry_updates) u(item)
  ) <> v_requested_count then
    raise exception 'O payload contém linhas físicas repetidas.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text, 202621)
  );

  select c.id
  into v_card_id
  from public.credit_cards c
  where c.account_id = p_account_id
    and c.user_id = v_user_id;
  if v_card_id is null then
    raise exception 'Cartão não encontrado para a conta autenticada.' using errcode = '42501';
  end if;

  v_current_revision :=
    finelo_internal.get_credit_card_projection_revision_for_user(
      p_account_id,
      v_user_id
    );
  if v_current_revision <> p_expected_revision then
    raise exception 'A projeção mudou depois da auditoria. Nenhum dado foi alterado.'
      using errcode = '40001';
  end if;

  perform e.id
  from public.credit_card_entries e
  join pg_catalog.jsonb_array_elements(p_entry_updates) u(item)
    on e.id = (u.item ->> 'rowId')::uuid
  where e.user_id = v_user_id
    and e.account_id = p_account_id
    and e.card_id = v_card_id
  order by e.id
  for update of e;

  select pg_catalog.count(*)
  into v_target_count
  from public.credit_card_entries e
  join pg_catalog.jsonb_array_elements(p_entry_updates) u(item)
    on e.id = (u.item ->> 'rowId')::uuid
  join public.credit_card_statements expected_statement
    on expected_statement.id = (u.item ->> 'expectedStatementRowId')::uuid
  join public.credit_card_statements desired_statement
    on desired_statement.id = (u.item ->> 'desiredStatementRowId')::uuid
  where e.user_id = v_user_id
    and e.account_id = p_account_id
    and e.card_id = v_card_id
    and e.transaction_id = (u.item ->> 'expectedTransactionId')::uuid
    and e.statement_id = expected_statement.id
    and e.entry_type = u.item ->> 'expectedEntryType'
    and e.posted_date is not distinct from nullif(u.item ->> 'expectedPostedDate', '')::date
    and pg_catalog.round(e.amount * 100)::bigint =
      (u.item ->> 'expectedAmountCents')::bigint
    and e.source_file_name = u.item ->> 'expectedSourceFileName'
    and e.source_row_hash = u.item ->> 'expectedSourceRowHash'
    and e.source_row_index = (u.item ->> 'expectedSourceRowIndex')::integer
    and e.import_lot_id = (u.item ->> 'expectedImportLotId')::uuid
    and expected_statement.user_id = v_user_id
    and expected_statement.account_id = p_account_id
    and expected_statement.card_id = v_card_id
    and desired_statement.user_id = v_user_id
    and desired_statement.account_id = p_account_id
    and desired_statement.card_id = v_card_id
    and (
      case
        when expected_statement.due_year between 1900 and 2200
         and expected_statement.due_month between 1 and 12
          then expected_statement.due_year::text || '-' ||
            pg_catalog.lpad(expected_statement.due_month::text, 2, '0')
        when expected_statement.reference_label ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
          then expected_statement.reference_label
        else pg_catalog.substring(expected_statement.due_date::text, 1, 7)
      end
    ) = u.item ->> 'expectedStatementKey'
    and (
      case
        when desired_statement.due_year between 1900 and 2200
         and desired_statement.due_month between 1 and 12
          then desired_statement.due_year::text || '-' ||
            pg_catalog.lpad(desired_statement.due_month::text, 2, '0')
        when desired_statement.reference_label ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
          then desired_statement.reference_label
        else pg_catalog.substring(desired_statement.due_date::text, 1, 7)
      end
    ) = u.item ->> 'desiredStatementKey';
  if v_target_count <> v_requested_count then
    raise exception 'As linhas ou faturas atuais divergem do plano auditado.'
      using errcode = '40001';
  end if;

  if (
    select pg_catalog.count(distinct t."ID_Transacao")
    from public.transactions t
    join (
      select distinct (u.item ->> 'desiredTransactionId')::uuid as transaction_id
      from pg_catalog.jsonb_array_elements(p_entry_updates) u(item)
    ) desired on desired.transaction_id = t."ID_Transacao"
    where t.user_id = v_user_id
      and t."ID_Conta" = p_account_id
  ) <> (
    select pg_catalog.count(distinct (u.item ->> 'desiredTransactionId')::uuid)
    from pg_catalog.jsonb_array_elements(p_entry_updates) u(item)
  ) then
    raise exception 'Uma identidade desejada não pertence à conta autenticada.'
      using errcode = '42501';
  end if;

  with desired_updates as (
    select
      (u.item ->> 'rowId')::uuid as row_id,
      (u.item ->> 'desiredTransactionId')::uuid as desired_transaction_id
    from pg_catalog.jsonb_array_elements(p_entry_updates) u(item)
  ), final_identities as (
    select e.id, coalesce(d.desired_transaction_id, e.transaction_id) as transaction_id
    from public.credit_card_entries e
    left join desired_updates d on d.row_id = e.id
    where e.user_id = v_user_id
      and e.account_id = p_account_id
      and e.card_id = v_card_id
  )
  select pg_catalog.count(*), pg_catalog.count(distinct f.transaction_id)
  into v_final_entry_count, v_final_identity_count
  from final_identities f;
  if v_final_entry_count <> v_final_identity_count then
    raise exception 'O plano não produz uma identidade única por lançamento.'
      using errcode = '23505';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'rowId', e.id,
        'transactionId', e.transaction_id,
        'statementRowId', e.statement_id,
        'entryType', e.entry_type
      ) order by e.id
    ),
    '[]'::jsonb
  )
  into v_before_rows
  from public.credit_card_entries e
  join pg_catalog.jsonb_array_elements(p_entry_updates) u(item)
    on e.id = (u.item ->> 'rowId')::uuid
  where e.user_id = v_user_id
    and e.account_id = p_account_id
    and e.card_id = v_card_id;

  select
    pg_catalog.count(*) filter (
      where u.item ->> 'expectedTransactionId' <>
        u.item ->> 'desiredTransactionId'
    ),
    pg_catalog.count(*) filter (
      where u.item ->> 'expectedStatementRowId' <>
        u.item ->> 'desiredStatementRowId'
    ),
    pg_catalog.count(*) filter (
      where u.item ->> 'expectedEntryType' <>
        u.item ->> 'desiredEntryType'
    )
  into
    v_identity_update_count,
    v_competence_update_count,
    v_type_update_count
  from pg_catalog.jsonb_array_elements(p_entry_updates) u(item);

  with desired_updates as (
    select
      (u.item ->> 'rowId')::uuid as row_id,
      (u.item ->> 'desiredTransactionId')::uuid as transaction_id,
      (u.item ->> 'desiredStatementRowId')::uuid as statement_id,
      u.item ->> 'desiredEntryType' as entry_type
    from pg_catalog.jsonb_array_elements(p_entry_updates) u(item)
  )
  update public.credit_card_entries e
  set transaction_id = desired.transaction_id,
      statement_id = desired.statement_id,
      entry_type = desired.entry_type
  from desired_updates desired
  where e.id = desired.row_id
    and e.user_id = v_user_id
    and e.account_id = p_account_id
    and e.card_id = v_card_id;
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> v_requested_count then
    raise exception 'O banco recusou uma atualização estrutural parcial.'
      using errcode = '40001';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'rowId', e.id,
        'transactionId', e.transaction_id,
        'statementRowId', e.statement_id,
        'entryType', e.entry_type
      ) order by e.id
    ),
    '[]'::jsonb
  )
  into v_after_rows
  from public.credit_card_entries e
  join pg_catalog.jsonb_array_elements(p_entry_updates) u(item)
    on e.id = (u.item ->> 'rowId')::uuid
  where e.user_id = v_user_id
    and e.account_id = p_account_id
    and e.card_id = v_card_id;

  v_after_revision :=
    finelo_internal.get_credit_card_projection_revision_for_user(
      p_account_id,
      v_user_id
    );
  if v_after_revision = v_current_revision then
    raise exception 'A revisão não mudou após a reconciliação.' using errcode = '40001';
  end if;

  insert into finelo_structural_internal.credit_card_entry_reconciliation_snapshots (
    id, user_id, account_id, card_id, operation_kind, shadow_checksum,
    before_revision, after_revision, before_rows, after_rows, entry_count,
    identity_update_count, competence_update_count, type_update_count
  ) values (
    v_snapshot_id, v_user_id, p_account_id, v_card_id,
    'structural_entry_reconciliation', p_shadow_checksum,
    v_current_revision, v_after_revision, v_before_rows, v_after_rows,
    v_requested_count, v_identity_update_count, v_competence_update_count,
    v_type_update_count
  );

  return pg_catalog.jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'before_revision', v_current_revision,
    'after_revision', v_after_revision,
    'entries_updated', v_updated_count,
    'identity_updates', v_identity_update_count,
    'competence_updates', v_competence_update_count,
    'type_updates', v_type_update_count,
    'transaction_records_changed', 0,
    'payment_records_changed', 0,
    'statement_records_changed', 0
  );
end;
$apply$;

revoke all on function finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role, finelo_structural_entry_gateway;
grant execute on function finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(
  uuid, text, text, jsonb
) to authenticated;
grant finelo_structural_entry_executor to postgres
  with set true, inherit false;
grant create on schema finelo_structural_internal to finelo_structural_entry_executor;
alter function finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(
  uuid, text, text, jsonb
) owner to finelo_structural_entry_executor;
revoke create on schema finelo_structural_internal from finelo_structural_entry_executor;
revoke finelo_structural_entry_executor from postgres;

create or replace function finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(
  p_snapshot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
set statement_timeout = '60s'
as $rollback$
declare
  v_user_id uuid := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
  v_snapshot finelo_structural_internal.credit_card_entry_reconciliation_snapshots%rowtype;
  v_current_revision text;
  v_restored_revision text;
  v_current_match_count integer;
  v_restored_count integer;
begin
  if v_user_id is null then
    raise exception 'Autenticação obrigatória.' using errcode = '28000';
  end if;

  select s.*
  into v_snapshot
  from finelo_structural_internal.credit_card_entry_reconciliation_snapshots s
  where s.id = p_snapshot_id
    and s.user_id = v_user_id
    and s.rolled_back_at is null
    and s.after_revision is not null
  for update;
  if v_snapshot.id is null then
    raise exception 'Snapshot ativo não encontrado.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_snapshot.account_id::text, 202621)
  );

  perform c.id
  from public.credit_cards c
  where c.id = v_snapshot.card_id
    and c.account_id = v_snapshot.account_id
    and c.user_id = v_user_id;

  v_current_revision :=
    finelo_internal.get_credit_card_projection_revision_for_user(
      v_snapshot.account_id,
      v_user_id
    );
  if v_current_revision <> v_snapshot.after_revision then
    raise exception 'A projeção mudou depois da aplicação. Rollback cancelado integralmente.'
      using errcode = '40001';
  end if;

  perform e.id
  from public.credit_card_entries e
  join pg_catalog.jsonb_array_elements(v_snapshot.after_rows) a(item)
    on e.id = (a.item ->> 'rowId')::uuid
  where e.user_id = v_user_id
    and e.account_id = v_snapshot.account_id
    and e.card_id = v_snapshot.card_id
  order by e.id
  for update of e;

  select pg_catalog.count(*)
  into v_current_match_count
  from public.credit_card_entries e
  join pg_catalog.jsonb_array_elements(v_snapshot.after_rows) a(item)
    on e.id = (a.item ->> 'rowId')::uuid
  where e.user_id = v_user_id
    and e.account_id = v_snapshot.account_id
    and e.card_id = v_snapshot.card_id
    and e.transaction_id = (a.item ->> 'transactionId')::uuid
    and e.statement_id = (a.item ->> 'statementRowId')::uuid
    and e.entry_type = a.item ->> 'entryType';
  if v_current_match_count <> v_snapshot.entry_count then
    raise exception 'As linhas atuais não coincidem com o snapshot aplicado.'
      using errcode = '40001';
  end if;

  with before_rows as (
    select
      (b.item ->> 'rowId')::uuid as row_id,
      (b.item ->> 'transactionId')::uuid as transaction_id,
      (b.item ->> 'statementRowId')::uuid as statement_id,
      b.item ->> 'entryType' as entry_type
    from pg_catalog.jsonb_array_elements(v_snapshot.before_rows) b(item)
  )
  update public.credit_card_entries e
  set transaction_id = before_row.transaction_id,
      statement_id = before_row.statement_id,
      entry_type = before_row.entry_type
  from before_rows before_row
  where e.id = before_row.row_id
    and e.user_id = v_user_id
    and e.account_id = v_snapshot.account_id
    and e.card_id = v_snapshot.card_id;
  get diagnostics v_restored_count = row_count;
  if v_restored_count <> v_snapshot.entry_count then
    raise exception 'O banco recusou uma restauração estrutural parcial.'
      using errcode = '40001';
  end if;

  v_restored_revision :=
    finelo_internal.get_credit_card_projection_revision_for_user(
      v_snapshot.account_id,
      v_user_id
    );
  if v_restored_revision <> v_snapshot.before_revision then
    raise exception 'A revisão restaurada não coincide com o snapshot.'
      using errcode = '40001';
  end if;

  update finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  set rolled_back_at = pg_catalog.now(),
      rollback_revision = v_restored_revision
  where id = v_snapshot.id
    and user_id = v_user_id;

  return pg_catalog.jsonb_build_object(
    'snapshot_id', v_snapshot.id,
    'account_id', v_snapshot.account_id,
    'restored_revision', v_restored_revision,
    'restored_entries', v_restored_count,
    'transaction_records_changed', 0,
    'payment_records_changed', 0,
    'statement_records_changed', 0,
    'rolled_back', true
  );
end;
$rollback$;

revoke all on function
  finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(uuid)
  from public, anon, authenticated, service_role, finelo_structural_entry_gateway;
grant execute on function
  finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(uuid)
  to authenticated;
grant finelo_structural_entry_executor to postgres
  with set true, inherit false;
grant create on schema finelo_structural_internal to finelo_structural_entry_executor;
alter function finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(uuid)
  owner to finelo_structural_entry_executor;
revoke create on schema finelo_structural_internal from finelo_structural_entry_executor;
revoke finelo_structural_entry_executor from postgres;

-- O caller autenticado recebe somente o caminho exato necessário para o wrapper
-- SECURITY INVOKER. O schema privado não é exposto pela Data API, e nenhum
-- privilégio de tabela é concedido ao caller.
grant usage on schema finelo_structural_internal to authenticated;

-- A Data API recebe somente wrappers estreitos SECURITY INVOKER. O owner não
-- possui acesso a tabelas nem capacidade de chamar as implementações privadas.
grant finelo_structural_entry_gateway to postgres
  with set true, inherit false;
grant create on schema public to finelo_structural_entry_gateway;
create or replace function public.get_atomic_card_structural_entry_feature_state()
returns text
language sql
stable
security invoker
set search_path = ''
as $wrapper$
  select case
    when pg_catalog.jsonb_extract_path_text(
      coalesce(
        nullif(pg_catalog.current_setting('request.jwt.claims', true), ''),
        '{}'
      )::jsonb,
      'app_metadata',
      'atomic_card_structural_entry_reconciliation_disabled'
    ) = 'true'
      then 'disabled'
    when pg_catalog.jsonb_extract_path_text(
      coalesce(
        nullif(pg_catalog.current_setting('request.jwt.claims', true), ''),
        '{}'
      )::jsonb,
      'app_metadata',
      'atomic_card_structural_entry_reconciliation_enabled'
    ) = 'true'
      then 'enabled'
    else 'unset'
  end;
$wrapper$;

revoke all on function public.get_atomic_card_structural_entry_feature_state()
  from public, anon, authenticated, service_role;
grant execute on function public.get_atomic_card_structural_entry_feature_state()
  to authenticated;

alter function public.get_atomic_card_structural_entry_feature_state()
  owner to finelo_structural_entry_gateway;

create or replace function public.reconcile_credit_card_structural_entries_atomic_v1(
  p_account_id uuid,
  p_expected_revision text,
  p_shadow_checksum text,
  p_entry_updates jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $wrapper$
  select finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(
    p_account_id,
    p_expected_revision,
    p_shadow_checksum,
    p_entry_updates
  );
$wrapper$;

revoke all on function public.reconcile_credit_card_structural_entries_atomic_v1(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.reconcile_credit_card_structural_entries_atomic_v1(
  uuid, text, text, jsonb
) to authenticated;

alter function public.reconcile_credit_card_structural_entries_atomic_v1(
  uuid, text, text, jsonb
) owner to finelo_structural_entry_gateway;

create or replace function public.rollback_credit_card_structural_entries_atomic_v1(
  p_snapshot_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $wrapper$
  select finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(
    p_snapshot_id
  );
$wrapper$;

revoke all on function public.rollback_credit_card_structural_entries_atomic_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.rollback_credit_card_structural_entries_atomic_v1(uuid)
  to authenticated;

alter function public.rollback_credit_card_structural_entries_atomic_v1(uuid)
  owner to finelo_structural_entry_gateway;
revoke create on schema public from finelo_structural_entry_gateway;
revoke finelo_structural_entry_gateway from postgres;

do $finelo_2u_final_assertions$
declare
  v_public_security_definer_count integer;
  v_bad_search_path_count integer;
  v_bad_owner_count integer;
begin
  select pg_catalog.count(*)
  into v_public_security_definer_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'get_atomic_card_structural_entry_feature_state',
      'reconcile_credit_card_structural_entries_atomic_v1',
      'rollback_credit_card_structural_entries_atomic_v1'
    )
    and p.prosecdef;
  if v_public_security_definer_count <> 0 then
    raise exception 'Um wrapper público Sprint 2U elevou privilégios indevidamente.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_atomic_card_structural_entry_feature_state'
      and p.prosecdef
  ) then
    raise exception 'A leitura pública da flag Sprint 2U elevou privilégios indevidamente.';
  end if;

  select pg_catalog.count(*)
  into v_bad_owner_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'get_atomic_card_structural_entry_feature_state',
      'reconcile_credit_card_structural_entries_atomic_v1',
      'rollback_credit_card_structural_entries_atomic_v1'
    )
    and pg_catalog.pg_get_userbyid(p.proowner) <>
      'finelo_structural_entry_gateway';
  if v_bad_owner_count <> 0 then
    raise exception 'Um gateway público Sprint 2U possui owner indevido.';
  end if;

  select pg_catalog.count(*)
  into v_bad_search_path_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where p.proname in (
      'get_atomic_card_structural_entry_feature_state_impl',
      'reconcile_credit_card_structural_entries_atomic_v1_impl',
      'rollback_credit_card_structural_entries_atomic_v1_impl',
      'get_atomic_card_structural_entry_feature_state',
      'reconcile_credit_card_structural_entries_atomic_v1',
      'rollback_credit_card_structural_entries_atomic_v1'
    )
    and n.nspname in ('finelo_structural_internal', 'public')
    and not exists (
      select 1
      from pg_catalog.unnest(coalesce(p.proconfig, '{}'::text[])) cfg(setting)
      where cfg.setting in ('search_path=', 'search_path=""')
    );
  if v_bad_search_path_count <> 0 then
    raise exception 'Uma função Sprint 2U não possui search_path vazio.';
  end if;

  if not pg_catalog.has_function_privilege(
    'authenticated',
    'public.reconcile_credit_card_structural_entries_atomic_v1(uuid,text,text,jsonb)',
    'EXECUTE'
  )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.reconcile_credit_card_structural_entries_atomic_v1(uuid,text,text,jsonb)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'public',
       'public.reconcile_credit_card_structural_entries_atomic_v1(uuid,text,text,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'ACL pública inválida no executor Sprint 2U.';
  end if;

  if not pg_catalog.has_function_privilege(
    'authenticated',
    'public.rollback_credit_card_structural_entries_atomic_v1(uuid)',
    'EXECUTE'
  )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.rollback_credit_card_structural_entries_atomic_v1(uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'public',
       'public.rollback_credit_card_structural_entries_atomic_v1(uuid)',
       'EXECUTE'
     ) then
    raise exception 'ACL pública inválida no rollback Sprint 2U.';
  end if;

  if not pg_catalog.has_schema_privilege(
       'authenticated', 'finelo_structural_internal', 'USAGE'
     )
     or not pg_catalog.has_function_privilege(
       'authenticated',
       'finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(uuid,text,text,jsonb)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'authenticated',
       'finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'finelo_structural_internal.get_atomic_card_structural_entry_feature_state_impl()',
       'EXECUTE'
     )
     or pg_catalog.has_schema_privilege(
       'finelo_structural_entry_gateway', 'finelo_structural_internal', 'USAGE'
     )
     or pg_catalog.has_function_privilege(
       'finelo_structural_entry_gateway',
       'finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(uuid,text,text,jsonb)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'finelo_structural_entry_gateway',
       'finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(uuid)',
       'EXECUTE'
     ) then
    raise exception 'ACL privada mínima inválida nos wrappers Sprint 2U.';
  end if;

  if pg_catalog.has_table_privilege(
       'finelo_structural_entry_gateway',
       'public.credit_card_entries',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or pg_catalog.has_table_privilege(
       'finelo_structural_entry_gateway',
       'finelo_structural_internal.credit_card_entry_reconciliation_snapshots',
       'SELECT,INSERT,UPDATE,DELETE'
     ) then
    raise exception 'O gateway Sprint 2U recebeu acesso direto a tabelas.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles role
    where role.rolname in (
      'finelo_structural_entry_executor',
      'finelo_structural_entry_gateway'
    )
      and (
        role.rolcanlogin or role.rolsuper or role.rolcreatedb
        or role.rolcreaterole or role.rolreplication or role.rolbypassrls
      )
  ) then
    raise exception 'Um role Sprint 2U possui atributo elevado.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles role on role.oid = membership.roleid
    join pg_catalog.pg_roles member_role on member_role.oid = membership.member
    where role.rolname in (
      'finelo_structural_entry_executor',
      'finelo_structural_entry_gateway'
    )
      and (
        member_role.rolname <> 'postgres'
        or membership.inherit_option
        or membership.set_option
      )
  ) then
    raise exception 'Uma membership funcional Sprint 2U permaneceu ativa.';
  end if;
end;
$finelo_2u_final_assertions$;

commit;
