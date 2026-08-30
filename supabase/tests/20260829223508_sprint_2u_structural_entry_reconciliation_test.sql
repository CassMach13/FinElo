\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, raw_app_meta_data) values (
  '1b000000-0000-4000-8000-000000000001',
  'sprint2u@example.invalid',
  '{"atomic_card_structural_entry_reconciliation_enabled":true}'
);

insert into public.contas (
  id, user_id, "Nome_Conta", "Tipo_Conta", "Saldo_Inicial", "Data_Saldo_Inicial"
) values (
  '2b000000-0000-4000-8000-000000000001',
  '1b000000-0000-4000-8000-000000000001',
  'Cartão Sprint 2U', 'Cartão de Crédito', 0, '2026-01-01'
);

insert into public.credit_cards (id, user_id, account_id, name, closing_day, due_day)
values (
  '3b000000-0000-4000-8000-000000000001',
  '1b000000-0000-4000-8000-000000000001',
  '2b000000-0000-4000-8000-000000000001',
  'Cartão Sprint 2U', 3, 28
);

insert into public.credit_card_import_lots (
  id, user_id, card_id, account_id, source_file_name,
  statement_due_year, statement_due_month, statement_due_date,
  purchase_reference_label, status, raw_row_count, imported_row_count,
  ignored_row_count, checksum
) values
  (
    '4b000000-0000-4000-8000-000000000001',
    '1b000000-0000-4000-8000-000000000001',
    '3b000000-0000-4000-8000-000000000001',
    '2b000000-0000-4000-8000-000000000001',
    'sprint-2u-julho.csv', 2026, 7, '2026-07-28', '2026-07',
    'confirmed', 1, 1, 0, 'sprint-2u-july'
  ),
  (
    '4b000000-0000-4000-8000-000000000002',
    '1b000000-0000-4000-8000-000000000001',
    '3b000000-0000-4000-8000-000000000001',
    '2b000000-0000-4000-8000-000000000001',
    'sprint-2u-agosto.csv', 2026, 8, '2026-08-28', '2026-08',
    'confirmed', 1, 1, 0, 'sprint-2u-august'
  );

insert into public.transactions (
  "ID_Transacao", user_id, "ID_Conta", "Data", "Nome_Fantasia", "Valor"
) values
  (
    '5b000000-0000-4000-8000-000000000001',
    '1b000000-0000-4000-8000-000000000001',
    '2b000000-0000-4000-8000-000000000001',
    '2026-07-02T12:00:00Z', 'Identidade antiga Sprint 2U', -300.00
  ),
  (
    '5b000000-0000-4000-8000-000000000002',
    '1b000000-0000-4000-8000-000000000001',
    '2b000000-0000-4000-8000-000000000001',
    '2026-07-02T12:00:00Z', 'Identidade comprovada Sprint 2U', -300.00
  ),
  (
    '5b000000-0000-4000-8000-000000000003',
    '1b000000-0000-4000-8000-000000000001',
    '2b000000-0000-4000-8000-000000000001',
    '2026-08-05T12:00:00Z', 'Competência comprovada Sprint 2U', 50.00
  );

insert into public.credit_card_statements (
  id, user_id, card_id, account_id, reference_label, purchase_reference_label,
  due_year, due_month, due_date, total_purchases, total_refunds,
  statement_total, total_payments, open_balance, total_charges, total_credits,
  open_amount, status
) values
  (
    '6b000000-0000-4000-8000-000000000001',
    '1b000000-0000-4000-8000-000000000001',
    '3b000000-0000-4000-8000-000000000001',
    '2b000000-0000-4000-8000-000000000001',
    '2026-07', '2026-07', 2026, 7, '2026-07-28',
    300.00, 0, 300.00, 0, 300.00, 300.00, 0, 300.00, 'open'
  ),
  (
    '6b000000-0000-4000-8000-000000000002',
    '1b000000-0000-4000-8000-000000000001',
    '3b000000-0000-4000-8000-000000000001',
    '2b000000-0000-4000-8000-000000000001',
    '2026-08', '2026-08', 2026, 8, '2026-08-28',
    0, 50.00, -50.00, 0, 0, 0, 50.00, 0, 'paid'
  );

-- Simula o estado histórico anterior ao guard de identidade: duas linhas
-- antigas apontavam para a mesma transação. A Sprint 2U deve separá-las e o
-- rollback precisa conseguir restaurar exatamente esse estado conhecido.
alter table public.credit_card_entries
  disable trigger trg_prevent_new_cc_entry_transaction_duplicate_insert;

insert into public.credit_card_entries (
  id, user_id, card_id, account_id, import_lot_id, source_file_name,
  source_row_index, source_row_hash, transaction_id, statement_id,
  posted_date, description_raw, description_normalized, amount, abs_amount,
  direction, entry_type
) values
  (
    '7b000000-0000-4000-8000-000000000001',
    '1b000000-0000-4000-8000-000000000001',
    '3b000000-0000-4000-8000-000000000001',
    '2b000000-0000-4000-8000-000000000001',
    '4b000000-0000-4000-8000-000000000001',
    'sprint-2u-julho.csv', 1, 'sprint-2u-row-july',
    '5b000000-0000-4000-8000-000000000001',
    '6b000000-0000-4000-8000-000000000001',
    '2026-07-02', 'Curso', 'curso', -300.00, 300.00, 'debit', 'needs_review'
  ),
  (
    '7b000000-0000-4000-8000-000000000002',
    '1b000000-0000-4000-8000-000000000001',
    '3b000000-0000-4000-8000-000000000001',
    '2b000000-0000-4000-8000-000000000001',
    '4b000000-0000-4000-8000-000000000002',
    'sprint-2u-agosto.csv', 1, 'sprint-2u-row-august',
    '5b000000-0000-4000-8000-000000000001',
    '6b000000-0000-4000-8000-000000000001',
    '2026-08-05', 'Estorno', 'estorno', 50.00, 50.00, 'credit', 'purchase'
  );

alter table public.credit_card_entries
  enable trigger trg_prevent_new_cc_entry_transaction_duplicate_insert;

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '1b000000-0000-4000-8000-000000000001',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"1b000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"atomic_card_structural_entry_reconciliation_enabled":true}}',
  true
);

set local role authenticated;

do $test$
declare
  v_account_id uuid := '2b000000-0000-4000-8000-000000000001';
  v_before_revision text;
  v_result jsonb;
  v_rollback jsonb;
  v_snapshot_id uuid;
  v_transaction_hash_before text;
  v_statement_hash_before text;
  v_payment_hash_before text;
  v_entry_economic_hash_before text;
begin
  if public.get_atomic_card_structural_entry_feature_state() <> 'enabled' then
    raise exception 'A flag Sprint 2U não chegou ao gateway autenticado.';
  end if;

  v_before_revision := public.get_credit_card_projection_revision(v_account_id);

  select pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(
    pg_catalog.to_jsonb(t) order by t."ID_Transacao"
  )::text, '[]'))
  into v_transaction_hash_before
  from public.transactions t
  where t.user_id = '1b000000-0000-4000-8000-000000000001'
    and t."ID_Conta" = v_account_id;

  select pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(
    pg_catalog.to_jsonb(s) order by s.id
  )::text, '[]'))
  into v_statement_hash_before
  from public.credit_card_statements s
  where s.user_id = '1b000000-0000-4000-8000-000000000001'
    and s.account_id = v_account_id;

  select pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(
    pg_catalog.to_jsonb(p) order by p.id
  )::text, '[]'))
  into v_payment_hash_before
  from public.credit_card_payments p
  where p.user_id = '1b000000-0000-4000-8000-000000000001'
    and p.card_id = '3b000000-0000-4000-8000-000000000001';

  select pg_catalog.md5(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_array(
      e.id, e.posted_date, e.amount, e.abs_amount, e.direction,
      e.source_file_name, e.source_row_index, e.source_row_hash,
      e.import_lot_id, e.description_raw, e.description_normalized
    ) order by e.id
  )::text)
  into v_entry_economic_hash_before
  from public.credit_card_entries e
  where e.user_id = '1b000000-0000-4000-8000-000000000001'
    and e.account_id = v_account_id;

  v_result := public.reconcile_credit_card_structural_entries_atomic_v1(
    v_account_id,
    v_before_revision,
    'shadow-v1-1234abcd',
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'rowId', '7b000000-0000-4000-8000-000000000001',
        'expectedTransactionId', '5b000000-0000-4000-8000-000000000001',
        'desiredTransactionId', '5b000000-0000-4000-8000-000000000002',
        'expectedStatementRowId', '6b000000-0000-4000-8000-000000000001',
        'desiredStatementRowId', '6b000000-0000-4000-8000-000000000001',
        'expectedStatementKey', '2026-07',
        'desiredStatementKey', '2026-07',
        'expectedEntryType', 'needs_review',
        'desiredEntryType', 'purchase',
        'expectedPostedDate', '2026-07-02',
        'expectedAmountCents', -30000,
        'expectedSourceFileName', 'sprint-2u-julho.csv',
        'expectedSourceRowHash', 'sprint-2u-row-july',
        'expectedSourceRowIndex', 1,
        'expectedImportLotId', '4b000000-0000-4000-8000-000000000001'
      ),
      pg_catalog.jsonb_build_object(
        'rowId', '7b000000-0000-4000-8000-000000000002',
        'expectedTransactionId', '5b000000-0000-4000-8000-000000000001',
        'desiredTransactionId', '5b000000-0000-4000-8000-000000000003',
        'expectedStatementRowId', '6b000000-0000-4000-8000-000000000001',
        'desiredStatementRowId', '6b000000-0000-4000-8000-000000000002',
        'expectedStatementKey', '2026-07',
        'desiredStatementKey', '2026-08',
        'expectedEntryType', 'purchase',
        'desiredEntryType', 'refund',
        'expectedPostedDate', '2026-08-05',
        'expectedAmountCents', 5000,
        'expectedSourceFileName', 'sprint-2u-agosto.csv',
        'expectedSourceRowHash', 'sprint-2u-row-august',
        'expectedSourceRowIndex', 1,
        'expectedImportLotId', '4b000000-0000-4000-8000-000000000002'
      )
    )
  );

  if (v_result->>'entries_updated')::integer <> 2
     or (v_result->>'identity_updates')::integer <> 2
     or (v_result->>'competence_updates')::integer <> 1
     or (v_result->>'type_updates')::integer <> 2
     or (v_result->>'transaction_records_changed')::integer <> 0
     or (v_result->>'payment_records_changed')::integer <> 0
     or (v_result->>'statement_records_changed')::integer <> 0 then
    raise exception 'Resultado de aplicação inesperado: %', v_result;
  end if;

  if not exists (
    select 1 from public.credit_card_entries e
    where e.id = '7b000000-0000-4000-8000-000000000001'
      and e.transaction_id = '5b000000-0000-4000-8000-000000000002'
      and e.statement_id = '6b000000-0000-4000-8000-000000000001'
      and e.entry_type = 'purchase'
  ) or not exists (
    select 1 from public.credit_card_entries e
    where e.id = '7b000000-0000-4000-8000-000000000002'
      and e.transaction_id = '5b000000-0000-4000-8000-000000000003'
      and e.statement_id = '6b000000-0000-4000-8000-000000000002'
      and e.entry_type = 'refund'
  ) then
    raise exception 'Os três vínculos estruturais não foram aplicados exatamente.';
  end if;

  if v_transaction_hash_before <> (
    select pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(t) order by t."ID_Transacao"
    )::text, '[]'))
    from public.transactions t
    where t.user_id = '1b000000-0000-4000-8000-000000000001'
      and t."ID_Conta" = v_account_id
  ) or v_statement_hash_before <> (
    select pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(s) order by s.id
    )::text, '[]'))
    from public.credit_card_statements s
    where s.user_id = '1b000000-0000-4000-8000-000000000001'
      and s.account_id = v_account_id
  ) or v_payment_hash_before <> (
    select pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(p) order by p.id
    )::text, '[]'))
    from public.credit_card_payments p
    where p.user_id = '1b000000-0000-4000-8000-000000000001'
      and p.card_id = '3b000000-0000-4000-8000-000000000001'
  ) or v_entry_economic_hash_before <> (
    select pg_catalog.md5(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_array(
        e.id, e.posted_date, e.amount, e.abs_amount, e.direction,
        e.source_file_name, e.source_row_index, e.source_row_hash,
        e.import_lot_id, e.description_raw, e.description_normalized
      ) order by e.id
    )::text)
    from public.credit_card_entries e
    where e.user_id = '1b000000-0000-4000-8000-000000000001'
      and e.account_id = v_account_id
  ) then
    raise exception 'Conteúdo econômico, origem ou registros físicos foram alterados.';
  end if;

  v_snapshot_id := (v_result->>'snapshot_id')::uuid;
  v_rollback := public.rollback_credit_card_structural_entries_atomic_v1(v_snapshot_id);
  if not (v_rollback->>'rolled_back')::boolean
     or (v_rollback->>'restored_entries')::integer <> 2
     or public.get_credit_card_projection_revision(v_account_id) <> v_before_revision then
    raise exception 'O rollback não restaurou exatamente a revisão original: %', v_rollback;
  end if;

  if not exists (
    select 1 from public.credit_card_entries e
    where e.id = '7b000000-0000-4000-8000-000000000001'
      and e.transaction_id = '5b000000-0000-4000-8000-000000000001'
      and e.statement_id = '6b000000-0000-4000-8000-000000000001'
      and e.entry_type = 'needs_review'
  ) or not exists (
    select 1 from public.credit_card_entries e
    where e.id = '7b000000-0000-4000-8000-000000000002'
      and e.transaction_id = '5b000000-0000-4000-8000-000000000001'
      and e.statement_id = '6b000000-0000-4000-8000-000000000001'
      and e.entry_type = 'purchase'
  ) then
    raise exception 'O rollback não restaurou os vínculos estruturais originais.';
  end if;

  begin
    perform public.rollback_credit_card_structural_entries_atomic_v1(v_snapshot_id);
    raise exception 'O mesmo snapshot foi aceito duas vezes.';
  exception when sqlstate '42501' then null;
  end;

  perform pg_catalog.set_config(
    'finelo.structural_identity_guard_rollback_snapshot_id',
    v_snapshot_id::text,
    true
  );
  begin
    update public.credit_card_entries
    set transaction_id = '5b000000-0000-4000-8000-000000000002'
    where id in (
      '7b000000-0000-4000-8000-000000000001',
      '7b000000-0000-4000-8000-000000000002'
    );
    raise exception 'Um chamador autenticado forjou o contexto privado do rollback.';
  exception when unique_violation then null;
  end;
end;
$test$;

reset role;

do $acl$
begin
  if pg_catalog.has_function_privilege(
    'anon',
    'public.reconcile_credit_card_structural_entries_atomic_v1(uuid,text,text,jsonb)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'service_role',
    'public.reconcile_credit_card_structural_entries_atomic_v1(uuid,text,text,jsonb)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'authenticated',
    'finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(uuid,text,text,jsonb)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'finelo_structural_entry_gateway',
    'finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(uuid,text,text,jsonb)',
    'EXECUTE'
  ) or not pg_catalog.has_schema_privilege(
    'authenticated',
    'finelo_structural_internal',
    'USAGE'
  ) or pg_catalog.has_schema_privilege(
    'finelo_structural_entry_gateway',
    'finelo_structural_internal',
    'USAGE'
  ) or exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'reconcile_credit_card_structural_entries_atomic_v1',
        'rollback_credit_card_structural_entries_atomic_v1'
      )
      and p.prosecdef
  ) or exists (
    select 1
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles role on role.oid = membership.roleid
    join pg_catalog.pg_roles member_role on member_role.oid = membership.member
    where role.rolname in (
      'finelo_structural_entry_executor',
      'finelo_structural_entry_gateway'
    )
      and (
        member_role.rolname <> 'postgres'
        or membership.inherit_option
        or membership.set_option
      )
  ) then
    raise exception 'Um papel não autorizado recebeu execução Sprint 2U.';
  end if;
end;
$acl$;

rollback;
