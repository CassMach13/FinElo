\set ON_ERROR_STOP on

-- Somente PostgreSQL descartavel. Simula uma falha depois de ambos os SET ROLE,
-- antes das restauracoes explicitas, para provar o rollback transacional dos
-- bits de membership.
begin;

grant finelo_structural_entry_gateway to postgres
  with set true;
set local role finelo_structural_entry_gateway;
select current_user;
reset role;

grant finelo_structural_entry_executor to postgres
  with set true;
set local role finelo_structural_entry_executor;
select current_user;
reset role;

grant finelo_structural_retirement_executor to postgres
  with set true;
grant create on schema finelo_structural_internal
  to finelo_structural_retirement_executor;
set local role finelo_structural_retirement_executor;
select current_user;
create table finelo_structural_internal.finelo_retirement_failure_probe (
  id integer primary key
);
reset role;

do $deliberate_failure$
begin
  raise exception 'Falha deliberada para testar rollback das memberships.';
end;
$deliberate_failure$;

commit;
