DROP FUNCTION IF EXISTS get_admin_crm_users();

CREATE OR REPLACE FUNCTION get_admin_crm_users()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  -- SEGURANÇA: Verifica se a função está sendo chamada pelo e-mail do admin da FinElo
  IF EXISTS (
    SELECT 1 FROM auth.users au 
    WHERE au.id = auth.uid() AND au.email = 'cassiomq@gmail.com'
  ) THEN
    -- Mágica: JSON aggregation bypassa restrições de tipo de tabela na API REST
    SELECT json_agg(
      json_build_object(
        'id', au.id,
        'email', au.email,
        'full_name', au.raw_user_meta_data->>'full_name',
        'created_at', au.created_at,
        'last_sign_in_at', au.last_sign_in_at,
        'plan_type', pu.plan_type,
        'plan_status', pu.plan_status
      ) ORDER BY au.last_sign_in_at DESC NULLS LAST
    )
    INTO result
    FROM auth.users au
    LEFT JOIN public.users pu ON au.id = pu.id;
    
    RETURN COALESCE(result, '[]'::json);
  ELSE
    -- Bloqueio sumário para acesso não autorizado
    RAISE EXCEPTION 'Acesso Negado: Apenas administradores podem ver o CRM.';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_crm_users() TO authenticated;
