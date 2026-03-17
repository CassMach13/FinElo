-- Adiciona a coluna source_file na tabela investments para rastreamento
ALTER TABLE public.investments ADD COLUMN IF NOT EXISTS source_file TEXT;
