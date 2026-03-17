-- ============================================================================
-- SQL DE MIGRAÇÃO: ASSINATURAS E PAGAMENTOS
-- ============================================================================

-- 1. Create Subscriptions Table
create table if not exists public.subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  status text not null check (status in ('active', 'past_due', 'canceled', 'incomplete', 'trialing', 'lifetime')),
  plan_type text not null check (plan_type in ('monthly', 'annual', 'lifetime', 'free')),
  current_period_end timestamptz,
  gateway_customer_id text, -- ID do cliente no Stripe/ASAAS
  gateway_subscription_id text, -- ID da assinatura no Stripe/ASAAS
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Enable RLS
alter table public.subscriptions enable row level security;

-- 3. Policies
-- User can read their own subscription
create policy "Users can read own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- Only service_role (backend) can insert/update/delete usually, but for now we might need manual insert for testing
-- Let's allow users to read only. Creation will happen via Webhook or specific backend functions.

-- 4. Function to handle updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger handle_subscriptions_updated_at
  before update on public.subscriptions
  for each row
  execute procedure public.handle_updated_at();

-- 5. Helper function to check premium status (useful for RLS later if we want strict enforcement)
create or replace function public.is_premium(check_user_id uuid)
returns boolean as $$
declare
  sub_status text;
begin
  select status into sub_status from public.subscriptions where user_id = check_user_id;
  if sub_status in ('active', 'lifetime', 'trialing') then
    return true;
  else
    return false;
  end if;
end;
$$ language plpgsql security definer;
