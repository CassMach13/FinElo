-- Create support_tickets table
create table support_tickets (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users not null,
  type text check (type in ('bug', 'feature', 'question')) not null,
  subject text not null,
  description text not null,
  status text check (status in ('open', 'in_progress', 'resolved', 'closed')) default 'open',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS Policies
alter table support_tickets enable row level security;

-- Users can view their own tickets
create policy "Users can view own tickets"
  on support_tickets for select
  using (auth.uid() = user_id);

-- Users can insert their own tickets
create policy "Users can insert own tickets"
  on support_tickets for insert
  with check (auth.uid() = user_id);

-- Admin (Cassio) can view all tickets
-- Note: Replace 'USER_ID_DO_CASSIO' with the actual UUID or use a role-based approach if available.
-- For now, allow specific ID or maybe just simple RLS for simplicity until admin role is set.
-- Let's make a broad "Admin" policy later. For now, we rely on the implementation or manual policy update.
-- Actually, let's create a policy that allows everything for the specific admin email if possible,
-- but SQL user_id is safer.
-- We will just use 'Users can view own tickets' for now for the USER side.
-- Usage of 'Admin' will likely bypass RLS using service role or we add a specific policy later.
