begin;

revoke execute on function public.has_family_access(uuid)
  from finelo_structural_entry_executor;

do $postflight$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(p.proacl) a
    join pg_catalog.pg_roles grantee on grantee.oid = a.grantee
    where p.oid = pg_catalog.to_regprocedure('public.has_family_access(uuid)')
      and grantee.rolname = 'finelo_structural_entry_executor'
      and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'O rollback não removeu a ACL auxiliar da Sprint 2U.';
  end if;
end;
$postflight$;

commit;
