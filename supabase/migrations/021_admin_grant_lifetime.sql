-- ============================================================================
-- SCRIPT ADMINISTRATIVO: CONCEDER ACESSO VITALÍCIO (LIFETIME)
-- ============================================================================
-- Instruções de Uso:
-- 1. Acesse o SQL Editor do Supabase: https://supabase.com/dashboard
-- 2. Copie TODO este conteúdo e cole no editor.
-- 3. Mude o email na linha abaixo (dentro das aspas simples).
-- 4. Clique em RUN.
-- ============================================================================

DO $$
DECLARE
  -- vvvvv EDITE O EMAIL ABAIXO vvvvv
  v_email text := 'EMAIL_DO_AMIGO@GMAIL.COM'; 
  -- ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  
  v_user_id uuid;
BEGIN
  -- 1. Busca o ID do usuário pelo email
  select id into v_user_id from auth.users where email = v_email;

  -- 2. Verifica se achou
  if v_user_id is null then
    raise exception 'ERRO: Usuário % não encontrado. Peça para a pessoa criar a conta no sistema primeiro!', v_email;
  end if;

  -- 3. Insere ou Atualiza a assinatura para Lifetime
  insert into public.subscriptions (user_id, status, plan_type)
  values (v_user_id, 'lifetime', 'lifetime')
  on conflict (user_id) do update
  set status = 'lifetime',
      plan_type = 'lifetime',
      updated_at = now();
      
  raise notice 'SUCESSO! O acesso Vitalício foi liberado para %', v_email;
END $$;
