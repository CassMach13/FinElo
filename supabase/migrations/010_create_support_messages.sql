-- 010_create_support_messages.sql
-- Transforma o sistema de resposta única em Chat (Histórico)

-- 1. Create table
create table support_messages (
  id uuid default uuid_generate_v4() primary key,
  ticket_id uuid references support_tickets(id) on delete cascade not null,
  sender_id uuid references auth.users not null,
  message text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. RLS Policies
alter table support_messages enable row level security;

-- User Policies:
-- View: Only if they own the ticket
create policy "Users view messages of own tickets" 
on support_messages for select 
using ( exists (select 1 from support_tickets where id = ticket_id and user_id = auth.uid()) );

-- Insert: Only if they own the ticket (User responding)
create policy "Users insert messages to own tickets" 
on support_messages for insert 
with check ( exists (select 1 from support_tickets where id = ticket_id and user_id = auth.uid()) );

-- Admin Policies (Cassio):
-- View All
create policy "Admins view all messages"
on support_messages for select
using ( lower(auth.jwt() ->> 'email') = 'cassiomq@gmail.com' );

-- Insert (Admin responding)
create policy "Admins insert messages"
on support_messages for insert
with check ( lower(auth.jwt() ->> 'email') = 'cassiomq@gmail.com' );

-- 3. Data Migration (Optional but good)
-- Migrar respostas antigas (campo admin_response) para a tabela nova
-- Assume sender_id as the admin's ID (or User ID? No, Admin ID).
-- We assume Admin ID logic or just insert manually?
-- Since we don't have Admin UID handy in SQL script easily without lookup, we skip automatic migration of 'admin_response' column OR we update the UI to show both.
-- Better approach: UI handles compatibility. 
-- Or:
-- do $$
-- declare admin_uid uuid;
-- begin
--   select id into admin_uid from auth.users where email = 'cassiomq@gmail.com';
--   if admin_uid is not null then
--     insert into support_messages (ticket_id, sender_id, message, created_at)
--     select id, admin_uid, admin_response, updated_at 
--     from support_tickets 
--     where admin_response is not null;
--   end if;
-- end $$;
