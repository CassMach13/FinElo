-- Totais conferidos manualmente por competência (substituem parcialmente o motor ao recalcular).
alter table public.credit_card_statements
  add column if not exists manual_totals_json jsonb null;

comment on column public.credit_card_statements.manual_totals_json is
  '{"use_manual":true,"statement_total":123.45,"total_payments":100} — valores opcionais; ausentes preservam o calculado pelo motor.';
