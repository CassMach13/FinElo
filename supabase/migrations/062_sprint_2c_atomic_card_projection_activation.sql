-- Sprint 2C — ativação atômica e reversível da projeção do cartão.
--
-- Escopo propositalmente estreito:
--   * atualiza apenas faturas, itens e pagamentos já existentes;
--   * nunca insere nem exclui linhas financeiras;
--   * preserva metadados manuais e totais originais do arquivo;
--   * recusa projeções incompletas, ambíguas ou que mudaram após a auditoria;
--   * grava um snapshot individual para rollback exato.

alter table public.credit_card_statements
  add column if not exists atomic_projection_version smallint null,
  add column if not exists atomic_projection_checksum text null,
  add column if not exists atomic_projection_snapshot_id uuid null;

alter table public.credit_card_statements
  drop constraint if exists credit_card_statements_atomic_projection_version_check;
alter table public.credit_card_statements
  add constraint credit_card_statements_atomic_projection_version_check
  check (atomic_projection_version is null or atomic_projection_version = 1);

create table if not exists public.credit_card_atomic_rebuild_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  account_id uuid references public.contas(id) on delete cascade not null,
  card_id uuid references public.credit_cards(id) on delete cascade not null,
  shadow_checksum text not null,
  before_revision text not null,
  after_revision text,
  before_state jsonb not null,
  applied_at timestamptz not null default now(),
  rolled_back_at timestamptz,
  rollback_revision text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cc_atomic_snapshots_account_applied
  on public.credit_card_atomic_rebuild_snapshots (account_id, applied_at desc);

alter table public.credit_card_atomic_rebuild_snapshots enable row level security;

drop policy if exists "Users can view own card rebuild snapshots"
  on public.credit_card_atomic_rebuild_snapshots;
create policy "Users can view own card rebuild snapshots"
  on public.credit_card_atomic_rebuild_snapshots for select
  using (auth.uid() = user_id);

-- Snapshots são imutáveis pelo cliente. Somente as funções SECURITY DEFINER
-- abaixo podem inserir ou marcar um rollback, sempre após validar auth.uid().
revoke all on table public.credit_card_atomic_rebuild_snapshots from public;
revoke all on table public.credit_card_atomic_rebuild_snapshots from anon;
revoke all on table public.credit_card_atomic_rebuild_snapshots from authenticated;
grant select on table public.credit_card_atomic_rebuild_snapshots to authenticated;

comment on table public.credit_card_atomic_rebuild_snapshots is
  'Snapshot reversível da projeção normalizada antes de uma ativação atômica Sprint 2C.';
comment on column public.credit_card_statements.atomic_projection_version is
  'Quando 1, a conciliação ativa vem da projeção atômica; totais do arquivo permanecem apenas como evidência.';

create or replace function public.get_credit_card_projection_revision(p_account_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_revision text;
begin
  if v_user_id is null then
    raise exception 'Autenticação obrigatória.' using errcode = '28000';
  end if;
  if not exists (
    select 1
    from public.contas c
    where c.id = p_account_id
      and c.user_id = v_user_id
  ) then
    raise exception 'Conta de cartão não encontrada.' using errcode = '42501';
  end if;

  select md5(
    jsonb_build_object(
      'statements', coalesce((
        select jsonb_agg(
          jsonb_build_array(
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
        where s.user_id = v_user_id
          and s.account_id = p_account_id
      ), '[]'::jsonb),
      'entries', coalesce((
        select jsonb_agg(
          jsonb_build_array(
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
        where e.user_id = v_user_id
          and e.account_id = p_account_id
      ), '[]'::jsonb),
      'payments', coalesce((
        select jsonb_agg(
          jsonb_build_array(
            p.id, p.card_id, p.statement_id, p.payment_account_id,
            p.payment_transaction_id, p.payment_date, p.amount,
            p.source, p.notes
          ) order by p.id
        )
        from public.credit_card_payments p
        join public.credit_card_statements s on s.id = p.statement_id
        where p.user_id = v_user_id
          and s.account_id = p_account_id
      ), '[]'::jsonb)
    )::text
  ) into v_revision;

  return v_revision;
end;
$$;

revoke all on function public.get_credit_card_projection_revision(uuid) from public;
grant execute on function public.get_credit_card_projection_revision(uuid) to authenticated;

create or replace function public.get_atomic_card_rebuild_feature_state()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when u.raw_app_meta_data ->> 'atomic_card_rebuild_disabled' = 'true' then 'disabled'
    when u.raw_app_meta_data ->> 'atomic_card_rebuild_enabled' = 'true' then 'enabled'
    else 'unset'
  end
  from auth.users u
  where u.id = (select auth.uid());
$$;

revoke all on function public.get_atomic_card_rebuild_feature_state() from public;
revoke all on function public.get_atomic_card_rebuild_feature_state() from anon;
grant execute on function public.get_atomic_card_rebuild_feature_state() to authenticated;

comment on function public.get_atomic_card_rebuild_feature_state() is
  'Kill switch autoritativo da Sprint 2C. Unset e disabled mantêm a ativação desligada.';

create or replace function public.activate_credit_card_projection_atomic(
  p_account_id uuid,
  p_expected_revision text,
  p_shadow_checksum text,
  p_statements jsonb,
  p_entries jsonb,
  p_payments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_feature_state text;
  v_card_id uuid;
  v_current_revision text;
  v_after_revision text;
  v_snapshot_id uuid;
  v_before_state jsonb;
  v_statement_count integer;
  v_entry_count integer;
  v_payment_count integer;
begin
  if v_user_id is null then
    raise exception 'Autenticação obrigatória.' using errcode = '28000';
  end if;
  select case
    when u.raw_app_meta_data ->> 'atomic_card_rebuild_disabled' = 'true' then 'disabled'
    when u.raw_app_meta_data ->> 'atomic_card_rebuild_enabled' = 'true' then 'enabled'
    else 'unset'
  end into v_feature_state
  from auth.users u
  where u.id = v_user_id;
  if coalesce(v_feature_state, 'unset') <> 'enabled' then
    raise exception 'A ativação atômica de cartão não está habilitada para esta conta.'
      using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision !~ '^[a-f0-9]{32}$' then
    raise exception 'Revisão esperada inválida.' using errcode = '22023';
  end if;
  if p_shadow_checksum is null or p_shadow_checksum !~ '^shadow-v1-[a-f0-9]{8}$' then
    raise exception 'Checksum da projeção sombra inválido.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_statements) <> 'array'
     or jsonb_typeof(p_entries) <> 'array'
     or jsonb_typeof(p_payments) <> 'array' then
    raise exception 'A projeção deve conter três arrays JSON.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_statements) > 240
     or jsonb_array_length(p_entries) > 10000
     or jsonb_array_length(p_payments) > 10000 then
    raise exception 'A projeção excede o limite seguro.' using errcode = '54000';
  end if;

  select cc.id into v_card_id
  from public.credit_cards cc
  join public.contas c on c.id = cc.account_id
  where cc.account_id = p_account_id
    and cc.user_id = v_user_id
    and c.user_id = v_user_id
  for update of cc;

  if v_card_id is null then
    raise exception 'Cartão normalizado não encontrado para esta conta.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_account_id::text, 202602));

  v_current_revision := public.get_credit_card_projection_revision(p_account_id);
  if v_current_revision <> p_expected_revision then
    raise exception 'A projeção mudou depois da auditoria. Audite novamente; nenhuma linha foi alterada.'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from (
      select value->>'statementKey' as key, count(*)
      from jsonb_array_elements(p_statements)
      group by value->>'statementKey'
      having count(*) > 1 or value->>'statementKey' is null
    ) duplicate_statement
  ) or exists (
    select 1
    from (
      select value->>'transactionId' as key, count(*)
      from jsonb_array_elements(p_entries)
      group by value->>'transactionId'
      having count(*) > 1 or value->>'transactionId' is null
    ) duplicate_entry
  ) or exists (
    select 1
    from (
      select value->>'transactionId' as key, count(*)
      from jsonb_array_elements(p_payments)
      group by value->>'transactionId'
      having count(*) > 1 or value->>'transactionId' is null
    ) duplicate_payment
  ) then
    raise exception 'A projeção contém identidades ausentes ou duplicadas.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_statements) row
    where coalesce(row->>'statementKey', '') !~ '^\d{4}-(0[1-9]|1[0-2])$'
       or coalesce(row->>'purchaseReferenceMonth', '') !~ '^\d{4}-(0[1-9]|1[0-2])$'
       or coalesce(row->>'dueDate', '') !~ '^\d{4}-(0[1-9]|1[0-2])-\d{2}$'
       or left(row->>'dueDate', 7) <> row->>'statementKey'
       or coalesce(row->>'status', '') not in ('open', 'closed', 'paid', 'partial', 'overdue')
       or coalesce(row->>'statementTotalCents', '') !~ '^\d+$'
       or coalesce(row->>'totalPaymentsCents', '') !~ '^\d+$'
       or coalesce(row->>'openBalanceCents', '') !~ '^\d+$'
       or coalesce(row->>'totalPurchasesCents', '') !~ '^\d+$'
       or coalesce(row->>'totalFeesCents', '') !~ '^\d+$'
       or coalesce(row->>'totalInterestCents', '') !~ '^\d+$'
       or coalesce(row->>'totalRefundsCents', '') !~ '^\d+$'
       or (row->>'openBalanceCents')::numeric <>
          greatest((row->>'statementTotalCents')::numeric - (row->>'totalPaymentsCents')::numeric, 0)
  ) then
    raise exception 'A projeção contém totais ou competências inválidos.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_entries) row
    where coalesce(row->>'transactionId', '') !~ '^[0-9a-fA-F-]{36}$'
       or coalesce(row->>'statementKey', '') !~ '^\d{4}-(0[1-9]|1[0-2])$'
       or coalesce(row->>'postedDate', '') !~ '^\d{4}-(0[1-9]|1[0-2])-\d{2}$'
       or coalesce(row->>'amountCents', '') !~ '^-?\d+$'
       or coalesce(row->>'entryType', '') not in (
         'purchase', 'installment_purchase', 'refund', 'invoice_payment',
         'fee', 'interest', 'adjustment', 'ignored', 'needs_review'
       )
  ) or exists (
    select 1
    from jsonb_array_elements(p_payments) row
    where coalesce(row->>'transactionId', '') !~ '^[0-9a-fA-F-]{36}$'
       or coalesce(row->>'statementKey', '') !~ '^\d{4}-(0[1-9]|1[0-2])$'
       or coalesce(row->>'paymentDate', '') !~ '^\d{4}-(0[1-9]|1[0-2])-\d{2}$'
       or coalesce(row->>'amountCents', '') !~ '^\d+$'
       or coalesce(row->>'source', '') not in ('manual', 'imported_statement', 'bank_account_import')
  ) then
    raise exception 'A projeção contém itens ou pagamentos inválidos.' using errcode = '22023';
  end if;

  select count(*) into v_statement_count
  from public.credit_card_statements s
  where s.user_id = v_user_id and s.account_id = p_account_id;
  select count(*) into v_entry_count
  from public.credit_card_entries e
  where e.user_id = v_user_id and e.account_id = p_account_id;
  select count(*) into v_payment_count
  from public.credit_card_payments p
  join public.credit_card_statements s on s.id = p.statement_id
  where p.user_id = v_user_id and s.account_id = p_account_id;

  if v_statement_count <> jsonb_array_length(p_statements)
     or v_entry_count <> jsonb_array_length(p_entries)
     or v_payment_count <> jsonb_array_length(p_payments) then
    raise exception 'A ativação exigiria criar ou excluir linhas. Operação recusada.' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.credit_card_statements s
    where s.user_id = v_user_id and s.account_id = p_account_id
      and not exists (
        select 1 from jsonb_array_elements(p_statements) row
        where row->>'statementKey' = s.reference_label
      )
  ) or exists (
    select 1
    from jsonb_array_elements(p_statements) row
    where not exists (
      select 1 from public.credit_card_statements s
      where s.user_id = v_user_id and s.account_id = p_account_id
        and s.reference_label = row->>'statementKey'
        and s.card_id = v_card_id
    )
  ) then
    raise exception 'O conjunto de faturas não corresponde exatamente ao auditado.' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.credit_card_entries e
    where e.user_id = v_user_id and e.account_id = p_account_id
      and (e.transaction_id is null or not exists (
        select 1 from jsonb_array_elements(p_entries) row
        where (row->>'transactionId')::uuid = e.transaction_id
      ))
  ) or exists (
    select 1
    from jsonb_array_elements(p_entries) row
    where not exists (
      select 1
      from public.credit_card_entries e
      join public.transactions t on t."ID_Transacao" = e.transaction_id
      where e.user_id = v_user_id and e.account_id = p_account_id
        and e.card_id = v_card_id
        and e.transaction_id = (row->>'transactionId')::uuid
        and t.user_id = v_user_id and t."ID_Conta" = p_account_id
    ) or not exists (
      select 1 from jsonb_array_elements(p_statements) statement_row
      where statement_row->>'statementKey' = row->>'statementKey'
    )
  ) then
    raise exception 'O conjunto de itens não corresponde exatamente ao auditado.' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.credit_card_payments p
    join public.credit_card_statements s on s.id = p.statement_id
    where p.user_id = v_user_id and s.account_id = p_account_id
      and (p.payment_transaction_id is null or not exists (
        select 1 from jsonb_array_elements(p_payments) row
        where (row->>'transactionId')::uuid = p.payment_transaction_id
      ))
  ) or exists (
    select 1
    from jsonb_array_elements(p_payments) row
    where not exists (
      select 1
      from public.credit_card_payments p
      join public.credit_card_statements s on s.id = p.statement_id
      where p.user_id = v_user_id and s.account_id = p_account_id
        and p.card_id = v_card_id
        and p.payment_transaction_id = (row->>'transactionId')::uuid
    ) or not exists (
      select 1 from jsonb_array_elements(p_statements) statement_row
      where statement_row->>'statementKey' = row->>'statementKey'
    )
  ) then
    raise exception 'O conjunto de pagamentos não corresponde exatamente ao auditado.' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'statements', coalesce((
      select jsonb_agg(to_jsonb(snapshot_row) order by snapshot_row.id)
      from (
        select s.id, s.purchase_reference_label, s.due_year, s.due_month,
          s.due_date, s.total_purchases, s.total_fees, s.total_interest,
          s.total_refunds, s.statement_total, s.total_payments, s.open_balance,
          s.total_charges, s.total_credits, s.open_amount, s.status,
          s.lines_computed_total, s.atomic_projection_version,
          s.atomic_projection_checksum, s.atomic_projection_snapshot_id
        from public.credit_card_statements s
        where s.user_id = v_user_id and s.account_id = p_account_id
      ) snapshot_row
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(to_jsonb(snapshot_row) order by snapshot_row.id)
      from (
        select e.id, e.statement_id, e.posted_date, e.amount, e.abs_amount,
          e.direction, e.entry_type
        from public.credit_card_entries e
        where e.user_id = v_user_id and e.account_id = p_account_id
      ) snapshot_row
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(to_jsonb(snapshot_row) order by snapshot_row.id)
      from (
        select p.id, p.statement_id, p.payment_date, p.amount, p.source
        from public.credit_card_payments p
        join public.credit_card_statements s on s.id = p.statement_id
        where p.user_id = v_user_id and s.account_id = p_account_id
      ) snapshot_row
    ), '[]'::jsonb)
  ) into v_before_state;

  insert into public.credit_card_atomic_rebuild_snapshots (
    user_id, account_id, card_id, shadow_checksum, before_revision, before_state
  ) values (
    v_user_id, p_account_id, v_card_id, p_shadow_checksum, v_current_revision, v_before_state
  ) returning id into v_snapshot_id;

  with desired as (
    select *
    from jsonb_to_recordset(p_entries) as x(
      "transactionId" uuid,
      "statementKey" text,
      "postedDate" date,
      "amountCents" bigint,
      "entryType" text
    )
  ), targets as (
    select desired.*, s.id as target_statement_id
    from desired
    join public.credit_card_statements s
      on s.user_id = v_user_id
     and s.account_id = p_account_id
     and s.reference_label = desired."statementKey"
  )
  update public.credit_card_entries e
  set statement_id = targets.target_statement_id,
      posted_date = targets."postedDate",
      amount = targets."amountCents"::numeric / 100,
      abs_amount = abs(targets."amountCents"::numeric / 100),
      direction = case when targets."amountCents" >= 0 then 'credit' else 'debit' end,
      entry_type = targets."entryType"
  from targets
  where e.user_id = v_user_id
    and e.account_id = p_account_id
    and e.transaction_id = targets."transactionId";

  with desired as (
    select *
    from jsonb_to_recordset(p_payments) as x(
      "transactionId" uuid,
      "statementKey" text,
      "paymentDate" date,
      "amountCents" bigint,
      "source" text
    )
  ), targets as (
    select desired.*, s.id as target_statement_id
    from desired
    join public.credit_card_statements s
      on s.user_id = v_user_id
     and s.account_id = p_account_id
     and s.reference_label = desired."statementKey"
  )
  update public.credit_card_payments p
  set statement_id = targets.target_statement_id,
      payment_date = targets."paymentDate",
      amount = targets."amountCents"::numeric / 100,
      source = targets."source"
  from targets
  where p.user_id = v_user_id
    and p.card_id = v_card_id
    and p.payment_transaction_id = targets."transactionId";

  with desired as (
    select *
    from jsonb_to_recordset(p_statements) as x(
      "statementKey" text,
      "purchaseReferenceMonth" text,
      "dueDate" date,
      "dueYear" integer,
      "dueMonth" integer,
      "status" text,
      "totalPurchasesCents" bigint,
      "totalFeesCents" bigint,
      "totalInterestCents" bigint,
      "totalRefundsCents" bigint,
      "statementTotalCents" bigint,
      "totalPaymentsCents" bigint,
      "openBalanceCents" bigint
    )
  )
  update public.credit_card_statements s
  set purchase_reference_label = desired."purchaseReferenceMonth",
      due_year = desired."dueYear",
      due_month = desired."dueMonth",
      due_date = desired."dueDate",
      total_purchases = desired."totalPurchasesCents"::numeric / 100,
      total_fees = desired."totalFeesCents"::numeric / 100,
      total_interest = desired."totalInterestCents"::numeric / 100,
      total_refunds = desired."totalRefundsCents"::numeric / 100,
      statement_total = desired."statementTotalCents"::numeric / 100,
      total_payments = desired."totalPaymentsCents"::numeric / 100,
      open_balance = desired."openBalanceCents"::numeric / 100,
      total_charges = (
        desired."totalPurchasesCents" + desired."totalFeesCents" + desired."totalInterestCents"
      )::numeric / 100,
      total_credits = desired."totalRefundsCents"::numeric / 100,
      open_amount = desired."openBalanceCents"::numeric / 100,
      status = desired."status",
      lines_computed_total = desired."statementTotalCents"::numeric / 100,
      atomic_projection_version = 1,
      atomic_projection_checksum = p_shadow_checksum,
      atomic_projection_snapshot_id = v_snapshot_id
  from desired
  where s.user_id = v_user_id
    and s.account_id = p_account_id
    and s.reference_label = desired."statementKey";

  v_after_revision := public.get_credit_card_projection_revision(p_account_id);

  update public.credit_card_atomic_rebuild_snapshots
  set after_revision = v_after_revision
  where id = v_snapshot_id and user_id = v_user_id;

  return jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'shadow_checksum', p_shadow_checksum,
    'before_revision', v_current_revision,
    'after_revision', v_after_revision,
    'statements_updated', v_statement_count,
    'entries_updated', v_entry_count,
    'payments_updated', v_payment_count
  );
end;
$$;

revoke all on function public.activate_credit_card_projection_atomic(uuid, text, text, jsonb, jsonb, jsonb) from public;
grant execute on function public.activate_credit_card_projection_atomic(uuid, text, text, jsonb, jsonb, jsonb) to authenticated;

create or replace function public.rollback_credit_card_projection_atomic(p_snapshot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_snapshot public.credit_card_atomic_rebuild_snapshots%rowtype;
  v_current_revision text;
  v_restored_revision text;
begin
  if v_user_id is null then
    raise exception 'Autenticação obrigatória.' using errcode = '28000';
  end if;

  select * into v_snapshot
  from public.credit_card_atomic_rebuild_snapshots
  where id = p_snapshot_id and user_id = v_user_id
  for update;

  if v_snapshot.id is null then
    raise exception 'Snapshot de rollback não encontrado.' using errcode = '42501';
  end if;
  if v_snapshot.rolled_back_at is not null then
    raise exception 'Este snapshot já foi revertido.' using errcode = 'P0001';
  end if;
  if v_snapshot.after_revision is null then
    raise exception 'Snapshot sem confirmação de aplicação.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_snapshot.account_id::text, 202602));
  v_current_revision := public.get_credit_card_projection_revision(v_snapshot.account_id);
  if v_current_revision <> v_snapshot.after_revision then
    raise exception 'A projeção mudou depois da ativação. Rollback automático recusado para não apagar alterações posteriores.'
      using errcode = '40001';
  end if;

  with previous as (
    select *
    from jsonb_to_recordset(v_snapshot.before_state->'entries') as x(
      id uuid, statement_id uuid, posted_date date, amount numeric,
      abs_amount numeric, direction text, entry_type text
    )
  )
  update public.credit_card_entries e
  set statement_id = previous.statement_id,
      posted_date = previous.posted_date,
      amount = previous.amount,
      abs_amount = previous.abs_amount,
      direction = previous.direction,
      entry_type = previous.entry_type
  from previous
  where e.id = previous.id
    and e.user_id = v_user_id
    and e.account_id = v_snapshot.account_id;

  with previous as (
    select *
    from jsonb_to_recordset(v_snapshot.before_state->'payments') as x(
      id uuid, statement_id uuid, payment_date date, amount numeric, source text
    )
  )
  update public.credit_card_payments p
  set statement_id = previous.statement_id,
      payment_date = previous.payment_date,
      amount = previous.amount,
      source = previous.source
  from previous
  where p.id = previous.id
    and p.user_id = v_user_id;

  with previous as (
    select *
    from jsonb_to_recordset(v_snapshot.before_state->'statements') as x(
      id uuid,
      purchase_reference_label text,
      due_year integer,
      due_month integer,
      due_date date,
      total_purchases numeric,
      total_fees numeric,
      total_interest numeric,
      total_refunds numeric,
      statement_total numeric,
      total_payments numeric,
      open_balance numeric,
      total_charges numeric,
      total_credits numeric,
      open_amount numeric,
      status text,
      lines_computed_total numeric,
      atomic_projection_version smallint,
      atomic_projection_checksum text,
      atomic_projection_snapshot_id uuid
    )
  )
  update public.credit_card_statements s
  set purchase_reference_label = previous.purchase_reference_label,
      due_year = previous.due_year,
      due_month = previous.due_month,
      due_date = previous.due_date,
      total_purchases = previous.total_purchases,
      total_fees = previous.total_fees,
      total_interest = previous.total_interest,
      total_refunds = previous.total_refunds,
      statement_total = previous.statement_total,
      total_payments = previous.total_payments,
      open_balance = previous.open_balance,
      total_charges = previous.total_charges,
      total_credits = previous.total_credits,
      open_amount = previous.open_amount,
      status = previous.status,
      lines_computed_total = previous.lines_computed_total,
      atomic_projection_version = previous.atomic_projection_version,
      atomic_projection_checksum = previous.atomic_projection_checksum,
      atomic_projection_snapshot_id = previous.atomic_projection_snapshot_id
  from previous
  where s.id = previous.id
    and s.user_id = v_user_id
    and s.account_id = v_snapshot.account_id;

  v_restored_revision := public.get_credit_card_projection_revision(v_snapshot.account_id);
  if v_restored_revision <> v_snapshot.before_revision then
    raise exception 'A restauração não reproduziu a revisão original. Toda a transação foi cancelada.'
      using errcode = 'P0001';
  end if;

  update public.credit_card_atomic_rebuild_snapshots
  set rolled_back_at = now(), rollback_revision = v_restored_revision
  where id = p_snapshot_id and user_id = v_user_id;

  return jsonb_build_object(
    'snapshot_id', p_snapshot_id,
    'account_id', v_snapshot.account_id,
    'restored_revision', v_restored_revision,
    'rolled_back', true
  );
end;
$$;

revoke all on function public.rollback_credit_card_projection_atomic(uuid) from public;
grant execute on function public.rollback_credit_card_projection_atomic(uuid) to authenticated;
