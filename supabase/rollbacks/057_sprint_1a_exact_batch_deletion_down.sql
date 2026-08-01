-- Executar antes do rollback 056. Não altera transações nem logs existentes.
drop function if exists public.delete_import_batch_atomic(uuid);
