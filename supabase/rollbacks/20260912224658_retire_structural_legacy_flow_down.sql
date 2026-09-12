-- Rollback conservador da capacidade administrativa de aposentadoria.
--
-- IMPORTANTE: este rollback jamais restaura apply/rollback estrutural, grants
-- antigos ou escrita no snapshot. Se houver snapshot ativo OU aposentado, ele
-- recusa a reversao. Reabrir o legado exigiria uma migration manual, revisada e
-- explicitamente autorizada; este arquivo nao contem esse caminho.

begin;

do $fail_closed_precondition$
begin
  if pg_catalog.to_regclass(
       'finelo_structural_internal.credit_card_entry_reconciliation_retirements'
     ) is not null
     and exists (
       select 1
       from finelo_structural_internal.credit_card_entry_reconciliation_retirements
     ) then
    raise exception
      'Rollback recusado: existe decisao de aposentadoria e ela nao pode ser apagada.'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regclass(
       'finelo_structural_internal.credit_card_entry_reconciliation_snapshots'
     ) is not null
     and exists (
       select 1
       from finelo_structural_internal.credit_card_entry_reconciliation_snapshots s
       where s.rolled_back_at is null
     ) then
    raise exception
      'Rollback recusado: existe snapshot estrutural ativo. O caminho legado permanecera fechado.'
      using errcode = '55000';
  end if;
end;
$fail_closed_precondition$;

drop function if exists public.retire_credit_card_structural_snapshot_v1(
  uuid, uuid, uuid, text, integer, text, uuid
);
drop function if exists
  finelo_structural_internal.retire_credit_card_structural_snapshot_v1_impl(
    uuid, uuid, uuid, text, integer, text, uuid
  );
drop policy if exists "Retirement executor reads structural snapshots"
  on finelo_structural_internal.credit_card_entry_reconciliation_snapshots;
revoke select on table
  finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  from finelo_structural_retirement_executor;
revoke usage on schema finelo_structural_internal
  from finelo_structural_retirement_executor;
drop trigger if exists trg_reject_retirement_update_delete
  on finelo_structural_internal.credit_card_entry_reconciliation_retirements;
drop function if exists finelo_structural_internal.reject_retirement_mutation_v1();
drop table if exists
  finelo_structural_internal.credit_card_entry_reconciliation_retirements;

-- Mantidos intencionalmente:
--   * structural_legacy_flow_state com apply_enabled=false;
--   * os corpos bloqueadores das quatro funcoes antigas;
--   * os REVOKEs de apply/rollback;
--   * trg_reject_legacy_snapshot_mutation;
--   * ux_structural_snapshot_single_unrolled_per_card.
-- Assim, remover a RPC administrativa nao reabre silenciosamente o legado.

drop role if exists finelo_structural_retirement_executor;

commit;
