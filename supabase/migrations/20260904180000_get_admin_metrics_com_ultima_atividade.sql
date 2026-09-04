-- ===========================================================================
-- get_admin_metrics: acrescentar `last_activity_at`, preservando o hotfix
-- ===========================================================================
--
-- Esta definição PARTE da versão segura aplicada em produção pelo hotfix
-- 20260904160000, e a única evolução funcional é um campo novo em `crm_users`:
--
--   last_activity_at = COALESCE(public.user_activity.last_activity_at,
--                               auth.users.last_sign_in_at)
--
-- Tudo o que o hotfix estabeleceu continua aqui, palavra por palavra:
--
--   * guarda de administrador dentro da própria função;
--   * SECURITY DEFINER — mantido porque é necessário, não por hábito:
--     `anon` e `authenticated` não têm privilégio algum sobre `auth.users`,
--     então sem DEFINER a função não leria nada;
--   * SET search_path = '' e todos os nomes qualificados;
--   * REVOKE de EXECUTE para PUBLIC e para anon;
--   * GRANT apenas para `authenticated` — e, lá dentro, só o admin passa.
--
-- Nenhum campo é removido ou renomeado. O frontend anterior a esta mudança
-- simplesmente ignora a chave nova.
--
-- SOBRE O FALLBACK
--
-- `last_activity_at` cai em `last_sign_in_at` apenas enquanto o usuário ainda
-- não tiver registrado atividade nenhuma, e isso é só exibição — nada é
-- gravado para trás. O campo `last_sign_in_at` continua exposto em separado,
-- com o nome do que ele realmente é: último login, não "última atividade".

CREATE OR REPLACE FUNCTION public.get_admin_metrics()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  total_users INT;
  new_users_30_days INT;
  pro_users INT;
  wealth_users INT;
  founders_users INT;
  free_users INT;
BEGIN
  -- Portão: sem isto, qualquer chamador recebia a base inteira.
  IF NOT EXISTS (
    SELECT 1 FROM auth.users au
    WHERE au.id = auth.uid() AND au.email = 'cassiomq@gmail.com'
  ) THEN
    RAISE EXCEPTION 'Acesso negado: métricas administrativas são restritas ao administrador.';
  END IF;

  SELECT count(*) INTO total_users FROM auth.users;

  SELECT count(*) INTO new_users_30_days FROM auth.users WHERE created_at >= NOW() - INTERVAL '30 days';

  SELECT count(*) INTO founders_users
  FROM public.subscriptions
  WHERE status = 'lifetime' OR plan_type = 'lifetime';

  SELECT count(*) INTO pro_users
  FROM public.subscriptions
  WHERE tier = 'pro'
  AND status IN ('active', 'trialing', 'past_due')
  AND (plan_type IS NULL OR plan_type != 'lifetime')
  AND status != 'lifetime';

  SELECT count(*) INTO wealth_users
  FROM public.subscriptions
  WHERE tier = 'wealth'
  AND status IN ('active', 'trialing', 'past_due')
  AND (plan_type IS NULL OR plan_type != 'lifetime')
  AND status != 'lifetime';

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
          'last_activity_at', COALESCE(ua.last_activity_at, au.last_sign_in_at),
          'plan_type', ps.plan_type,
          'tier', ps.tier,
          'plan_status', ps.status
        ) ORDER BY COALESCE(ua.last_activity_at, au.last_sign_in_at) DESC NULLS LAST
      ), '[]'::json)
      FROM auth.users au
      LEFT JOIN public.subscriptions ps ON au.id = ps.user_id
      LEFT JOIN public.user_activity ua ON au.id = ua.user_id
    )
  );
END;
$function$;

-- Repetidos de propósito: um `CREATE OR REPLACE` preserva os privilégios
-- atuais, mas repetir aqui torna a garantia explícita e independente do estado
-- anterior do banco — inclusive num banco novo.
REVOKE ALL ON FUNCTION public.get_admin_metrics() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_metrics() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_metrics() TO authenticated;
