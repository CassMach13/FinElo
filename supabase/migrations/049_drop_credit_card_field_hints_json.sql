-- Remove coluna legada de «apontamentos por cartão» (funcionalidade retirada da aplicação).
alter table public.credit_cards drop column if exists field_hints_json;
