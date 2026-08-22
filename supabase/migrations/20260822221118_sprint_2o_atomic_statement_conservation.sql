-- Sprint 2O: conservação atômica e reversível de uma competência com faturas
-- físicas duplicadas.
--
-- O RPC não elege uma linha vencedora. Ele cria uma fatura composta nova,
-- fotografa integralmente as linhas originais e todos os vínculos, religa-os e
-- remove as duplicadas na mesma transação. A função permanece desligada por
-- padrão por uma flag dedicada em auth.raw_app_meta_data.

create table if not exists public.credit_card_statement_conservation_snapshots (
  id uuid primary key default gen_random_uuid(),
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
  applied_at timestamptz not null default now(),
  rolled_back_at timestamptz,
  rollback_revision text,
  created_at timestamptz not null default now()
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

revoke all on table public.credit_card_statement_conservation_snapshots from public;
revoke all on table public.credit_card_statement_conservation_snapshots from anon;
revoke all on table public.credit_card_statement_conservation_snapshots from authenticated;
grant select on table public.credit_card_statement_conservation_snapshots to authenticated;

comment on table public.credit_card_statement_conservation_snapshots is
  'Snapshot reversível das faturas físicas e vínculos substituídos por uma fatura composta na Sprint 2O.';

create or replace function public.get_atomic_card_statement_conservation_feature_state()
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
  where u.id = (select auth.uid());
$$;

revoke all on function public.get_atomic_card_statement_conservation_feature_state() from public;
revoke all on function public.get_atomic_card_statement_conservation_feature_state() from anon;
grant execute on function public.get_atomic_card_statement_conservation_feature_state()
  to authenticated;

comment on function public.get_atomic_card_statement_conservation_feature_state() is
  'Kill switch dedicado da Sprint 2O. Unset e disabled mantêm toda conservação desligada.';

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
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
set statement_timeout = '30s'
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_feature_state text;
  v_card_id uuid;
  v_before_revision text;
  v_after_revision text;
  v_snapshot_id uuid := gen_random_uuid();
  v_composite_id uuid := gen_random_uuid();
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

  select case
    when u.raw_app_meta_data ->> 'atomic_card_statement_conservation_disabled' = 'true'
      then 'disabled'
    when u.raw_app_meta_data ->> 'atomic_card_statement_conservation_enabled' = 'true'
      then 'enabled'
    else 'unset'
  end
  into v_feature_state
  from auth.users u
  where u.id = v_user_id;

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

  v_before_revision := public.get_credit_card_projection_revision(p_account_id);
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

  v_after_revision := public.get_credit_card_projection_revision(p_account_id);
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

revoke all on function public.conserve_credit_card_statement_duplicates_atomic_v1(
  uuid, text, text, text, uuid[], integer, integer, jsonb
) from public;
revoke all on function public.conserve_credit_card_statement_duplicates_atomic_v1(
  uuid, text, text, text, uuid[], integer, integer, jsonb
) from anon;
grant execute on function public.conserve_credit_card_statement_duplicates_atomic_v1(
  uuid, text, text, text, uuid[], integer, integer, jsonb
) to authenticated;

comment on function public.conserve_credit_card_statement_duplicates_atomic_v1(
  uuid, text, text, text, uuid[], integer, integer, jsonb
) is
  'Sprint 2O: substitui um grupo completo de faturas físicas por uma composta sob lock, com snapshot e rollback exatos.';

create or replace function public.rollback_credit_card_statement_conservation_atomic_v1(
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
  v_user_id uuid := (select auth.uid());
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
  v_current_revision := public.get_credit_card_projection_revision(v_snapshot.account_id);
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

  v_restored_revision := public.get_credit_card_projection_revision(v_snapshot.account_id);
  if v_restored_revision <> v_snapshot.before_revision then
    raise exception 'A revisão restaurada não coincide com o snapshot. Rollback cancelado integralmente.'
      using errcode = '40001';
  end if;

  update public.credit_card_statement_conservation_snapshots
  set rolled_back_at = now(), rollback_revision = v_restored_revision
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

revoke all on function public.rollback_credit_card_statement_conservation_atomic_v1(uuid)
  from public;
revoke all on function public.rollback_credit_card_statement_conservation_atomic_v1(uuid)
  from anon;
grant execute on function public.rollback_credit_card_statement_conservation_atomic_v1(uuid)
  to authenticated;

comment on function public.rollback_credit_card_statement_conservation_atomic_v1(uuid) is
  'Sprint 2O: restaura exatamente as faturas e vínculos do snapshot somente quando a revisão posterior permanece intacta.';
