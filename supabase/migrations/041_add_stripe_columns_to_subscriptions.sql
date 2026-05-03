-- Migration: Adiciona colunas do Stripe na tabela subscriptions
-- Necessário para o webhook gravar dados da compra

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_session_id text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Garante que cada usuário tenha apenas 1 linha (necessário para o upsert)
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_user_id_key;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_user_id_key UNIQUE (user_id);

SELECT 'Colunas Stripe adicionadas com sucesso!' as resultado;
