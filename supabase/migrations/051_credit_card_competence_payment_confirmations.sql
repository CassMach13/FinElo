-- ============================================================================
-- MIGRATION 051: Confirmações manuais de pagamento por competência (histórico de faturas)
-- Sincroniza entre dispositivos; substitui localStorage.
-- ============================================================================

create table if not exists public.credit_card_competence_payment_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  account_id uuid references public.contas(id) on delete cascade not null,
  reference_month text not null
    check (reference_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  settled_amount numeric(15, 2) not null check (settled_amount >= 0),
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, account_id, reference_month)
);

create index if not exists idx_cc_competence_payment_confirm_account
  on public.credit_card_competence_payment_confirmations (account_id);

create index if not exists idx_cc_competence_payment_confirm_user_account
  on public.credit_card_competence_payment_confirmations (user_id, account_id);

drop trigger if exists trg_cc_competence_payment_confirm_updated_at
  on public.credit_card_competence_payment_confirmations;
create trigger trg_cc_competence_payment_confirm_updated_at
before update on public.credit_card_competence_payment_confirmations
for each row execute procedure public.handle_updated_at();

alter table public.credit_card_competence_payment_confirmations enable row level security;

drop policy if exists "Family read competence payment confirmations"
  on public.credit_card_competence_payment_confirmations;
create policy "Family read competence payment confirmations"
  on public.credit_card_competence_payment_confirmations for select
  using (public.has_family_access(user_id));

drop policy if exists "Family insert competence payment confirmations"
  on public.credit_card_competence_payment_confirmations;
create policy "Family insert competence payment confirmations"
  on public.credit_card_competence_payment_confirmations for insert
  with check (public.has_family_access(user_id));

drop policy if exists "Family update competence payment confirmations"
  on public.credit_card_competence_payment_confirmations;
create policy "Family update competence payment confirmations"
  on public.credit_card_competence_payment_confirmations for update
  using (public.has_family_access(user_id));

drop policy if exists "Family delete competence payment confirmations"
  on public.credit_card_competence_payment_confirmations;
create policy "Family delete competence payment confirmations"
  on public.credit_card_competence_payment_confirmations for delete
  using (public.has_family_access(user_id));
