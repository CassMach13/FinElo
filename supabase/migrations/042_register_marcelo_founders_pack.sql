-- Migration: Registrar manualmente assinatura do Founder's Pack do Marcelo
-- Motivo: A compra foi feita antes do webhook ser configurado, então não foi capturada automaticamente.
-- Ação: Inserir/atualizar o registro de assinatura do Marcelo como Founder's Pack vitalício.

INSERT INTO public.subscriptions (user_id, plan_type, tier, status, unlimited_sync, family_slots, updated_at)
SELECT 
  au.id,
  'lifetime'   AS plan_type,
  'wealth'     AS tier,
  'lifetime'   AS status,
  true         AS unlimited_sync,   -- Sync ilimitado com Open Finance
  5            AS family_slots,     -- Slots do plano família
  now()        AS updated_at
FROM auth.users au
WHERE au.email = 'marcelo@m3transportes.com'
ON CONFLICT (user_id) DO UPDATE SET
  plan_type      = 'lifetime',
  tier           = 'wealth',
  status         = 'lifetime',
  unlimited_sync = true,
  family_slots   = 5,
  updated_at     = now();

-- Verificação: deve retornar 1 linha com plan_type = 'lifetime'
SELECT au.email, ps.plan_type, ps.tier, ps.status
FROM public.subscriptions ps
JOIN auth.users au ON au.id = ps.user_id
WHERE au.email = 'marcelo@m3transportes.com';
