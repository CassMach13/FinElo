begin;

drop trigger if exists trg_prevent_new_cc_entry_transaction_duplicate_insert
  on public.credit_card_entries;
drop trigger if exists trg_prevent_new_cc_entry_transaction_duplicate_update
  on public.credit_card_entries;

drop function if exists public.prevent_new_credit_card_entry_transaction_duplicate_insert_stmt();
drop function if exists public.prevent_new_credit_card_entry_transaction_duplicate_update_stmt();

create or replace function public.prevent_new_credit_card_entry_transaction_duplicate()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $guard_row$
begin
  if new.transaction_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.transaction_id::text, 0));

  if exists (
    select 1
    from public.credit_card_entries e
    where e.transaction_id = new.transaction_id
      and e.id <> new.id
  ) then
    raise exception 'A transação % já possui uma projeção no motor de cartão.',
      new.transaction_id
      using errcode = '23505',
        constraint = 'credit_card_entries_transaction_id_guard';
  end if;

  return new;
end;
$guard_row$;

drop trigger if exists trg_prevent_new_cc_entry_transaction_duplicate
  on public.credit_card_entries;
create trigger trg_prevent_new_cc_entry_transaction_duplicate
before insert or update of transaction_id on public.credit_card_entries
for each row
execute function public.prevent_new_credit_card_entry_transaction_duplicate();

commit;
