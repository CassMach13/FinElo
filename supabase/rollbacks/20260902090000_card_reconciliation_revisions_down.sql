-- Rollback dos contadores de revisão de reconciliação.
--
-- Remove os gatilhos, as funções, os contadores, o schema privado e o papel
-- dedicado. Nenhum dado financeiro é tocado: os contadores são DERIVADOS —
-- existem para dizer «alguma entrada mudou desde o snapshot», e não guardam
-- nenhuma informação que não possa ser reconstruída invalidando tudo.
--
-- Sentido seguro da perda: se a migration for reaplicada, os contadores
-- recomeçam do zero. Um snapshot antigo guardando `account_revision = 7`
-- compara contra 1, não bate, e é tratado como stale — recalcula. A reversão
-- pode causar recálculo desnecessário, nunca um snapshot stale aceito como
-- válido. É a direção de erro que queremos.
--
-- Os gatilhos são removidos ANTES das funções: soltar a função primeiro
-- deixaria gatilhos apontando para nada e quebraria escritas em `transactions`,
-- `contas` e `import_logs`.

begin;

drop trigger if exists trg_transactions_reconciliation_revision on public.transactions;
drop trigger if exists trg_confirmations_reconciliation_revision
  on public.credit_card_competence_payment_confirmations;
drop trigger if exists trg_resolutions_reconciliation_revision
  on public.credit_card_reconciliation_resolutions;
drop trigger if exists trg_reversals_reconciliation_revision
  on public.credit_card_reconciliation_resolution_reversals;
drop trigger if exists trg_statement_authoritative_revision on public.credit_card_statements;
drop trigger if exists trg_contas_reconciliation_revision on public.contas;
drop trigger if exists trg_contas_lifecycle_reconciliation_revision on public.contas;
drop trigger if exists trg_import_logs_reconciliation_revision on public.import_logs;
drop trigger if exists trg_import_logs_update_reconciliation_revision on public.import_logs;

drop function if exists finelo_reconciliation_internal.tg_transactions_revision();
drop function if exists finelo_reconciliation_internal.tg_account_scoped_revision();
drop function if exists finelo_reconciliation_internal.tg_statement_authoritative_revision();
drop function if exists finelo_reconciliation_internal.tg_contas_revision();
drop function if exists finelo_reconciliation_internal.tg_contas_lifecycle_revision();
drop function if exists finelo_reconciliation_internal.tg_import_logs_revision();
drop function if exists finelo_reconciliation_internal.current_revisions(uuid, uuid);
drop function if exists finelo_reconciliation_internal.bump_account_revision(uuid, uuid);
drop function if exists finelo_reconciliation_internal.bump_user_context_revision(uuid);

drop table if exists finelo_reconciliation_internal.account_revisions;
drop table if exists finelo_reconciliation_internal.user_context_revisions;

drop schema if exists finelo_reconciliation_internal cascade;

-- O papel só pode cair depois que todos os objetos que ele possuía sumiram.
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'finelo_reconciliation_executor') then
    revoke usage on schema public from finelo_reconciliation_executor;
    drop role finelo_reconciliation_executor;
  end if;
end $$;

commit;
