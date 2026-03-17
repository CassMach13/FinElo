-- ============================================================================
-- SQL DE MIGRAÇÃO: ADICIONAR EMAIL DO DONO NO CONVITE
-- ============================================================================

-- 1. Adicionar coluna owner_email
alter table public.family_members 
add column if not exists owner_email text;

-- 2. Preencher registros existentes cruzando com a tabela de usuários
update public.family_members fm
set owner_email = u.email
from auth.users u
where fm.owner_id = u.id
and fm.owner_email is null;
