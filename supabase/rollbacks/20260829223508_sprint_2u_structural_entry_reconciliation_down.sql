-- Rollback de schema da Sprint 2U. Não altera lançamentos nem tenta desfazer
-- snapshots aplicados; use o RPC de rollback de dados antes de remover o contrato.

begin;

revoke all on function public.rollback_credit_card_structural_entries_atomic_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.reconcile_credit_card_structural_entries_atomic_v1(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.get_atomic_card_structural_entry_feature_state()
  from public, anon, authenticated, service_role;

drop function if exists public.rollback_credit_card_structural_entries_atomic_v1(uuid);
drop function if exists public.reconcile_credit_card_structural_entries_atomic_v1(
  uuid, text, text, jsonb
);
drop function if exists public.get_atomic_card_structural_entry_feature_state();

drop function if exists
  finelo_internal.rollback_credit_card_structural_entries_atomic_v1_impl(uuid);
drop function if exists
  finelo_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(
    uuid, text, text, jsonb
  );
drop function if exists
  finelo_internal.get_atomic_card_structural_entry_feature_state_impl();

drop table if exists
  finelo_internal.credit_card_entry_reconciliation_snapshots;

revoke execute on function
  finelo_internal.get_credit_card_projection_revision_for_user(uuid, uuid)
  from finelo_structural_entry_executor;
revoke update (transaction_id, statement_id, entry_type)
  on table public.credit_card_entries
  from finelo_structural_entry_executor;
revoke select on table public.credit_card_entries
  from finelo_structural_entry_executor;
revoke select on table public.credit_card_payments
  from finelo_structural_entry_executor;
revoke select on table public.credit_card_statements
  from finelo_structural_entry_executor;
revoke select on table public.transactions
  from finelo_structural_entry_executor;
revoke select on table public.credit_cards
  from finelo_structural_entry_executor;
revoke select on table public.contas
  from finelo_structural_entry_executor;
revoke usage on schema public
  from finelo_structural_entry_executor;
revoke usage on schema finelo_internal
  from finelo_structural_entry_executor;
revoke usage on schema finelo_internal
  from finelo_structural_entry_gateway;

drop role if exists finelo_structural_entry_executor;
drop role if exists finelo_structural_entry_gateway;

commit;
