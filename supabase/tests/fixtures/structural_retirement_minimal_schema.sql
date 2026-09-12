\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role finelo_structural_entry_executor nologin noinherit nobypassrls;
create role finelo_structural_entry_gateway nologin noinherit nobypassrls;

create schema auth;
create schema finelo_structural_internal;

create table auth.users (
  id uuid primary key,
  email text
);

create table public.contas (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  "Nome_Conta" text not null,
  "Tipo_Conta" text not null,
  "Saldo_Inicial" numeric not null,
  "Data_Saldo_Inicial" date not null
);

create table public.credit_cards (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  account_id uuid not null references public.contas(id),
  name text not null,
  closing_day integer,
  due_day integer
);

create table public.transactions (
  "ID_Transacao" uuid primary key,
  user_id uuid,
  "ID_Conta" uuid
);

create table public.credit_card_statements (
  id uuid primary key
);

create table public.credit_card_entries (
  id uuid primary key,
  transaction_id uuid,
  statement_id uuid,
  entry_type text
);

create table public.credit_card_payments (
  id uuid primary key
);

create table public.credit_card_reconciliation_resolutions (
  id uuid primary key
);

create table public.credit_card_reconciliation_resolution_reversals (
  id uuid primary key
);

create table finelo_structural_internal.credit_card_entry_reconciliation_snapshots (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  account_id uuid references public.contas(id) on delete cascade not null,
  card_id uuid references public.credit_cards(id) on delete cascade not null,
  operation_kind text not null,
  shadow_checksum text not null,
  before_revision text not null,
  after_revision text,
  before_rows jsonb not null,
  after_rows jsonb not null,
  entry_count integer not null,
  identity_update_count integer not null,
  competence_update_count integer not null,
  type_update_count integer not null,
  applied_at timestamptz not null default pg_catalog.now(),
  rolled_back_at timestamptz,
  rollback_revision text,
  created_at timestamptz not null default pg_catalog.now()
);

alter table finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  enable row level security;
alter table finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  force row level security;

create policy "Legacy executor policy"
  on finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  for all
  to finelo_structural_entry_executor
  using (true)
  with check (true);

grant usage on schema finelo_structural_internal to authenticated;
grant select, insert on table
  finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  to finelo_structural_entry_executor;
grant update (after_revision, rolled_back_at, rollback_revision)
  on table finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  to finelo_structural_entry_executor;
grant update (transaction_id, statement_id, entry_type)
  on table public.credit_card_entries
  to finelo_structural_entry_executor;

create function finelo_structural_internal.get_atomic_card_structural_entry_feature_state_impl()
returns text language sql as $$ select 'enabled'::text $$;

create function finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(
  uuid, text, text, jsonb
)
returns jsonb language sql as $$ select '{}'::jsonb $$;

create function finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(uuid)
returns jsonb language sql as $$ select '{}'::jsonb $$;

create function public.get_atomic_card_structural_entry_feature_state()
returns text language sql as $$ select 'enabled'::text $$;

create function public.reconcile_credit_card_structural_entries_atomic_v1(
  uuid, text, text, jsonb
)
returns jsonb language sql as $$ select '{}'::jsonb $$;

create function public.rollback_credit_card_structural_entries_atomic_v1(uuid)
returns jsonb language sql as $$ select '{}'::jsonb $$;

alter function finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(
  uuid, text, text, jsonb
) owner to finelo_structural_entry_executor;
alter function finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(uuid)
  owner to finelo_structural_entry_executor;
alter function public.get_atomic_card_structural_entry_feature_state()
  owner to finelo_structural_entry_gateway;
alter function public.reconcile_credit_card_structural_entries_atomic_v1(
  uuid, text, text, jsonb
) owner to finelo_structural_entry_gateway;
alter function public.rollback_credit_card_structural_entries_atomic_v1(uuid)
  owner to finelo_structural_entry_gateway;

grant execute on function public.get_atomic_card_structural_entry_feature_state()
  to authenticated;
grant execute on function public.reconcile_credit_card_structural_entries_atomic_v1(
  uuid, text, text, jsonb
) to authenticated;
grant execute on function public.rollback_credit_card_structural_entries_atomic_v1(uuid)
  to authenticated;
grant execute on function
  finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(
    uuid, text, text, jsonb
  ) to authenticated;
grant execute on function
  finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(uuid)
  to authenticated;
