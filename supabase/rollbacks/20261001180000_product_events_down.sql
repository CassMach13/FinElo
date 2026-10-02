-- Rollback de 20261001180000_product_events.sql
--
-- Remove a tabela e, com ela, os índices, as policies e os eventos coletados.
-- É destrutivo para os dados de analytics: exporte antes, se forem necessários.

DROP TABLE IF EXISTS public.product_events;
