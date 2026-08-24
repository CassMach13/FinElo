-- Sprint 2O: conservação atômica e reversível de uma competência com faturas
-- físicas duplicadas.
--
-- O RPC não elege uma linha vencedora. Ele cria uma fatura composta nova,
-- fotografa integralmente as linhas originais e todos os vínculos, religa-os e
-- remove as duplicadas na mesma transação. A função permanece desligada por
-- padrão por uma flag dedicada em auth.raw_app_meta_data.

begin;

-- Compatibilidade com a primeira revisão aplicada somente em staging. O papel
-- intermediário nunca existiu em produção; se estiver presente, a função da
-- flag volta para postgres e o papel é removido na mesma transação.
do $finelo_remove_intermediate_flag_reader$
begin
  if exists (
    select 1
    from pg_catalog.pg_roles r
    where r.rolname = 'finelo_statement_conservation_flag_reader'
  ) then
    execute 'grant finelo_statement_conservation_flag_reader to postgres';
    if pg_catalog.to_regprocedure(
      'finelo_internal.get_atomic_card_statement_conservation_feature_state_impl()'
    ) is not null then
      execute 'alter function finelo_internal.get_atomic_card_statement_conservation_feature_state_impl() owner to postgres';
    end if;
    execute 'drop owned by finelo_statement_conservation_flag_reader';
    execute 'revoke finelo_statement_conservation_flag_reader from postgres';
    execute 'drop role finelo_statement_conservation_flag_reader';
  end if;
end;
$finelo_remove_intermediate_flag_reader$;

-- O executor é dedicado, sem login, sem memberships efetivos e com grants
-- limitados às tabelas desta operação. BYPASSRLS é necessário porque os
-- papéis gerenciados pelo Supabase não podem conceder USAGE no schema auth ao
-- novo owner; todas as consultas mantêm filtros explícitos pelo JWT original.
do $finelo_roles$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles r
    where r.rolname = 'finelo_statement_conservation_executor'
  ) then
    create role finelo_statement_conservation_executor;
  end if;
end;
$finelo_roles$;

alter role finelo_statement_conservation_executor
  nologin noinherit connection limit 0;
alter role finelo_statement_conservation_executor bypassrls;

-- CREATE ROLE nasce sem SUPERUSER/CREATEDB/CREATEROLE/REPLICATION. Nesta
-- operação o executor precisa atravessar as policies existentes sem receber
-- acesso ao schema gerenciado auth. A superfície fica limitada pelos grants
-- explícitos abaixo e pelos filtros de user_id/account_id dentro das funções.
do $finelo_role_assertions$
begin
  if exists (
    select 1
    from pg_catalog.pg_roles r
    where r.rolname = 'finelo_statement_conservation_executor'
      and (
        r.rolcanlogin or r.rolsuper or r.rolcreatedb or r.rolcreaterole
        or r.rolreplication or not r.rolbypassrls
      )
  ) then
    raise exception 'O papel executor possui atributos incompatíveis.';
  end if;
end;
$finelo_role_assertions$;

-- PostgreSQL exige que quem transfere ownership possa SET ROLE para o novo
-- owner. A membership existe somente dentro desta transação e é revogada antes
-- do COMMIT; se qualquer etapa falhar, todo o bloco é revertido.
grant finelo_statement_conservation_executor to postgres;

create schema if not exists finelo_internal authorization postgres;
alter schema finelo_internal owner to postgres;
revoke all on schema finelo_internal from public;
revoke all on schema finelo_internal from anon;
revoke all on schema finelo_internal from authenticated;
revoke all on schema finelo_internal from service_role;
revoke all on schema finelo_internal from finelo_statement_conservation_executor;
grant usage on schema finelo_internal to authenticated;
grant usage on schema finelo_internal to finelo_statement_conservation_executor;
grant usage on schema public to finelo_statement_conservation_executor;

create table if not exists public.credit_card_statement_conservation_snapshots (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  account_id uuid references public.contas(id) on delete cascade not null,
  card_id uuid references public.credit_cards(id) on delete cascade not null,
  operation_kind text not null
    check (operation_kind = 'duplicate_statement_conservation'),
  statement_key text not null,
  shadow_checksum text not null,
  before_revision text not null,
  after_revision text,
  composite_statement_id uuid not null,
  source_statement_rows jsonb not null,
  entry_links jsonb not null,
  legacy_item_links jsonb not null,
  payment_links jsonb not null,
  source_statement_count integer not null check (source_statement_count between 2 and 10),
  entry_link_count integer not null check (entry_link_count between 0 and 50000),
  legacy_item_link_count integer not null check (legacy_item_link_count between 0 and 50000),
  payment_link_count integer not null check (payment_link_count between 0 and 50000),
  applied_at timestamptz not null default pg_catalog.now(),
  rolled_back_at timestamptz,
  rollback_revision text,
  created_at timestamptz not null default pg_catalog.now()
);

create index if not exists idx_cc_statement_conservation_account_applied
  on public.credit_card_statement_conservation_snapshots (account_id, applied_at desc);
create index if not exists idx_cc_statement_conservation_user
  on public.credit_card_statement_conservation_snapshots (user_id);
create index if not exists idx_cc_statement_conservation_card
  on public.credit_card_statement_conservation_snapshots (card_id);

alter table public.credit_card_statement_conservation_snapshots enable row level security;

drop policy if exists "Users can view own statement conservation snapshots"
  on public.credit_card_statement_conservation_snapshots;
create policy "Users can view own statement conservation snapshots"
  on public.credit_card_statement_conservation_snapshots
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Conservation executor can manage own snapshots"
  on public.credit_card_statement_conservation_snapshots;
-- Não há policy para o executor: o papel é BYPASSRLS por desenho e só é
-- alcançável pelas funções privadas. Manter uma policy inoperante criaria uma
-- falsa sensação de proteção e um alerta de performance no advisor.

revoke all on table public.credit_card_statement_conservation_snapshots from public;
revoke all on table public.credit_card_statement_conservation_snapshots from anon;
revoke all on table public.credit_card_statement_conservation_snapshots from authenticated;
grant select on table public.credit_card_statement_conservation_snapshots to authenticated;

-- BYPASSRLS não ignora ACL: os grants abaixo continuam definindo o teto de
-- acesso do executor. Toda consulta privilegiada repete filtros explícitos do
-- usuário extraído do JWT. UPDATE de id existe apenas para row locks FOR
-- UPDATE; o código não altera identidades.
grant select on table public.contas to finelo_statement_conservation_executor;
grant select on table public.credit_cards to finelo_statement_conservation_executor;
grant update (id) on table public.credit_cards
  to finelo_statement_conservation_executor;
grant select, insert, delete on table public.credit_card_statements
  to finelo_statement_conservation_executor;
grant update (id) on table public.credit_card_statements
  to finelo_statement_conservation_executor;
grant select on table public.credit_card_entries
  to finelo_statement_conservation_executor;
grant update (statement_id) on table public.credit_card_entries
  to finelo_statement_conservation_executor;
grant select on table public.credit_card_statement_items
  to finelo_statement_conservation_executor;
grant update (statement_id) on table public.credit_card_statement_items
  to finelo_statement_conservation_executor;
grant select on table public.credit_card_payments
  to finelo_statement_conservation_executor;
grant update (statement_id) on table public.credit_card_payments
  to finelo_statement_conservation_executor;
grant select, insert on table public.credit_card_statement_conservation_snapshots
  to finelo_statement_conservation_executor;
grant update (after_revision, rolled_back_at, rollback_revision)
  on table public.credit_card_statement_conservation_snapshots
  to finelo_statement_conservation_executor;

comment on table public.credit_card_statement_conservation_snapshots is
  'Snapshot reversível das faturas físicas e vínculos substituídos por uma fatura composta na Sprint 2O.';

create or replace function finelo_internal.get_atomic_card_statement_conservation_feature_state_impl()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when u.raw_app_meta_data ->> 'atomic_card_statement_conservation_disabled' = 'true'
      then 'disabled'
    when u.raw_app_meta_data ->> 'atomic_card_statement_conservation_enabled' = 'true'
      then 'enabled'
    else 'unset'
  end
  from auth.users u
  where u.id = coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    nullif(
      pg_catalog.current_setting('request.jwt.claims', true), ''
    )::jsonb ->> 'sub'
  )::uuid;
$$;

revoke all on function finelo_internal.get_atomic_card_statement_conservation_feature_state_impl()
  from public;
revoke all on function finelo_internal.get_atomic_card_statement_conservation_feature_state_impl()
  from anon;
revoke all on function finelo_internal.get_atomic_card_statement_conservation_feature_state_impl()
  from authenticated;
revoke all on function finelo_internal.get_atomic_card_statement_conservation_feature_state_impl()
  from service_role;
grant execute on function finelo_internal.get_atomic_card_statement_conservation_feature_state_impl()
  to authenticated;
grant execute on function finelo_internal.get_atomic_card_statement_conservation_feature_state_impl()
  to finelo_statement_conservation_executor;

comment on function finelo_internal.get_atomic_card_statement_conservation_feature_state_impl() is
  'Ponte privada mínima para o kill switch Sprint 2O. Owner postgres é necessário apenas para ler a flag do usuário autenticado no schema auth gerenciado.';

-- Variante privada do checksum da projeção. Ela recebe a identidade já
-- autenticada pelo RPC pai e não depende de auth.uid(), evitando conceder ao
-- executor qualquer acesso ao schema auth. SECURITY INVOKER preserva o mesmo
-- executor e o mesmo teto de ACL do chamador privilegiado.
create or replace function finelo_internal.get_credit_card_projection_revision_for_user(
  p_account_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_revision text;
begin
  if p_user_id is null then
    raise exception 'Autenticação obrigatória.' using errcode = '28000';
  end if;
  if not exists (
    select 1
    from public.contas c
    where c.id = p_account_id
      and c.user_id = p_user_id
  ) then
    raise exception 'Conta de cartão não encontrada.' using errcode = '42501';
  end if;

  select pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'statements', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_array(
            s.id, s.card_id, s.reference_label, s.purchase_reference_label,
            s.due_year, s.due_month, s.due_date, s.closing_date,
            s.source_import_lot_ids, s.total_purchases, s.total_fees,
            s.total_interest, s.total_refunds, s.statement_total,
            s.total_payments, s.open_balance, s.total_charges,
            s.total_credits, s.open_amount, s.status,
            s.manual_totals_json, s.statement_total_from_file,
            s.total_payments_from_file, s.lines_computed_total,
            s.atomic_projection_version, s.atomic_projection_checksum,
            s.atomic_projection_snapshot_id
          ) order by s.id
        )
        from public.credit_card_statements s
        where s.user_id = p_user_id
          and s.account_id = p_account_id
      ), '[]'::jsonb),
      'entries', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_array(
            e.id, e.card_id, e.import_lot_id, e.source_file_name,
            e.source_row_index, e.source_row_hash, e.transaction_id,
            e.statement_id, e.posted_date, e.amount, e.abs_amount,
            e.direction, e.entry_type, e.description_raw,
            e.description_normalized, e.merchant_name, e.holder_name,
            e.installment_current, e.installment_total, e.category_id,
            e.classification_source, e.classification_confidence
          ) order by e.id
        )
        from public.credit_card_entries e
        where e.user_id = p_user_id
          and e.account_id = p_account_id
      ), '[]'::jsonb),
      'payments', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_array(
            p.id, p.card_id, p.statement_id, p.payment_account_id,
            p.payment_transaction_id, p.payment_date, p.amount,
            p.source, p.notes
          ) order by p.id
        )
        from public.credit_card_payments p
        join public.credit_card_statements s on s.id = p.statement_id
        where p.user_id = p_user_id
          and s.account_id = p_account_id
      ), '[]'::jsonb)
    )::text
  ) into v_revision;

  return v_revision;
end;
$$;

grant create on schema finelo_internal
  to finelo_statement_conservation_executor;
alter function finelo_internal.get_credit_card_projection_revision_for_user(uuid, uuid)
  owner to finelo_statement_conservation_executor;
revoke create on schema finelo_internal
  from finelo_statement_conservation_executor;
revoke all on function finelo_internal.get_credit_card_projection_revision_for_user(uuid, uuid)
  from public;
revoke all on function finelo_internal.get_credit_card_projection_revision_for_user(uuid, uuid)
  from anon;
revoke all on function finelo_internal.get_credit_card_projection_revision_for_user(uuid, uuid)
  from authenticated;
revoke all on function finelo_internal.get_credit_card_projection_revision_for_user(uuid, uuid)
  from service_role;
grant execute on function finelo_internal.get_credit_card_projection_revision_for_user(uuid, uuid)
  to finelo_statement_conservation_executor;

comment on function finelo_internal.get_credit_card_projection_revision_for_user(uuid, uuid) is
  'Checksum privado SECURITY INVOKER; recebe user_id já validado pelo RPC pai e não acessa auth.';

create or replace function finelo_internal.conserve_credit_card_statement_duplicates_atomic_v1_impl(
  p_account_id uuid,
  p_expected_revision text,
  p_shadow_checksum text,
  p_statement_key text,
  p_source_statement_ids uuid[],
  p_expected_entry_link_count integer,
  p_expected_payment_link_count integer,
  p_composite jsonb
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
    nullif(
      pg_catalog.current_setting('request.jwt.claims', true), ''
    )::jsonb ->> 'sub'
  )::uuid;
  v_feature_state text;
  v_card_id uuid;
  v_before_revision text;
  v_after_revision text;
  v_snapshot_id uuid := pg_catalog.gen_random_uuid();
  v_composite_id uuid := pg_catalog.gen_random_uuid();
  v_requested_count integer;
  v_group_count integer;
  v_entry_count integer;
  v_legacy_item_count integer;
  v_payment_count integer;
  v_updated_entries integer;
  v_updated_legacy_items integer;
  v_updated_payments integer;
  v_deleted_statements integer;
  v_source_rows jsonb;
  v_entry_links jsonb;
  v_legacy_item_links jsonb;
  v_payment_links jsonb;
  v_source_import_lot_ids jsonb;
  v_reference_label text;
  v_purchase_reference text;
  v_due_date date;
  v_due_year integer;
  v_due_month integer;
  v_status text;
  v_entry_count_expected integer;
  v_total_purchases_cents bigint;
  v_total_fees_cents bigint;
  v_total_interest_cents bigint;
  v_total_refunds_cents bigint;
  v_statement_total_cents bigint;
  v_total_payments_cents bigint;
  v_open_balance_cents bigint;
  v_manual_totals_json jsonb;
  v_candidate_manual_totals_json jsonb;
  v_manual_payload_count integer;
  v_statement_file_value_count integer;
  v_payment_file_value_count integer;
  v_lines_value_count integer;
  v_statement_total_from_file numeric;
  v_total_payments_from_file numeric;
  v_lines_computed_total numeric;
  v_candidate_statement_total_from_file_cents bigint;
  v_candidate_total_payments_from_file_cents bigint;
  v_candidate_lines_computed_total_cents bigint;
  v_close_date date;
  v_closing_date date;
  v_close_date_count integer;
  v_closing_date_count integer;
begin
  if v_user_id is null then
    raise exception 'Autenticação obrigatória.' using errcode = '28000';
  end if;

  v_feature_state :=
    finelo_internal.get_atomic_card_statement_conservation_feature_state_impl();

  if coalesce(v_feature_state, 'unset') <> 'enabled' then
    raise exception 'A conservação atômica de faturas não está habilitada para esta conta.'
      using errcode = '42501';
  end if;

  if p_expected_revision is null or p_expected_revision !~ '^[a-f0-9]{32}$' then
    raise exception 'Revisão esperada inválida.' using errcode = '22023';
  end if;
  if p_shadow_checksum is null or p_shadow_checksum !~ '^shadow-v1-[a-f0-9]{8}$' then
    raise exception 'Checksum sombra inválido.' using errcode = '22023';
  end if;
  if p_statement_key is null or p_statement_key !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Competência inválida.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_composite) <> 'object' then
    raise exception 'A fatura composta deve ser um objeto.' using errcode = '22023';
  end if;

  v_requested_count := coalesce(cardinality(p_source_statement_ids), 0);
  if v_requested_count < 2 or v_requested_count > 10 then
    raise exception 'A conservação deve conter entre 2 e 10 faturas físicas.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_source_statement_ids) source_id where source_id is null
  ) or (
    select count(distinct source_id) from unnest(p_source_statement_ids) source_id
  ) <> v_requested_count then
    raise exception 'A conservação contém identidades ausentes ou duplicadas.'
      using errcode = '22023';
  end if;
  if p_expected_entry_link_count not between 0 and 50000
     or p_expected_payment_link_count not between 0 and 50000 then
    raise exception 'Contagem esperada de vínculos inválida.' using errcode = '22023';
  end if;

  if coalesce(p_composite->>'statementKey', '') <> p_statement_key
     or coalesce(p_composite->>'purchaseReferenceMonth', '') <> p_statement_key
     or coalesce(p_composite->>'dueDate', '') !~ '^\d{4}-(0[1-9]|1[0-2])-\d{2}$'
     or jsonb_typeof(p_composite->'dueYear') <> 'number'
     or jsonb_typeof(p_composite->'dueMonth') <> 'number'
     or jsonb_typeof(p_composite->'entryCount') <> 'number'
     or jsonb_typeof(p_composite->'totalPurchasesCents') <> 'number'
     or jsonb_typeof(p_composite->'totalFeesCents') <> 'number'
     or jsonb_typeof(p_composite->'totalInterestCents') <> 'number'
     or jsonb_typeof(p_composite->'totalRefundsCents') <> 'number'
     or jsonb_typeof(p_composite->'statementTotalCents') <> 'number'
     or jsonb_typeof(p_composite->'totalPaymentsCents') <> 'number'
     or jsonb_typeof(p_composite->'openBalanceCents') <> 'number' then
    raise exception 'Campos obrigatórios da fatura composta são inválidos.'
      using errcode = '22023';
  end if;

  if (p_composite ? 'manualTotalsJson')
     and jsonb_typeof(p_composite->'manualTotalsJson') not in ('object', 'null') then
    raise exception 'Metadados manuais inválidos.' using errcode = '22023';
  end if;
  if (p_composite ? 'statementTotalFromFileCents')
     and jsonb_typeof(p_composite->'statementTotalFromFileCents') not in ('number', 'null') then
    raise exception 'Total oficial da fatura inválido.' using errcode = '22023';
  end if;
  if (p_composite ? 'totalPaymentsFromFileCents')
     and jsonb_typeof(p_composite->'totalPaymentsFromFileCents') not in ('number', 'null') then
    raise exception 'Total oficial de pagamentos inválido.' using errcode = '22023';
  end if;
  if (p_composite ? 'linesComputedTotalCents')
     and jsonb_typeof(p_composite->'linesComputedTotalCents') not in ('number', 'null') then
    raise exception 'Total calculado das linhas inválido.' using errcode = '22023';
  end if;

  v_purchase_reference := p_composite->>'purchaseReferenceMonth';
  v_due_date := (p_composite->>'dueDate')::date;
  v_due_year := (p_composite->>'dueYear')::integer;
  v_due_month := (p_composite->>'dueMonth')::integer;
  v_status := p_composite->>'status';
  v_entry_count_expected := (p_composite->>'entryCount')::integer;
  v_total_purchases_cents := (p_composite->>'totalPurchasesCents')::bigint;
  v_total_fees_cents := (p_composite->>'totalFeesCents')::bigint;
  v_total_interest_cents := (p_composite->>'totalInterestCents')::bigint;
  v_total_refunds_cents := (p_composite->>'totalRefundsCents')::bigint;
  v_statement_total_cents := (p_composite->>'statementTotalCents')::bigint;
  v_total_payments_cents := (p_composite->>'totalPaymentsCents')::bigint;
  v_open_balance_cents := (p_composite->>'openBalanceCents')::bigint;
  v_candidate_manual_totals_json := case
    when jsonb_typeof(p_composite->'manualTotalsJson') = 'object'
      then p_composite->'manualTotalsJson'
    else null
  end;
  v_candidate_statement_total_from_file_cents := case
    when jsonb_typeof(p_composite->'statementTotalFromFileCents') = 'number'
      then (p_composite->>'statementTotalFromFileCents')::bigint
    else null
  end;
  v_candidate_total_payments_from_file_cents := case
    when jsonb_typeof(p_composite->'totalPaymentsFromFileCents') = 'number'
      then (p_composite->>'totalPaymentsFromFileCents')::bigint
    else null
  end;
  v_candidate_lines_computed_total_cents := case
    when jsonb_typeof(p_composite->'linesComputedTotalCents') = 'number'
      then (p_composite->>'linesComputedTotalCents')::bigint
    else null
  end;

  if v_due_year <> left(p_statement_key, 4)::integer
     or v_due_month <> right(p_statement_key, 2)::integer
     or to_char(v_due_date, 'YYYY-MM') not in (
       p_statement_key,
       to_char((p_statement_key || '-01')::date + interval '1 month', 'YYYY-MM')
     ) then
    raise exception 'Competência e vencimento da fatura composta não coincidem.'
      using errcode = '22023';
  end if;
  if v_status not in ('open', 'closed', 'paid', 'partial', 'overdue') then
    raise exception 'Status da fatura composta inválido.' using errcode = '22023';
  end if;
  if v_entry_count_expected <> p_expected_entry_link_count
     or v_entry_count_expected < 0 then
    raise exception 'A cardinalidade da fatura composta diverge da auditoria.'
      using errcode = '22023';
  end if;
  if greatest(
    abs(v_total_purchases_cents), abs(v_total_fees_cents),
    abs(v_total_interest_cents), abs(v_total_refunds_cents),
    abs(v_statement_total_cents), abs(v_total_payments_cents),
    abs(v_open_balance_cents)
  ) > 1000000000000000 then
    raise exception 'Valor monetário fora do limite operacional.' using errcode = '22003';
  end if;
  if v_total_purchases_cents < 0 or v_total_fees_cents < 0
     or v_total_interest_cents < 0 or v_total_refunds_cents < 0
     or v_statement_total_cents < 0 or v_total_payments_cents < 0
     or v_open_balance_cents < 0 then
    raise exception 'Totais monetários negativos não são aceitos.' using errcode = '22023';
  end if;
  if v_statement_total_cents <>
       v_total_purchases_cents + v_total_fees_cents + v_total_interest_cents - v_total_refunds_cents
     or v_open_balance_cents <> greatest(v_statement_total_cents - v_total_payments_cents, 0) then
    raise exception 'Os totais derivados da fatura composta não fecham.' using errcode = '22023';
  end if;

  -- Uma transação concorrente da mesma conta nunca passa deste ponto em paralelo.
  perform pg_advisory_xact_lock(hashtextextended(p_account_id::text, 202602));

  v_before_revision :=
    finelo_internal.get_credit_card_projection_revision_for_user(
      p_account_id,
      v_user_id
    );
  if v_before_revision <> p_expected_revision then
    raise exception 'A projeção mudou depois da auditoria. Audite novamente; nenhuma linha foi alterada.'
      using errcode = '40001';
  end if;

  select cc.id
  into v_card_id
  from public.credit_cards cc
  join public.contas c on c.id = cc.account_id
  where cc.account_id = p_account_id
    and cc.user_id = v_user_id
    and c.user_id = v_user_id
  for update of cc;
  if v_card_id is null then
    raise exception 'Cartão normalizado não encontrado para esta conta.' using errcode = '42501';
  end if;

  -- Locks de linha sempre em ordem de UUID para prevenir deadlocks.
  perform s.id
  from public.credit_card_statements s
  where s.id = any(p_source_statement_ids)
  order by s.id
  for update;

  select count(*)
  into v_group_count
  from public.credit_card_statements s
  where s.id = any(p_source_statement_ids)
    and s.user_id = v_user_id
    and s.account_id = p_account_id
    and s.card_id = v_card_id
    and case
      when s.due_year between 1900 and 2200 and s.due_month between 1 and 12
        then s.due_year::text || '-' || lpad(s.due_month::text, 2, '0')
      when s.due_date is not null then to_char(s.due_date, 'YYYY-MM')
      else s.reference_label
    end = p_statement_key;
  if v_group_count <> v_requested_count then
    raise exception 'Uma ou mais faturas deixaram de pertencer ao grupo auditado.'
      using errcode = '40001';
  end if;

  select count(*)
  into v_group_count
  from public.credit_card_statements s
  where s.user_id = v_user_id
    and s.account_id = p_account_id
    and s.card_id = v_card_id
    and case
      when s.due_year between 1900 and 2200 and s.due_month between 1 and 12
        then s.due_year::text || '-' || lpad(s.due_month::text, 2, '0')
      when s.due_date is not null then to_char(s.due_date, 'YYYY-MM')
      else s.reference_label
    end = p_statement_key;
  if v_group_count <> v_requested_count then
    raise exception 'O conjunto enviado não contém todas as faturas físicas da competência.'
      using errcode = '40001';
  end if;

  perform e.id
  from public.credit_card_entries e
  where e.statement_id = any(p_source_statement_ids)
  order by e.id
  for update;
  perform i.id
  from public.credit_card_statement_items i
  where i.statement_id = any(p_source_statement_ids)
  order by i.id
  for update;
  perform p.id
  from public.credit_card_payments p
  where p.statement_id = any(p_source_statement_ids)
  order by p.id
  for update;

  if exists (
    select 1 from public.credit_card_entries e
    where e.statement_id = any(p_source_statement_ids)
      and (e.user_id <> v_user_id or e.account_id <> p_account_id or e.card_id <> v_card_id)
  ) or exists (
    select 1 from public.credit_card_statement_items i
    where i.statement_id = any(p_source_statement_ids)
      and (i.user_id <> v_user_id or i.account_id <> p_account_id)
  ) or exists (
    select 1 from public.credit_card_payments p
    where p.statement_id = any(p_source_statement_ids)
      and (p.user_id <> v_user_id or p.card_id <> v_card_id)
  ) then
    raise exception 'Foram encontrados vínculos fora do limite da conta.' using errcode = '42501';
  end if;

  select count(*) into v_entry_count
  from public.credit_card_entries e
  where e.statement_id = any(p_source_statement_ids)
    and e.user_id = v_user_id and e.account_id = p_account_id and e.card_id = v_card_id;
  select count(*) into v_legacy_item_count
  from public.credit_card_statement_items i
  where i.statement_id = any(p_source_statement_ids)
    and i.user_id = v_user_id and i.account_id = p_account_id;
  select count(*) into v_payment_count
  from public.credit_card_payments p
  where p.statement_id = any(p_source_statement_ids)
    and p.user_id = v_user_id and p.card_id = v_card_id;

  if v_entry_count <> p_expected_entry_link_count
     or v_payment_count <> p_expected_payment_link_count then
    raise exception 'As cardinalidades dos vínculos mudaram depois da auditoria.'
      using errcode = '40001';
  end if;

  select
    count(*) filter (where s.manual_totals_json is not null),
    count(distinct s.statement_total_from_file) filter (where s.statement_total_from_file is not null),
    count(distinct s.total_payments_from_file) filter (where s.total_payments_from_file is not null),
    count(distinct s.lines_computed_total) filter (where s.lines_computed_total is not null),
    max(s.statement_total_from_file),
    max(s.total_payments_from_file),
    max(s.lines_computed_total),
    count(distinct s.close_date) filter (where s.close_date is not null),
    max(s.close_date),
    count(distinct s.closing_date) filter (where s.closing_date is not null),
    max(s.closing_date)
  into
    v_manual_payload_count,
    v_statement_file_value_count,
    v_payment_file_value_count,
    v_lines_value_count,
    v_statement_total_from_file,
    v_total_payments_from_file,
    v_lines_computed_total,
    v_close_date_count,
    v_close_date,
    v_closing_date_count,
    v_closing_date
  from public.credit_card_statements s
  where s.id = any(p_source_statement_ids);

  if v_manual_payload_count > 1 or v_statement_file_value_count > 1
     or v_payment_file_value_count > 1 or v_lines_value_count > 1
     or v_close_date_count > 1 or v_closing_date_count > 1 then
    raise exception 'Os metadados protegidos do grupo são ambíguos; nenhuma linha foi alterada.'
      using errcode = 'P0001';
  end if;

  select s.manual_totals_json
  into v_manual_totals_json
  from public.credit_card_statements s
  where s.id = any(p_source_statement_ids)
    and s.manual_totals_json is not null
  order by s.id
  limit 1;

  if v_candidate_manual_totals_json is distinct from v_manual_totals_json
     or v_candidate_statement_total_from_file_cents is distinct from
       (case when v_statement_total_from_file is null then null
             else round(v_statement_total_from_file * 100)::bigint end)
     or v_candidate_total_payments_from_file_cents is distinct from
       (case when v_total_payments_from_file is null then null
             else round(v_total_payments_from_file * 100)::bigint end)
     or v_candidate_lines_computed_total_cents is distinct from
       (case when v_lines_computed_total is null then null
             else round(v_lines_computed_total * 100)::bigint end) then
    raise exception 'A fatura composta não conserva exatamente os metadados protegidos.'
      using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(to_jsonb(source_lot_id) order by source_lot_id), '[]'::jsonb)
  into v_source_import_lot_ids
  from (
    select distinct jsonb_array_elements_text(s.source_import_lot_ids) source_lot_id
    from public.credit_card_statements s
    where s.id = any(p_source_statement_ids)
  ) source_lots;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb)
  into v_source_rows
  from public.credit_card_statements s
  where s.id = any(p_source_statement_ids);
  select coalesce(jsonb_agg(
    jsonb_build_object('id', e.id, 'statement_id', e.statement_id) order by e.id
  ), '[]'::jsonb)
  into v_entry_links
  from public.credit_card_entries e
  where e.statement_id = any(p_source_statement_ids);
  select coalesce(jsonb_agg(
    jsonb_build_object('id', i.id, 'statement_id', i.statement_id) order by i.id
  ), '[]'::jsonb)
  into v_legacy_item_links
  from public.credit_card_statement_items i
  where i.statement_id = any(p_source_statement_ids);
  select coalesce(jsonb_agg(
    jsonb_build_object('id', p.id, 'statement_id', p.statement_id) order by p.id
  ), '[]'::jsonb)
  into v_payment_links
  from public.credit_card_payments p
  where p.statement_id = any(p_source_statement_ids);

  if jsonb_array_length(v_source_rows) <> v_requested_count
     or jsonb_array_length(v_entry_links) <> v_entry_count
     or jsonb_array_length(v_legacy_item_links) <> v_legacy_item_count
     or jsonb_array_length(v_payment_links) <> v_payment_count then
    raise exception 'O snapshot bloqueado ficou incompleto; nenhuma linha foi alterada.'
      using errcode = '40001';
  end if;

  v_reference_label := 'atomic:' || p_statement_key || ':' || left(v_snapshot_id::text, 8);

  insert into public.credit_card_statement_conservation_snapshots (
    id, user_id, account_id, card_id, operation_kind, statement_key,
    shadow_checksum, before_revision, composite_statement_id,
    source_statement_rows, entry_links, legacy_item_links, payment_links,
    source_statement_count, entry_link_count, legacy_item_link_count,
    payment_link_count
  ) values (
    v_snapshot_id, v_user_id, p_account_id, v_card_id,
    'duplicate_statement_conservation', p_statement_key,
    p_shadow_checksum, v_before_revision, v_composite_id,
    v_source_rows, v_entry_links, v_legacy_item_links, v_payment_links,
    v_requested_count, v_entry_count, v_legacy_item_count, v_payment_count
  );

  insert into public.credit_card_statements (
    id, user_id, account_id, card_id, reference_label,
    close_date, due_date, total_charges, total_credits, total_payments,
    open_amount, source_origin, status, purchase_reference_label,
    due_year, due_month, closing_date, source_import_lot_ids,
    total_purchases, total_fees, total_interest, total_refunds,
    statement_total, open_balance, manual_totals_json,
    statement_total_from_file, total_payments_from_file, lines_computed_total,
    atomic_projection_version, atomic_projection_checksum,
    atomic_projection_snapshot_id
  ) values (
    v_composite_id, v_user_id, p_account_id, v_card_id, v_reference_label,
    v_close_date, v_due_date,
    (v_total_purchases_cents + v_total_fees_cents + v_total_interest_cents)::numeric / 100,
    v_total_refunds_cents::numeric / 100,
    v_total_payments_cents::numeric / 100,
    v_open_balance_cents::numeric / 100,
    'atomic_statement_conservation', v_status, v_purchase_reference,
    v_due_year, v_due_month, v_closing_date, v_source_import_lot_ids,
    v_total_purchases_cents::numeric / 100,
    v_total_fees_cents::numeric / 100,
    v_total_interest_cents::numeric / 100,
    v_total_refunds_cents::numeric / 100,
    v_statement_total_cents::numeric / 100,
    v_open_balance_cents::numeric / 100,
    v_manual_totals_json,
    v_statement_total_from_file,
    v_total_payments_from_file,
    v_lines_computed_total,
    null, null, null
  );

  update public.credit_card_entries e
  set statement_id = v_composite_id
  where e.statement_id = any(p_source_statement_ids)
    and e.user_id = v_user_id and e.account_id = p_account_id and e.card_id = v_card_id;
  get diagnostics v_updated_entries = row_count;
  update public.credit_card_statement_items i
  set statement_id = v_composite_id
  where i.statement_id = any(p_source_statement_ids)
    and i.user_id = v_user_id and i.account_id = p_account_id;
  get diagnostics v_updated_legacy_items = row_count;
  update public.credit_card_payments p
  set statement_id = v_composite_id
  where p.statement_id = any(p_source_statement_ids)
    and p.user_id = v_user_id and p.card_id = v_card_id;
  get diagnostics v_updated_payments = row_count;

  if v_updated_entries <> v_entry_count
     or v_updated_legacy_items <> v_legacy_item_count
     or v_updated_payments <> v_payment_count then
    raise exception 'O banco recusou uma religação parcial.' using errcode = '40001';
  end if;

  delete from public.credit_card_statements s
  where s.id = any(p_source_statement_ids)
    and s.user_id = v_user_id and s.account_id = p_account_id and s.card_id = v_card_id;
  get diagnostics v_deleted_statements = row_count;
  if v_deleted_statements <> v_requested_count then
    raise exception 'O banco recusou uma substituição parcial.' using errcode = '40001';
  end if;

  if (select count(*) from public.credit_card_entries where statement_id = v_composite_id)
       <> v_entry_count
     or (select count(*) from public.credit_card_statement_items where statement_id = v_composite_id)
       <> v_legacy_item_count
     or (select count(*) from public.credit_card_payments where statement_id = v_composite_id)
       <> v_payment_count then
    raise exception 'A conferência posterior dos vínculos divergiu.' using errcode = '40001';
  end if;

  v_after_revision :=
    finelo_internal.get_credit_card_projection_revision_for_user(
      p_account_id,
      v_user_id
    );
  if v_after_revision = v_before_revision then
    raise exception 'A revisão não registrou a conservação.' using errcode = '40001';
  end if;

  update public.credit_card_statement_conservation_snapshots
  set after_revision = v_after_revision
  where id = v_snapshot_id and user_id = v_user_id;

  return jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'before_revision', v_before_revision,
    'after_revision', v_after_revision,
    'source_statements', v_requested_count,
    'composite_statements', 1,
    'entries_relinked', v_updated_entries,
    'legacy_items_relinked', v_updated_legacy_items,
    'payments_relinked', v_updated_payments
  );
end;
$$;

grant create on schema finelo_internal
  to finelo_statement_conservation_executor;
alter function finelo_internal.conserve_credit_card_statement_duplicates_atomic_v1_impl(
  uuid, text, text, text, uuid[], integer, integer, jsonb
) owner to finelo_statement_conservation_executor;
revoke create on schema finelo_internal
  from finelo_statement_conservation_executor;
revoke all on function finelo_internal.conserve_credit_card_statement_duplicates_atomic_v1_impl(
  uuid, text, text, text, uuid[], integer, integer, jsonb
) from public;
revoke all on function finelo_internal.conserve_credit_card_statement_duplicates_atomic_v1_impl(
  uuid, text, text, text, uuid[], integer, integer, jsonb
) from anon;
revoke all on function finelo_internal.conserve_credit_card_statement_duplicates_atomic_v1_impl(
  uuid, text, text, text, uuid[], integer, integer, jsonb
) from authenticated;
revoke all on function finelo_internal.conserve_credit_card_statement_duplicates_atomic_v1_impl(
  uuid, text, text, text, uuid[], integer, integer, jsonb
) from service_role;
grant execute on function finelo_internal.conserve_credit_card_statement_duplicates_atomic_v1_impl(
  uuid, text, text, text, uuid[], integer, integer, jsonb
) to authenticated;

comment on function finelo_internal.conserve_credit_card_statement_duplicates_atomic_v1_impl(
  uuid, text, text, text, uuid[], integer, integer, jsonb
) is
  'Implementação privada Sprint 2O: owner NOLOGIN/BYPASSRLS com ACL estreita substitui um grupo completo por uma fatura composta sob lock e filtros explícitos de usuário.';

create or replace function finelo_internal.rollback_credit_card_statement_conservation_atomic_v1_impl(
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
    nullif(
      pg_catalog.current_setting('request.jwt.claims', true), ''
    )::jsonb ->> 'sub'
  )::uuid;
  v_snapshot public.credit_card_statement_conservation_snapshots%rowtype;
  v_current_revision text;
  v_restored_revision text;
  v_restored_statements integer;
  v_restored_entries integer;
  v_restored_legacy_items integer;
  v_restored_payments integer;
  v_deleted_composites integer;
begin
  if v_user_id is null then
    raise exception 'Autenticação obrigatória.' using errcode = '28000';
  end if;

  select * into v_snapshot
  from public.credit_card_statement_conservation_snapshots s
  where s.id = p_snapshot_id and s.user_id = v_user_id
  for update;
  if v_snapshot.id is null then
    raise exception 'Snapshot de conservação não encontrado.' using errcode = '42501';
  end if;
  if v_snapshot.rolled_back_at is not null then
    raise exception 'Esta conservação já foi desfeita.' using errcode = 'P0001';
  end if;
  if v_snapshot.after_revision is null then
    raise exception 'Snapshot sem confirmação de aplicação.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_snapshot.account_id::text, 202602));
  v_current_revision :=
    finelo_internal.get_credit_card_projection_revision_for_user(
      v_snapshot.account_id,
      v_user_id
    );
  if v_current_revision <> v_snapshot.after_revision then
    raise exception 'A projeção mudou depois da conservação. Rollback automático recusado para proteger alterações posteriores.'
      using errcode = '40001';
  end if;

  perform s.id
  from public.credit_card_statements s
  where s.id = v_snapshot.composite_statement_id
    and s.user_id = v_user_id
    and s.account_id = v_snapshot.account_id
    and s.card_id = v_snapshot.card_id
  for update;
  if not found then
    raise exception 'A fatura composta não existe mais.' using errcode = '40001';
  end if;

  perform e.id from public.credit_card_entries e
  where e.statement_id = v_snapshot.composite_statement_id order by e.id for update;
  perform i.id from public.credit_card_statement_items i
  where i.statement_id = v_snapshot.composite_statement_id order by i.id for update;
  perform p.id from public.credit_card_payments p
  where p.statement_id = v_snapshot.composite_statement_id order by p.id for update;

  if (select count(*) from public.credit_card_entries e
      where e.statement_id = v_snapshot.composite_statement_id)
       <> v_snapshot.entry_link_count
     or (select count(*) from public.credit_card_statement_items i
         where i.statement_id = v_snapshot.composite_statement_id)
       <> v_snapshot.legacy_item_link_count
     or (select count(*) from public.credit_card_payments p
         where p.statement_id = v_snapshot.composite_statement_id)
       <> v_snapshot.payment_link_count then
    raise exception 'A fatura composta recebeu vínculos posteriores. Rollback recusado.'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_snapshot.entry_links) old(id uuid, statement_id uuid)
    left join public.credit_card_entries current on current.id = old.id
    where current.id is null or current.statement_id <> v_snapshot.composite_statement_id
  ) or exists (
    select 1
    from jsonb_to_recordset(v_snapshot.legacy_item_links) old(id uuid, statement_id uuid)
    left join public.credit_card_statement_items current on current.id = old.id
    where current.id is null or current.statement_id <> v_snapshot.composite_statement_id
  ) or exists (
    select 1
    from jsonb_to_recordset(v_snapshot.payment_links) old(id uuid, statement_id uuid)
    left join public.credit_card_payments current on current.id = old.id
    where current.id is null or current.statement_id <> v_snapshot.composite_statement_id
  ) then
    raise exception 'Um vínculo do snapshot foi alterado. Rollback recusado.'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_snapshot.source_statement_rows) old(id uuid)
    join public.credit_card_statements current on current.id = old.id
  ) then
    raise exception 'Uma fatura original do snapshot já existe. Rollback recusado.'
      using errcode = 'P0001';
  end if;

  insert into public.credit_card_statements
  select restored.*
  from jsonb_populate_recordset(
    null::public.credit_card_statements,
    v_snapshot.source_statement_rows
  ) restored;
  get diagnostics v_restored_statements = row_count;
  if v_restored_statements <> v_snapshot.source_statement_count then
    raise exception 'O banco recusou uma restauração parcial de faturas.'
      using errcode = '40001';
  end if;

  update public.credit_card_entries current
  set statement_id = old.statement_id
  from jsonb_to_recordset(v_snapshot.entry_links) old(id uuid, statement_id uuid)
  where current.id = old.id
    and current.user_id = v_user_id
    and current.account_id = v_snapshot.account_id
    and current.card_id = v_snapshot.card_id
    and current.statement_id = v_snapshot.composite_statement_id;
  get diagnostics v_restored_entries = row_count;

  update public.credit_card_statement_items current
  set statement_id = old.statement_id
  from jsonb_to_recordset(v_snapshot.legacy_item_links) old(id uuid, statement_id uuid)
  where current.id = old.id
    and current.user_id = v_user_id
    and current.account_id = v_snapshot.account_id
    and current.statement_id = v_snapshot.composite_statement_id;
  get diagnostics v_restored_legacy_items = row_count;

  update public.credit_card_payments current
  set statement_id = old.statement_id
  from jsonb_to_recordset(v_snapshot.payment_links) old(id uuid, statement_id uuid)
  where current.id = old.id
    and current.user_id = v_user_id
    and current.card_id = v_snapshot.card_id
    and current.statement_id = v_snapshot.composite_statement_id;
  get diagnostics v_restored_payments = row_count;

  if v_restored_entries <> v_snapshot.entry_link_count
     or v_restored_legacy_items <> v_snapshot.legacy_item_link_count
     or v_restored_payments <> v_snapshot.payment_link_count then
    raise exception 'O banco recusou uma restauração parcial de vínculos.'
      using errcode = '40001';
  end if;

  delete from public.credit_card_statements s
  where s.id = v_snapshot.composite_statement_id
    and s.user_id = v_user_id
    and s.account_id = v_snapshot.account_id
    and s.card_id = v_snapshot.card_id;
  get diagnostics v_deleted_composites = row_count;
  if v_deleted_composites <> 1 then
    raise exception 'A fatura composta não pôde ser removida.' using errcode = '40001';
  end if;

  v_restored_revision :=
    finelo_internal.get_credit_card_projection_revision_for_user(
      v_snapshot.account_id,
      v_user_id
    );
  if v_restored_revision <> v_snapshot.before_revision then
    raise exception 'A revisão restaurada não coincide com o snapshot. Rollback cancelado integralmente.'
      using errcode = '40001';
  end if;

  update public.credit_card_statement_conservation_snapshots
  set rolled_back_at = pg_catalog.now(), rollback_revision = v_restored_revision
  where id = v_snapshot.id and user_id = v_user_id;

  return jsonb_build_object(
    'snapshot_id', v_snapshot.id,
    'account_id', v_snapshot.account_id,
    'restored_revision', v_restored_revision,
    'restored_statements', v_restored_statements,
    'restored_entries', v_restored_entries,
    'restored_legacy_items', v_restored_legacy_items,
    'restored_payments', v_restored_payments,
    'rolled_back', true
  );
end;
$$;

grant create on schema finelo_internal
  to finelo_statement_conservation_executor;
alter function finelo_internal.rollback_credit_card_statement_conservation_atomic_v1_impl(uuid)
  owner to finelo_statement_conservation_executor;
revoke create on schema finelo_internal
  from finelo_statement_conservation_executor;
revoke all on function finelo_internal.rollback_credit_card_statement_conservation_atomic_v1_impl(uuid)
  from public;
revoke all on function finelo_internal.rollback_credit_card_statement_conservation_atomic_v1_impl(uuid)
  from anon;
revoke all on function finelo_internal.rollback_credit_card_statement_conservation_atomic_v1_impl(uuid)
  from authenticated;
revoke all on function finelo_internal.rollback_credit_card_statement_conservation_atomic_v1_impl(uuid)
  from service_role;
grant execute on function finelo_internal.rollback_credit_card_statement_conservation_atomic_v1_impl(uuid)
  to authenticated;

comment on function finelo_internal.rollback_credit_card_statement_conservation_atomic_v1_impl(uuid) is
  'Implementação privada Sprint 2O: owner NOLOGIN/BYPASSRLS com ACL estreita restaura o snapshot somente quando a revisão e o usuário permanecem intactos.';

-- A Data API expõe somente wrappers SECURITY INVOKER. Eles não carregam
-- privilégios do owner e encaminham os argumentos sem lógica própria.
create or replace function public.get_atomic_card_statement_conservation_feature_state()
returns text
language sql
stable
security invoker
set search_path = ''
as $wrapper$
  select finelo_internal.get_atomic_card_statement_conservation_feature_state_impl();
$wrapper$;

revoke all on function public.get_atomic_card_statement_conservation_feature_state()
  from public;
revoke all on function public.get_atomic_card_statement_conservation_feature_state()
  from anon;
revoke all on function public.get_atomic_card_statement_conservation_feature_state()
  from authenticated;
revoke all on function public.get_atomic_card_statement_conservation_feature_state()
  from service_role;
grant execute on function public.get_atomic_card_statement_conservation_feature_state()
  to authenticated;

comment on function public.get_atomic_card_statement_conservation_feature_state() is
  'Wrapper público SECURITY INVOKER do kill switch da Sprint 2O.';

create or replace function public.conserve_credit_card_statement_duplicates_atomic_v1(
  p_account_id uuid,
  p_expected_revision text,
  p_shadow_checksum text,
  p_statement_key text,
  p_source_statement_ids uuid[],
  p_expected_entry_link_count integer,
  p_expected_payment_link_count integer,
  p_composite jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $wrapper$
  select finelo_internal.conserve_credit_card_statement_duplicates_atomic_v1_impl(
    p_account_id,
    p_expected_revision,
    p_shadow_checksum,
    p_statement_key,
    p_source_statement_ids,
    p_expected_entry_link_count,
    p_expected_payment_link_count,
    p_composite
  );
$wrapper$;

revoke all on function public.conserve_credit_card_statement_duplicates_atomic_v1(
  uuid, text, text, text, uuid[], integer, integer, jsonb
) from public;
revoke all on function public.conserve_credit_card_statement_duplicates_atomic_v1(
  uuid, text, text, text, uuid[], integer, integer, jsonb
) from anon;
revoke all on function public.conserve_credit_card_statement_duplicates_atomic_v1(
  uuid, text, text, text, uuid[], integer, integer, jsonb
) from authenticated;
revoke all on function public.conserve_credit_card_statement_duplicates_atomic_v1(
  uuid, text, text, text, uuid[], integer, integer, jsonb
) from service_role;
grant execute on function public.conserve_credit_card_statement_duplicates_atomic_v1(
  uuid, text, text, text, uuid[], integer, integer, jsonb
) to authenticated;

comment on function public.conserve_credit_card_statement_duplicates_atomic_v1(
  uuid, text, text, text, uuid[], integer, integer, jsonb
) is
  'Wrapper público SECURITY INVOKER da conservação atômica Sprint 2O.';

create or replace function public.rollback_credit_card_statement_conservation_atomic_v1(
  p_snapshot_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $wrapper$
  select finelo_internal.rollback_credit_card_statement_conservation_atomic_v1_impl(
    p_snapshot_id
  );
$wrapper$;

revoke all on function public.rollback_credit_card_statement_conservation_atomic_v1(uuid)
  from public;
revoke all on function public.rollback_credit_card_statement_conservation_atomic_v1(uuid)
  from anon;
revoke all on function public.rollback_credit_card_statement_conservation_atomic_v1(uuid)
  from authenticated;
revoke all on function public.rollback_credit_card_statement_conservation_atomic_v1(uuid)
  from service_role;
grant execute on function public.rollback_credit_card_statement_conservation_atomic_v1(uuid)
  to authenticated;

comment on function public.rollback_credit_card_statement_conservation_atomic_v1(uuid) is
  'Wrapper público SECURITY INVOKER do rollback atômico Sprint 2O.';

revoke finelo_statement_conservation_executor from postgres;

do $finelo_membership_assertions$
declare
  v_executor_oid oid :=
    'finelo_statement_conservation_executor'::pg_catalog.regrole::oid;
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
    raise exception 'Um papel interno recebeu membership efetivo inesperado.';
  end if;
end;
$finelo_membership_assertions$;

commit;
