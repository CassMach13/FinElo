\set ON_ERROR_STOP on

-- Executar como autoridade do PostgreSQL descartavel. SET LOCAL ROLE reproduz
-- cada identidade sem conceder memberships persistentes ao papel de migration.
begin;

set local role anon;
do $anon_denied$
begin
  begin
    perform public.retire_credit_card_structural_snapshot_v1(
      null, null, null, null, null, null, null
    );
    raise exception 'anon executou o wrapper administrativo.';
  exception when insufficient_privilege then null;
  end;
end;
$anon_denied$;
reset role;

set local role authenticated;
do $authenticated_denied$
begin
  begin
    perform public.retire_credit_card_structural_snapshot_v1(
      null, null, null, null, null, null, null
    );
    raise exception 'authenticated executou o wrapper administrativo.';
  exception when insufficient_privilege then null;
  end;
end;
$authenticated_denied$;
reset role;

set local role service_role;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role","sub":"local-access-test"}',
  true
);
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

do $service_wrapper_only$
begin
  begin
    perform public.retire_credit_card_structural_snapshot_v1(
      null, null, null, null, null, null, null
    );
    raise exception 'O wrapper nao validou parametros obrigatorios.';
  exception when invalid_parameter_value then null;
  end;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'retire_credit_card_structural_snapshot_v1',
        'reconcile_credit_card_structural_entries_atomic_v1',
        'rollback_credit_card_structural_entries_atomic_v1'
      )
      and pg_catalog.has_function_privilege(
        'service_role',
        p.oid,
        'EXECUTE'
      )
  ) <> 1 then
    raise exception 'service_role possui superficie publica estrutural inesperada.';
  end if;
end;
$service_wrapper_only$;
reset role;

rollback;
