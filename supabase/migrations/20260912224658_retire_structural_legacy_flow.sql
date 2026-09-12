-- Aposenta definitivamente o fluxo estrutural legado da Sprint 2U.
--
-- Esta migration NAO reconcilia nem restaura lancamentos. Ela:
--   * fecha as RPCs antigas em todas as camadas;
--   * torna o historico de snapshots imutavel;
--   * cria uma decisao de aposentadoria separada, auditavel e idempotente;
--   * preserva integralmente before_rows, after_rows e todos os dados financeiros.
--
-- O fluxo atual de dois livros, as resolucoes/reversoes explicitas e o residual
-- canonico nao sao referenciados por esta migration.

begin;

do $retirement_preflight$
begin
  if pg_catalog.to_regnamespace('finelo_structural_internal') is null
     or pg_catalog.to_regclass(
       'finelo_structural_internal.credit_card_entry_reconciliation_snapshots'
     ) is null
     or pg_catalog.to_regprocedure(
       'finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(uuid,text,text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.reconcile_credit_card_structural_entries_atomic_v1(uuid,text,text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.rollback_credit_card_structural_entries_atomic_v1(uuid)'
     ) is null then
    raise exception
      'O contrato estrutural legado esperado nao existe neste banco. Aposentadoria cancelada.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles r
    where r.rolname = 'finelo_structural_entry_gateway'
  ) then
    raise exception
      'O gateway estrutural legado esperado nao existe. Aposentadoria cancelada.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles r
    where r.rolname = 'finelo_structural_retirement_executor'
  ) then
    create role finelo_structural_retirement_executor;
  end if;
end;
$retirement_preflight$;

alter role finelo_structural_retirement_executor
  nologin noinherit nobypassrls connection limit 0;

-- Estado global, independente de JWT. Os CHECKs tornam impossivel reabilitar
-- aplicacao ou rollback por um UPDATE acidental.
create table if not exists finelo_structural_internal.structural_legacy_flow_state (
  flow_key text primary key
    check (flow_key = 'structural_entry_reconciliation_v1'),
  apply_enabled boolean not null default false
    check (apply_enabled = false),
  rollback_enabled boolean not null default false
    check (rollback_enabled = false),
  disabled_at timestamptz not null default pg_catalog.now(),
  disabled_reason text not null
    check (pg_catalog.char_length(pg_catalog.btrim(disabled_reason)) between 20 and 1000)
);

insert into finelo_structural_internal.structural_legacy_flow_state (
  flow_key,
  apply_enabled,
  rollback_enabled,
  disabled_reason
) values (
  'structural_entry_reconciliation_v1',
  false,
  false,
  'Fluxo estrutural legado aposentado em favor da reconciliacao explicita de dois livros.'
)
on conflict (flow_key) do update
set apply_enabled = false,
    rollback_enabled = false,
    disabled_at = pg_catalog.now(),
    disabled_reason = excluded.disabled_reason;

alter table finelo_structural_internal.structural_legacy_flow_state
  enable row level security;
alter table finelo_structural_internal.structural_legacy_flow_state
  force row level security;
revoke all on table finelo_structural_internal.structural_legacy_flow_state
  from public, anon, authenticated, service_role,
    finelo_structural_entry_gateway, finelo_structural_retirement_executor;

-- A aposentadoria e uma linha nova. O snapshot original nunca e atualizado.
create table if not exists finelo_structural_internal.credit_card_entry_reconciliation_retirements (
  snapshot_id uuid primary key
    references finelo_structural_internal.credit_card_entry_reconciliation_snapshots(id)
      on delete restrict,
  user_id uuid not null,
  account_id uuid not null,
  card_id uuid not null,
  decision text not null default 'retired_without_rollback'
    check (decision = 'retired_without_rollback'),
  reason text not null
    check (pg_catalog.char_length(pg_catalog.btrim(reason)) between 20 and 1000),
  idempotency_key uuid not null unique,
  snapshot_before_revision text not null,
  snapshot_after_revision text not null,
  snapshot_entry_count integer not null check (snapshot_entry_count > 0),
  retired_at timestamptz not null default pg_catalog.now(),
  retired_by_role text not null,
  retired_by_subject text not null
);

comment on table finelo_structural_internal.credit_card_entry_reconciliation_retirements is
  'Decisao imutavel de aposentar um snapshot estrutural sem apply nem rollback; o snapshot original permanece intacto.';
comment on column finelo_structural_internal.credit_card_entry_reconciliation_retirements.idempotency_key is
  'Identidade da intencao administrativa. Repeticoes nao criam uma segunda decisao.';

alter table finelo_structural_internal.credit_card_entry_reconciliation_retirements
  enable row level security;
alter table finelo_structural_internal.credit_card_entry_reconciliation_retirements
  force row level security;

revoke all on table finelo_structural_internal.credit_card_entry_reconciliation_retirements
  from public, anon, authenticated, service_role,
    finelo_structural_entry_gateway, finelo_structural_retirement_executor;

grant usage on schema finelo_structural_internal
  to finelo_structural_retirement_executor;
grant select on table
  finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  to finelo_structural_retirement_executor;
grant select, insert on table
  finelo_structural_internal.credit_card_entry_reconciliation_retirements
  to finelo_structural_retirement_executor;

drop policy if exists "Retirement executor reads structural snapshots"
  on finelo_structural_internal.credit_card_entry_reconciliation_snapshots;
create policy "Retirement executor reads structural snapshots"
  on finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  for select
  to finelo_structural_retirement_executor
  using (true);

drop policy if exists "Retirement executor reads retirement decisions"
  on finelo_structural_internal.credit_card_entry_reconciliation_retirements;
create policy "Retirement executor reads retirement decisions"
  on finelo_structural_internal.credit_card_entry_reconciliation_retirements
  for select
  to finelo_structural_retirement_executor
  using (true);

drop policy if exists "Retirement executor records retirement decisions"
  on finelo_structural_internal.credit_card_entry_reconciliation_retirements;
create policy "Retirement executor records retirement decisions"
  on finelo_structural_internal.credit_card_entry_reconciliation_retirements
  for insert
  to finelo_structural_retirement_executor
  with check (true);

-- Impede que duas aplicacoes historicas nao revertidas coexistam para o mesmo
-- cartao. Um snapshot aposentado continua nao revertido e, portanto, tambem
-- impede para sempre a abertura de um novo snapshot legado no cartao.
create unique index if not exists ux_structural_snapshot_single_unrolled_per_card
  on finelo_structural_internal.credit_card_entry_reconciliation_snapshots (
    user_id,
    account_id,
    card_id
  )
  where rolled_back_at is null;

-- Defesa de ultima linha: mesmo uma concessao futura indevida nao consegue
-- inserir, atualizar ou apagar snapshots do fluxo aposentado.
create or replace function finelo_structural_internal.reject_legacy_snapshot_mutation_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $reject_snapshot_mutation$
begin
  raise exception
    'O historico estrutural legado e imutavel: apply e rollback foram aposentados.'
    using errcode = '0A000';
end;
$reject_snapshot_mutation$;

revoke all on function
  finelo_structural_internal.reject_legacy_snapshot_mutation_v1()
  from public, anon, authenticated, service_role,
    finelo_structural_entry_gateway, finelo_structural_retirement_executor;

drop trigger if exists trg_reject_legacy_snapshot_mutation
  on finelo_structural_internal.credit_card_entry_reconciliation_snapshots;
create trigger trg_reject_legacy_snapshot_mutation
before insert or update or delete
on finelo_structural_internal.credit_card_entry_reconciliation_snapshots
for each row
execute function finelo_structural_internal.reject_legacy_snapshot_mutation_v1();

create or replace function finelo_structural_internal.reject_retirement_mutation_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $reject_retirement_mutation$
begin
  raise exception
    'A decisao de aposentadoria e imutavel.'
    using errcode = '0A000';
end;
$reject_retirement_mutation$;

revoke all on function
  finelo_structural_internal.reject_retirement_mutation_v1()
  from public, anon, authenticated, service_role,
    finelo_structural_entry_gateway, finelo_structural_retirement_executor;

drop trigger if exists trg_reject_retirement_update_delete
  on finelo_structural_internal.credit_card_entry_reconciliation_retirements;
create trigger trg_reject_retirement_update_delete
before update or delete
on finelo_structural_internal.credit_card_entry_reconciliation_retirements
for each row
execute function finelo_structural_internal.reject_retirement_mutation_v1();

-- O executor e privado, SECURITY DEFINER, NOBYPASSRLS e dono apenas desta
-- funcao/tabela. O JWT e consultado no servidor; nenhum app_metadata de feature
-- flag participa da autorizacao.
create or replace function finelo_structural_internal.retire_credit_card_structural_snapshot_v1_impl(
  p_snapshot_id uuid,
  p_account_id uuid,
  p_card_id uuid,
  p_expected_after_revision text,
  p_expected_entry_count integer,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
set statement_timeout = '20s'
as $retire$
declare
  v_claims jsonb;
  v_request_role text;
  v_request_subject text;
  v_reason text := pg_catalog.btrim(p_reason);
  v_existing finelo_structural_internal.credit_card_entry_reconciliation_retirements%rowtype;
  v_snapshot finelo_structural_internal.credit_card_entry_reconciliation_snapshots%rowtype;
  v_active_count integer;
begin
  begin
    v_claims := coalesce(
      nullif(pg_catalog.current_setting('request.jwt.claims', true), ''),
      '{}'
    )::jsonb;
  exception when others then
    raise exception 'Credencial administrativa invalida.' using errcode = '28000';
  end;

  v_request_role := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    v_claims ->> 'role'
  );
  if v_request_role is distinct from 'service_role' then
    raise exception
      'Somente o executor administrativo do servidor pode aposentar snapshots.'
      using errcode = '42501';
  end if;

  v_request_subject := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    nullif(v_claims ->> 'sub', ''),
    'service_role'
  );

  if p_snapshot_id is null
     or p_account_id is null
     or p_card_id is null
     or p_idempotency_key is null
     or p_reason is null
     or coalesce(p_expected_after_revision, '') = ''
     or p_expected_entry_count is null
     or p_expected_entry_count < 1
     or pg_catalog.char_length(v_reason) not between 20 and 1000 then
    raise exception
      'Snapshot, conta, cartao, revisao, quantidade, motivo e idempotencia validos sao obrigatorios.'
      using errcode = '22023';
  end if;

  -- A ordem de locks e fixa para evitar corrida entre mesma intencao e mesmo
  -- cartao. Ambos sao transaction-scoped e liberados automaticamente.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_idempotency_key::text, 20262912)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_card_id::text, 20262913)
  );

  select r.*
  into v_existing
  from finelo_structural_internal.credit_card_entry_reconciliation_retirements r
  where r.idempotency_key = p_idempotency_key;

  if v_existing.snapshot_id is not null then
    if v_existing.snapshot_id <> p_snapshot_id
       or v_existing.account_id <> p_account_id
       or v_existing.card_id <> p_card_id
       or v_existing.snapshot_after_revision <> p_expected_after_revision
       or v_existing.snapshot_entry_count <> p_expected_entry_count
       or v_existing.reason <> v_reason then
      raise exception
        'A chave de idempotencia ja pertence a outra decisao.'
        using errcode = '23505';
    end if;

    return pg_catalog.jsonb_build_object(
      'snapshot_id', v_existing.snapshot_id,
      'decision', v_existing.decision,
      'retired_at', v_existing.retired_at,
      'idempotent_replay', true,
      'financial_records_changed', 0,
      'structural_rows_changed', 0
    );
  end if;

  select r.*
  into v_existing
  from finelo_structural_internal.credit_card_entry_reconciliation_retirements r
  where r.snapshot_id = p_snapshot_id;

  if v_existing.snapshot_id is not null then
    if v_existing.account_id <> p_account_id
       or v_existing.card_id <> p_card_id
       or v_existing.snapshot_after_revision <> p_expected_after_revision
       or v_existing.snapshot_entry_count <> p_expected_entry_count
       or v_existing.reason <> v_reason then
      raise exception
        'O snapshot ja foi aposentado por uma decisao diferente.'
        using errcode = '55000';
    end if;

    return pg_catalog.jsonb_build_object(
      'snapshot_id', v_existing.snapshot_id,
      'decision', v_existing.decision,
      'retired_at', v_existing.retired_at,
      'idempotent_replay', true,
      'financial_records_changed', 0,
      'structural_rows_changed', 0
    );
  end if;

  select s.*
  into v_snapshot
  from finelo_structural_internal.credit_card_entry_reconciliation_snapshots s
  where s.id = p_snapshot_id
    and s.account_id = p_account_id
    and s.card_id = p_card_id
    and s.operation_kind = 'structural_entry_reconciliation'
    and s.rolled_back_at is null
    and s.after_revision = p_expected_after_revision
    and s.entry_count = p_expected_entry_count;

  if v_snapshot.id is null then
    raise exception
      'Snapshot ativo nao encontrado ou suas pre-condicoes mudaram.'
      using errcode = '40001';
  end if;

  if pg_catalog.jsonb_typeof(v_snapshot.before_rows) <> 'array'
     or pg_catalog.jsonb_typeof(v_snapshot.after_rows) <> 'array'
     or pg_catalog.jsonb_array_length(v_snapshot.before_rows) <> v_snapshot.entry_count
     or pg_catalog.jsonb_array_length(v_snapshot.after_rows) <> v_snapshot.entry_count
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_snapshot.before_rows) b(item)
       where coalesce(b.item ->> 'rowId', '') = ''
          or coalesce(b.item ->> 'transactionId', '') = ''
          or coalesce(b.item ->> 'statementRowId', '') = ''
          or coalesce(b.item ->> 'entryType', '') = ''
     )
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_snapshot.after_rows) a(item)
       where coalesce(a.item ->> 'rowId', '') = ''
          or coalesce(a.item ->> 'transactionId', '') = ''
          or coalesce(a.item ->> 'statementRowId', '') = ''
          or coalesce(a.item ->> 'entryType', '') = ''
     ) then
    raise exception
      'O snapshot nao contem as linhas historicas exatas exigidas para auditoria.'
      using errcode = '22023';
  end if;

  select pg_catalog.count(*)
  into v_active_count
  from finelo_structural_internal.credit_card_entry_reconciliation_snapshots s
  left join finelo_structural_internal.credit_card_entry_reconciliation_retirements r
    on r.snapshot_id = s.id
  where s.user_id = v_snapshot.user_id
    and s.account_id = v_snapshot.account_id
    and s.card_id = v_snapshot.card_id
    and s.rolled_back_at is null
    and r.snapshot_id is null;

  if v_active_count <> 1 then
    raise exception
      'Esperado exatamente um snapshot estrutural ativo para o cartao; encontrados %.',
      v_active_count
      using errcode = '55000';
  end if;

  insert into finelo_structural_internal.credit_card_entry_reconciliation_retirements (
    snapshot_id,
    user_id,
    account_id,
    card_id,
    reason,
    idempotency_key,
    snapshot_before_revision,
    snapshot_after_revision,
    snapshot_entry_count,
    retired_by_role,
    retired_by_subject
  ) values (
    v_snapshot.id,
    v_snapshot.user_id,
    v_snapshot.account_id,
    v_snapshot.card_id,
    v_reason,
    p_idempotency_key,
    v_snapshot.before_revision,
    v_snapshot.after_revision,
    v_snapshot.entry_count,
    v_request_role,
    v_request_subject
  )
  returning * into v_existing;

  return pg_catalog.jsonb_build_object(
    'snapshot_id', v_existing.snapshot_id,
    'decision', v_existing.decision,
    'retired_at', v_existing.retired_at,
    'idempotent_replay', false,
    'financial_records_changed', 0,
    'structural_rows_changed', 0
  );
end;
$retire$;

revoke all on function
  finelo_structural_internal.retire_credit_card_structural_snapshot_v1_impl(
    uuid, uuid, uuid, text, integer, text, uuid
  )
  from public, anon, authenticated, service_role,
    finelo_structural_entry_gateway, finelo_structural_retirement_executor;

grant usage on schema finelo_structural_internal to service_role;
grant execute on function
  finelo_structural_internal.retire_credit_card_structural_snapshot_v1_impl(
    uuid, uuid, uuid, text, integer, text, uuid
  )
  to service_role;

grant finelo_structural_retirement_executor to postgres
  with set true, inherit false;
grant create on schema finelo_structural_internal
  to finelo_structural_retirement_executor;
alter table finelo_structural_internal.credit_card_entry_reconciliation_retirements
  owner to finelo_structural_retirement_executor;
alter function
  finelo_structural_internal.retire_credit_card_structural_snapshot_v1_impl(
    uuid, uuid, uuid, text, integer, text, uuid
  ) owner to finelo_structural_retirement_executor;
revoke create on schema finelo_structural_internal
  from finelo_structural_retirement_executor;
revoke finelo_structural_retirement_executor from postgres;

-- Porta publica minima para supabase.rpc(). SECURITY INVOKER significa que o
-- wrapper nao eleva privilegio: somente service_role tem EXECUTE e acesso ao
-- executor privado.
grant finelo_structural_entry_gateway to postgres
  with set true, inherit false;
grant create on schema public to finelo_structural_entry_gateway;
create or replace function public.retire_credit_card_structural_snapshot_v1(
  p_snapshot_id uuid,
  p_account_id uuid,
  p_card_id uuid,
  p_expected_after_revision text,
  p_expected_entry_count integer,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $wrapper$
  select finelo_structural_internal.retire_credit_card_structural_snapshot_v1_impl(
    p_snapshot_id,
    p_account_id,
    p_card_id,
    p_expected_after_revision,
    p_expected_entry_count,
    p_reason,
    p_idempotency_key
  );
$wrapper$;

revoke all on function public.retire_credit_card_structural_snapshot_v1(
  uuid, uuid, uuid, text, integer, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.retire_credit_card_structural_snapshot_v1(
  uuid, uuid, uuid, text, integer, text, uuid
) to service_role;
alter function public.retire_credit_card_structural_snapshot_v1(
  uuid, uuid, uuid, text, integer, text, uuid
) owner to finelo_structural_entry_gateway;
revoke create on schema public from finelo_structural_entry_gateway;
revoke finelo_structural_entry_gateway from postgres;

-- Mata o recurso no banco, mesmo para clientes antigos, JWTs antigos e
-- chamadas diretas que ainda conhecam os nomes das RPCs.
create or replace function finelo_structural_internal.get_atomic_card_structural_entry_feature_state_impl()
returns text
language sql
stable
security invoker
set search_path = ''
as $feature$
  select 'retired'::text;
$feature$;

create or replace function public.get_atomic_card_structural_entry_feature_state()
returns text
language sql
stable
security invoker
set search_path = ''
as $feature$
  select 'retired'::text;
$feature$;

revoke all on function public.get_atomic_card_structural_entry_feature_state()
  from public, anon, authenticated, service_role;
grant execute on function public.get_atomic_card_structural_entry_feature_state()
  to authenticated;

create or replace function finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(
  p_account_id uuid,
  p_expected_revision text,
  p_shadow_checksum text,
  p_entry_updates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $retired_apply$
begin
  raise exception
    'O fluxo estrutural legado foi aposentado; use a reconciliacao explicita de dois livros.'
    using errcode = '0A000';
end;
$retired_apply$;

create or replace function finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(
  p_snapshot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $retired_rollback$
begin
  raise exception
    'O rollback estrutural legado foi aposentado; o snapshot permanece preservado para auditoria.'
    using errcode = '0A000';
end;
$retired_rollback$;

create or replace function public.reconcile_credit_card_structural_entries_atomic_v1(
  p_account_id uuid,
  p_expected_revision text,
  p_shadow_checksum text,
  p_entry_updates jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $retired_apply$
begin
  raise exception
    'O fluxo estrutural legado foi aposentado; use a reconciliacao explicita de dois livros.'
    using errcode = '0A000';
end;
$retired_apply$;

create or replace function public.rollback_credit_card_structural_entries_atomic_v1(
  p_snapshot_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $retired_rollback$
begin
  raise exception
    'O rollback estrutural legado foi aposentado; o snapshot permanece preservado para auditoria.'
    using errcode = '0A000';
end;
$retired_rollback$;

revoke all on function
  finelo_structural_internal.get_atomic_card_structural_entry_feature_state_impl()
  from public, anon, authenticated, service_role,
    finelo_structural_entry_gateway, finelo_structural_retirement_executor;
revoke all on function
  finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(
    uuid, text, text, jsonb
  )
  from public, anon, authenticated, service_role,
    finelo_structural_entry_gateway, finelo_structural_retirement_executor;
revoke all on function
  finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(uuid)
  from public, anon, authenticated, service_role,
    finelo_structural_entry_gateway, finelo_structural_retirement_executor;
revoke all on function public.reconcile_credit_card_structural_entries_atomic_v1(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.rollback_credit_card_structural_entries_atomic_v1(uuid)
  from public, anon, authenticated, service_role;

revoke insert, update, delete on table
  finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  from finelo_structural_entry_executor;
revoke update (transaction_id, statement_id, entry_type)
  on table public.credit_card_entries
  from finelo_structural_entry_executor;
revoke usage on schema finelo_structural_internal
  from anon, authenticated, finelo_structural_entry_gateway,
    finelo_structural_entry_executor;

do $retirement_assertions$
declare
  v_retirement_owner text;
begin
  if not exists (
    select 1
    from finelo_structural_internal.structural_legacy_flow_state s
    where s.flow_key = 'structural_entry_reconciliation_v1'
      and not s.apply_enabled
      and not s.rollback_enabled
  ) then
    raise exception 'O estado global do legado nao ficou fail-closed.';
  end if;

  if pg_catalog.has_function_privilege(
       'authenticated',
       'public.reconcile_credit_card_structural_entries_atomic_v1(uuid,text,text,jsonb)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.rollback_credit_card_structural_entries_atomic_v1(uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.reconcile_credit_card_structural_entries_atomic_v1(uuid,text,text,jsonb)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.rollback_credit_card_structural_entries_atomic_v1(uuid)',
       'EXECUTE'
     ) then
    raise exception 'Uma RPC de apply/rollback legado ainda possui executor externo.';
  end if;

  if pg_catalog.has_table_privilege(
       'finelo_structural_entry_executor',
       'finelo_structural_internal.credit_card_entry_reconciliation_snapshots',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'finelo_structural_entry_executor',
       'finelo_structural_internal.credit_card_entry_reconciliation_snapshots',
       'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'finelo_structural_entry_executor',
       'public.credit_card_entries',
       'transaction_id',
       'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'finelo_structural_entry_executor',
       'public.credit_card_entries',
       'statement_id',
       'UPDATE'
     ) then
    raise exception 'O executor legado ainda possui escrita estrutural.';
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
    raise exception 'A ACL da aposentadoria administrativa e invalida.';
  end if;

  select pg_catalog.pg_get_userbyid(p.proowner)
  into v_retirement_owner
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'finelo_structural_internal'
    and p.proname = 'retire_credit_card_structural_snapshot_v1_impl';

  if v_retirement_owner <> 'finelo_structural_retirement_executor'
     or exists (
       select 1
       from pg_catalog.pg_roles r
       where r.rolname = 'finelo_structural_retirement_executor'
         and (r.rolcanlogin or r.rolinherit or r.rolbypassrls)
     )
     or exists (
       select 1
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'finelo_structural_internal'
         and p.proname = 'retire_credit_card_structural_snapshot_v1_impl'
         and (
           not p.prosecdef
           or not exists (
             select 1
             from pg_catalog.unnest(coalesce(p.proconfig, '{}'::text[])) cfg(setting)
             where cfg.setting in ('search_path=', 'search_path=""')
           )
         )
     )
     or exists (
       select 1
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = 'retire_credit_card_structural_snapshot_v1'
         and p.prosecdef
     ) then
    raise exception 'Owner, BYPASSRLS ou search_path da aposentadoria e inseguro.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles role on role.oid = m.roleid
    where role.rolname = 'finelo_structural_retirement_executor'
  ) then
    raise exception 'O papel de aposentadoria permaneceu concedido a outro papel.';
  end if;
end;
$retirement_assertions$;

commit;
