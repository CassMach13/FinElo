-- Migration: FinElo Metrics & CRM Sync
-- Considera os planos: Basic (Grátis), PRO, Wealth e Founder's Pack (Vitalício)

CREATE OR REPLACE FUNCTION get_admin_metrics()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_users INT;
  new_users_30_days INT;
  pro_users INT;
  wealth_users INT;
  founders_users INT;
  free_users INT;
BEGIN
  -- Total de cadastros
  SELECT count(*) INTO total_users FROM auth.users;
  
  -- Novos usuários nos últimos 30 dias
  SELECT count(*) INTO new_users_30_days FROM auth.users WHERE created_at >= NOW() - INTERVAL '30 days';

  -- FOUNDER'S PACK: Somente os vitalícios
  SELECT count(*) INTO founders_users 
  FROM public.subscriptions 
  WHERE status = 'lifetime' OR plan_type = 'lifetime';

  -- PRO: Tier PRO que não são vitalícios
  SELECT count(*) INTO pro_users 
  FROM public.subscriptions 
  WHERE tier = 'pro' 
  AND status IN ('active', 'trialing', 'past_due')
  AND plan_type != 'lifetime' AND status != 'lifetime';

  -- WEALTH: Tier WEALTH que não são vitalícios (Anuais/Mensais)
  SELECT count(*) INTO wealth_users 
  FROM public.subscriptions 
  WHERE tier = 'wealth' 
  AND status IN ('active', 'trialing', 'past_due')
  AND plan_type != 'lifetime' AND status != 'lifetime';

  -- BASIC (Grátis): Todo o resto
  free_users := total_users - (pro_users + wealth_users + founders_users);
  IF free_users < 0 THEN free_users := 0; END IF;

  RETURN json_build_object(
    'total_users', total_users,
    'new_users_30_days', new_users_30_days,
    'pro_users', pro_users,
    'wealth_users', wealth_users,
    'founders_users', founders_users,
    'free_users', free_users,
    'crm_users', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'id', au.id,
          'email', au.email,
          'full_name', au.raw_user_meta_data->>'full_name',
          'created_at', au.created_at,
          'last_sign_in_at', au.last_sign_in_at,
          'plan_type', COALESCE(ps.plan_type, 'free'), 
          'tier', COALESCE(ps.tier, 'pro'),           
          'plan_status', COALESCE(ps.status, 'active')
        ) ORDER BY au.last_sign_in_at DESC NULLS LAST
      ), '[]'::json)
      FROM auth.users au
      LEFT JOIN public.subscriptions ps ON au.id = ps.user_id
    )
  );
END;
$$;
