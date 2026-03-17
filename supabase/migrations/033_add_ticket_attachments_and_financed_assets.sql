-- 033_add_ticket_attachments_and_financed_assets.sql
-- Adiciona suporte a anexos em chamados e campos de financiamento em ativos

-- 1. Suporte a anexos nos chamados e mensagens
ALTER TABLE IF EXISTS public.support_tickets 
ADD COLUMN IF NOT EXISTS attachment_url TEXT;

ALTER TABLE IF EXISTS public.support_messages 
ADD COLUMN IF NOT EXISTS attachment_url TEXT;

-- 2. Campos de financiamento para a tabela de ativos (assets)
ALTER TABLE IF EXISTS public.assets 
ADD COLUMN IF NOT EXISTS is_financed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS financed_amount NUMERIC,
ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC,
ADD COLUMN IF NOT EXISTS installment_value NUMERIC,
ADD COLUMN IF NOT EXISTS total_installments INTEGER,
ADD COLUMN IF NOT EXISTS paid_installments INTEGER;

-- Comentários para documentação no Supabase
COMMENT ON COLUMN public.support_tickets.attachment_url IS 'URL do anexo inicial do chamado (Supabase Storage)';
COMMENT ON COLUMN public.support_messages.attachment_url IS 'URL do anexo da mensagem (Supabase Storage)';
COMMENT ON COLUMN public.assets.remaining_balance IS 'Saldo devedor atual do bem financiado';
COMMENT ON COLUMN public.assets.is_financed IS 'Indica se o bem possui dívida ativa';
