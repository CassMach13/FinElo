-- 034_link_transactions_to_assets.sql
-- Adiciona vínculo entre transações e ativos para automação de abatimento de dívidas

ALTER TABLE IF EXISTS public.transactions 
ADD COLUMN IF NOT EXISTS linked_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.transactions.linked_asset_id IS 'ID do ativo relacionado a esta transação (ex: pagamento de financiamento)';
