-- Sprint 1A — guardrails aditivos de integridade.
-- Não corrige, remove ou reclassifica nenhum dado histórico.

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  account_id uuid references public.contas(id) on delete set null,
  file_name text not null,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  import_log_id uuid references public.import_logs(id) on delete cascade,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, fingerprint)
);

alter table public.import_batches enable row level security;

drop policy if exists "Users can view their own import batches" on public.import_batches;
create policy "Users can view their own import batches"
  on public.import_batches for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own import batches" on public.import_batches;
create policy "Users can insert their own import batches"
  on public.import_batches for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own import batches" on public.import_batches;
create policy "Users can update their own import batches"
  on public.import_batches for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own import batches" on public.import_batches;
create policy "Users can delete their own import batches"
  on public.import_batches for delete
  using (auth.uid() = user_id);

create or replace function public.import_transactions_atomic(
  p_fingerprint text,
  p_file_name text,
  p_account_id uuid,
  p_transactions jsonb,
  p_total_transactions integer,
  p_ignored_details jsonb default '[]'::jsonb,
  p_detail_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch_id uuid;
  v_log_id uuid;
  v_inserted jsonb := '[]'::jsonb;
  v_imported_details jsonb := '[]'::jsonb;
  v_log jsonb;
begin
  if v_user_id is null then
    raise exception 'Autenticação obrigatória para importar transações.' using errcode = '28000';
  end if;
  if p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Fingerprint de importação inválido.' using errcode = '22023';
  end if;
  if p_file_name is null or length(trim(p_file_name)) = 0 or length(p_file_name) > 255 then
    raise exception 'Nome de arquivo inválido.' using errcode = '22023';
  end if;
  if p_transactions is null or jsonb_typeof(p_transactions) <> 'array' then
    raise exception 'A lista de transações deve ser um array JSON.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_transactions) > 10000 then
    raise exception 'O lote excede o limite seguro de 10.000 transações.' using errcode = '54000';
  end if;
  if p_ignored_details is null or jsonb_typeof(p_ignored_details) <> 'array' then
    raise exception 'A lista de itens ignorados deve ser um array JSON.' using errcode = '22023';
  end if;
  if p_total_transactions < jsonb_array_length(p_transactions) then
    raise exception 'A contagem total é menor que a quantidade importada.' using errcode = '22023';
  end if;

  insert into public.import_batches (user_id, account_id, file_name, fingerprint)
  values (v_user_id, p_account_id, p_file_name, p_fingerprint)
  on conflict (user_id, fingerprint) do nothing
  returning id into v_batch_id;

  if v_batch_id is null then
    select b.id, b.import_log_id
      into v_batch_id, v_log_id
    from public.import_batches b
    where b.user_id = v_user_id
      and b.fingerprint = p_fingerprint;

    if v_log_id is null then
      raise exception 'Lote idempotente encontrado sem conclusão; nenhuma transação foi gravada.'
        using errcode = 'P0001';
    end if;

    select to_jsonb(l)
      into v_log
    from public.import_logs l
    where l.id = v_log_id
      and l.user_id = v_user_id;

    if v_log is null then
      raise exception 'Histórico do lote idempotente não foi encontrado; nenhuma transação foi gravada.'
        using errcode = 'P0001';
    end if;

    select coalesce(jsonb_agg(to_jsonb(t) order by t."ID_Transacao"), '[]'::jsonb)
      into v_inserted
    from public.transactions t
    join jsonb_array_elements(coalesce(v_log->'imported_details', '[]'::jsonb)) d
      on t."ID_Transacao"::text = d->>'ID_Transacao'
    where t.user_id = v_user_id;

    return jsonb_build_object(
      'duplicate', true,
      'batch_id', v_batch_id,
      'transactions', v_inserted,
      'import_log', v_log
    );
  end if;

  with input_rows as (
    select value, ordinality
    from jsonb_array_elements(p_transactions) with ordinality
  ), inserted as (
    insert into public.transactions (
      user_id,
      "Data",
      "Data_Pagamento",
      "Nome_Fantasia",
      "Parcela_Atual",
      "Total_Parcelas",
      "Categoria",
      "Fonte",
      "Valor",
      "Origem",
      "Descricao_Original",
      "Portador",
      "Tipo",
      "ID_Conta",
      pluggy_transaction_id,
      linked_asset_id
    )
    select
      v_user_id,
      (value->>'Data')::timestamptz,
      nullif(value->>'Data_Pagamento', '')::timestamptz,
      value->>'Nome_Fantasia',
      nullif(value->>'Parcela_Atual', '')::integer,
      nullif(value->>'Total_Parcelas', '')::integer,
      nullif(value->>'Categoria', ''),
      nullif(value->>'Fonte', ''),
      (value->>'Valor')::numeric,
      p_file_name,
      nullif(value->>'Descricao_Original', ''),
      nullif(value->>'Portador', ''),
      nullif(value->>'Tipo', ''),
      p_account_id,
      nullif(value->>'pluggy_transaction_id', ''),
      nullif(value->>'linked_asset_id', '')::uuid
    from input_rows
    order by ordinality
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(inserted) order by "ID_Transacao"), '[]'::jsonb)
    into v_inserted
  from inserted;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ID_Transacao', row->>'ID_Transacao',
        'Origem', row->>'Origem',
        'Data', row->'Data',
        'Descricao', row->>'Descricao_Original',
        'Nome_Fantasia', row->>'Nome_Fantasia',
        'Valor', row->'Valor',
        'Categoria', row->>'Categoria',
        'ID_Conta', row->>'ID_Conta',
        'Conta_Nome', p_detail_context->>'Conta_Nome',
        'Card_Cycle_Mode', p_detail_context->>'Card_Cycle_Mode',
        'Card_Reference_Label', p_detail_context->>'Card_Reference_Label',
        'Card_Due_Date', p_detail_context->>'Card_Due_Date'
      )
    ),
    '[]'::jsonb
  )
  into v_imported_details
  from jsonb_array_elements(v_inserted) row;

  insert into public.import_logs (
    user_id,
    file_name,
    total_transactions,
    imported_count,
    ignored_count,
    ignored_details,
    imported_details
  )
  values (
    v_user_id,
    p_file_name,
    p_total_transactions,
    jsonb_array_length(v_inserted),
    jsonb_array_length(p_ignored_details),
    p_ignored_details,
    v_imported_details
  )
  returning id into v_log_id;

  update public.import_batches
  set import_log_id = v_log_id,
      completed_at = now()
  where id = v_batch_id
    and user_id = v_user_id;

  select to_jsonb(l)
    into v_log
  from public.import_logs l
  where l.id = v_log_id;

  return jsonb_build_object(
    'duplicate', false,
    'batch_id', v_batch_id,
    'transactions', v_inserted,
    'import_log', v_log
  );
end;
$$;

revoke all on function public.import_transactions_atomic(text, text, uuid, jsonb, integer, jsonb, jsonb) from public;
grant execute on function public.import_transactions_atomic(text, text, uuid, jsonb, integer, jsonb, jsonb) to authenticated;

-- Índice não exclusivo: acelera a guarda sem tentar "consertar" duplicidades antigas.
create index if not exists idx_cc_entries_transaction_id_guard
  on public.credit_card_entries (transaction_id)
  where transaction_id is not null;

create or replace function public.prevent_new_credit_card_entry_transaction_duplicate()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.transaction_id is null then
    return new;
  end if;

  -- Serializa concorrência para o mesmo ID sem bloquear outros lançamentos.
  perform pg_advisory_xact_lock(hashtextextended(new.transaction_id::text, 0));

  if exists (
    select 1
    from public.credit_card_entries e
    where e.transaction_id = new.transaction_id
      and e.id <> new.id
  ) then
    raise exception 'A transação % já possui uma projeção no motor de cartão.', new.transaction_id
      using errcode = '23505', constraint = 'credit_card_entries_transaction_id_guard';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_new_cc_entry_transaction_duplicate on public.credit_card_entries;
create trigger trg_prevent_new_cc_entry_transaction_duplicate
before insert or update of transaction_id on public.credit_card_entries
for each row execute procedure public.prevent_new_credit_card_entry_transaction_duplicate();

-- Relatório agregado e somente leitura. Não retorna descrições, e-mails ou IDs.
create or replace function public.get_finelo_integrity_dry_run()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with duplicate_entries as (
    select transaction_id, count(*)::integer as copies
    from public.credit_card_entries
    where transaction_id is not null
    group by transaction_id
    having count(*) > 1
  )
  select jsonb_build_object(
    'transactions_total', (select count(*) from public.transactions),
    'transactions_without_account', (
      select count(*) from public.transactions where "ID_Conta" is null
    ),
    'transactions_on_opening_cutoff', (
      select count(*)
      from public.transactions t
      join public.contas c on c.id = t."ID_Conta"
      where t."Data"::date = c."Data_Saldo_Inicial"::date
    ),
    'duplicate_card_projection_transaction_ids', (
      select count(*) from duplicate_entries
    ),
    'excess_card_projection_rows', (
      select coalesce(sum(copies - 1), 0) from duplicate_entries
    ),
    'import_logs_without_current_origin_rows', (
      select count(*)
      from public.import_logs l
      where not exists (
        select 1 from public.transactions t where t."Origem" = l.file_name
      )
    ),
    'origin_groups_without_import_log', (
      select count(*)
      from (
        select t."Origem"
        from public.transactions t
        where coalesce(t."Origem", 'manual') <> 'manual'
        group by t."Origem"
        having not exists (
          select 1 from public.import_logs l where l.file_name = t."Origem"
        )
      ) missing_logs
    )
  );
$$;

revoke all on function public.get_finelo_integrity_dry_run() from public;
grant execute on function public.get_finelo_integrity_dry_run() to authenticated;
