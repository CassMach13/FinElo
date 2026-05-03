-- Migration: Fix admin metrics with fallback and robust mapping
-- Atualiza a função para ser mais "tolerante" e buscar o plano em múltiplas fontes (subscriptions e users)

CREATE OR REPLACE FUNCTION get_admin_metrics()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_users INT;
  new_users_30_days INT;
  free_users INT;
  pro_users INT;
  wealth_users INT;
  yearly_users INT;
  monthly_users INT;
BEGIN
  -- Total registered users
  SELECT count(*) INTO total_users FROM auth.users;
  
  -- Users registered in the last 30 days
  SELECT count(*) INTO new_users_30_days FROM auth.users WHERE created_at >= NOW() - INTERVAL '30 days';

  -- Active Pro users
  SELECT count(*) INTO pro_users FROM public.subscriptions WHERE (status = 'active' OR status = 'trialing') AND tier = 'pro';

  -- Active Wealth/Lifetime users (Contagem dos Founders)
  SELECT count(*) INTO wealth_users FROM public.subscriptions WHERE status = 'lifetime' OR tier = 'wealth';

  -- Contagem real de anuais e mensais
  SELECT count(*) INTO yearly_users FROM public.subscriptions WHERE plan_type = 'annual' AND status IN ('active', 'trialing', 'past_due');
  SELECT count(*) INTO monthly_users FROM public.subscriptions WHERE plan_type = 'monthly' AND status IN ('active', 'trialing', 'past_due');

  -- Free users are total users minus the ones that have an active/lifetime subscription
  free_users := total_users - (pro_users + wealth_users);
  IF free_users < 0 THEN free_users := 0; END IF;

  RETURN json_build_object(
    'total_users', total_users,
    'new_users_30_days', new_users_30_days,
    'free_users', free_users,
    'pro_users', pro_users,
    'wealth_users', wealth_users,
    'yearly_users', yearly_users,
    'monthly_users', monthly_users,
    'crm_users', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'id', au.id,
          'email', au.email,
          'full_name', au.raw_user_meta_data->>'full_name',
          'created_at', au.created_at,
          'last_sign_in_at', au.last_sign_in_at,
          -- Fallback para tabela public.users caso a subscription ainda não tenha sido criada/sincronizada
          'plan_type', COALESCE(ps.plan_type, pu.plan_type), 
          'tier', COALESCE(ps.tier, 'pro'),           
          'plan_status', COALESCE(ps.status, pu.plan_status)
        ) ORDER BY au.last_sign_in_at DESC NULLS LAST
      ), '[]'::json)
      FROM auth.users au
      LEFT JOIN public.subscriptions ps ON au.id = ps.user_id
      LEFT JOIN public.users pu ON au.id = pu.id
    )
  );
END;
$$;
