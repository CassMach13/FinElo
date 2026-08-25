-- Rollback da Sprint 2T. Remove apenas a superfície criada nesta migration.
-- Dados de faturas não são tocados; snapshots da Sprint 2T são removidos.

begin;

-- O owner dedicado não é membro permanente de postgres. A associação é
-- readquirida somente dentro desta transação para permitir DROP OWNED e é
-- eliminada antes do COMMIT junto com o próprio papel.
grant finelo_derived_settlement_executor to postgres;
grant finelo_statement_conservation_executor to postgres;

drop function if exists public.rollback_credit_card_derived_settlement_atomic_v1(uuid);
drop function if exists public.reconcile_credit_card_derived_settlement_atomic_v1(
  uuid, text, text, jsonb
);
drop function if exists public.get_atomic_card_derived_settlement_feature_state();

drop function if exists finelo_internal.rollback_credit_card_derived_settlement_atomic_v1_impl(uuid);
drop function if exists finelo_internal.reconcile_credit_card_derived_settlement_atomic_v1_impl(
  uuid, text, text, jsonb
);
drop function if exists finelo_internal.get_atomic_card_derived_settlement_feature_state_impl();

revoke update (total_payments, open_balance, open_amount, status)
  on table public.credit_card_statements
  from finelo_derived_settlement_executor;

-- Este privilégio incide sobre uma função preservada da Sprint 2O e, por isso,
-- precisa ser revogado explicitamente antes de remover o papel da Sprint 2T.
revoke execute on function finelo_internal.get_credit_card_projection_revision_for_user(uuid, uuid)
  from finelo_derived_settlement_executor;

-- A função preservada pertence ao executor da Sprint 2O, que é também o
-- grantor registrado desta ACL. Revogamos sob esse papel para remover a
-- dependência sem alterar ownership nem outras permissões da Sprint 2O.
set local role finelo_statement_conservation_executor;
revoke execute on function finelo_internal.get_credit_card_projection_revision_for_user(uuid, uuid)
  from finelo_derived_settlement_executor;
reset role;

drop table if exists public.credit_card_reconciliation_snapshots;

drop owned by finelo_derived_settlement_executor;
revoke finelo_derived_settlement_executor from postgres;
drop role if exists finelo_derived_settlement_executor;
revoke finelo_statement_conservation_executor from postgres;

commit;
