-- Rollback conservador da capacidade administrativa de aposentadoria.
--
-- IMPORTANTE: este rollback jamais restaura apply/rollback estrutural, grants
-- antigos ou escrita no snapshot. Se houver snapshot ativo OU aposentado, ele
-- recusa a reversao. Reabrir o legado exigiria uma migration manual, revisada e
-- explicitamente autorizada; este arquivo nao contem esse caminho.

begin;

do $fail_closed_precondition$
begin
  if session_user <> 'postgres'
     or current_user <> 'postgres' then
    raise exception
      'O rollback deve iniciar com session_user e current_user postgres.'
      using errcode = '42501';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles owner_role on owner_role.oid = m.roleid
    join pg_catalog.pg_roles member_role on member_role.oid = m.member
    where owner_role.rolname in (
      'finelo_structural_entry_gateway',
      'finelo_structural_entry_executor'
    )
      and member_role.rolname = 'postgres'
      and m.admin_option
      and not m.inherit_option
      and not m.set_option
  ) <> 2
  or exists (
    select 1
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles owner_role on owner_role.oid = m.roleid
    join pg_catalog.pg_roles member_role on member_role.oid = m.member
    where owner_role.rolname in (
      'finelo_structural_entry_gateway',
      'finelo_structural_entry_executor'
    )
      and member_role.rolname = 'postgres'
      and (
        not m.admin_option or m.inherit_option or m.set_option
      )
  ) then
    raise exception
      'Memberships estruturais divergiram do estado esperado; rollback cancelado.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles r
    where r.rolname = 'finelo_structural_retirement_executor'
      and not r.rolcanlogin
      and not r.rolinherit
      and not r.rolbypassrls
      and not r.rolsuper
      and not r.rolcreatedb
      and not r.rolcreaterole
      and not r.rolreplication
      and r.rolconnlimit = 0
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles owner_role on owner_role.oid = m.roleid
    join pg_catalog.pg_roles member_role on member_role.oid = m.member
    where owner_role.rolname = 'finelo_structural_retirement_executor'
      and member_role.rolname = 'postgres'
      and m.admin_option
      and not m.inherit_option
      and not m.set_option
  ) <> 1 or exists (
    select 1
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles owner_role on owner_role.oid = m.roleid
    join pg_catalog.pg_roles member_role on member_role.oid = m.member
    where owner_role.rolname = 'finelo_structural_retirement_executor'
      and (
        member_role.rolname <> 'postgres'
        or not m.admin_option
        or m.inherit_option
        or m.set_option
      )
  ) then
    raise exception
      'Executor de aposentadoria ausente, inseguro ou com membership residual.'
      using errcode = '55000';
  end if;

  if pg_catalog.pg_get_userbyid(
       (
         select p.proowner
         from pg_catalog.pg_proc p
         where p.oid = pg_catalog.to_regprocedure(
           'public.retire_credit_card_structural_snapshot_v1(uuid,uuid,uuid,text,integer,text,uuid)'
         )
       )
     ) is distinct from 'finelo_structural_entry_gateway'
     or pg_catalog.pg_get_userbyid(
       (
         select p.proowner
         from pg_catalog.pg_proc p
         where p.oid = pg_catalog.to_regprocedure(
           'finelo_structural_internal.retire_credit_card_structural_snapshot_v1_impl(uuid,uuid,uuid,text,integer,text,uuid)'
         )
       )
     ) is distinct from 'finelo_structural_retirement_executor'
     or pg_catalog.pg_get_userbyid(
       (
         select c.relowner
         from pg_catalog.pg_class c
         where c.oid = pg_catalog.to_regclass(
           'finelo_structural_internal.credit_card_entry_reconciliation_retirements'
         )
       )
     ) is distinct from 'finelo_structural_retirement_executor' then
    raise exception
      'Owners dos objetos de aposentadoria divergiram; rollback cancelado.'
      using errcode = '55000';
  end if;

end;
$fail_closed_precondition$;

create temporary table finelo_structural_membership_baseline
on commit drop
as
select
  owner_role.rolname as owner_role_name,
  member_role.rolname as member_role_name,
  grantor_role.rolname as grantor_role_name,
  m.admin_option,
  m.inherit_option,
  m.set_option
from pg_catalog.pg_auth_members m
join pg_catalog.pg_roles owner_role on owner_role.oid = m.roleid
join pg_catalog.pg_roles member_role on member_role.oid = m.member
join pg_catalog.pg_roles grantor_role on grantor_role.oid = m.grantor
where owner_role.rolname in (
  'finelo_structural_entry_gateway',
  'finelo_structural_entry_executor',
  'finelo_structural_retirement_executor'
)
  and member_role.rolname = 'postgres';

create function pg_temp.restore_finelo_structural_membership_v1(
  p_owner_role_name text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $restore_membership$
declare
  v_original_grantor text;
begin
  select b.grantor_role_name
  into strict v_original_grantor
  from pg_temp.finelo_structural_membership_baseline b
  where b.owner_role_name = p_owner_role_name
    and b.member_role_name = 'postgres';

  if v_original_grantor = current_user then
    execute pg_catalog.format(
      'revoke set option for %I from postgres granted by current_user',
      p_owner_role_name
    );
  else
    execute pg_catalog.format(
      'revoke %I from postgres granted by current_user',
      p_owner_role_name
    );
  end if;
end;
$restore_membership$;

-- A leitura fail-closed usa o owner minimo da tabela; postgres nao recebe
-- SELECT persistente. Se houver dados protegidos, o erro reverte inclusive a
-- elevacao temporaria de SET.
grant finelo_structural_retirement_executor to postgres
  with set true;
set local role finelo_structural_retirement_executor;
do $protected_state_precondition$
begin
  if exists (
    select 1
    from finelo_structural_internal.credit_card_entry_reconciliation_retirements
  ) then
    raise exception
      'Rollback recusado: existe decisao de aposentadoria e ela nao pode ser apagada.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from finelo_structural_internal.credit_card_entry_reconciliation_snapshots s
    where s.rolled_back_at is null
  ) then
    raise exception
      'Rollback recusado: existe snapshot estrutural ativo. O caminho legado permanecera fechado.'
      using errcode = '55000';
  end if;
end;
$protected_state_precondition$;
reset role;
select pg_temp.restore_finelo_structural_membership_v1(
  'finelo_structural_retirement_executor'
);

grant finelo_structural_entry_gateway to postgres
  with set true;
set local role finelo_structural_entry_gateway;
drop function if exists public.retire_credit_card_structural_snapshot_v1(
  uuid, uuid, uuid, text, integer, text, uuid
);
reset role;
select pg_temp.restore_finelo_structural_membership_v1(
  'finelo_structural_entry_gateway'
);

drop policy if exists "Retirement executor reads structural snapshots"
  on finelo_structural_internal.credit_card_entry_reconciliation_snapshots;
revoke select on table
  finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  from finelo_structural_retirement_executor;

grant finelo_structural_retirement_executor to postgres
  with set true;
set local role finelo_structural_retirement_executor;
drop function if exists
  finelo_structural_internal.retire_credit_card_structural_snapshot_v1_impl(
    uuid, uuid, uuid, text, integer, text, uuid
  );
drop trigger if exists trg_reject_retirement_update_delete
  on finelo_structural_internal.credit_card_entry_reconciliation_retirements;
drop table if exists
  finelo_structural_internal.credit_card_entry_reconciliation_retirements;
reset role;
revoke usage on schema finelo_structural_internal
  from finelo_structural_retirement_executor;
select pg_temp.restore_finelo_structural_membership_v1(
  'finelo_structural_retirement_executor'
);

drop function if exists finelo_structural_internal.reject_retirement_mutation_v1();

-- Mantidos intencionalmente:
--   * structural_legacy_flow_state com apply_enabled=false;
--   * os corpos bloqueadores das quatro funcoes antigas;
--   * os REVOKEs de apply/rollback;
--   * trg_reject_legacy_snapshot_mutation;
--   * ux_structural_snapshot_single_unrolled_per_card.
-- Assim, remover a RPC administrativa nao reabre silenciosamente o legado.
-- O papel dedicado preexistente permanece inerte, sem memberships. Remove-lo
-- exigiria a identidade administrativa que o provisionou e nao faz parte deste
-- rollback fail-closed.

do $rollback_assertions$
declare
  v_bad_function_count integer;
begin
  if pg_catalog.to_regclass(
       'finelo_structural_internal.structural_legacy_flow_state'
     ) is null
     or not exists (
       select 1
       from finelo_structural_internal.structural_legacy_flow_state s
       where s.flow_key = 'structural_entry_reconciliation_v1'
         and not s.apply_enabled
         and not s.rollback_enabled
     )
     or pg_catalog.to_regprocedure(
       'public.reconcile_credit_card_structural_entries_atomic_v1(uuid,text,text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.rollback_credit_card_structural_entries_atomic_v1(uuid)'
     ) is null then
    raise exception 'O rollback tentou reabrir ou removeu a barreira do legado.';
  end if;

  if pg_catalog.to_regprocedure(
       'public.retire_credit_card_structural_snapshot_v1(uuid,uuid,uuid,text,integer,text,uuid)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'finelo_structural_internal.retire_credit_card_structural_snapshot_v1_impl(uuid,uuid,uuid,text,integer,text,uuid)'
     ) is not null
     or pg_catalog.to_regclass(
       'finelo_structural_internal.credit_card_entry_reconciliation_retirements'
     ) is not null
     or not exists (
       select 1
       from pg_catalog.pg_roles r
       where r.rolname = 'finelo_structural_retirement_executor'
         and not r.rolcanlogin
         and not r.rolinherit
         and not r.rolbypassrls
         and not r.rolsuper
         and not r.rolcreatedb
         and not r.rolcreaterole
         and not r.rolreplication
         and r.rolconnlimit = 0
     )
     or (
       select pg_catalog.count(*)
       from pg_catalog.pg_auth_members m
       join pg_catalog.pg_roles owner_role on owner_role.oid = m.roleid
       join pg_catalog.pg_roles member_role on member_role.oid = m.member
       where owner_role.rolname = 'finelo_structural_retirement_executor'
         and member_role.rolname = 'postgres'
         and m.admin_option
         and not m.inherit_option
         and not m.set_option
     ) <> 1
     or exists (
       select 1
       from pg_catalog.pg_auth_members m
       join pg_catalog.pg_roles owner_role on owner_role.oid = m.roleid
       join pg_catalog.pg_roles member_role on member_role.oid = m.member
       where owner_role.rolname = 'finelo_structural_retirement_executor'
         and (
           member_role.rolname <> 'postgres'
           or not m.admin_option
           or m.inherit_option
           or m.set_option
         )
     ) then
    raise exception 'O rollback deixou objetos administrativos ou membership de aposentadoria.';
  end if;

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
  )
  or exists (
    select 1
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles owner_role on owner_role.oid = m.roleid
    join pg_catalog.pg_roles member_role on member_role.oid = m.member
    where owner_role.rolname = 'finelo_structural_retirement_executor'
      and member_role.rolname <> 'postgres'
  )
  or exists (
    select 1
    from pg_temp.finelo_structural_membership_baseline b
    where not exists (
      select 1
      from pg_catalog.pg_auth_members m
      join pg_catalog.pg_roles owner_role on owner_role.oid = m.roleid
      join pg_catalog.pg_roles member_role on member_role.oid = m.member
      join pg_catalog.pg_roles grantor_role on grantor_role.oid = m.grantor
      where owner_role.rolname = b.owner_role_name
        and member_role.rolname = b.member_role_name
        and grantor_role.rolname = b.grantor_role_name
        and m.admin_option = b.admin_option
        and m.inherit_option = b.inherit_option
        and m.set_option = b.set_option
    )
  ) then
    raise exception 'O rollback nao restaurou exatamente as memberships estruturais.';
  end if;

  with expected(signature, expected_owner, expected_security_definer) as (
    values
      ('finelo_structural_internal.get_atomic_card_structural_entry_feature_state_impl()', 'postgres', false),
      ('finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(uuid,text,text,jsonb)', 'finelo_structural_entry_executor', true),
      ('finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(uuid)', 'finelo_structural_entry_executor', true),
      ('public.get_atomic_card_structural_entry_feature_state()', 'finelo_structural_entry_gateway', false),
      ('public.reconcile_credit_card_structural_entries_atomic_v1(uuid,text,text,jsonb)', 'finelo_structural_entry_gateway', false),
      ('public.rollback_credit_card_structural_entries_atomic_v1(uuid)', 'finelo_structural_entry_gateway', false)
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
    raise exception 'O rollback alterou owner, SECURITY ou search_path do legado fechado.';
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
    raise exception 'O rollback reabriu EXECUTE do legado.';
  end if;
end;
$rollback_assertions$;

commit;
