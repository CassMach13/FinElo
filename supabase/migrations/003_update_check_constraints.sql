-- Update check constraint for import_configs table
ALTER TABLE import_configs 
DROP CONSTRAINT IF EXISTS "import_configs_Tipo_Fonte_check";

ALTER TABLE import_configs 
ADD CONSTRAINT "import_configs_Tipo_Fonte_check" 
CHECK ("Tipo_Fonte" IN ('Conta', 'Cartao', 'Cartão Alimentação'));

-- Update check constraint for accounts table (proactive fix)
ALTER TABLE accounts 
DROP CONSTRAINT IF EXISTS "accounts_Tipo_Conta_check";

ALTER TABLE accounts 
ADD CONSTRAINT "accounts_Tipo_Conta_check" 
CHECK ("Tipo_Conta" IN ('Conta Corrente', 'Poupança', 'Investimento', 'Cartão de Crédito', 'Cartão Alimentação', 'Outro'));
