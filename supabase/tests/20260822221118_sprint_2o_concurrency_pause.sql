\set ON_ERROR_STOP on

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
