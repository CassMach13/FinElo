-- Sprint 2T: contrato reversível e estreito para reconciliar somente campos
-- derivados de quitação em faturas físicas já existentes.
--
-- Não cria, remove ou religa transações, lançamentos, pagamentos ou faturas.
-- Não altera competência, vencimento, totais da fatura ou metadados protegidos.
-- A execução permanece desligada por padrão por uma flag dedicada por usuário.

begin;

do $finelo_roles_and_preflight$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles r
    where r.rolname = 'finelo_derived_settlement_executor'
  ) then
    create role finelo_derived_settlement_executor;
  end if;

  if pg_catalog.to_regnamespace('finelo_internal') is null
     or pg_catalog.to_regprocedure(
       'finelo_internal.get_credit_card_projection_revision_for_user(uuid,uuid)'
     ) is null then
    raise exception 'O hardening privado da Sprint 2O não está disponível.';
  end if;
end;
$finelo_roles_and_preflight$;

alter role finelo_derived_settlement_executor
  nologin noinherit connection limit 0;
alter role finelo_derived_settlement_executor bypassrls;

do $finelo_role_assertions$
begin
  if exists (
    select 1
    from pg_catalog.pg_roles r
    where r.rolname = 'finelo_derived_settlement_executor'
      and (
        r.rolcanlogin or r.rolsuper or r.rolcreatedb or r.rolcreaterole
        or r.rolreplication or not r.rolbypassrls
      )
  ) then
    raise exception 'O executor dedicado Sprint 2T possui atributos incompatíveis.';
  end if;
end;
$finelo_role_assertions$;

-- PostgreSQL exige membership temporária para transferir ownership. A
-- membership é revogada e verificada antes do COMMIT.
grant finelo_statement_conservation_executor to postgres;
grant finelo_derived_settlement_executor to postgres;

grant usage on schema public to finelo_derived_settlement_executor;
grant usage on schema finelo_internal to finelo_derived_settlement_executor;

create table if not exists public.credit_card_reconciliation_snapshots (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  account_id uuid references public.contas(id) on delete cascade not null,
  card_id uuid references public.credit_cards(id) on delete cascade not null,
  operation_kind text not null
    check (operation_kind = 'derived_settlement_reconciliation'),
  shadow_checksum text not null,
  before_revision text not null,
  after_revision text,
  before_rows jsonb not null,
  after_rows jsonb not null,
  statement_count integer not null check (statement_count between 1 and 12),
  applied_at timestamptz not null default pg_catalog.now(),
  rolled_back_at timestamptz,
  rollback_revision text,
  created_at timestamptz not null default pg_catalog.now()
);

create index if not exists idx_cc_reconciliation_account_applied
  on public.credit_card_reconciliation_snapshots (account_id, applied_at desc);
create index if not exists idx_cc_reconciliation_user
  on public.credit_card_reconciliation_snapshots (user_id);
create index if not exists idx_cc_reconciliation_card
  on public.credit_card_reconciliation_snapshots (card_id);

alter table public.credit_card_reconciliation_snapshots enable row level security;

drop policy if exists "Users can view own reconciliation snapshots"
  on public.credit_card_reconciliation_snapshots;
create policy "Users can view own reconciliation snapshots"
  on public.credit_card_reconciliation_snapshots
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.credit_card_reconciliation_snapshots from public;
revoke all on table public.credit_card_reconciliation_snapshots from anon;
revoke all on table public.credit_card_reconciliation_snapshots from authenticated;
revoke all on table public.credit_card_reconciliation_snapshots from service_role;
grant select on table public.credit_card_reconciliation_snapshots to authenticated;

grant select, insert on table public.credit_card_reconciliation_snapshots
  to finelo_derived_settlement_executor;
grant update (after_revision, rolled_back_at, rollback_revision)
  on table public.credit_card_reconciliation_snapshots
  to finelo_derived_settlement_executor;
grant select on table public.contas to finelo_derived_settlement_executor;
grant select on table public.credit_cards to finelo_derived_settlement_executor;
grant update (id) on table public.credit_cards to finelo_derived_settlement_executor;
grant select on table public.credit_card_entries to finelo_derived_settlement_executor;
grant select on table public.credit_card_statements to finelo_derived_settlement_executor;
grant select on table public.credit_card_payments to finelo_derived_settlement_executor;
grant update (total_payments, open_balance, open_amount, status)
  on table public.credit_card_statements
  to finelo_derived_settlement_executor;
grant execute on function finelo_internal.get_credit_card_projection_revision_for_user(uuid, uuid)
  to finelo_derived_settlement_executor;

comment on table public.credit_card_reconciliation_snapshots is
  'Snapshot reversível da Sprint 2T. Guarda exclusivamente os quatro campos derivados de quitação alterados por fatura.';

create or replace function finelo_internal.get_atomic_card_derived_settlement_feature_state_impl()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when u.raw_app_meta_data ->> 'atomic_card_derived_settlement_reconciliation_disabled' = 'true'
      then 'disabled'
    when u.raw_app_meta_data ->> 'atomic_card_derived_settlement_reconciliation_enabled' = 'true'
      then 'enabled'
    else 'unset'
  end
  from auth.users u
  where u.id = coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

revoke all on function finelo_internal.get_atomic_card_derived_settlement_feature_state_impl()
  from public;
revoke all on function finelo_internal.get_atomic_card_derived_settlement_feature_state_impl()
  from anon;
revoke all on function finelo_internal.get_atomic_card_derived_settlement_feature_state_impl()
  from authenticated;
revoke all on function finelo_internal.get_atomic_card_derived_settlement_feature_state_impl()
  from service_role;
grant execute on function finelo_internal.get_atomic_card_derived_settlement_feature_state_impl()
  to authenticated;
grant execute on function finelo_internal.get_atomic_card_derived_settlement_feature_state_impl()
  to finelo_derived_settlement_executor;

comment on function finelo_internal.get_atomic_card_derived_settlement_feature_state_impl() is
  'Ponte privada mínima, owner postgres, usada apenas para consultar o kill switch do usuário autenticado no schema auth gerenciado.';

create or replace function public.get_atomic_card_derived_settlement_feature_state()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select finelo_internal.get_atomic_card_derived_settlement_feature_state_impl();
$$;

revoke all on function public.get_atomic_card_derived_settlement_feature_state() from public;
revoke all on function public.get_atomic_card_derived_settlement_feature_state() from anon;
revoke all on function public.get_atomic_card_derived_settlement_feature_state() from service_role;
grant execute on function public.get_atomic_card_derived_settlement_feature_state()
  to authenticated;

comment on function public.get_atomic_card_derived_settlement_feature_state() is
  'Wrapper público mínimo SECURITY INVOKER para leitura da flag Sprint 2T via supabase.rpc().';

create or replace function finelo_internal.reconcile_credit_card_derived_settlement_atomic_v1_impl(
  p_account_id uuid,
  p_expected_revision text,
  p_shadow_checksum text,
  p_statement_updates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
set statement_timeout = '30s'
as $$
declare
  v_user_id uuid := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
  v_card_id uuid;
  v_current_revision text;
  v_after_revision text;
  v_snapshot_id uuid;
  v_requested_count integer;
  v_target_count integer;
  v_updated_count integer;
  v_before_rows jsonb;
  v_after_rows jsonb;
begin
  if v_user_id is null then
    raise exception 'Autenticação obrigatória.' using errcode = '28000';
  end if;
  if coalesce(
    finelo_internal.get_atomic_card_derived_settlement_feature_state_impl(),
    'unset'
  ) <> 'enabled' then
    raise exception 'A reconciliação derivada Sprint 2T está desabilitada para esta conta.'
      using errcode = '42501';
  end if;
  if coalesce(p_expected_revision, '') !~ '^[a-f0-9]{32}$'
     or coalesce(p_shadow_checksum, '') !~ '^shadow-v1-[a-f0-9]{8}$' then
    raise exception 'Revisão ou checksum inválido.' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_statement_updates) <> 'array' then
    raise exception 'A lista de atualizações deve ser um array JSON.' using errcode = '22023';
  end if;

  v_requested_count := pg_catalog.jsonb_array_length(p_statement_updates);
  if v_requested_count < 1 or v_requested_count > 12 then
    raise exception 'Quantidade de faturas fora do limite seguro.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_statement_updates) r
    where coalesce(r->>'rowId', '') !~ '^[0-9a-fA-F-]{36}$'
       or coalesce(r->>'statementKey', '') !~ '^\d{4}-(0[1-9]|1[0-2])$'
       or coalesce(r->>'expectedTotalPaymentsCents', '') !~ '^\d+$'
       or coalesce(r->>'expectedOpenBalanceCents', '') !~ '^\d+$'
       or coalesce(r->>'expectedOpenAmountCents', '') !~ '^\d+$'
       or coalesce(r->>'desiredTotalPaymentsCents', '') !~ '^\d+$'
       or coalesce(r->>'desiredOpenBalanceCents', '') !~ '^\d+$'
       or coalesce(r->>'desiredOpenAmountCents', '') !~ '^\d+$'
       or coalesce(r->>'expectedStatus', '') not in ('open', 'closed', 'paid', 'partial', 'overdue')
       or coalesce(r->>'desiredStatus', '') not in ('open', 'paid', 'partial')
  ) then
    raise exception 'Uma atualização de fatura possui formato inválido.' using errcode = '22023';
  end if;
  if (
    select pg_catalog.count(distinct r->>'rowId')
    from pg_catalog.jsonb_array_elements(p_statement_updates) r
  ) <> v_requested_count or (
    select pg_catalog.count(distinct r->>'statementKey')
    from pg_catalog.jsonb_array_elements(p_statement_updates) r
  ) <> v_requested_count then
    raise exception 'IDs ou competências duplicados no contrato.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text, 202620)
  );

  select cc.id into v_card_id
  from public.credit_cards cc
  join public.contas c on c.id = cc.account_id
  where cc.account_id = p_account_id
    and cc.user_id = v_user_id
    and c.user_id = v_user_id
  for update of cc;

  if v_card_id is null then
    raise exception 'Conta de cartão não encontrada ou não pertence ao usuário.'
      using errcode = '42501';
  end if;

  v_current_revision :=
    finelo_internal.get_credit_card_projection_revision_for_user(
      p_account_id,
      v_user_id
    );
  if v_current_revision is distinct from p_expected_revision then
    raise exception 'A projeção mudou desde a auditoria. Refaça a auditoria antes de escrever.'
      using errcode = '40001';
  end if;

  with requested as (
    select *
    from pg_catalog.jsonb_to_recordset(p_statement_updates) as x(
      "rowId" uuid,
      "statementKey" text,
      "expectedTotalPaymentsCents" bigint,
      "expectedOpenBalanceCents" bigint,
      "expectedOpenAmountCents" bigint,
      "expectedStatus" text,
      "desiredTotalPaymentsCents" bigint,
      "desiredOpenBalanceCents" bigint,
      "desiredOpenAmountCents" bigint,
      "desiredStatus" text
    )
  )
  select pg_catalog.count(*) into v_target_count
  from requested r
  join public.credit_card_statements s
    on s.id = r."rowId"
   and s.reference_label = r."statementKey"
   and s.user_id = v_user_id
   and s.account_id = p_account_id
   and s.card_id = v_card_id
   and pg_catalog.round(s.total_payments * 100)::bigint = r."expectedTotalPaymentsCents"
   and pg_catalog.round(s.open_balance * 100)::bigint = r."expectedOpenBalanceCents"
   and pg_catalog.round(s.open_amount * 100)::bigint = r."expectedOpenAmountCents"
   and s.status = r."expectedStatus";

  if v_target_count <> v_requested_count then
    raise exception 'As faturas físicas não correspondem exatamente ao contrato auditado.'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_statement_updates) as r(
      "rowId" uuid,
      "statementKey" text,
      "expectedTotalPaymentsCents" bigint,
      "expectedOpenBalanceCents" bigint,
      "expectedOpenAmountCents" bigint,
      "expectedStatus" text,
      "desiredTotalPaymentsCents" bigint,
      "desiredOpenBalanceCents" bigint,
      "desiredOpenAmountCents" bigint,
      "desiredStatus" text
    )
    join public.credit_card_statements s on s.id = r."rowId"
    where r."desiredOpenAmountCents" <> r."desiredOpenBalanceCents"
       or r."desiredOpenBalanceCents" < 0
       or r."desiredTotalPaymentsCents" < 0
       or r."desiredOpenBalanceCents" <>
         greatest(
           pg_catalog.round(s.statement_total * 100)::bigint - r."desiredTotalPaymentsCents",
           0
         )
       or r."desiredStatus" <> case
         when r."desiredOpenBalanceCents" = 0 then 'paid'
         when r."desiredTotalPaymentsCents" > 0 then 'partial'
         else 'open'
       end
       or (
         r."expectedTotalPaymentsCents" = r."desiredTotalPaymentsCents"
         and r."expectedOpenBalanceCents" = r."desiredOpenBalanceCents"
         and r."expectedOpenAmountCents" = r."desiredOpenAmountCents"
         and r."expectedStatus" = r."desiredStatus"
       )
       or r."desiredTotalPaymentsCents" <> coalesce((
         select pg_catalog.round(pg_catalog.sum(p.amount) * 100)::bigint
         from public.credit_card_payments p
         where p.user_id = v_user_id
           and p.card_id = v_card_id
           and p.statement_id = r."rowId"
       ), 0)
  ) then
    raise exception 'Os valores desejados não conservam saldo, status e pagamentos vinculados.'
      using errcode = 'P0001';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'rowId', s.id,
        'statementKey', s.reference_label,
        'totalPaymentsCents', pg_catalog.round(s.total_payments * 100)::bigint,
        'openBalanceCents', pg_catalog.round(s.open_balance * 100)::bigint,
        'openAmountCents', pg_catalog.round(s.open_amount * 100)::bigint,
        'status', s.status
      ) order by s.id
    ),
    '[]'::jsonb
  ) into v_before_rows
  from public.credit_card_statements s
  where s.user_id = v_user_id
    and s.account_id = p_account_id
    and s.card_id = v_card_id
    and s.id in (
      select (r->>'rowId')::uuid
      from pg_catalog.jsonb_array_elements(p_statement_updates) r
    );

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'rowId', r."rowId",
        'statementKey', r."statementKey",
        'totalPaymentsCents', r."desiredTotalPaymentsCents",
        'openBalanceCents', r."desiredOpenBalanceCents",
        'openAmountCents', r."desiredOpenAmountCents",
        'status', r."desiredStatus"
      ) order by r."rowId"
    ),
    '[]'::jsonb
  ) into v_after_rows
  from pg_catalog.jsonb_to_recordset(p_statement_updates) as r(
    "rowId" uuid,
    "statementKey" text,
    "desiredTotalPaymentsCents" bigint,
    "desiredOpenBalanceCents" bigint,
    "desiredOpenAmountCents" bigint,
    "desiredStatus" text
  );

  insert into public.credit_card_reconciliation_snapshots (
    user_id,
    account_id,
    card_id,
    operation_kind,
    shadow_checksum,
    before_revision,
    before_rows,
    after_rows,
    statement_count
  ) values (
    v_user_id,
    p_account_id,
    v_card_id,
    'derived_settlement_reconciliation',
    p_shadow_checksum,
    v_current_revision,
    v_before_rows,
    v_after_rows,
    v_requested_count
  ) returning id into v_snapshot_id;

  with desired as (
    select *
    from pg_catalog.jsonb_to_recordset(p_statement_updates) as x(
      "rowId" uuid,
      "desiredTotalPaymentsCents" bigint,
      "desiredOpenBalanceCents" bigint,
      "desiredOpenAmountCents" bigint,
      "desiredStatus" text
    )
  )
  update public.credit_card_statements s
  set total_payments = desired."desiredTotalPaymentsCents"::numeric / 100,
      open_balance = desired."desiredOpenBalanceCents"::numeric / 100,
      open_amount = desired."desiredOpenAmountCents"::numeric / 100,
      status = desired."desiredStatus"
  from desired
  where s.id = desired."rowId"
    and s.user_id = v_user_id
    and s.account_id = p_account_id
    and s.card_id = v_card_id;

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> v_requested_count then
    raise exception 'A quantidade atualizada divergiu do contrato; transação cancelada.'
      using errcode = 'P0001';
  end if;

  v_after_revision :=
    finelo_internal.get_credit_card_projection_revision_for_user(
      p_account_id,
      v_user_id
    );
  if v_after_revision is null or v_after_revision = v_current_revision then
    raise exception 'A revisão posterior não confirmou a reconciliação.'
      using errcode = 'P0001';
  end if;

  update public.credit_card_reconciliation_snapshots s
  set after_revision = v_after_revision
  where s.id = v_snapshot_id
    and s.user_id = v_user_id;

  return pg_catalog.jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'before_revision', v_current_revision,
    'after_revision', v_after_revision,
    'shadow_checksum', p_shadow_checksum,
    'statements_updated', v_updated_count,
    'entry_records_changed', 0,
    'payment_records_changed', 0,
    'rolled_back', false
  );
end;
$$;

grant create on schema finelo_internal to finelo_derived_settlement_executor;
alter function finelo_internal.reconcile_credit_card_derived_settlement_atomic_v1_impl(
  uuid, text, text, jsonb
) owner to finelo_derived_settlement_executor;
revoke create on schema finelo_internal from finelo_derived_settlement_executor;
revoke all on function finelo_internal.reconcile_credit_card_derived_settlement_atomic_v1_impl(
  uuid, text, text, jsonb
) from public;
revoke all on function finelo_internal.reconcile_credit_card_derived_settlement_atomic_v1_impl(
  uuid, text, text, jsonb
) from anon;
revoke all on function finelo_internal.reconcile_credit_card_derived_settlement_atomic_v1_impl(
  uuid, text, text, jsonb
) from authenticated;
revoke all on function finelo_internal.reconcile_credit_card_derived_settlement_atomic_v1_impl(
  uuid, text, text, jsonb
) from service_role;
grant execute on function finelo_internal.reconcile_credit_card_derived_settlement_atomic_v1_impl(
  uuid, text, text, jsonb
) to authenticated;

create or replace function public.reconcile_credit_card_derived_settlement_atomic_v1(
  p_account_id uuid,
  p_expected_revision text,
  p_shadow_checksum text,
  p_statement_updates jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select finelo_internal.reconcile_credit_card_derived_settlement_atomic_v1_impl(
    p_account_id,
    p_expected_revision,
    p_shadow_checksum,
    p_statement_updates
  );
$$;

revoke all on function public.reconcile_credit_card_derived_settlement_atomic_v1(
  uuid, text, text, jsonb
) from public;
revoke all on function public.reconcile_credit_card_derived_settlement_atomic_v1(
  uuid, text, text, jsonb
) from anon;
revoke all on function public.reconcile_credit_card_derived_settlement_atomic_v1(
  uuid, text, text, jsonb
) from service_role;
grant execute on function public.reconcile_credit_card_derived_settlement_atomic_v1(
  uuid, text, text, jsonb
) to authenticated;

comment on function public.reconcile_credit_card_derived_settlement_atomic_v1(
  uuid, text, text, jsonb
) is 'Wrapper SECURITY INVOKER. A implementação privilegiada privada altera somente quatro colunas derivadas, sob lock, checksum e snapshot.';

create or replace function finelo_internal.rollback_credit_card_derived_settlement_atomic_v1_impl(
  p_snapshot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
set statement_timeout = '30s'
as $$
declare
  v_user_id uuid := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
  v_snapshot public.credit_card_reconciliation_snapshots%rowtype;
  v_current_revision text;
  v_restored_revision text;
  v_matching_count integer;
  v_updated_count integer;
begin
  if v_user_id is null then
    raise exception 'Autenticação obrigatória.' using errcode = '28000';
  end if;

  select s.* into v_snapshot
  from public.credit_card_reconciliation_snapshots s
  where s.id = p_snapshot_id
    and s.user_id = v_user_id
    and s.operation_kind = 'derived_settlement_reconciliation'
  for update;

  if v_snapshot.id is null then
    raise exception 'Snapshot de reconciliação não encontrado.' using errcode = '42501';
  end if;
  if v_snapshot.rolled_back_at is not null then
    raise exception 'Este snapshot já foi revertido.' using errcode = 'P0001';
  end if;
  if v_snapshot.after_revision is null then
    raise exception 'Snapshot sem confirmação de aplicação.' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_snapshot.account_id::text, 202620)
  );
  perform 1
  from public.credit_cards cc
  where cc.id = v_snapshot.card_id
    and cc.account_id = v_snapshot.account_id
    and cc.user_id = v_user_id
  for update;
  if not found then
    raise exception 'Cartão do snapshot não está disponível.' using errcode = '42501';
  end if;

  v_current_revision :=
    finelo_internal.get_credit_card_projection_revision_for_user(
      v_snapshot.account_id,
      v_user_id
    );
  if v_current_revision is distinct from v_snapshot.after_revision then
    raise exception 'A projeção mudou após a reconciliação. Rollback automático recusado.'
      using errcode = '40001';
  end if;

  with expected as (
    select *
    from pg_catalog.jsonb_to_recordset(v_snapshot.after_rows) as x(
      "rowId" uuid,
      "statementKey" text,
      "totalPaymentsCents" bigint,
      "openBalanceCents" bigint,
      "openAmountCents" bigint,
      "status" text
    )
  )
  select pg_catalog.count(*) into v_matching_count
  from expected e
  join public.credit_card_statements s
    on s.id = e."rowId"
   and s.reference_label = e."statementKey"
   and s.user_id = v_user_id
   and s.account_id = v_snapshot.account_id
   and s.card_id = v_snapshot.card_id
   and pg_catalog.round(s.total_payments * 100)::bigint = e."totalPaymentsCents"
   and pg_catalog.round(s.open_balance * 100)::bigint = e."openBalanceCents"
   and pg_catalog.round(s.open_amount * 100)::bigint = e."openAmountCents"
   and s.status = e."status";

  if v_matching_count <> v_snapshot.statement_count then
    raise exception 'As faturas não correspondem ao estado posterior do snapshot.'
      using errcode = '40001';
  end if;

  with previous as (
    select *
    from pg_catalog.jsonb_to_recordset(v_snapshot.before_rows) as x(
      "rowId" uuid,
      "statementKey" text,
      "totalPaymentsCents" bigint,
      "openBalanceCents" bigint,
      "openAmountCents" bigint,
      "status" text
    )
  )
  update public.credit_card_statements s
  set total_payments = previous."totalPaymentsCents"::numeric / 100,
      open_balance = previous."openBalanceCents"::numeric / 100,
      open_amount = previous."openAmountCents"::numeric / 100,
      status = previous."status"
  from previous
  where s.id = previous."rowId"
    and s.reference_label = previous."statementKey"
    and s.user_id = v_user_id
    and s.account_id = v_snapshot.account_id
    and s.card_id = v_snapshot.card_id;

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> v_snapshot.statement_count then
    raise exception 'A quantidade restaurada divergiu do snapshot; transação cancelada.'
      using errcode = 'P0001';
  end if;

  v_restored_revision :=
    finelo_internal.get_credit_card_projection_revision_for_user(
      v_snapshot.account_id,
      v_user_id
    );
  if v_restored_revision is distinct from v_snapshot.before_revision then
    raise exception 'A restauração não reproduziu a revisão original; transação cancelada.'
      using errcode = 'P0001';
  end if;

  update public.credit_card_reconciliation_snapshots s
  set rolled_back_at = pg_catalog.now(),
      rollback_revision = v_restored_revision
  where s.id = p_snapshot_id
    and s.user_id = v_user_id;

  return pg_catalog.jsonb_build_object(
    'snapshot_id', p_snapshot_id,
    'restored_revision', v_restored_revision,
    'statements_restored', v_updated_count,
    'entry_records_changed', 0,
    'payment_records_changed', 0,
    'rolled_back', true
  );
end;
$$;

grant create on schema finelo_internal to finelo_derived_settlement_executor;
alter function finelo_internal.rollback_credit_card_derived_settlement_atomic_v1_impl(uuid)
  owner to finelo_derived_settlement_executor;
revoke create on schema finelo_internal from finelo_derived_settlement_executor;
revoke all on function finelo_internal.rollback_credit_card_derived_settlement_atomic_v1_impl(uuid)
  from public;
revoke all on function finelo_internal.rollback_credit_card_derived_settlement_atomic_v1_impl(uuid)
  from anon;
revoke all on function finelo_internal.rollback_credit_card_derived_settlement_atomic_v1_impl(uuid)
  from authenticated;
revoke all on function finelo_internal.rollback_credit_card_derived_settlement_atomic_v1_impl(uuid)
  from service_role;
grant execute on function finelo_internal.rollback_credit_card_derived_settlement_atomic_v1_impl(uuid)
  to authenticated;

create or replace function public.rollback_credit_card_derived_settlement_atomic_v1(
  p_snapshot_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select finelo_internal.rollback_credit_card_derived_settlement_atomic_v1_impl(
    p_snapshot_id
  );
$$;

revoke all on function public.rollback_credit_card_derived_settlement_atomic_v1(uuid)
  from public;
revoke all on function public.rollback_credit_card_derived_settlement_atomic_v1(uuid)
  from anon;
revoke all on function public.rollback_credit_card_derived_settlement_atomic_v1(uuid)
  from service_role;
grant execute on function public.rollback_credit_card_derived_settlement_atomic_v1(uuid)
  to authenticated;

comment on function public.rollback_credit_card_derived_settlement_atomic_v1(uuid) is
  'Wrapper SECURITY INVOKER para rollback exato da Sprint 2T. Não depende da feature flag para permitir recuperação emergencial.';

revoke finelo_statement_conservation_executor from postgres;
revoke finelo_derived_settlement_executor from postgres;

do $finelo_postflight$
declare
  v_executor_oid oid :=
    'finelo_derived_settlement_executor'::pg_catalog.regrole::oid;
begin
  if exists (
    select 1
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles member_role on member_role.oid = m.member
    where m.member = v_executor_oid
       or (
         m.roleid = v_executor_oid
         and (
           member_role.rolname <> 'postgres'
           or m.inherit_option
           or m.set_option
         )
       )
  ) then
    raise exception 'O executor dedicado terminou a migration com membership efetiva.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'finelo_internal')
      and p.proname in (
        'get_atomic_card_derived_settlement_feature_state',
        'get_atomic_card_derived_settlement_feature_state_impl',
        'reconcile_credit_card_derived_settlement_atomic_v1',
        'reconcile_credit_card_derived_settlement_atomic_v1_impl',
        'rollback_credit_card_derived_settlement_atomic_v1',
        'rollback_credit_card_derived_settlement_atomic_v1_impl'
      )
      and not ('search_path=""' = any(p.proconfig))
  ) then
    raise exception 'Uma função Sprint 2T não possui search_path vazio.';
  end if;

  if pg_catalog.has_function_privilege(
       'public',
       'public.reconcile_credit_card_derived_settlement_atomic_v1(uuid,text,text,jsonb)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.reconcile_credit_card_derived_settlement_atomic_v1(uuid,text,text,jsonb)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.reconcile_credit_card_derived_settlement_atomic_v1(uuid,text,text,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'ACL pública indevida detectada no RPC de reconciliação.';
  end if;
end;
$finelo_postflight$;

commit;
