\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, raw_app_meta_data) values (
  '1a000000-0000-0000-0000-000000000001',
  'sprint2t@example.invalid',
  '{"atomic_card_derived_settlement_reconciliation_enabled":true}'
);

insert into public.contas (
  id, user_id, "Nome_Conta", "Tipo_Conta", "Saldo_Inicial", "Data_Saldo_Inicial"
) values (
  '2a000000-0000-0000-0000-000000000001',
  '1a000000-0000-0000-0000-000000000001',
  'Cartão Sprint 2T', 'Cartão de Crédito', 0, '2026-01-01'
);

insert into public.credit_cards (id, user_id, account_id, name, closing_day, due_day)
values (
  '3a000000-0000-0000-0000-000000000001',
  '1a000000-0000-0000-0000-000000000001',
  '2a000000-0000-0000-0000-000000000001',
  'Cartão Sprint 2T', 3, 28
);

insert into public.transactions (
  "ID_Transacao", user_id, "ID_Conta", "Data", "Nome_Fantasia", "Valor"
) values (
  '4a000000-0000-0000-0000-000000000001',
  '1a000000-0000-0000-0000-000000000001',
  '2a000000-0000-0000-0000-000000000001',
  '2026-08-20T12:00:00Z', 'Pagamento Sprint 2T', 399.90
);

insert into public.credit_card_statements (
  id, user_id, card_id, account_id, reference_label, purchase_reference_label,
  due_year, due_month, due_date, total_purchases, total_refunds,
  statement_total, total_payments, open_balance, total_charges, total_credits,
  open_amount, status, manual_totals_json, statement_total_from_file,
  total_payments_from_file, lines_computed_total
) values
  (
    '5a000000-0000-0000-0000-000000000001',
    '1a000000-0000-0000-0000-000000000001',
    '3a000000-0000-0000-0000-000000000001',
    '2a000000-0000-0000-0000-000000000001',
    '2026-07', '2026-07', 2026, 7, '2026-07-28',
    449.90, 50.00, 399.90, 400.00, 0, 449.90, 50.00, 0, 'paid',
    '{"protected":"july"}', 399.90, 400.00, 399.90
  ),
  (
    '5a000000-0000-0000-0000-000000000002',
    '1a000000-0000-0000-0000-000000000001',
    '3a000000-0000-0000-0000-000000000001',
    '2a000000-0000-0000-0000-000000000001',
    '2026-08', '2026-08', 2026, 8, '2026-08-28',
    449.90, 0, 449.90, 399.90, 50.00, 449.90, 0, 0, 'partial',
    '{"protected":"august"}', 449.90, 399.90, 449.90
  );

insert into public.credit_card_payments (
  id, user_id, card_id, statement_id, payment_transaction_id,
  payment_date, amount, source, notes
) values (
  '6a000000-0000-0000-0000-000000000001',
  '1a000000-0000-0000-0000-000000000001',
  '3a000000-0000-0000-0000-000000000001',
  '5a000000-0000-0000-0000-000000000001',
  '4a000000-0000-0000-0000-000000000001',
  '2026-08-20', 399.90, 'imported_statement', 'pagamento preservado'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '1a000000-0000-0000-0000-000000000001',
  true
);

set local role authenticated;

do $test$
declare
  v_account_id uuid := '2a000000-0000-0000-0000-000000000001';
  v_before_revision text;
  v_result jsonb;
  v_rollback jsonb;
  v_snapshot_id uuid;
  v_protected_before text;
begin
  if public.get_atomic_card_derived_settlement_feature_state() <> 'enabled' then
    raise exception 'A flag Sprint 2T não chegou ao wrapper autenticado.';
  end if;

  v_before_revision := public.get_credit_card_projection_revision(v_account_id);
  select pg_catalog.md5(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_array(
      s.id, s.reference_label, s.due_date, s.statement_total,
      s.manual_totals_json, s.statement_total_from_file,
      s.total_payments_from_file, s.lines_computed_total
    ) order by s.id
  )::text) into v_protected_before
  from public.credit_card_statements s
  where s.account_id = v_account_id;

  v_result := public.reconcile_credit_card_derived_settlement_atomic_v1(
    v_account_id,
    v_before_revision,
    'shadow-v1-05712d54',
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'rowId', '5a000000-0000-0000-0000-000000000001',
        'statementKey', '2026-07',
        'expectedTotalPaymentsCents', 40000,
        'expectedOpenBalanceCents', 0,
        'expectedOpenAmountCents', 0,
        'expectedStatus', 'paid',
        'desiredTotalPaymentsCents', 39990,
        'desiredOpenBalanceCents', 0,
        'desiredOpenAmountCents', 0,
        'desiredStatus', 'paid'
      ),
      pg_catalog.jsonb_build_object(
        'rowId', '5a000000-0000-0000-0000-000000000002',
        'statementKey', '2026-08',
        'expectedTotalPaymentsCents', 39990,
        'expectedOpenBalanceCents', 5000,
        'expectedOpenAmountCents', 0,
        'expectedStatus', 'partial',
        'desiredTotalPaymentsCents', 0,
        'desiredOpenBalanceCents', 44990,
        'desiredOpenAmountCents', 44990,
        'desiredStatus', 'open'
      )
    )
  );

  if (v_result->>'statements_updated')::integer <> 2
     or (v_result->>'entry_records_changed')::integer <> 0
     or (v_result->>'payment_records_changed')::integer <> 0 then
    raise exception 'Resultado de aplicação inesperado: %', v_result;
  end if;
  if not exists (
    select 1 from public.credit_card_statements s
    where s.id = '5a000000-0000-0000-0000-000000000001'
      and pg_catalog.round(s.total_payments * 100)::bigint = 39990
      and s.status = 'paid'
  ) or not exists (
    select 1 from public.credit_card_statements s
    where s.id = '5a000000-0000-0000-0000-000000000002'
      and pg_catalog.round(s.total_payments * 100)::bigint = 0
      and pg_catalog.round(s.open_balance * 100)::bigint = 44990
      and pg_catalog.round(s.open_amount * 100)::bigint = 44990
      and s.status = 'open'
  ) then
    raise exception 'Os quatro campos derivados não foram aplicados exatamente.';
  end if;
  if v_protected_before <> (
    select pg_catalog.md5(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_array(
        s.id, s.reference_label, s.due_date, s.statement_total,
        s.manual_totals_json, s.statement_total_from_file,
        s.total_payments_from_file, s.lines_computed_total
      ) order by s.id
    )::text)
    from public.credit_card_statements s
    where s.account_id = v_account_id
  ) then
    raise exception 'Metadados protegidos mudaram na aplicação.';
  end if;

  v_snapshot_id := (v_result->>'snapshot_id')::uuid;
  v_rollback := public.rollback_credit_card_derived_settlement_atomic_v1(v_snapshot_id);
  if not (v_rollback->>'rolled_back')::boolean
     or public.get_credit_card_projection_revision(v_account_id) <> v_before_revision then
    raise exception 'O rollback não restaurou exatamente a revisão original.';
  end if;

  begin
    perform public.rollback_credit_card_derived_settlement_atomic_v1(v_snapshot_id);
    raise exception 'O mesmo snapshot foi aceito duas vezes.';
  exception when sqlstate 'P0001' then null;
  end;
end;
$test$;

reset role;

do $acl$
begin
  if pg_catalog.has_function_privilege(
    'anon',
    'public.reconcile_credit_card_derived_settlement_atomic_v1(uuid,text,text,jsonb)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'service_role',
    'public.reconcile_credit_card_derived_settlement_atomic_v1(uuid,text,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'Um papel não autorizado recebeu execução no RPC Sprint 2T.';
  end if;
end;
$acl$;

rollback;
