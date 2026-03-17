create table if not exists public.investments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  institution text not null,
  product_type text not null,
  balance numeric not null default 0,
  reference_month date not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS Policies
alter table public.investments enable row level security;

create policy "Users can view their own investments"
  on public.investments for select
  using ( auth.uid() = user_id );

create policy "Users can insert their own investments"
  on public.investments for insert
  with check ( auth.uid() = user_id );

create policy "Users can update their own investments"
  on public.investments for update
  using ( auth.uid() = user_id );

create policy "Users can delete their own investments"
  on public.investments for delete
  using ( auth.uid() = user_id );
