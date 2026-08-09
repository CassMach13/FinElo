-- Sprint 2C: reparo estreito e reversivel de pagamentos materializados em duplicidade.
--
-- O RPC remove somente linhas antigas sem payment_transaction_id quando existe
-- exatamente uma linha canonica, vinculada a uma transacao, com o mesmo evento
-- economico e a mesma proveniencia (arquivo + linha). Toda remocao recebe um
-- snapshot proprio e pode ser desfeita enquanto a projecao nao mudar.

create table if not exists public.credit_card_atomic_repair_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  account_id uuid references public.contas(id) on delete cascade not null,
  card_id uuid references public.credit_cards(id) on delete cascade not null,
  repair_kind text not null check (repair_kind = 'duplicate_imported_payment'),
  before_revision text not null,
  after_revision text,
  deleted_rows jsonb not null,
  applied_at timestamptz not null default now(),
  rolled_back_at timestamptz,
  rollback_revision text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cc_atomic_repair_snapshots_account_applied
  on public.credit_card_atomic_repair_snapshots (account_id, applied_at desc);

alter table public.credit_card_atomic_repair_snapshots enable row level security;

drop policy if exists "Users can view own card repair snapshots"
  on public.credit_card_atomic_repair_snapshots;
create policy "Users can view own card repair snapshots"
  on public.credit_card_atomic_repair_snapshots for select
  using (auth.uid() = user_id);

revoke all on table public.credit_card_atomic_repair_snapshots from public;
revoke all on table public.credit_card_atomic_repair_snapshots from anon;
revoke all on table public.credit_card_atomic_repair_snapshots from authenticated;
grant select on table public.credit_card_atomic_repair_snapshots to authenticated;

comment on table public.credit_card_atomic_repair_snapshots is
  'Snapshot reversivel de linhas antigas removidas por um reparo deterministico da conciliacao do cartao.';

create or replace function public.repair_credit_card_payment_duplicates_atomic_v1(
  p_account_id uuid,
  p_expected_revision text,
  p_payment_row_ids uuid[]
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
  v_deleted_rows jsonb;
  v_requested_count integer;
  v_deleted_count integer;
begin
  if v_user_id is null then
    raise exception 'Autenticacao obrigatoria.' using errcode = '28000';
  end if;

  select case
    when u.raw_app_meta_data ->> 'atomic_card_rebuild_disabled' = 'true' then 'disabled'
    when u.raw_app_meta_data ->> 'atomic_card_rebuild_enabled' = 'true' then 'enabled'
    else 'unset'
  end into v_feature_state
  from auth.users u
  where u.id = v_user_id;
  if coalesce(v_feature_state, 'unset') <> 'enabled' then
    raise exception 'O reparo atomico de cartao nao esta habilitado para esta conta.'
      using errcode = '42501';
  end if;

  if p_expected_revision is null or p_expected_revision !~ '^[a-f0-9]{32}$' then
    raise exception 'Revisao esperada invalida.' using errcode = '22023';
  end if;

  v_requested_count := coalesce(cardinality(p_payment_row_ids), 0);
  if v_requested_count < 1 or v_requested_count > 50 then
    raise exception 'O reparo deve conter entre 1 e 50 linhas.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_payment_row_ids) row_id where row_id is null)
     or (select count(distinct row_id) from unnest(p_payment_row_ids) row_id) <> v_requested_count then
    raise exception 'O reparo contem identidades ausentes ou duplicadas.' using errcode = '22023';
  end if;

  select cc.id into v_card_id
  from public.credit_cards cc
  join public.contas c on c.id = cc.account_id
  where cc.account_id = p_account_id
    and cc.user_id = v_user_id
    and c.user_id = v_user_id
  for update of cc;
  if v_card_id is null then
    raise exception 'Cartao normalizado nao encontrado para esta conta.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_account_id::text, 202602));
  v_current_revision := public.get_credit_card_projection_revision(p_account_id);
  if v_current_revision <> p_expected_revision then
    raise exception 'A projecao mudou depois da auditoria. Audite novamente; nenhuma linha foi alterada.'
      using errcode = '40001';
  end if;

  -- Toda candidata deve ser uma linha importada antiga, sem identidade, desta conta.
  if (
    select count(*)
    from public.credit_card_payments obsolete
    join public.credit_card_statements statement on statement.id = obsolete.statement_id
    where obsolete.id = any(p_payment_row_ids)
      and obsolete.user_id = v_user_id
      and obsolete.card_id = v_card_id
      and statement.user_id = v_user_id
      and statement.account_id = p_account_id
      and obsolete.payment_transaction_id is null
      and obsolete.source = 'imported_statement'
  ) <> v_requested_count then
    raise exception 'Uma ou mais linhas deixaram de ser candidatas seguras. Nenhuma linha foi alterada.'
      using errcode = 'P0001';
  end if;

  -- Para cada candidata deve existir exatamente uma linha canonica ligada a uma
  -- transacao invoice_payment, com o mesmo valor/data/fatura e a mesma cauda de
  -- proveniencia. O hash inicial pode diferir entre materializacoes historicas.
  if exists (
    select 1
    from public.credit_card_payments obsolete
    where obsolete.id = any(p_payment_row_ids)
      and (
        select count(*)
        from public.credit_card_payments canonical
        join public.credit_card_entries entry
          on entry.transaction_id = canonical.payment_transaction_id
         and entry.user_id = v_user_id
         and entry.account_id = p_account_id
         and entry.entry_type = 'invoice_payment'
        where canonical.user_id = v_user_id
          and canonical.card_id = v_card_id
          and canonical.id <> obsolete.id
          and canonical.payment_transaction_id is not null
          and canonical.statement_id = obsolete.statement_id
          and canonical.payment_date = obsolete.payment_date
          and canonical.amount = obsolete.amount
          and canonical.source = obsolete.source
          and regexp_replace(coalesce(canonical.notes, ''), '^[^·]*·\s*', '') <> ''
          and regexp_replace(coalesce(canonical.notes, ''), '^[^·]*·\s*', '') =
              regexp_replace(coalesce(obsolete.notes, ''), '^[^·]*·\s*', '')
      ) <> 1
  ) then
    raise exception 'A contraparte canonica e sua proveniencia nao sao inequivocas. Nenhuma linha foi alterada.'
      using errcode = 'P0001';
  end if;

  perform 1
  from public.credit_card_payments obsolete
  where obsolete.id = any(p_payment_row_ids)
    and obsolete.user_id = v_user_id
  for update;

  select coalesce(jsonb_agg(to_jsonb(obsolete) order by obsolete.id), '[]'::jsonb)
  into v_deleted_rows
  from public.credit_card_payments obsolete
  where obsolete.id = any(p_payment_row_ids)
    and obsolete.user_id = v_user_id;

  if jsonb_array_length(v_deleted_rows) <> v_requested_count then
    raise exception 'A leitura bloqueada do reparo ficou incompleta. Nenhuma linha foi alterada.'
      using errcode = '40001';
  end if;

  insert into public.credit_card_atomic_repair_snapshots (
    user_id, account_id, card_id, repair_kind, before_revision, deleted_rows
  ) values (
    v_user_id, p_account_id, v_card_id, 'duplicate_imported_payment',
    v_current_revision, v_deleted_rows
  ) returning id into v_snapshot_id;

  delete from public.credit_card_payments obsolete
  where obsolete.id = any(p_payment_row_ids)
    and obsolete.user_id = v_user_id
    and obsolete.card_id = v_card_id;
  get diagnostics v_deleted_count = row_count;
  if v_deleted_count <> v_requested_count then
    raise exception 'O banco recusou um reparo parcial.' using errcode = '40001';
  end if;

  v_after_revision := public.get_credit_card_projection_revision(p_account_id);
  update public.credit_card_atomic_repair_snapshots
  set after_revision = v_after_revision
  where id = v_snapshot_id and user_id = v_user_id;

  return jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'before_revision', v_current_revision,
    'after_revision', v_after_revision,
    'deleted_payments', v_deleted_count
  );
end;
$$;

revoke all on function public.repair_credit_card_payment_duplicates_atomic_v1(uuid, text, uuid[]) from public;
revoke all on function public.repair_credit_card_payment_duplicates_atomic_v1(uuid, text, uuid[]) from anon;
grant execute on function public.repair_credit_card_payment_duplicates_atomic_v1(uuid, text, uuid[]) to authenticated;

create or replace function public.rollback_credit_card_payment_repair_atomic_v1(
  p_snapshot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_snapshot public.credit_card_atomic_repair_snapshots%rowtype;
  v_current_revision text;
  v_restored_revision text;
  v_restored_count integer;
begin
  if v_user_id is null then
    raise exception 'Autenticacao obrigatoria.' using errcode = '28000';
  end if;

  select * into v_snapshot
  from public.credit_card_atomic_repair_snapshots
  where id = p_snapshot_id and user_id = v_user_id
  for update;
  if v_snapshot.id is null then
    raise exception 'Snapshot de reparo nao encontrado.' using errcode = '42501';
  end if;
  if v_snapshot.rolled_back_at is not null then
    raise exception 'Este reparo ja foi desfeito.' using errcode = 'P0001';
  end if;
  if v_snapshot.after_revision is null then
    raise exception 'Snapshot sem confirmacao de aplicacao.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_snapshot.account_id::text, 202602));
  v_current_revision := public.get_credit_card_projection_revision(v_snapshot.account_id);
  if v_current_revision <> v_snapshot.after_revision then
    raise exception 'A projecao mudou depois do reparo. Rollback automatico recusado para proteger alteracoes posteriores.'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_snapshot.deleted_rows) as old(id uuid)
    join public.credit_card_payments current on current.id = old.id
  ) then
    raise exception 'Uma linha do snapshot ja existe. Nenhuma linha foi restaurada.' using errcode = 'P0001';
  end if;

  insert into public.credit_card_payments (
    id, user_id, card_id, statement_id, payment_account_id,
    payment_transaction_id, payment_date, amount, source, notes,
    created_at, updated_at
  )
  select
    old.id, old.user_id, old.card_id, old.statement_id, old.payment_account_id,
    old.payment_transaction_id, old.payment_date, old.amount, old.source,
    old.notes, old.created_at, old.updated_at
  from jsonb_to_recordset(v_snapshot.deleted_rows) as old(
    id uuid,
    user_id uuid,
    card_id uuid,
    statement_id uuid,
    payment_account_id uuid,
    payment_transaction_id uuid,
    payment_date date,
    amount numeric,
    source text,
    notes text,
    created_at timestamptz,
    updated_at timestamptz
  )
  join public.credit_card_statements statement on statement.id = old.statement_id
  where old.user_id = v_user_id
    and old.card_id = v_snapshot.card_id
    and statement.user_id = v_user_id
    and statement.account_id = v_snapshot.account_id;
  get diagnostics v_restored_count = row_count;

  if v_restored_count <> jsonb_array_length(v_snapshot.deleted_rows) then
    raise exception 'O banco recusou um rollback parcial.' using errcode = '40001';
  end if;

  v_restored_revision := public.get_credit_card_projection_revision(v_snapshot.account_id);
  update public.credit_card_atomic_repair_snapshots
  set rolled_back_at = now(), rollback_revision = v_restored_revision
  where id = v_snapshot.id and user_id = v_user_id;

  return jsonb_build_object(
    'snapshot_id', v_snapshot.id,
    'account_id', v_snapshot.account_id,
    'restored_revision', v_restored_revision,
    'restored_payments', v_restored_count,
    'rolled_back', true
  );
end;
$$;

revoke all on function public.rollback_credit_card_payment_repair_atomic_v1(uuid) from public;
revoke all on function public.rollback_credit_card_payment_repair_atomic_v1(uuid) from anon;
grant execute on function public.rollback_credit_card_payment_repair_atomic_v1(uuid) to authenticated;
