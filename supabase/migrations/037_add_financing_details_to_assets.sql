-- 037_add_financing_details_to_assets.sql
-- Adiciona suporte a taxa de juros (financiamento) e taxa administrativa (consórcio)

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS financing_type TEXT CHECK (financing_type IN ('financing', 'consortium')),
  ADD COLUMN IF NOT EXISTS monthly_interest_rate NUMERIC,      -- ex: 0.89 para 0,89% ao mês
  ADD COLUMN IF NOT EXISTS consortium_admin_rate NUMERIC;      -- ex: 20 para 20% total

COMMENT ON COLUMN public.assets.financing_type IS 'Tipo do compromisso: financing (financiamento) ou consortium (consórcio)';
COMMENT ON COLUMN public.assets.monthly_interest_rate IS 'Taxa de juros mensal do financiamento (ex: 0.89 = 0.89%)';
COMMENT ON COLUMN public.assets.consortium_admin_rate IS 'Taxa administrativa total do consórcio em % (ex: 20 = 20%)';
