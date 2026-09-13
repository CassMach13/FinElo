\set ON_ERROR_STOP on

do $ownership_and_membership_test$
declare
  v_bad_function_count integer;
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
    raise exception 'Memberships canonicas estruturais nao foram preservadas.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles owner_role on owner_role.oid = m.roleid
    join pg_catalog.pg_roles member_role on member_role.oid = m.member
    where owner_role.rolname = 'finelo_structural_retirement_executor'
      and member_role.rolname <> 'postgres'
  ) then
    raise exception 'Membership adicional do retirement executor permaneceu.';
  end if;

  if pg_catalog.pg_has_role(
       'postgres',
       'finelo_structural_retirement_executor',
       'SET'
     ) then
    raise exception 'SET ROLE comum permaneceu habilitado para o retirement executor.';
  end if;

  with expected(signature, expected_owner, expected_security_definer) as (
    values
      ('finelo_structural_internal.get_atomic_card_structural_entry_feature_state_impl()', 'postgres', false),
      ('finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(uuid,text,text,jsonb)', 'finelo_structural_entry_executor', true),
      ('finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(uuid)', 'finelo_structural_entry_executor', true),
      ('public.get_atomic_card_structural_entry_feature_state()', 'finelo_structural_entry_gateway', false),
      ('public.reconcile_credit_card_structural_entries_atomic_v1(uuid,text,text,jsonb)', 'finelo_structural_entry_gateway', false),
      ('public.rollback_credit_card_structural_entries_atomic_v1(uuid)', 'finelo_structural_entry_gateway', false),
      ('finelo_structural_internal.retire_credit_card_structural_snapshot_v1_impl(uuid,uuid,uuid,text,integer,text,uuid)', 'finelo_structural_retirement_executor', true),
      ('public.retire_credit_card_structural_snapshot_v1(uuid,uuid,uuid,text,integer,text,uuid)', 'finelo_structural_entry_gateway', false)
  )
  select pg_catalog.count(*)
  into v_bad_function_count
  from expected e
  left join pg_catalog.pg_proc p
    on p.oid = pg_catalog.to_regprocedure(e.signature)
  where p.oid is null
     or pg_catalog.pg_get_userbyid(p.proowner) <> e.expected_owner
     or p.prosecdef is distinct from e.expected_security_definer
     or not exists (
       select 1
       from pg_catalog.unnest(coalesce(p.proconfig, '{}'::text[])) cfg(setting)
       where cfg.setting in ('search_path=', 'search_path=""')
     );

  if v_bad_function_count <> 0 then
    raise exception 'Owner, SECURITY ou search_path de uma funcao divergiu.';
  end if;

  if pg_catalog.has_function_privilege(
       'public',
       'public.retire_credit_card_structural_snapshot_v1(uuid,uuid,uuid,text,integer,text,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.retire_credit_card_structural_snapshot_v1(uuid,uuid,uuid,text,integer,text,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.retire_credit_card_structural_snapshot_v1(uuid,uuid,uuid,text,integer,text,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.retire_credit_card_structural_snapshot_v1(uuid,uuid,uuid,text,integer,text,uuid)',
       'EXECUTE'
     ) then
    raise exception 'ACL do wrapper administrativo divergiu.';
  end if;

  if exists (
    select 1
    from (values ('public'), ('anon'), ('authenticated'), ('service_role')) caller(role_name)
    cross join (values
      ('public.reconcile_credit_card_structural_entries_atomic_v1(uuid,text,text,jsonb)'),
      ('public.rollback_credit_card_structural_entries_atomic_v1(uuid)'),
      ('finelo_structural_internal.get_atomic_card_structural_entry_feature_state_impl()'),
      ('finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(uuid,text,text,jsonb)'),
      ('finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(uuid)')
    ) blocked(signature)
    where pg_catalog.has_function_privilege(
      caller.role_name,
      blocked.signature,
      'EXECUTE'
    )
  ) then
    raise exception 'Uma funcao aposentada ou privada manteve EXECUTE externo.';
  end if;

  if exists (
    select 1
    from (values ('public'), ('anon'), ('authenticated'), ('service_role')) caller(role_name)
    cross join (values
      ('finelo_structural_internal.structural_legacy_flow_state'),
      ('finelo_structural_internal.credit_card_entry_reconciliation_retirements')
    ) protected_table(table_name)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) privilege_row(privilege_name)
    where pg_catalog.has_table_privilege(
      caller.role_name,
      protected_table.table_name,
      privilege_row.privilege_name
    )
  ) then
    raise exception 'Uma tabela privada recebeu privilegio externo adicional.';
  end if;
end;
$ownership_and_membership_test$;
