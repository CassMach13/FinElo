-- 035_add_linked_asset_id_to_mapping_rules.sql
-- Garante que o vínculo de ativos também persista nas regras de mapeamento

-- 1. Adiciona nas transações (caso ainda não tenha sido adicionado)
ALTER TABLE IF EXISTS public.transactions 
ADD COLUMN IF NOT EXISTS linked_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL;

-- 2. Adiciona nas regras de mapeamento
ALTER TABLE IF EXISTS public.mapping_rules 
ADD COLUMN IF NOT EXISTS linked_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.transactions.linked_asset_id IS 'ID do ativo relacionado a esta transação';
COMMENT ON COLUMN public.mapping_rules.linked_asset_id IS 'ID do ativo a ser vinculado automaticamente por esta regra';
