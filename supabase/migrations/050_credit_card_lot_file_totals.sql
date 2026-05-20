-- Totais oficiais do arquivo de fatura (fonte primária para exibição e limite).
alter table public.credit_card_import_lots
  add column if not exists statement_total_from_file numeric(15,2) null,
  add column if not exists total_payments_from_file numeric(15,2) null,
  add column if not exists lines_computed_total numeric(15,2) null;

comment on column public.credit_card_import_lots.statement_total_from_file is
  'Total da fatura conforme rodapé/resumo do arquivo importado (prioridade sobre soma de linhas).';
comment on column public.credit_card_import_lots.total_payments_from_file is
  'Total de pagamentos no arquivo ou soma de linhas invoice_payment do lote.';
comment on column public.credit_card_import_lots.lines_computed_total is
  'Soma calculada pelo motor (auditoria / divergência vs arquivo).';

alter table public.credit_card_statements
  add column if not exists statement_total_from_file numeric(15,2) null,
  add column if not exists total_payments_from_file numeric(15,2) null,
  add column if not exists lines_computed_total numeric(15,2) null;

comment on column public.credit_card_statements.statement_total_from_file is
  'Total oficial da competência (propagado do lote / arquivo).';
comment on column public.credit_card_statements.total_payments_from_file is
  'Pagamentos oficiais da competência (arquivo ou lote).';
comment on column public.credit_card_statements.lines_computed_total is
  'Soma das linhas no motor — comparar com statement_total_from_file.';
