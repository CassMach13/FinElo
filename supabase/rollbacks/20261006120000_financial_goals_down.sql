-- Rollback de 20261006120000_financial_goals.sql
--
-- Remove a tabela e, com ela, o índice, o trigger, as policies e os objetivos gravados.
-- É destrutivo para os dados de objetivos: exporte antes, se forem necessários.
-- Não remove `public.handle_updated_at()`, que é compartilhada com outras tabelas.

DROP TABLE IF EXISTS public.financial_goals;
