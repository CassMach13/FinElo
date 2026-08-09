\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end;
$$;

create table auth.users (
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb not null default '{}'::jsonb
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.contas (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  "Nome_Conta" text not null,
  "Tipo_Conta" text not null
);

create table public.categories (
  id uuid primary key
);

create table public.transactions (
  "ID_Transacao" uuid primary key,
  user_id uuid not null references auth.users(id),
  "ID_Conta" uuid references public.contas(id),
  "Data" timestamptz not null,
  "Valor" numeric not null
);

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.credit_cards (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  account_id uuid not null unique references public.contas(id),
  name text not null,
  closing_day integer not null,
  due_day integer not null
);

create table public.credit_card_import_lots (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  card_id uuid not null references public.credit_cards(id),
  account_id uuid not null references public.contas(id),
  source_file_name text not null,
  statement_due_year integer not null,
  statement_due_month integer not null,
  statement_due_date date,
  purchase_reference_label text,
  statement_total_from_file numeric(15,2),
  total_payments_from_file numeric(15,2),
  lines_computed_total numeric(15,2)
);

create table public.credit_card_statements (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  card_id uuid references public.credit_cards(id),
  account_id uuid not null references public.contas(id),
  reference_label text not null,
  purchase_reference_label text,
  due_year integer,
  due_month integer,
  due_date date,
  closing_date date,
  source_import_lot_ids jsonb not null default '[]'::jsonb,
  total_purchases numeric(15,2) not null default 0,
  total_fees numeric(15,2) not null default 0,
  total_interest numeric(15,2) not null default 0,
  total_refunds numeric(15,2) not null default 0,
  statement_total numeric(15,2) not null default 0,
  total_payments numeric(15,2) not null default 0,
  open_balance numeric(15,2) not null default 0,
  total_charges numeric(15,2) not null default 0,
  total_credits numeric(15,2) not null default 0,
  open_amount numeric(15,2) not null default 0,
  status text not null default 'open',
  manual_totals_json jsonb,
  statement_total_from_file numeric(15,2),
  total_payments_from_file numeric(15,2),
  lines_computed_total numeric(15,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, account_id, reference_label)
);

create trigger trg_cc_statements_updated_at
before update on public.credit_card_statements
for each row execute procedure public.handle_updated_at();

create table public.credit_card_entries (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  card_id uuid not null references public.credit_cards(id),
  account_id uuid not null references public.contas(id),
  import_lot_id uuid not null references public.credit_card_import_lots(id),
  source_file_name text not null,
  source_row_index integer not null,
  source_row_hash text not null,
  transaction_id uuid references public.transactions("ID_Transacao"),
  statement_id uuid references public.credit_card_statements(id),
  posted_date date,
  description_raw text not null default '',
  description_normalized text not null default '',
  merchant_name text,
  holder_name text,
  amount numeric(15,2) not null,
  abs_amount numeric(15,2) not null,
  direction text not null,
  entry_type text not null,
  installment_current integer,
  installment_total integer,
  category_id uuid references public.categories(id),
  classification_source text not null default 'system',
  classification_confidence numeric(5,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.credit_card_payments (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  card_id uuid not null references public.credit_cards(id),
  statement_id uuid not null references public.credit_card_statements(id),
  payment_account_id uuid references public.contas(id),
  payment_transaction_id uuid references public.transactions("ID_Transacao"),
  payment_date date not null,
  amount numeric(15,2) not null,
  source text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_cc_entries_updated_at
before update on public.credit_card_entries
for each row execute procedure public.handle_updated_at();

create trigger trg_cc_payments_updated_at
before update on public.credit_card_payments
for each row execute procedure public.handle_updated_at();
