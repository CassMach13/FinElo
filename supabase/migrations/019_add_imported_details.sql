-- Migração para adicionar detalhes das transações importadas com sucesso

-- 1. Adicionar coluna 'imported_details' na tabela 'import_logs'
ALTER TABLE public.import_logs ADD COLUMN IF NOT EXISTS imported_details JSONB DEFAULT '[]'::jsonb;

-- 2. Atualizar logs existentes para ter no mínimo o array vazio
UPDATE public.import_logs SET imported_details = '[]'::jsonb WHERE imported_details IS NULL;

-- 3. Caso o RL (Row Level Security) precise permitir o novo campo, mas no Supabase insert/update costumam incluir todas as colunas declaradas na tabela se quem estiver inserindo for o dono (auth.uid() = user_id).
-- Como as policies operam ao nível da linha (row), nenhuma change extra de Security Policy é estritamente necessária só por ter adicionado uma coluna.
