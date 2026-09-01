-- Rollback da fase «expand» do modelo de dois livros.
--
-- Seguro por construção: a fase expand é puramente aditiva, então desfazê-la
-- apenas remove o que ela criou. As colunas antigas (`statement_total_from_file`,
-- `lines_computed_total`) nunca foram tocadas e seguem intactas, com os mesmos
-- valores — nenhum dado financeiro é perdido ao reverter.
--
-- Atenção: descarta os registros de `credit_card_reconciliation_resolutions`.
-- Se houver resoluções gravadas, exporte-as antes de reverter.

begin;

drop table if exists public.credit_card_reconciliation_resolutions;

alter table public.credit_card_competence_payment_confirmations
  drop constraint if exists cc_competence_payment_confirm_type_check;
alter table public.credit_card_competence_payment_confirmations
  drop column if exists confirmation_type;

alter table public.credit_card_statements
  drop constraint if exists credit_card_statements_authoritative_source_check,
  drop constraint if exists credit_card_statements_authoritative_provenance_check,
  drop constraint if exists credit_card_statements_economic_status_check,
  drop constraint if exists credit_card_statements_reconciliation_status_check;

alter table public.credit_card_statements
  drop column if exists authoritative_statement_total,
  drop column if exists authoritative_source,
  drop column if exists authoritative_recorded_at,
  drop column if exists authoritative_recorded_by,
  drop column if exists reconciliation_adjustment,
  drop column if exists unresolved_reconciliation_delta,
  drop column if exists economic_status,
  drop column if exists reconciliation_status,
  drop column if exists file_reported_total,
  drop column if exists computed_lines_total;

alter table public.credit_card_import_lots
  drop column if exists file_reported_total,
  drop column if exists computed_lines_total;

commit;
