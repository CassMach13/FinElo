-- ===========================================================================
-- get_admin_metrics: fechar a exposição da lista de usuários
-- ===========================================================================
--
-- A função é SECURITY DEFINER, retorna `crm_users` com id, e-mail, nome,
-- data de cadastro, último login e plano de TODOS os usuários — e não olhava
-- quem estava chamando. Com `EXECUTE` concedido a `anon`, o papel que a chave
-- pública do frontend assume, a base inteira de usuários ficava ao alcance de
-- quem tivesse essa chave.
--
-- Verificado no banco de produção assumindo o papel `anon`: a chamada
-- executava e devolvia os 32 usuários com e-mail e nome.
--
-- COMO ISSO APARECEU
--
-- Não foi descuido isolado: a guarda existe e sempre existiu em
-- `get_admin_crm_users`. Quando a listagem de usuários foi absorvida por
-- `get_admin_metrics`, a guarda não veio junto. Varrendo as demais funções
-- SECURITY DEFINER que leem `auth.users`, esta é a única sem checagem de
-- chamador.
--
-- POR QUE A GUARDA POR E-MAIL É CONFIÁVEL AQUI
--
-- Ela lê `auth.users.email`, não `raw_user_meta_data`. A diferença importa: o
-- metadata do usuário é gravável pelo próprio usuário via `updateUser({data})`
-- e serviria de escada; o e-mail não é. Trocar de e-mail exige confirmação no
-- endereço novo, e existe índice único `users_email_partial_key` sobre
-- `auth.users(email)` — verificado — de modo que nenhuma outra conta consegue
-- assumir o endereço do administrador.
--
-- Optou-se por manter o padrão que o projeto já usa em vez de introduzir uma
-- fonte nova de autorização (por exemplo `raw_app_meta_data`), que exigiria
-- escrever em dados de usuário só para viabilizar o hotfix.
--
-- O QUE MUDA E O QUE NÃO MUDA
--
-- Muda: a guarda, os grants e o search_path.
-- NÃO muda: o formato do retorno. Nenhum campo entra, sai ou troca de nome —
-- o frontend em produção continua funcionando exatamente igual.
--
-- SECURITY DEFINER é mantido porque é necessário: `authenticated` e `anon` não
-- têm privilégio algum sobre `auth.users` (verificado), então sem DEFINER a
-- função não conseguiria ler nada.
--
-- `search_path = ''` obriga todo objeto a ser qualificado, fechando a porta
-- para captura de nome por um schema plantado no caminho de busca. O corpo já
-- qualificava tudo (`auth.users`, `public.subscriptions`, `auth.uid()`), então
-- o endurecimento não exigiu reescrever a consulta.

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
          'plan_type', ps.plan_type,
          'tier', ps.tier,
          'plan_status', ps.status
        ) ORDER BY au.last_sign_in_at DESC NULLS LAST
      ), '[]'::json)
      FROM auth.users au
      LEFT JOIN public.subscriptions ps ON au.id = ps.user_id
    )
  );
END;
$function$;

-- Nem `anon` nem o mundo. Só sessão autenticada chega à função — e, dentro
-- dela, só o administrador passa da guarda.
REVOKE ALL ON FUNCTION public.get_admin_metrics() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_metrics() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_metrics() TO authenticated;
