-- ============================================================================
-- MIGRATION 047: Credit Card Engine Normalized Model
-- ============================================================================

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 1) Credit cards (1:1 with contas when Tipo_Conta = Cartao de Credito)
create table if not exists public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  account_id uuid references public.contas(id) on delete cascade not null unique,
  name text not null,
  holder_name text,
  issuer text,
  limit_amount numeric(15,2) not null default 0,
  closing_day int not null check (closing_day between 1 and 31),
  due_day int not null check (due_day between 1 and 31),
  linked_payment_account_id uuid references public.contas(id) on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_credit_cards_user_archived
  on public.credit_cards (user_id, archived);

drop trigger if exists trg_credit_cards_updated_at on public.credit_cards;
create trigger trg_credit_cards_updated_at
before update on public.credit_cards
for each row execute procedure public.handle_updated_at();

-- 2) Import lots
create table if not exists public.credit_card_import_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  card_id uuid references public.credit_cards(id) on delete cascade not null,
  account_id uuid references public.contas(id) on delete cascade not null,
  source_file_name text not null,
  source_file_path text,
  imported_at timestamptz not null default now(),
  statement_due_year int not null check (statement_due_year between 2000 and 2200),
  statement_due_month int not null check (statement_due_month between 1 and 12),
  statement_due_date date,
  purchase_reference_label text,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'confirmed', 'reprocessed', 'error')),
  raw_row_count int not null default 0,
  imported_row_count int not null default 0,
  ignored_row_count int not null default 0,
  checksum text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (card_id, source_file_name, checksum)
);

create index if not exists idx_cc_import_lots_card_due
  on public.credit_card_import_lots (card_id, statement_due_year desc, statement_due_month desc);

create index if not exists idx_cc_import_lots_user_status
  on public.credit_card_import_lots (user_id, status);

drop trigger if exists trg_cc_import_lots_updated_at on public.credit_card_import_lots;
create trigger trg_cc_import_lots_updated_at
before update on public.credit_card_import_lots
for each row execute procedure public.handle_updated_at();

-- 3) Entries (normalized imported rows)
create table if not exists public.credit_card_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  card_id uuid references public.credit_cards(id) on delete cascade not null,
  account_id uuid references public.contas(id) on delete cascade not null,
  import_lot_id uuid references public.credit_card_import_lots(id) on delete cascade not null,
  source_file_name text not null,
  source_row_index int not null,
  source_row_hash text not null,
  transaction_id uuid references public.transactions("ID_Transacao") on delete set null,
  posted_date date,
  description_raw text not null default '',
  description_normalized text not null default '',
  merchant_name text,
  holder_name text,
  amount numeric(15,2) not null default 0,
  abs_amount numeric(15,2) not null default 0,
  direction text not null check (direction in ('debit', 'credit')),
  entry_type text not null default 'needs_review'
    check (entry_type in (
      'purchase', 'installment_purchase', 'refund', 'invoice_payment',
      'fee', 'interest', 'adjustment', 'ignored', 'needs_review'
    )),
  installment_current int,
  installment_total int,
  category_id uuid references public.categories(id) on delete set null,
  classification_source text not null default 'system'
    check (classification_source in ('import_rule', 'user', 'system', 'reprocess')),
  classification_confidence numeric(5,2) not null default 0,
  statement_id uuid references public.credit_card_statements(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (card_id, source_file_name, source_row_hash)
);

create index if not exists idx_cc_entries_statement on public.credit_card_entries (statement_id);
create index if not exists idx_cc_entries_lot on public.credit_card_entries (import_lot_id);
create index if not exists idx_cc_entries_card_type on public.credit_card_entries (card_id, entry_type);

drop trigger if exists trg_cc_entries_updated_at on public.credit_card_entries;
create trigger trg_cc_entries_updated_at
before update on public.credit_card_entries
for each row execute procedure public.handle_updated_at();

-- 4) Expand existing statement table for deterministic model
alter table public.credit_card_statements
  add column if not exists card_id uuid references public.credit_cards(id) on delete cascade,
  add column if not exists purchase_reference_label text,
  add column if not exists due_year int,
  add column if not exists due_month int,
  add column if not exists closing_date date,
  add column if not exists source_import_lot_ids jsonb not null default '[]'::jsonb,
  add column if not exists total_purchases numeric(15,2) not null default 0,
  add column if not exists total_fees numeric(15,2) not null default 0,
  add column if not exists total_interest numeric(15,2) not null default 0,
  add column if not exists total_refunds numeric(15,2) not null default 0,
  add column if not exists statement_total numeric(15,2) not null default 0,
  add column if not exists open_balance numeric(15,2) not null default 0;

alter table public.credit_card_statements
  drop constraint if exists credit_card_statements_status_check;
alter table public.credit_card_statements
  add constraint credit_card_statements_status_check
  check (status in ('open', 'closed', 'paid', 'partial', 'overdue'));

create index if not exists idx_cc_statements_card_due
  on public.credit_card_statements (card_id, due_year desc, due_month desc);

-- 5) Expand statement items bridge
alter table public.credit_card_statement_items
  add column if not exists entry_id uuid references public.credit_card_entries(id) on delete cascade;

create unique index if not exists idx_cc_statement_items_unique_entry
  on public.credit_card_statement_items (entry_id)
  where entry_id is not null;

-- 6) Payments (separated concept)
create table if not exists public.credit_card_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  card_id uuid references public.credit_cards(id) on delete cascade not null,
  statement_id uuid references public.credit_card_statements(id) on delete cascade not null,
  payment_account_id uuid references public.contas(id) on delete set null,
  payment_transaction_id uuid references public.transactions("ID_Transacao") on delete set null,
  payment_date date not null,
  amount numeric(15,2) not null default 0 check (amount >= 0),
  source text not null default 'manual'
    check (source in ('manual', 'imported_statement', 'bank_account_import')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cc_payments_statement
  on public.credit_card_payments (statement_id, payment_date desc);

drop trigger if exists trg_cc_payments_updated_at on public.credit_card_payments;
create trigger trg_cc_payments_updated_at
before update on public.credit_card_payments
for each row execute procedure public.handle_updated_at();

-- 7) RLS
alter table public.credit_cards enable row level security;
alter table public.credit_card_import_lots enable row level security;
alter table public.credit_card_entries enable row level security;
alter table public.credit_card_payments enable row level security;

drop policy if exists "Users can view own credit cards" on public.credit_cards;
create policy "Users can view own credit cards"
  on public.credit_cards for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own credit cards" on public.credit_cards;
create policy "Users can insert own credit cards"
  on public.credit_cards for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own credit cards" on public.credit_cards;
create policy "Users can update own credit cards"
  on public.credit_cards for update using (auth.uid() = user_id);
drop policy if exists "Users can delete own credit cards" on public.credit_cards;
create policy "Users can delete own credit cards"
  on public.credit_cards for delete using (auth.uid() = user_id);

drop policy if exists "Users can view own credit card import lots" on public.credit_card_import_lots;
create policy "Users can view own credit card import lots"
  on public.credit_card_import_lots for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own credit card import lots" on public.credit_card_import_lots;
create policy "Users can insert own credit card import lots"
  on public.credit_card_import_lots for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own credit card import lots" on public.credit_card_import_lots;
create policy "Users can update own credit card import lots"
  on public.credit_card_import_lots for update using (auth.uid() = user_id);
drop policy if exists "Users can delete own credit card import lots" on public.credit_card_import_lots;
create policy "Users can delete own credit card import lots"
  on public.credit_card_import_lots for delete using (auth.uid() = user_id);

drop policy if exists "Users can view own credit card entries" on public.credit_card_entries;
create policy "Users can view own credit card entries"
  on public.credit_card_entries for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own credit card entries" on public.credit_card_entries;
create policy "Users can insert own credit card entries"
  on public.credit_card_entries for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own credit card entries" on public.credit_card_entries;
create policy "Users can update own credit card entries"
  on public.credit_card_entries for update using (auth.uid() = user_id);
drop policy if exists "Users can delete own credit card entries" on public.credit_card_entries;
create policy "Users can delete own credit card entries"
  on public.credit_card_entries for delete using (auth.uid() = user_id);

drop policy if exists "Users can view own credit card payments" on public.credit_card_payments;
create policy "Users can view own credit card payments"
  on public.credit_card_payments for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own credit card payments" on public.credit_card_payments;
create policy "Users can insert own credit card payments"
  on public.credit_card_payments for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own credit card payments" on public.credit_card_payments;
create policy "Users can update own credit card payments"
  on public.credit_card_payments for update using (auth.uid() = user_id);
drop policy if exists "Users can delete own credit card payments" on public.credit_card_payments;
create policy "Users can delete own credit card payments"
  on public.credit_card_payments for delete using (auth.uid() = user_id);
