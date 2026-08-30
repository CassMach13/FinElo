begin;

-- The original row-level guard observes each intermediate row state. That is
-- correct for single-row writes, but rejects an otherwise valid atomic repair
-- when duplicate historical identities are being separated or identities are
-- swapped in one UPDATE. Statement-level transition tables let the guard lock
-- every affected identity and validate only the final state of the statement.

drop trigger if exists trg_prevent_new_cc_entry_transaction_duplicate
  on public.credit_card_entries;
drop trigger if exists trg_prevent_new_cc_entry_transaction_duplicate_insert
  on public.credit_card_entries;
drop trigger if exists trg_prevent_new_cc_entry_transaction_duplicate_update
  on public.credit_card_entries;

drop function if exists public.prevent_new_credit_card_entry_transaction_duplicate();

create function public.prevent_new_credit_card_entry_transaction_duplicate_insert_stmt()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard_insert$
declare
  v_transaction_id uuid;
begin
  for v_transaction_id in
    select distinct inserted.transaction_id
    from new_credit_card_entries inserted
    where inserted.transaction_id is not null
    order by inserted.transaction_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_transaction_id::text, 0)
    );
  end loop;

  select affected.transaction_id
  into v_transaction_id
  from (
    select distinct inserted.transaction_id
    from new_credit_card_entries inserted
    where inserted.transaction_id is not null
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
$guard_insert$;

create function public.prevent_new_credit_card_entry_transaction_duplicate_update_stmt()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard_update$
declare
  v_transaction_id uuid;
begin
  -- Lock both released and claimed identities in a stable order so concurrent
  -- swaps and inserts cannot pass by observing each other's uncommitted state.
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

revoke all on function public.prevent_new_credit_card_entry_transaction_duplicate_insert_stmt()
  from public, anon, authenticated;
revoke all on function public.prevent_new_credit_card_entry_transaction_duplicate_update_stmt()
  from public, anon, authenticated;

create trigger trg_prevent_new_cc_entry_transaction_duplicate_insert
after insert on public.credit_card_entries
referencing new table as new_credit_card_entries
for each statement
execute function public.prevent_new_credit_card_entry_transaction_duplicate_insert_stmt();

create trigger trg_prevent_new_cc_entry_transaction_duplicate_update
after update on public.credit_card_entries
referencing old table as old_credit_card_entries
            new table as new_credit_card_entries
for each statement
execute function public.prevent_new_credit_card_entry_transaction_duplicate_update_stmt();

do $postflight$
declare
  v_trigger_count integer;
begin
  select pg_catalog.count(*)
  into v_trigger_count
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_class table_row
    on table_row.oid = trigger_row.tgrelid
  join pg_catalog.pg_namespace schema_row
    on schema_row.oid = table_row.relnamespace
  where schema_row.nspname = 'public'
    and table_row.relname = 'credit_card_entries'
    and not trigger_row.tgisinternal
    and trigger_row.tgname in (
      'trg_prevent_new_cc_entry_transaction_duplicate_insert',
      'trg_prevent_new_cc_entry_transaction_duplicate_update'
    )
    and (trigger_row.tgtype & 1) = 0
    and trigger_row.tgenabled = 'O';

  if v_trigger_count <> 2 then
    raise exception 'Os guards statement-level de identidade não foram instalados.';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    'public.prevent_new_credit_card_entry_transaction_duplicate_insert_stmt()',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.prevent_new_credit_card_entry_transaction_duplicate_insert_stmt()',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'anon',
    'public.prevent_new_credit_card_entry_transaction_duplicate_update_stmt()',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.prevent_new_credit_card_entry_transaction_duplicate_update_stmt()',
    'EXECUTE'
  ) then
    raise exception 'Uma função de trigger ficou executável diretamente.';
  end if;
end;
$postflight$;

commit;
