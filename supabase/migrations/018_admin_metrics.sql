-- Migration: Admin metrics function
-- Retorna os dados agregados dos usuários, planos e faturamento estimado
-- Para ser usado de forma segura no Admin Dashboard (onde RLS bloqueia ler `auth.users` diretamente)

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

  -- Active Wealth/Lifetime users
  SELECT count(*) INTO wealth_users FROM public.subscriptions WHERE status = 'lifetime' OR tier = 'wealth';

  -- Fornecer temporariamente os totais genéricos zerados para anuais/mensais até aprimorar infra de Pagamento/Stripe Webhook
  yearly_users := 0;
  monthly_users := 0;

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
          'plan_type', pu.plan_type,
          'plan_status', pu.plan_status
        ) ORDER BY au.last_sign_in_at DESC NULLS LAST
      ), '[]'::json)
      FROM auth.users au
      LEFT JOIN public.users pu ON au.id = pu.id
    )
  );
END;
$$;
