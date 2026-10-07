-- Rollback de 20261007200000_economic_events_v1.sql
--
-- Remove a identidade econômica da Fase 1: coluna `transactions.economic_event_id` (e, com ela, a FK
-- composta e o índice), a tabela `economic_events` (e policies/trigger) e a função do trigger.
-- É destrutivo para os eventos gravados (só metadata; nenhuma transação é apagada) e só é seguro
-- ENQUANTO nenhum KPI ler `economic_event_id` (Fase 1). Depois da Fase 3, reverta o frontend primeiro.
--
-- NÃO toca no hardening de public.transactions (20261007180000): privilégios e policies de INSERT permanecem.

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_economic_event_owner_fkey;
DROP INDEX IF EXISTS public.idx_transactions_economic_event;
ALTER TABLE public.transactions DROP COLUMN IF EXISTS economic_event_id;

DROP TABLE IF EXISTS public.economic_events;
DROP FUNCTION IF EXISTS public.economic_events_check_counterparty();
