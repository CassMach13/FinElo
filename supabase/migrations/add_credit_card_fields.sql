-- Migration: Adicionar campos de Cartão de Crédito na tabela contas
-- Execute este SQL no painel do Supabase > SQL Editor

ALTER TABLE contas
  ADD COLUMN IF NOT EXISTS limite_credito NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS dia_vencimento INTEGER,
  ADD COLUMN IF NOT EXISTS dia_fechamento INTEGER;

-- Comentários para documentação
COMMENT ON COLUMN contas.limite_credito IS 'Limite total do cartão de crédito (ex: 10000.00)';
COMMENT ON COLUMN contas.dia_vencimento IS 'Dia do mês em que a fatura vence (1-31)';
COMMENT ON COLUMN contas.dia_fechamento IS 'Dia do mês em que a fatura fecha (1-31)';
