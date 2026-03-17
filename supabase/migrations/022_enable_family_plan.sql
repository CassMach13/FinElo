-- ============================================================================
-- SQL DE MIGRAÇÃO: PLANO FAMÍLIA (ACESSO COMPARTILHADO)
-- ============================================================================
-- Instruções:
-- 1. Acesse o painel do Supabase (https://supabase.com/dashboard)
-- 2. Na barra lateral, clique em "SQL Editor"
-- 3. Clique em "New Query"
-- 4. Cole este código e clique em "Run"
-- ============================================================================

-- 1. Criar a tabela de membros da família (convites/permissões)
create table if not exists public.family_members (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references auth.users(id) on delete cascade not null,
  member_email text not null,
  created_at timestamptz default now(),
  unique(owner_id, member_email)
);

-- Habilitar RLS na tabela family_members
alter table public.family_members enable row level security;

-- Política: O Dono da conta pode ver quem ele adicionou
create policy "Dono vê seus membros"
  on public.family_members for select
  using (auth.uid() = owner_id);

-- Política: O Dono da conta pode adicionar membros
create policy "Dono adiciona membros"
  on public.family_members for insert
  with check (auth.uid() = owner_id);

-- Política: O Dono da conta pode remover membros
create policy "Dono remove membros"
  on public.family_members for delete
  using (auth.uid() = owner_id);

-- Política: O convidado pode ver se ele foi adicionado por alguém (necessário para o frontend saber)
create policy "Membro vê se foi adicionado"
  on public.family_members for select
  using (member_email = auth.jwt() ->> 'email');


-- ============================================================================
-- 2. ATUALIZAR POLÍTICAS DE SEGURANÇA (RLS) DAS TABELAS PRINCIPAIS
-- O objetivo é permitir que: 
-- A) O dono veja seus dados (padrão)
-- B) O membro convidado veja os dados do dono
-- ============================================================================

-- Função auxiliar para verificar acesso familiar
-- Retorna TRUE se:
-- 1. O usuário é o dono do registro
-- 2. O usuário é membro da família do dono (verificado por email)
create or replace function public.has_family_access(record_user_id uuid)
returns boolean as $$
begin
  return (
    -- Caso 1: Usuário é o dono
    auth.uid() = record_user_id 
    OR 
    -- Caso 2: Usuário está na lista de family_members daquele dono
    exists (
      select 1 from public.family_members
      where owner_id = record_user_id
      and member_email = (select email from auth.users where id = auth.uid())
    )
  );
end;
$$ language plpgsql security definer;

-- --- ATUALIZAR TRANSACTIONS ---
drop policy if exists "Users can read own transactions" on public.transactions;
create policy "Family Read Transactions"
  on public.transactions for select
  using ( public.has_family_access(user_id) );

-- Nota: Para simplificar, escrita (INSERT/UPDATE/DELETE) continua sendo apenas do DONO por enquanto, 
-- ou podemos liberar escrita também. O pedido foi "todos os saldos compartilhados".
-- Se quiser que a esposa também ADICIONE gastos na conta do marido, precisamos liberar INSERT.
-- VAMOS LIBERAR TUDO (Full Access) conforme "sem permissões granulares".

drop policy if exists "Users can insert own transactions" on public.transactions;
create policy "Family Insert Transactions"
  on public.transactions for insert
  with check ( public.has_family_access(user_id) );

drop policy if exists "Users can update own transactions" on public.transactions;
create policy "Family Update Transactions"
  on public.transactions for update
  using ( public.has_family_access(user_id) );

drop policy if exists "Users can delete own transactions" on public.transactions;
create policy "Family Delete Transactions"
  on public.transactions for delete
  using ( public.has_family_access(user_id) );


-- --- ATUALIZAR CONTAS (table: contas) ---
drop policy if exists "Users can read own accounts" on public.contas;
create policy "Family Read Accounts"
  on public.contas for select
  using ( public.has_family_access(user_id) );

drop policy if exists "Users can insert own accounts" on public.contas;
create policy "Family Insert Accounts"
  on public.contas for insert
  with check ( public.has_family_access(user_id) );

drop policy if exists "Users can update own accounts" on public.contas;
create policy "Family Update Accounts"
  on public.contas for update
  using ( public.has_family_access(user_id) );

drop policy if exists "Users can delete own accounts" on public.contas;
create policy "Family Delete Accounts"
  on public.contas for delete
  using ( public.has_family_access(user_id) );


-- --- ATUALIZAR CATEGORIES ---
-- Categorias geralmente são globais ou por usuário. Se forem por usuário, aplicamos a mesma lógica.
drop policy if exists "Users can read own categories" on public.categories;
create policy "Family Read Categories"
  on public.categories for select
  using ( public.has_family_access(user_id) ); -- Assumindo que categories tem user_id. Se não tiver, ignore.

drop policy if exists "Users can insert own categories" on public.categories;
create policy "Family Insert Categories"
  on public.categories for insert
  with check ( public.has_family_access(user_id) );

drop policy if exists "Users can update own categories" on public.categories;
create policy "Family Update Categories"
  on public.categories for update
  using ( public.has_family_access(user_id) );

drop policy if exists "Users can delete own categories" on public.categories;
create policy "Family Delete Categories"
  on public.categories for delete
  using ( public.has_family_access(user_id) );
  
  
-- --- ATUALIZAR MAPPING RULES ---
drop policy if exists "Users can read own rules" on public.mapping_rules;
create policy "Family Read Rules"
  on public.mapping_rules for select
  using ( public.has_family_access(user_id) );

drop policy if exists "Users can insert own rules" on public.mapping_rules;
create policy "Family Insert Rules"
  on public.mapping_rules for insert
  with check ( public.has_family_access(user_id) );

drop policy if exists "Users can update own rules" on public.mapping_rules;
create policy "Family Update Rules"
  on public.mapping_rules for update
  using ( public.has_family_access(user_id) );

drop policy if exists "Users can delete own rules" on public.mapping_rules;
create policy "Family Delete Rules"
  on public.mapping_rules for delete
  using ( public.has_family_access(user_id) );
