begin;

create or replace function public.prevent_new_credit_card_entry_transaction_duplicate_update_stmt()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard_update$
declare
  v_transaction_id uuid;
begin
  for v_transaction_id in
    select changed.transaction_id
    from (
      select previous.transaction_id
      from old_credit_card_entries previous
      join new_credit_card_entries updated using (id)
      where previous.transaction_id is distinct from updated.transaction_id
        and previous.transaction_id is not null
      union
      select updated.transaction_id
      from old_credit_card_entries previous
      join new_credit_card_entries updated using (id)
      where previous.transaction_id is distinct from updated.transaction_id
        and updated.transaction_id is not null
    ) changed
    order by changed.transaction_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_transaction_id::text, 0)
    );
  end loop;

  select affected.transaction_id
  into v_transaction_id
  from (
    select distinct updated.transaction_id
    from old_credit_card_entries previous
    join new_credit_card_entries updated using (id)
    where previous.transaction_id is distinct from updated.transaction_id
      and updated.transaction_id is not null
  ) affected
  join public.credit_card_entries existing
    on existing.transaction_id = affected.transaction_id
  group by affected.transaction_id
  having pg_catalog.count(*) > 1
  order by affected.transaction_id
  limit 1;

  if found then
    raise exception 'A transação % já possui uma projeção no motor de cartão.',
      v_transaction_id
      using errcode = '23505',
        constraint = 'credit_card_entries_transaction_id_guard';
  end if;

  return null;
end;
$guard_update$;

grant finelo_structural_entry_executor to postgres
  with set true, inherit false;
grant create on schema finelo_structural_internal
  to finelo_structural_entry_executor;
set local role finelo_structural_entry_executor;

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

  select snapshot.*
  into v_snapshot
  from finelo_structural_internal.credit_card_entry_reconciliation_snapshots snapshot
  where snapshot.id = p_snapshot_id
    and snapshot.user_id = v_user_id
    and snapshot.rolled_back_at is null
    and snapshot.after_revision is not null
  for update;
  if v_snapshot.id is null then
    raise exception 'Snapshot ativo não encontrado.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_snapshot.account_id::text, 202621)
  );

  perform card.id
  from public.credit_cards card
  where card.id = v_snapshot.card_id
    and card.account_id = v_snapshot.account_id
    and card.user_id = v_user_id;

  v_current_revision :=
    finelo_internal.get_credit_card_projection_revision_for_user(
      v_snapshot.account_id,
      v_user_id
    );
  if v_current_revision <> v_snapshot.after_revision then
    raise exception 'A projeção mudou depois da aplicação. Rollback cancelado integralmente.'
      using errcode = '40001';
  end if;

  perform entry.id
  from public.credit_card_entries entry
  join pg_catalog.jsonb_array_elements(v_snapshot.after_rows) after_row(item)
    on entry.id = (after_row.item ->> 'rowId')::uuid
  where entry.user_id = v_user_id
    and entry.account_id = v_snapshot.account_id
    and entry.card_id = v_snapshot.card_id
  order by entry.id
  for update of entry;

  select pg_catalog.count(*)
  into v_current_match_count
  from public.credit_card_entries entry
  join pg_catalog.jsonb_array_elements(v_snapshot.after_rows) after_row(item)
    on entry.id = (after_row.item ->> 'rowId')::uuid
  where entry.user_id = v_user_id
    and entry.account_id = v_snapshot.account_id
    and entry.card_id = v_snapshot.card_id
    and entry.transaction_id = (after_row.item ->> 'transactionId')::uuid
    and entry.statement_id = (after_row.item ->> 'statementRowId')::uuid
    and entry.entry_type = after_row.item ->> 'entryType';
  if v_current_match_count <> v_snapshot.entry_count then
    raise exception 'As linhas atuais não coincidem com o snapshot aplicado.'
      using errcode = '40001';
  end if;

  with before_rows as (
    select
      (before_row.item ->> 'rowId')::uuid as row_id,
      (before_row.item ->> 'transactionId')::uuid as transaction_id,
      (before_row.item ->> 'statementRowId')::uuid as statement_id,
      before_row.item ->> 'entryType' as entry_type
    from pg_catalog.jsonb_array_elements(v_snapshot.before_rows) before_row(item)
  )
  update public.credit_card_entries entry
  set transaction_id = before_row.transaction_id,
      statement_id = before_row.statement_id,
      entry_type = before_row.entry_type
  from before_rows before_row
  where entry.id = before_row.row_id
    and entry.user_id = v_user_id
    and entry.account_id = v_snapshot.account_id
    and entry.card_id = v_snapshot.card_id;
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

reset role;
revoke create on schema finelo_structural_internal
  from finelo_structural_entry_executor;
revoke finelo_structural_entry_executor from postgres;

do $postflight$
begin
  if pg_catalog.pg_get_functiondef(
    'public.prevent_new_credit_card_entry_transaction_duplicate_update_stmt()'::regprocedure
  ) like '%finelo.structural_identity_guard_rollback_snapshot_id%'
     or pg_catalog.pg_get_functiondef(
       'finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(uuid)'::regprocedure
     ) like '%finelo.structural_identity_guard_rollback_snapshot_id%' then
    raise exception 'O rollback de schema Sprint 2W não restaurou as funções anteriores.';
  end if;
end;
$postflight$;

commit;
