\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, raw_app_meta_data) values
  ('17000000-0000-0000-0000-000000000001', 'sprint2c-competence@example.invalid', '{"atomic_card_rebuild_enabled":true}');

insert into public.contas (
  id, user_id, "Nome_Conta", "Tipo_Conta", "Saldo_Inicial", "Data_Saldo_Inicial"
) values (
  '27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001',
  'Cartão Competência', 'Cartão de Crédito', 0, '2026-01-01'
);

insert into public.credit_cards (id, user_id, account_id, name, closing_day, due_day) values
  ('37000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001', 'Cartão Competência', 3, 10);

insert into public.credit_card_import_lots (
  id, user_id, card_id, account_id, source_file_name,
  statement_due_year, statement_due_month, statement_due_date,
  purchase_reference_label
) values (
  '47000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001',
  '37000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001',
  'fatura-agosto.csv', 2026, 7, '2026-08-10', '2026-07'
);

insert into public.transactions (
  "ID_Transacao", user_id, "ID_Conta", "Data", "Descricao_Original",
  "Nome_Fantasia", "Valor", "Tipo", "Categoria", "Origem", "Fonte"
) values (
  '57000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001',
  '27000000-0000-0000-0000-000000000001', '2026-07-20T12:00:00Z', 'COMPRA TESTE',
  'COMPRA TESTE', -100, 'Despesa', 'Teste', 'fatura-agosto.csv', 'Teste'
);

insert into public.credit_card_statements (
  id, user_id, card_id, account_id, reference_label, purchase_reference_label,
  due_year, due_month, due_date, source_import_lot_ids,
  total_purchases, statement_total, total_payments, open_balance,
  total_charges, total_credits, open_amount, status, manual_totals_json
) values (
  '67000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001',
  '37000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001',
  '2026-07', '2026-07', 2026, 7, '2026-08-10',
  '["47000000-0000-0000-0000-000000000001"]',
  100, 100, 0, 100, 100, 0, 100, 'open', '{"user_note":"preservar"}'
);

insert into public.credit_card_entries (
  id, user_id, card_id, account_id, import_lot_id, source_file_name,
  source_row_index, source_row_hash, transaction_id, statement_id,
  posted_date, amount, abs_amount, direction, entry_type
) values (
  '77000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001',
  '37000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001',
  '47000000-0000-0000-0000-000000000001', 'fatura-agosto.csv', 1, 'row-july',
  '57000000-0000-0000-0000-000000000001', '67000000-0000-0000-0000-000000000001',
  '2026-07-20', -100, 100, 'debit', 'purchase'
);

select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000001', true);

do $$
declare
  before_revision text;
  activation jsonb;
  snapshot_id uuid;
  rollback_result jsonb;
begin
  before_revision := public.get_credit_card_projection_revision(
    '27000000-0000-0000-0000-000000000001'
  );

  activation := public.activate_credit_card_projection_atomic_v2(
    '27000000-0000-0000-0000-000000000001',
    before_revision,
    'shadow-v1-89abcdef',
    '[
      {"statementKey":"2026-07","purchaseReferenceMonth":"2026-07","dueDate":"2026-08-10","dueYear":2026,"dueMonth":7,"status":"open","totalPurchasesCents":9000,"totalFeesCents":0,"totalInterestCents":0,"totalRefundsCents":0,"statementTotalCents":9000,"totalPaymentsCents":0,"openBalanceCents":9000}
    ]'::jsonb,
    '[
      {"transactionId":"57000000-0000-0000-0000-000000000001","statementKey":"2026-07","postedDate":"2026-07-20","amountCents":-9000,"entryType":"purchase"}
    ]'::jsonb,
    '[]'::jsonb
  );
  snapshot_id := (activation->>'snapshot_id')::uuid;

  if not exists (
    select 1
    from public.credit_card_statements
    where id = '67000000-0000-0000-0000-000000000001'
      and reference_label = '2026-07'
      and due_year = 2026
      and due_month = 7
      and due_date = '2026-08-10'
      and statement_total = 90
      and manual_totals_json->>'user_note' = 'preservar'
      and atomic_projection_snapshot_id = snapshot_id
  ) then
    raise exception 'A ativação deslocou a competência, perdeu o vencimento ou descartou metadados.';
  end if;

  if (activation->>'after_revision') <>
     public.get_credit_card_projection_revision('27000000-0000-0000-0000-000000000001') then
    raise exception 'A revisão final do wrapper não inclui o vencimento civil restaurado.';
  end if;

  rollback_result := public.rollback_credit_card_projection_atomic(snapshot_id);
  if not (rollback_result->>'rolled_back')::boolean then
    raise exception 'O rollback da ativação por competência não foi confirmado.';
  end if;
  if public.get_credit_card_projection_revision('27000000-0000-0000-0000-000000000001') <> before_revision then
    raise exception 'O rollback não restaurou a revisão original.';
  end if;
  if not exists (
    select 1
    from public.credit_card_statements
    where id = '67000000-0000-0000-0000-000000000001'
      and due_date = '2026-08-10'
      and statement_total = 100
      and atomic_projection_version is null
  ) then
    raise exception 'O rollback não restaurou a fatura original.';
  end if;
end;
$$;

rollback;
