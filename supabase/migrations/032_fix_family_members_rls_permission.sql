-- ============================================================================
-- SQL DE MIGRAÇÃO: CORREÇÃO DE PERMISSÃO RLS (AUTH.USERS)
-- ============================================================================

-- 1. Atualizar a função has_family_access para usar auth.jwt() em vez de query direta em auth.users
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
      and member_email = (auth.jwt() ->> 'email')
      and status = 'accepted'
    )
  );
end;
$$ language plpgsql security definer;

-- 2. Atualizar a política de resposta ao convite para usar auth.jwt()
drop policy if exists "Membro responde ao convite" on public.family_members;
create policy "Membro responde ao convite"
  on public.family_members for update
  using (member_email = (auth.jwt() ->> 'email'));
