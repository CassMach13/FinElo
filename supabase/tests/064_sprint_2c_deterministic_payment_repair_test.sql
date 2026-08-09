\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, raw_app_meta_data) values
  ('18000000-0000-0000-0000-000000000001', 'sprint2c-repair@example.invalid', '{"atomic_card_rebuild_enabled":true}');

insert into public.contas (
  id, user_id, "Nome_Conta", "Tipo_Conta", "Saldo_Inicial", "Data_Saldo_Inicial"
) values (
  '28000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000001',
  'Cartão Reparo', 'Cartão de Crédito', 0, '2026-01-01'
);

insert into public.credit_cards (id, user_id, account_id, name, closing_day, due_day) values
  ('38000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000001',
   '28000000-0000-0000-0000-000000000001', 'Cartão Reparo', 3, 28);

insert into public.credit_card_import_lots (
  id, user_id, card_id, account_id, source_file_name,
  statement_due_year, statement_due_month, statement_due_date,
  purchase_reference_label
) values (
  '48000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000001',
  '38000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000001',
  'fatura-agosto.csv', 2026, 7, '2026-07-28', '2026-07'
);

insert into public.transactions (
  "ID_Transacao", user_id, "ID_Conta", "Data", "Descricao_Original",
  "Nome_Fantasia", "Valor", "Tipo", "Categoria", "Origem", "Fonte"
) values (
  '58000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000001',
  '28000000-0000-0000-0000-000000000001', '2026-08-20T12:00:00Z', 'PAGAMENTO FATURA',
  'PAGAMENTO FATURA', 399.90, 'Receita', 'Pagamento de Fatura', 'fatura-agosto.csv', 'Teste'
);

insert into public.credit_card_statements (
  id, user_id, card_id, account_id, reference_label, purchase_reference_label,
  due_year, due_month, due_date, total_purchases, statement_total,
  total_payments, open_balance, total_charges, total_credits, open_amount, status
) values (
  '68000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000001',
  '38000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000001',
  '2026-07', '2026-07', 2026, 7, '2026-07-28', 399.90, 399.90,
  399.90, 0, 399.90, 0, 0, 'paid'
);

insert into public.credit_card_entries (
  id, user_id, card_id, account_id, import_lot_id, source_file_name, source_row_index,
  source_row_hash, transaction_id, statement_id, posted_date, amount,
  abs_amount, direction, entry_type
) values (
  '78000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000001',
  '38000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000001',
  '48000000-0000-0000-0000-000000000001', 'fatura-agosto.csv', 4, 'canonical-row', '58000000-0000-0000-0000-000000000001',
  '68000000-0000-0000-0000-000000000001', '2026-08-20', 399.90, 399.90,
  'credit', 'invoice_payment'
);

insert into public.credit_card_payments (
  id, user_id, card_id, statement_id, payment_transaction_id,
  payment_date, amount, source, notes
) values
  (
    '88000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000001',
    '38000000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000001',
    '58000000-0000-0000-0000-000000000001', '2026-08-20', 399.90,
    'imported_statement', 'hnew · fatura-agosto.csv · linha 4 · PAGAMENTO FATURA'
  ),
  (
    '88000000-0000-0000-0000-000000000002', '18000000-0000-0000-0000-000000000001',
    '38000000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000001',
    null, '2026-08-20', 399.90,
    'imported_statement', 'hold · fatura-agosto.csv · linha 4 · PAGAMENTO FATURA'
  ),
  (
    '88000000-0000-0000-0000-000000000003', '18000000-0000-0000-0000-000000000001',
    '38000000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000001',
    null, '2026-08-20', 399.90,
    'imported_statement', 'hbad · outro-arquivo.csv · linha 9 · PAGAMENTO FATURA'
  );

select set_config('request.jwt.claim.sub', '18000000-0000-0000-0000-000000000001', true);

do $$
declare
  before_revision text;
  repair_result jsonb;
  snapshot_id uuid;
  rollback_result jsonb;
begin
  before_revision := public.get_credit_card_projection_revision(
    '28000000-0000-0000-0000-000000000001'
  );

  begin
    perform public.repair_credit_card_payment_duplicates_atomic_v1(
      '28000000-0000-0000-0000-000000000001',
      before_revision,
      array['88000000-0000-0000-0000-000000000003'::uuid]
    );
    raise exception 'O reparo aceitou proveniencia divergente.';
  exception
    when others then
      if sqlerrm = 'O reparo aceitou proveniencia divergente.' then
        raise;
      end if;
  end;

  if not exists (
    select 1 from public.credit_card_payments
    where id = '88000000-0000-0000-0000-000000000003'
  ) then
    raise exception 'A tentativa recusada alterou a linha divergente.';
  end if;

  repair_result := public.repair_credit_card_payment_duplicates_atomic_v1(
    '28000000-0000-0000-0000-000000000001',
    before_revision,
    array['88000000-0000-0000-0000-000000000002'::uuid]
  );
  snapshot_id := (repair_result->>'snapshot_id')::uuid;

  if (repair_result->>'deleted_payments')::integer <> 1 then
    raise exception 'O reparo nao confirmou exatamente uma remocao.';
  end if;
  if exists (
    select 1 from public.credit_card_payments
    where id = '88000000-0000-0000-0000-000000000002'
  ) then
    raise exception 'A materializacao obsoleta permaneceu apos o reparo.';
  end if;
  if not exists (
    select 1 from public.credit_card_payments
    where id = '88000000-0000-0000-0000-000000000001'
      and payment_transaction_id = '58000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'A linha canonica foi alterada ou removida.';
  end if;

  rollback_result := public.rollback_credit_card_payment_repair_atomic_v1(snapshot_id);
  if not (rollback_result->>'rolled_back')::boolean
     or (rollback_result->>'restored_payments')::integer <> 1 then
    raise exception 'O rollback do reparo nao foi confirmado.';
  end if;
  if public.get_credit_card_projection_revision('28000000-0000-0000-0000-000000000001') <> before_revision then
    raise exception 'O rollback nao restaurou a revisao original.';
  end if;
  if not exists (
    select 1 from public.credit_card_payments
    where id = '88000000-0000-0000-0000-000000000002'
      and payment_transaction_id is null
      and notes = 'hold · fatura-agosto.csv · linha 4 · PAGAMENTO FATURA'
  ) then
    raise exception 'O rollback nao restaurou exatamente a linha antiga.';
  end if;
end;
$$;

rollback;
