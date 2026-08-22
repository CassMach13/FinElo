drop function if exists public.rollback_credit_card_statement_conservation_atomic_v1(uuid);
drop function if exists public.conserve_credit_card_statement_duplicates_atomic_v1(
  uuid, text, text, text, uuid[], integer, integer, jsonb
);
drop function if exists public.get_atomic_card_statement_conservation_feature_state();
drop table if exists public.credit_card_statement_conservation_snapshots;
