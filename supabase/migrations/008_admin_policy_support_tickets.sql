-- 008_admin_rls.sql
-- PERMISSÃO DE ADMIN (CASSIO)
-- Objetivo: Permitir que o admin visualize e edite chamados de OUTROS usuários.
-- Motivo: O RLS padrão (Row Level Security) impede que um usuário veja dados de outro.

-- 1. Limpa políticas antigas se existirem (para evitar erros ao rodar múltiplas vezes)
drop policy if exists "Admins can view all tickets" on support_tickets;
drop policy if exists "Admins can update all tickets" on support_tickets;

-- 2. Política de Visualização (SELECT)
-- Permite ver todos os chamados se o email do usuário logado for 'cassiomq@gmail.com'
create policy "Admins can view all tickets"
  on support_tickets for select
  using (
    lower(auth.jwt() ->> 'email') = 'cassiomq@gmail.com'
  );

-- 3. Política de Edição (UPDATE)
-- Permite alterar status (ex: marcar como resolvido)
create policy "Admins can update all tickets"
  on support_tickets for update
  using (
    lower(auth.jwt() ->> 'email') = 'cassiomq@gmail.com'
  );
