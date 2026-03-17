-- ============================================================================
-- SCRIPT ADMINISTRATIVO: CONCEDER SINCRONIZAÇÃO ILIMITADA (VERY VIP)
-- ============================================================================
-- Este script libera o poder de sincronizar QUANTOS BANCOS QUISER via Pluggy.
--
-- INSTRUÇÕES:
-- 1. Copie o código abaixo.
-- 2. Vá no SQL Editor do seu Supabase Dashboard.
-- 3. Cole e clique em "Run".
-- ============================================================================

DO $$
DECLARE
  -- COLOQUE O E-MAIL DO USUÁRIO VIP AQUI ABAIXO:
  v_email_vip text := 'cassiomq@gmail.com'; 
  
  v_user_id uuid;
BEGIN
  -- 1. Garantir que a coluna de permissão existe
  ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS unlimited_sync boolean DEFAULT false;

  -- 2. Buscar o ID do usuário pelo e-mail
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email_vip;

  IF v_user_id IS NOT NULL THEN
    -- 3. Criar ou Atualizar a assinatura para nível Wealth com Sync Ilimitado
    INSERT INTO public.subscriptions (user_id, status, plan_type, tier, unlimited_sync)
    VALUES (v_user_id, 'lifetime', 'lifetime', 'wealth', true)
    ON CONFLICT (user_id) DO UPDATE
    SET unlimited_sync = true,
        tier = 'wealth',
        status = 'lifetime',
        updated_at = now();
        
    RAISE NOTICE 'SUCESSO! Sincronização ILIMITADA liberada para o e-mail: %', v_email_vip;
  ELSE
    RAISE WARNING 'ERRO: Usuário com o e-mail % não foi encontrado.', v_email_vip;
  END IF;
END $$;
