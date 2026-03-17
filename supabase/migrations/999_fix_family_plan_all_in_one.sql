-- ============================================================================
-- SQL CONSOLIDADO: CORREÇÃO TOTAL DO PLANO FAMÍLIA
-- ============================================================================
-- Este script resolve:
-- 1. Coluna de status (Aceite/Recusa)
-- 2. Coluna owner_email (Quem convidou)
-- 3. Erro de permissão (403) no RLS
-- ============================================================================

-- A. ADICIONAR COLUNAS NECESSÁRIAS
alter table public.family_members 
add column if not exists status text check (status in ('pending', 'accepted', 'declined')) default 'pending',
add column if not exists owner_email text;

-- B. BACKFILL: PREENCHER REGISTROS EXISTENTES
update public.family_members set status = 'accepted' where status is null;

update public.family_members fm
set owner_email = u.email
from auth.users u
where fm.owner_id = u.id
and fm.owner_email is null;

-- C. ATUALIZAR FUNÇÃO DE ACESSO (SEM CONSULTAR AUTH.USERS DIRETAMENTE)
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

-- D. ATUALIZAR POLÍTICAS DE RLS
drop policy if exists "Membro responde ao convite" on public.family_members;
create policy "Membro responde ao convite"
  on public.family_members for update
  using (member_email = (auth.jwt() ->> 'email'));

drop policy if exists "Membro vê se foi adicionado" on public.family_members;
create policy "Membro vê se foi adicionado"
  on public.family_members for select
  using (member_email = (auth.jwt() ->> 'email'));

-- E. GARANTIR QUE POLÍTICA DE INSERT PERMITE O OWNER_EMAIL
drop policy if exists "Dono adiciona membros" on public.family_members;
create policy "Dono adiciona membros"
  on public.family_members for insert
  with check (auth.uid() = owner_id);
