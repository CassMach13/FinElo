-- Data da aplicação (importação XP / lançamento manual) e rendimento mensal esperado

ALTER TABLE public.investments
ADD COLUMN IF NOT EXISTS application_date date,
ADD COLUMN IF NOT EXISTS monthly_yield_rate text;

COMMENT ON COLUMN public.investments.application_date IS 'Data em que o recurso foi aplicado no produto.';
COMMENT ON COLUMN public.investments.monthly_yield_rate IS 'Rendimento/juros mensal informado pelo usuário ou planilha (texto livre, ex.: 0,8% ou R$ 150).';
