-- Executar somente depois de desligar VITE_ATOMIC_IMPORTS_ENABLED no ambiente.
-- O rollback remove apenas objetos da Sprint 1A; não altera transações ou logs existentes.

drop function if exists public.get_finelo_integrity_dry_run();
drop trigger if exists trg_prevent_new_cc_entry_transaction_duplicate on public.credit_card_entries;
drop function if exists public.prevent_new_credit_card_entry_transaction_duplicate();
drop index if exists public.idx_cc_entries_transaction_id_guard;
drop function if exists public.import_transactions_atomic(text, text, uuid, jsonb, integer, jsonb, jsonb);
drop table if exists public.import_batches;
