\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, raw_app_meta_data) values
  ('16000000-0000-0000-0000-000000000001', 'sprint2c@example.invalid', '{"atomic_card_rebuild_enabled":true}'),
  ('16000000-0000-0000-0000-000000000002', 'other@example.invalid', '{}');

insert into public.contas (id, user_id, "Nome_Conta", "Tipo_Conta") values
  ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001', 'Cartão Sprint 2C', 'Cartão de Crédito');

insert into public.credit_cards (id, user_id, account_id, name, closing_day, due_day) values
  ('36000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', 'Cartão Sprint 2C', 19, 28);

insert into public.credit_card_import_lots (
  id, user_id, card_id, account_id, source_file_name,
  statement_due_year, statement_due_month, statement_due_date,
  purchase_reference_label, statement_total_from_file, total_payments_from_file
) values
  ('46000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', 'julho.csv', 2026, 7, '2026-07-28', '2026-06', 100, 0),
  ('46000000-0000-0000-0000-000000000002', '16000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', 'agosto.csv', 2026, 8, '2026-08-28', '2026-07', 50, 100);

insert into public.transactions ("ID_Transacao", user_id, "ID_Conta", "Data", "Valor") values
  ('56000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '2026-06-10T12:00:00Z', -100),
  ('56000000-0000-0000-0000-000000000002', '16000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '2026-07-10T12:00:00Z', -50),
  ('56000000-0000-0000-0000-000000000003', '16000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '2026-07-20T12:00:00Z', 100);

insert into public.credit_card_statements (
  id, user_id, card_id, account_id, reference_label, purchase_reference_label,
  due_year, due_month, due_date, source_import_lot_ids,
  total_purchases, statement_total, total_payments, open_balance,
  total_charges, total_credits, open_amount, status,
  statement_total_from_file, total_payments_from_file, manual_totals_json
) values
  ('66000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '2026-07', '2026-06', 2026, 7, '2026-07-28', '["46000000-0000-0000-0000-000000000001"]', 100, 100, 0, 100, 100, 0, 100, 'open', 100, 0, '{"use_manual":false,"user_note":"preservar"}'),
  ('66000000-0000-0000-0000-000000000002', '16000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '2026-08', '2026-07', 2026, 8, '2026-08-28', '["46000000-0000-0000-0000-000000000002"]', 50, 50, 100, 0, 50, 0, 0, 'paid', 50, 100, null);

insert into public.credit_card_entries (
  id, user_id, card_id, account_id, import_lot_id, source_file_name,
  source_row_index, source_row_hash, transaction_id, statement_id,
  posted_date, amount, abs_amount, direction, entry_type
) values
  ('76000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '46000000-0000-0000-0000-000000000001', 'julho.csv', 1, 'row-july', '56000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000001', '2026-06-10', -100, 100, 'debit', 'purchase'),
  ('76000000-0000-0000-0000-000000000002', '16000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '46000000-0000-0000-0000-000000000002', 'agosto.csv', 1, 'row-aug', '56000000-0000-0000-0000-000000000002', '66000000-0000-0000-0000-000000000002', '2026-07-10', -50, 50, 'debit', 'purchase'),
  ('76000000-0000-0000-0000-000000000003', '16000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '46000000-0000-0000-0000-000000000002', 'agosto.csv', 2, 'row-payment', '56000000-0000-0000-0000-000000000003', '66000000-0000-0000-0000-000000000002', '2026-07-20', 100, 100, 'credit', 'invoice_payment');

insert into public.credit_card_payments (
  id, user_id, card_id, statement_id, payment_transaction_id,
  payment_date, amount, source, notes
) values (
  '86000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001',
  '36000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000002',
  '56000000-0000-0000-0000-000000000003', '2026-07-20', 100,
  'imported_statement', 'proveniência preservada'
);

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);

do $$
declare
  before_revision text;
  activation jsonb;
  snapshot_id uuid;
  failed boolean := false;
  rollback_result jsonb;
begin
  before_revision := public.get_credit_card_projection_revision('26000000-0000-0000-0000-000000000001');

  if has_table_privilege('authenticated', 'public.credit_card_atomic_rebuild_snapshots', 'INSERT')
     or has_table_privilege('authenticated', 'public.credit_card_atomic_rebuild_snapshots', 'UPDATE')
     or has_table_privilege('authenticated', 'public.credit_card_atomic_rebuild_snapshots', 'DELETE') then
    raise exception 'O cliente autenticado consegue adulterar snapshots diretamente.';
  end if;

  activation := public.activate_credit_card_projection_atomic(
    '26000000-0000-0000-0000-000000000001',
    before_revision,
    'shadow-v1-1234abcd',
    '[
      {"statementKey":"2026-07","purchaseReferenceMonth":"2026-06","dueDate":"2026-07-28","dueYear":2026,"dueMonth":7,"status":"paid","totalPurchasesCents":10000,"totalFeesCents":0,"totalInterestCents":0,"totalRefundsCents":0,"statementTotalCents":10000,"totalPaymentsCents":10000,"openBalanceCents":0},
      {"statementKey":"2026-08","purchaseReferenceMonth":"2026-07","dueDate":"2026-08-28","dueYear":2026,"dueMonth":8,"status":"open","totalPurchasesCents":5000,"totalFeesCents":0,"totalInterestCents":0,"totalRefundsCents":0,"statementTotalCents":5000,"totalPaymentsCents":0,"openBalanceCents":5000}
    ]'::jsonb,
    '[
      {"transactionId":"56000000-0000-0000-0000-000000000001","statementKey":"2026-07","postedDate":"2026-06-10","amountCents":-10000,"entryType":"purchase"},
      {"transactionId":"56000000-0000-0000-0000-000000000002","statementKey":"2026-08","postedDate":"2026-07-10","amountCents":-5000,"entryType":"purchase"},
      {"transactionId":"56000000-0000-0000-0000-000000000003","statementKey":"2026-08","postedDate":"2026-07-20","amountCents":10000,"entryType":"invoice_payment"}
    ]'::jsonb,
    '[
      {"transactionId":"56000000-0000-0000-0000-000000000003","statementKey":"2026-07","paymentDate":"2026-07-20","amountCents":10000,"source":"imported_statement"}
    ]'::jsonb
  );
  snapshot_id := (activation->>'snapshot_id')::uuid;

  if (activation->>'before_revision') <> before_revision then
    raise exception 'A ativação não preservou a revisão anterior.';
  end if;
  if (activation->>'after_revision') = before_revision then
    raise exception 'A revisão não mudou após a ativação.';
  end if;
  if not exists (
    select 1 from public.credit_card_statements
    where reference_label = '2026-07'
      and total_payments = 100 and open_balance = 0
      and atomic_projection_version = 1
      and atomic_projection_snapshot_id = snapshot_id
      and manual_totals_json->>'user_note' = 'preservar'
      and statement_total_from_file = 100
  ) then
    raise exception 'A fatura de julho não foi conciliada ou perdeu metadados protegidos.';
  end if;
  if not exists (
    select 1 from public.credit_card_statements
    where reference_label = '2026-08'
      and total_payments = 0 and open_balance = 50
      and total_payments_from_file = 100
  ) then
    raise exception 'A fatura de agosto não separou evidência do arquivo e conciliação ativa.';
  end if;
  if not exists (
    select 1 from public.credit_card_payments
    where id = '86000000-0000-0000-0000-000000000001'
      and statement_id = '66000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'O pagamento não foi movido para a fatura anterior.';
  end if;

  begin
    perform public.activate_credit_card_projection_atomic(
      '26000000-0000-0000-0000-000000000001', before_revision,
      'shadow-v1-1234abcd', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
    );
  exception when serialization_failure then
    failed := true;
  end;
  if not failed then
    raise exception 'Uma revisão obsoleta foi aceita.';
  end if;
  if (select count(*) from public.credit_card_atomic_rebuild_snapshots) <> 1 then
    raise exception 'A tentativa obsoleta criou um snapshot indevido.';
  end if;

  update public.credit_card_statements set total_payments = 1
  where id = '66000000-0000-0000-0000-000000000002';
  failed := false;
  begin
    perform public.rollback_credit_card_projection_atomic(snapshot_id);
  exception when serialization_failure then
    failed := true;
  end;
  if not failed then
    raise exception 'Rollback concorrente deveria ter sido recusado.';
  end if;

  update public.credit_card_statements set total_payments = 0
  where id = '66000000-0000-0000-0000-000000000002';
  rollback_result := public.rollback_credit_card_projection_atomic(snapshot_id);
  if not (rollback_result->>'rolled_back')::boolean then
    raise exception 'Rollback não foi confirmado.';
  end if;
  if public.get_credit_card_projection_revision('26000000-0000-0000-0000-000000000001') <> before_revision then
    raise exception 'Rollback não restaurou a revisão exata.';
  end if;
  if not exists (
    select 1 from public.credit_card_statements
    where reference_label = '2026-08'
      and total_payments = 100 and open_balance = 0
      and atomic_projection_version is null
  ) then
    raise exception 'Rollback não restaurou os totais originais.';
  end if;
end;
$$;

rollback;
