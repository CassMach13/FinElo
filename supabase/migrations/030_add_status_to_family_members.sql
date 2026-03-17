-- ============================================================================
-- SQL DE MIGRAÇÃO: STATUS DE ACEITE NO PLANO FAMÍLIA
-- ============================================================================

-- 1. Adicionar coluna de status (pending, accepted, declined)
-- Usamos 'accepted' por padrão para registros existentes para não quebrar quem já usa.
alter table public.family_members 
add column if not exists status text check (status in ('pending', 'accepted', 'declined')) default 'pending';

-- 2. Atualizar registros existentes para 'accepted' 
update public.family_members set status = 'accepted' where status is null;

-- 3. Atualizar a função has_family_access para considerar apenas membros ACEITOS
create or replace function public.has_family_access(record_user_id uuid)
returns boolean as $$
begin
  return (
    -- Caso 1: Usuário é o dono
    auth.uid() = record_user_id 
    OR 
    -- Caso 2: Usuário está na lista de family_members daquele dono e ACEITOU o convite
    exists (
      select 1 from public.family_members
      where owner_id = record_user_id
      and member_email = (select email from auth.users where id = auth.uid())
      and status = 'accepted'
    )
  );
end;
$$ language plpgsql security definer;

-- 4. Adicionar política para o convidado conseguir responder ao convite (UPDATE)
create policy "Membro responde ao convite"
  on public.family_members for update
  using (member_email = (select email from auth.users where id = auth.uid()));
