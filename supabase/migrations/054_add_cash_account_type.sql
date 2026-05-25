-- Permite conta "Dinheiro em Espécie" (sem vínculo bancário)
-- Tabela real em produção: public.contas (não "accounts")

ALTER TABLE public.contas
DROP CONSTRAINT IF EXISTS "contas_Tipo_Conta_check";

ALTER TABLE public.contas
ADD CONSTRAINT "contas_Tipo_Conta_check"
CHECK (
  "Tipo_Conta" IN (
    'Conta Corrente',
    'Poupança',
    'Investimento',
    'Cartão de Crédito',
    'Cartão Alimentação',
    'Dinheiro em Espécie',
    'Outro'
  )
);
