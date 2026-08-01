\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema if not exists auth;

create table auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz,
  updated_at timestamptz
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.contas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  "Nome_Conta" text not null,
  "Tipo_Conta" text not null,
  "Saldo_Inicial" numeric not null default 0,
  "Data_Saldo_Inicial" date,
  limite_credito numeric,
  dia_fechamento integer,
  dia_vencimento integer
);

create table public.transactions (
  "ID_Transacao" uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  "Data" timestamptz not null,
  "Data_Pagamento" timestamptz,
  "Nome_Fantasia" text,
  "Parcela_Atual" integer,
  "Total_Parcelas" integer,
  "Categoria" text,
  "Fonte" text,
  "Valor" numeric not null,
  "Origem" text,
  "Descricao_Original" text,
  "Portador" text,
  "Tipo" text,
  "ID_Conta" uuid references public.contas(id) on delete set null,
  pluggy_transaction_id text,
  linked_asset_id uuid
);

create table public.import_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  import_date timestamptz not null default now(),
  total_transactions integer not null default 0,
  imported_count integer not null default 0,
  ignored_count integer not null default 0,
  ignored_details jsonb not null default '[]'::jsonb,
  imported_details jsonb not null default '[]'::jsonb
);

create table public.credit_card_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid
);
