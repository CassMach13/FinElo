-- Create a table to store import history logs
create table if not exists public.import_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  file_name text not null,
  import_date timestamp with time zone default timezone('utc'::text, now()) not null,
  total_transactions integer not null,
  imported_count integer not null,
  ignored_count integer not null,
  ignored_details jsonb -- Stores details of ignored transactions (e.g., description, date, value)
);

-- Enable RLS
alter table public.import_logs enable row level security;

-- Create policy to allow users to see only their own logs
create policy "Users can view their own import logs"
  on public.import_logs for select
  using (auth.uid() = user_id);

-- Create policy to allow users to insert their own logs
create policy "Users can insert their own import logs"
  on public.import_logs for insert
  with check (auth.uid() = user_id);
