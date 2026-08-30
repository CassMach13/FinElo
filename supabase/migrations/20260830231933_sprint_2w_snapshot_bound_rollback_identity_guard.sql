begin;

-- Sprint 2W: o guard statement-level continua recusando qualquer duplicidade
-- nova, mas permite que o rollback estrutural restaure exatamente as
-- identidades históricas registradas no snapshot ativo. A exceção exige ao
-- mesmo tempo o executor privado, um contexto local criado pelo próprio
-- rollback e igualdade exata entre os IDs finais e os IDs do before_rows.

create or replace function public.prevent_new_credit_card_entry_transaction_duplicate_update_stmt()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard_update$
declare
  v_transaction_id uuid;
  v_rollback_snapshot_id uuid;
  v_snapshot_restoration_matches boolean := false;
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
    begin
      if current_user = 'finelo_structural_entry_executor'
         and nullif(
           pg_catalog.current_setting(
             'finelo.structural_identity_guard_rollback_snapshot_id',
             true
           ),
           ''
         ) is not null then
        v_rollback_snapshot_id := pg_catalog.current_setting(
          'finelo.structural_identity_guard_rollback_snapshot_id',
          true
        )::uuid;

        select not exists (
          with affected_duplicates as (
            select affected.transaction_id
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
          ), snapshot_rows as (
            select
              (before_row.item ->> 'transactionId')::uuid as transaction_id,
              pg_catalog.array_agg(
                (before_row.item ->> 'rowId')::uuid
                order by (before_row.item ->> 'rowId')::uuid
              ) as row_ids
            from finelo_structural_internal.credit_card_entry_reconciliation_snapshots snapshot
            cross join lateral pg_catalog.jsonb_array_elements(snapshot.before_rows)
              before_row(item)
            where snapshot.id = v_rollback_snapshot_id
              and snapshot.rolled_back_at is null
              and snapshot.after_revision is not null
              and (before_row.item ->> 'transactionId') is not null
            group by (before_row.item ->> 'transactionId')::uuid
          ), current_rows as (
            select
              entry.transaction_id,
              pg_catalog.array_agg(entry.id order by entry.id) as row_ids
            from public.credit_card_entries entry
            join affected_duplicates duplicate
              on duplicate.transaction_id = entry.transaction_id
            group by entry.transaction_id
          )
          select 1
          from affected_duplicates duplicate
          left join snapshot_rows expected
            on expected.transaction_id = duplicate.transaction_id
          left join current_rows actual
            on actual.transaction_id = duplicate.transaction_id
          where expected.row_ids is null
             or actual.row_ids is distinct from expected.row_ids
        )
        into v_snapshot_restoration_matches;
      end if;
    exception
      when invalid_text_representation then
        v_snapshot_restoration_matches := false;
    end;

    if not v_snapshot_restoration_matches then
      raise exception 'A transação % já possui uma projeção no motor de cartão.',
        v_transaction_id
        using errcode = '23505',
          constraint = 'credit_card_entries_transaction_id_guard';
    end if;
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

  perform pg_catalog.set_config(
    'finelo.structural_identity_guard_rollback_snapshot_id',
    v_snapshot.id::text,
    true
  );

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

  perform pg_catalog.set_config(
    'finelo.structural_identity_guard_rollback_snapshot_id',
    '',
    true
  );

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
declare
  v_guard_owner name;
  v_rollback_owner name;
  v_guard_security_definer boolean;
  v_rollback_security_definer boolean;
  v_guard_config text[];
  v_rollback_config text[];
  v_guard_definition text;
  v_rollback_definition text;
begin
  select
    owner_role.rolname,
    function_row.prosecdef,
    function_row.proconfig,
    pg_catalog.lower(pg_catalog.pg_get_functiondef(function_row.oid))
  into
    v_guard_owner,
    v_guard_security_definer,
    v_guard_config,
    v_guard_definition
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace schema_row on schema_row.oid = function_row.pronamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid = function_row.proowner
  where schema_row.nspname = 'public'
    and function_row.proname = 'prevent_new_credit_card_entry_transaction_duplicate_update_stmt';

  select
    owner_role.rolname,
    function_row.prosecdef,
    function_row.proconfig,
    pg_catalog.lower(pg_catalog.pg_get_functiondef(function_row.oid))
  into
    v_rollback_owner,
    v_rollback_security_definer,
    v_rollback_config,
    v_rollback_definition
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace schema_row on schema_row.oid = function_row.pronamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid = function_row.proowner
  where schema_row.nspname = 'finelo_structural_internal'
    and function_row.proname = 'rollback_credit_card_structural_entries_atomic_v1_impl';

  if v_guard_owner <> 'postgres'
     or v_guard_security_definer
     or not ('search_path=""' = any(v_guard_config))
     or v_guard_definition not like '%finelo.structural_identity_guard_rollback_snapshot_id%'
     or v_rollback_owner <> 'finelo_structural_entry_executor'
     or not v_rollback_security_definer
     or not ('search_path=""' = any(v_rollback_config))
     or v_rollback_definition not like '%finelo.structural_identity_guard_rollback_snapshot_id%' then
    raise exception 'O hardening de rollback Sprint 2W não foi instalado integralmente.';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    'public.prevent_new_credit_card_entry_transaction_duplicate_update_stmt()',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.prevent_new_credit_card_entry_transaction_duplicate_update_stmt()',
    'EXECUTE'
  ) then
    raise exception 'O guard Sprint 2W ficou executável diretamente.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles role on role.oid = membership.roleid
    join pg_catalog.pg_roles member_role on member_role.oid = membership.member
    where role.rolname = 'finelo_structural_entry_executor'
      and member_role.rolname = 'postgres'
      and (membership.inherit_option or membership.set_option)
  ) or pg_catalog.has_schema_privilege(
    'finelo_structural_entry_executor',
    'finelo_structural_internal',
    'CREATE'
  ) then
    raise exception 'A elevação temporária Sprint 2W permaneceu ativa.';
  end if;
end;
$postflight$;

commit;
