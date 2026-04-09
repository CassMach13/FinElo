-- Migration: User Retention Logic
-- Cria a estrutura para identificar e rastrear usuários inativos há mais de 15 dias.

-- 1. Tabela para registrar quando um e-mail de retenção foi enviado (para evitar spam)
CREATE TABLE IF NOT EXISTS public.retention_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    retention_type TEXT NOT NULL, -- Ex: '15_days_inactivity'
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Habilitar RLS
ALTER TABLE public.retention_history ENABLE ROW LEVEL SECURITY;

-- Apenas admins podem ver o histórico completo, usuários vêm apenas o seu
CREATE POLICY "Users can view their own retention history"
  ON public.retention_history FOR SELECT
  USING (auth.uid() = user_id);

-- 2. Função para buscar usuários inativos
-- Identifica usuários que não lançam transações há mais de 15 dias e não foram notificados nos últimos 30 dias.
CREATE OR REPLACE FUNCTION get_inactive_users_for_retention()
RETURNS TABLE (
    user_id UUID,
    email TEXT,
    full_name TEXT,
    last_transaction_at TIMESTAMPTZ
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        au.id as user_id,
        au.email::TEXT,
        (au.raw_user_meta_data->>'full_name')::TEXT as full_name,
        MAX(t."Data") as last_transaction_at
    FROM auth.users au
    JOIN public.transactions t ON au.id = t.user_id
    /* 
       Filtro: 
       - Não enviamos e-mail se já foi enviado um '15_days_inactivity' nos últimos 30 dias 
    */
    LEFT JOIN public.retention_history rh ON au.id = rh.user_id 
        AND rh.retention_type = '15_days_inactivity' 
        AND rh.sent_at > NOW() - INTERVAL '30 days'
    WHERE rh.id IS NULL -- Garantia de que não houve envio recente
    GROUP BY au.id, au.email, au.raw_user_meta_data
    HAVING MAX(t."Data") < NOW() - INTERVAL '15 days'
    ORDER BY MAX(t."Data") ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_inactive_users_for_retention() TO authenticated;
