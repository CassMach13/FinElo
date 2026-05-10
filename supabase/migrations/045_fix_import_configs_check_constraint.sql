-- Migration: 045_fix_import_configs_check_constraint.sql
-- Description: Updates the check constraint for Tipo_Fonte in import_configs table to match the accounts table and frontend options.

ALTER TABLE import_configs 
DROP CONSTRAINT IF EXISTS "import_configs_Tipo_Fonte_check";

ALTER TABLE import_configs 
ADD CONSTRAINT "import_configs_Tipo_Fonte_check" 
CHECK ("Tipo_Fonte" IN (
    'Conta', 
    'Cartao', 
    'Conta Corrente', 
    'Poupança', 
    'Investimento', 
    'Cartão de Crédito', 
    'Cartão Alimentação', 
    'Outro'
));
