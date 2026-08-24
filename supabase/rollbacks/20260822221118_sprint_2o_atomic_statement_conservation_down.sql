begin;

grant finelo_statement_conservation_executor to postgres;

drop function if exists public.rollback_credit_card_statement_conservation_atomic_v1(uuid);
drop function if exists public.conserve_credit_card_statement_duplicates_atomic_v1(
  uuid, text, text, text, uuid[], integer, integer, jsonb
);
drop function if exists public.get_atomic_card_statement_conservation_feature_state();

drop function if exists finelo_internal.rollback_credit_card_statement_conservation_atomic_v1_impl(uuid);
drop function if exists finelo_internal.conserve_credit_card_statement_duplicates_atomic_v1_impl(
  uuid, text, text, text, uuid[], integer, integer, jsonb
);
drop function if exists finelo_internal.get_credit_card_projection_revision_for_user(uuid, uuid);
drop function if exists finelo_internal.get_atomic_card_statement_conservation_feature_state_impl();

drop table if exists public.credit_card_statement_conservation_snapshots;
drop schema if exists finelo_internal;

drop owned by finelo_statement_conservation_executor;
revoke finelo_statement_conservation_executor from postgres;
drop role if exists finelo_statement_conservation_executor;

commit;
