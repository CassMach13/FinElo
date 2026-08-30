-- Sprint 2U: permite que o executor estrutural avalie a política RLS legada
-- de public.contas. O papel continua NOLOGIN/NOINHERIT/NOBYPASSRLS e recebe
-- somente EXECUTE na função booleana já exposta a authenticated.
begin;

do $preflight$
declare
  v_function_oid oid := pg_catalog.to_regprocedure(
    'public.has_family_access(uuid)'
  )::oid;
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles r
    where r.rolname = 'finelo_structural_entry_executor'
      and not r.rolcanlogin
      and not r.rolinherit
      and not r.rolbypassrls
      and not r.rolsuper
  ) then
    raise exception 'O executor estrutural não preserva os atributos mínimos esperados.';
  end if;

  if v_function_oid is null then
    raise exception 'A função public.has_family_access(uuid) não foi encontrada.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where p.oid = v_function_oid
      and n.nspname = 'public'
      and p.proname = 'has_family_access'
      and p.prosecdef
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  ) then
    raise exception 'A função de acesso familiar diverge do contrato validado.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles member_role on member_role.oid = m.member
    where member_role.rolname = 'finelo_structural_entry_executor'
  ) then
    raise exception 'O executor estrutural possui membership inesperada.';
  end if;
end;
$preflight$;

grant execute on function public.has_family_access(uuid)
  to finelo_structural_entry_executor;

do $postflight$
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(p.proacl) a
    join pg_catalog.pg_roles grantee on grantee.oid = a.grantee
    where p.oid = pg_catalog.to_regprocedure('public.has_family_access(uuid)')
      and grantee.rolname = 'finelo_structural_entry_executor'
      and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'O executor estrutural não recebeu a ACL mínima necessária.';
  end if;

  if pg_catalog.has_table_privilege(
    'finelo_structural_entry_executor',
    'public.transactions',
    'INSERT,UPDATE,DELETE'
  ) or pg_catalog.has_table_privilege(
    'finelo_structural_entry_executor',
    'public.credit_card_statements',
    'INSERT,UPDATE,DELETE'
  ) or pg_catalog.has_table_privilege(
    'finelo_structural_entry_executor',
    'public.credit_card_payments',
    'INSERT,UPDATE,DELETE'
  ) then
    raise exception 'A correção de ACL ampliou privilégios de escrita indevidamente.';
  end if;
end;
$postflight$;

commit;
