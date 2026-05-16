-- ============================================================================
-- MIGRATION 046: Credit Card V2 Core Tables
-- ============================================================================

-- Ensure helper function for updated_at exists
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 1) Statements (one row per card cycle/reference)
create table if not exists public.credit_card_statements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  account_id uuid references public.contas(id) on delete cascade not null,
  reference_label text not null, -- ex: 2026-05
  close_date date,
  due_date date,
  total_charges numeric(15,2) not null default 0,
  total_credits numeric(15,2) not null default 0,
  total_payments numeric(15,2) not null default 0,
  open_amount numeric(15,2) not null default 0,
  source_origin text,
  status text not null default 'open'
    check (status in ('open', 'closed', 'paid', 'partial')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, account_id, reference_label)
);

create index if not exists idx_cc_statements_account_due
  on public.credit_card_statements (account_id, due_date desc);

create index if not exists idx_cc_statements_user_status
  on public.credit_card_statements (user_id, status);

drop trigger if exists trg_cc_statements_updated_at on public.credit_card_statements;
create trigger trg_cc_statements_updated_at
before update on public.credit_card_statements
for each row execute procedure public.handle_updated_at();

-- 2) Statement items (charges/refunds/payments tied to a statement)
create table if not exists public.credit_card_statement_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  account_id uuid references public.contas(id) on delete cascade not null,
  statement_id uuid references public.credit_card_statements(id) on delete cascade not null,
  transaction_id uuid references public.transactions("ID_Transacao") on delete set null,
  item_type text not null check (item_type in ('charge', 'refund', 'payment')),
  amount numeric(15,2) not null default 0,
  posted_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id)
);

create index if not exists idx_cc_statement_items_statement
  on public.credit_card_statement_items (statement_id);

create index if not exists idx_cc_statement_items_user_account
  on public.credit_card_statement_items (user_id, account_id);

drop trigger if exists trg_cc_statement_items_updated_at on public.credit_card_statement_items;
create trigger trg_cc_statement_items_updated_at
before update on public.credit_card_statement_items
for each row execute procedure public.handle_updated_at();

-- 3) Reprocess jobs (auditability for rebuild operations)
create table if not exists public.credit_card_reprocess_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  account_id uuid references public.contas(id) on delete cascade not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'success', 'failed')),
  summary_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cc_reprocess_jobs_user_account
  on public.credit_card_reprocess_jobs (user_id, account_id, started_at desc);

drop trigger if exists trg_cc_reprocess_jobs_updated_at on public.credit_card_reprocess_jobs;
create trigger trg_cc_reprocess_jobs_updated_at
before update on public.credit_card_reprocess_jobs
for each row execute procedure public.handle_updated_at();

-- 4) RLS
alter table public.credit_card_statements enable row level security;
alter table public.credit_card_statement_items enable row level security;
alter table public.credit_card_reprocess_jobs enable row level security;

-- statements policies
drop policy if exists "Users can view own credit card statements" on public.credit_card_statements;
create policy "Users can view own credit card statements"
  on public.credit_card_statements for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own credit card statements" on public.credit_card_statements;
create policy "Users can insert own credit card statements"
  on public.credit_card_statements for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own credit card statements" on public.credit_card_statements;
create policy "Users can update own credit card statements"
  on public.credit_card_statements for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own credit card statements" on public.credit_card_statements;
create policy "Users can delete own credit card statements"
  on public.credit_card_statements for delete
  using (auth.uid() = user_id);

-- statement items policies
drop policy if exists "Users can view own credit card statement items" on public.credit_card_statement_items;
create policy "Users can view own credit card statement items"
  on public.credit_card_statement_items for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own credit card statement items" on public.credit_card_statement_items;
create policy "Users can insert own credit card statement items"
  on public.credit_card_statement_items for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own credit card statement items" on public.credit_card_statement_items;
create policy "Users can update own credit card statement items"
  on public.credit_card_statement_items for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own credit card statement items" on public.credit_card_statement_items;
create policy "Users can delete own credit card statement items"
  on public.credit_card_statement_items for delete
  using (auth.uid() = user_id);

-- reprocess jobs policies
drop policy if exists "Users can view own credit card reprocess jobs" on public.credit_card_reprocess_jobs;
create policy "Users can view own credit card reprocess jobs"
  on public.credit_card_reprocess_jobs for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own credit card reprocess jobs" on public.credit_card_reprocess_jobs;
create policy "Users can insert own credit card reprocess jobs"
  on public.credit_card_reprocess_jobs for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own credit card reprocess jobs" on public.credit_card_reprocess_jobs;
create policy "Users can update own credit card reprocess jobs"
  on public.credit_card_reprocess_jobs for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own credit card reprocess jobs" on public.credit_card_reprocess_jobs;
create policy "Users can delete own credit card reprocess jobs"
  on public.credit_card_reprocess_jobs for delete
  using (auth.uid() = user_id);
