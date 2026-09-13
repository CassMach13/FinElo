\set ON_ERROR_STOP on

do $membership_rollback_assertion$
begin
  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles owner_role on owner_role.oid = m.roleid
    join pg_catalog.pg_roles member_role on member_role.oid = m.member
    where owner_role.rolname in (
      'finelo_structural_entry_gateway',
      'finelo_structural_entry_executor',
      'finelo_structural_retirement_executor'
    )
      and member_role.rolname = 'postgres'
      and m.admin_option
      and not m.inherit_option
      and not m.set_option
  ) <> 3
  or exists (
    select 1
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles owner_role on owner_role.oid = m.roleid
    join pg_catalog.pg_roles member_role on member_role.oid = m.member
    where owner_role.rolname in (
      'finelo_structural_entry_gateway',
      'finelo_structural_entry_executor',
      'finelo_structural_retirement_executor'
    )
      and member_role.rolname = 'postgres'
      and (
        not m.admin_option or m.inherit_option or m.set_option
      )
  ) then
    raise exception 'A falha deliberada deixou membership residual.';
  end if;

  if current_user <> 'postgres'
     or pg_catalog.pg_has_role(
       'postgres',
       'finelo_structural_retirement_executor',
       'SET'
     ) then
    raise exception 'SET ROLE comum permaneceu disponivel depois do rollback.';
  end if;

  if pg_catalog.to_regclass(
       'finelo_structural_internal.finelo_retirement_failure_probe'
     ) is not null
     or pg_catalog.has_schema_privilege(
       'finelo_structural_retirement_executor',
       'finelo_structural_internal',
       'CREATE'
     ) then
    raise exception 'A falha deliberada deixou objeto ou CREATE residual.';
  end if;
end;
$membership_rollback_assertion$;
