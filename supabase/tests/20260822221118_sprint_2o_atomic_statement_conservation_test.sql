\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, raw_app_meta_data) values
  (
    '19000000-0000-0000-0000-000000000001',
    'sprint2o@example.invalid',
    '{"atomic_card_statement_conservation_enabled":true}'
  ),
  (
    '19000000-0000-0000-0000-000000000002',
    'other-sprint2o@example.invalid',
    '{"atomic_card_statement_conservation_enabled":true}'
  );

insert into public.contas (
  id, user_id, "Nome_Conta", "Tipo_Conta", "Saldo_Inicial", "Data_Saldo_Inicial"
) values
  (
    '29000000-0000-0000-0000-000000000001',
    '19000000-0000-0000-0000-000000000001',
    'Cartão Sprint 2O', 'Cartão de Crédito', 0, '2026-01-01'
  );

insert into public.credit_cards (id, user_id, account_id, name, closing_day, due_day) values
  (
    '39000000-0000-0000-0000-000000000001',
    '19000000-0000-0000-0000-000000000001',
    '29000000-0000-0000-0000-000000000001',
    'Cartão Sprint 2O', 3, 28
  );

insert into public.credit_card_import_lots (
  id, user_id, card_id, account_id, source_file_name,
  statement_due_year, statement_due_month, statement_due_date,
  purchase_reference_label
) values
  (
    '49000000-0000-0000-0000-000000000001',
    '19000000-0000-0000-0000-000000000001',
    '39000000-0000-0000-0000-000000000001',
    '29000000-0000-0000-0000-000000000001',
    'lote-a.csv', 2026, 8, '2026-08-28', '2026-08'
  ),
  (
    '49000000-0000-0000-0000-000000000002',
    '19000000-0000-0000-0000-000000000001',
    '39000000-0000-0000-0000-000000000001',
    '29000000-0000-0000-0000-000000000001',
    'lote-b.csv', 2026, 8, '2026-08-28', '2026-08'
  );

insert into public.transactions (
  "ID_Transacao", user_id, "ID_Conta", "Data", "Nome_Fantasia", "Valor"
) values
  (
    '59000000-0000-0000-0000-000000000001',
    '19000000-0000-0000-0000-000000000001',
    '29000000-0000-0000-0000-000000000001',
    '2026-08-02T12:00:00Z', 'Compra Sprint 2O A', -329.90
  ),
  (
    '59000000-0000-0000-0000-000000000002',
    '19000000-0000-0000-0000-000000000001',
    '29000000-0000-0000-0000-000000000001',
    '2026-08-05T12:00:00Z', 'Compra Sprint 2O B', -120.00
  ),
  (
    '59000000-0000-0000-0000-000000000003',
    '19000000-0000-0000-0000-000000000001',
    '29000000-0000-0000-0000-000000000001',
    '2026-08-20T12:00:00Z', 'Pagamento Sprint 2O', 399.90
  );

insert into public.credit_card_statements (
  id, user_id, card_id, account_id, reference_label, purchase_reference_label,
  due_year, due_month, due_date, source_import_lot_ids,
  total_purchases, statement_total, total_payments, open_balance,
  total_charges, total_credits, open_amount, status,
  manual_totals_json, statement_total_from_file,
  total_payments_from_file, lines_computed_total
) values
  (
    '69000000-0000-0000-0000-000000000001',
    '19000000-0000-0000-0000-000000000001',
    '39000000-0000-0000-0000-000000000001',
    '29000000-0000-0000-0000-000000000001',
    'legacy-2026-08-a', '2026-08', 2026, 8, '2026-08-28',
    '["49000000-0000-0000-0000-000000000001"]',
    329.90, 329.90, 399.90, 0, 329.90, 0, 0, 'paid',
    '{"use_manual":true,"statement_total":449.90,"user_note":"preservar"}',
    449.90, 399.90, 449.90
  ),
  (
    '69000000-0000-0000-0000-000000000002',
    '19000000-0000-0000-0000-000000000001',
    '39000000-0000-0000-0000-000000000001',
    '29000000-0000-0000-0000-000000000001',
    'legacy-2026-08-b', '2026-08', 2026, 8, '2026-08-28',
    '["49000000-0000-0000-0000-000000000002"]',
    120.00, 120.00, 0, 120.00, 120.00, 0, 120.00, 'open',
    null, null, null, null
  );

insert into public.credit_card_entries (
  id, user_id, card_id, account_id, import_lot_id, source_file_name,
  source_row_index, source_row_hash, transaction_id, statement_id,
  posted_date, amount, abs_amount, direction, entry_type
) values
  (
    '79000000-0000-0000-0000-000000000001',
    '19000000-0000-0000-0000-000000000001',
    '39000000-0000-0000-0000-000000000001',
    '29000000-0000-0000-0000-000000000001',
    '49000000-0000-0000-0000-000000000001', 'lote-a.csv', 1, 'hash-a',
    '59000000-0000-0000-0000-000000000001',
    '69000000-0000-0000-0000-000000000001',
    '2026-08-02', -329.90, 329.90, 'debit', 'purchase'
  ),
  (
    '79000000-0000-0000-0000-000000000002',
    '19000000-0000-0000-0000-000000000001',
    '39000000-0000-0000-0000-000000000001',
    '29000000-0000-0000-0000-000000000001',
    '49000000-0000-0000-0000-000000000002', 'lote-b.csv', 1, 'hash-b',
    '59000000-0000-0000-0000-000000000002',
    '69000000-0000-0000-0000-000000000002',
    '2026-08-05', -120.00, 120.00, 'debit', 'purchase'
  );

insert into public.credit_card_statement_items (
  id, user_id, account_id, statement_id, transaction_id, entry_id,
  item_type, amount, posted_date
) values
  (
    '89000000-0000-0000-0000-000000000001',
    '19000000-0000-0000-0000-000000000001',
    '29000000-0000-0000-0000-000000000001',
    '69000000-0000-0000-0000-000000000001',
    '59000000-0000-0000-0000-000000000001',
    '79000000-0000-0000-0000-000000000001',
    'charge', 329.90, '2026-08-02'
  ),
  (
    '89000000-0000-0000-0000-000000000002',
    '19000000-0000-0000-0000-000000000001',
    '29000000-0000-0000-0000-000000000001',
    '69000000-0000-0000-0000-000000000002',
    '59000000-0000-0000-0000-000000000002',
    '79000000-0000-0000-0000-000000000002',
    'charge', 120.00, '2026-08-05'
  );

insert into public.credit_card_payments (
  id, user_id, card_id, statement_id, payment_transaction_id,
  payment_date, amount, source, notes
) values (
  '99000000-0000-0000-0000-000000000001',
  '19000000-0000-0000-0000-000000000001',
  '39000000-0000-0000-0000-000000000001',
  '69000000-0000-0000-0000-000000000001',
  '59000000-0000-0000-0000-000000000003',
  '2026-08-20', 399.90, 'imported_statement', 'pagamento preservado'
);

select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);

-- Exercita a fronteira real da Data API: wrapper invoker como authenticated,
-- implementação privada definer e ACLs entre os dois papéis.
set local role authenticated;
do $$
begin
  if public.get_atomic_card_statement_conservation_feature_state() <> 'enabled' then
    raise exception 'O wrapper público não alcançou o leitor privado da flag.';
  end if;

  begin
    perform public.conserve_credit_card_statement_duplicates_atomic_v1(
      null, null, null, null, null, null, null, null
    );
    raise exception 'A validação privada não foi alcançada pelo wrapper de conservação.';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.rollback_credit_card_statement_conservation_atomic_v1(
      '00000000-0000-0000-0000-000000000000'
    );
    raise exception 'A validação privada não foi alcançada pelo wrapper de rollback.';
  exception
    when sqlstate '42501' then null;
  end;
end;
$$;
reset role;

do $$
declare
  before_revision text;
  after_revision text;
  conservation_result jsonb;
  rollback_result jsonb;
  snapshot_id uuid;
  composite_id uuid;
  correct_composite jsonb := jsonb_build_object(
    'statementKey', '2026-08',
    'purchaseReferenceMonth', '2026-08',
    'dueDate', '2026-08-28',
    'dueYear', 2026,
    'dueMonth', 8,
    'status', 'paid',
    'entryCount', 2,
    'totalPurchasesCents', 44990,
    'totalFeesCents', 0,
    'totalInterestCents', 0,
    'totalRefundsCents', 0,
    'statementTotalCents', 44990,
    'totalPaymentsCents', 39990,
    'openBalanceCents', 5000,
    'manualTotalsJson', jsonb_build_object(
      'use_manual', true,
      'statement_total', 449.90,
      'user_note', 'preservar'
    ),
    'statementTotalFromFileCents', 44990,
    'totalPaymentsFromFileCents', 39990,
    'linesComputedTotalCents', 44990
  );
begin
  before_revision := public.get_credit_card_projection_revision(
    '29000000-0000-0000-0000-000000000001'
  );

  -- A flag dedicada nasce fail-closed e não herda a flag antiga da Sprint 2C.
  update auth.users
  set raw_app_meta_data = '{}'
  where id = '19000000-0000-0000-0000-000000000001';
  begin
    perform public.conserve_credit_card_statement_duplicates_atomic_v1(
      '29000000-0000-0000-0000-000000000001', before_revision,
      'shadow-v1-05712d54', '2026-08',
      array[
        '69000000-0000-0000-0000-000000000001'::uuid,
        '69000000-0000-0000-0000-000000000002'::uuid
      ], 2, 1, correct_composite
    );
    raise exception 'A função ignorou a flag dedicada.';
  exception when others then
    if sqlerrm = 'A função ignorou a flag dedicada.' then raise; end if;
  end;
  update auth.users
  set raw_app_meta_data = '{"atomic_card_statement_conservation_enabled":true}'
  where id = '19000000-0000-0000-0000-000000000001';

  -- Revisão obsoleta, grupo incompleto e metadado divergente falham sem escrita.
  begin
    perform public.conserve_credit_card_statement_duplicates_atomic_v1(
      '29000000-0000-0000-0000-000000000001', repeat('b', 32),
      'shadow-v1-05712d54', '2026-08',
      array[
        '69000000-0000-0000-0000-000000000001'::uuid,
        '69000000-0000-0000-0000-000000000002'::uuid
      ], 2, 1, correct_composite
    );
    raise exception 'A função aceitou revisão obsoleta.';
  exception when others then
    if sqlerrm = 'A função aceitou revisão obsoleta.' then raise; end if;
  end;

  begin
    perform public.conserve_credit_card_statement_duplicates_atomic_v1(
      '29000000-0000-0000-0000-000000000001', before_revision,
      'shadow-v1-05712d54', '2026-08',
      array[
        '69000000-0000-0000-0000-000000000001'::uuid,
        '69000000-0000-0000-0000-000000000002'::uuid
      ], 2, 1,
      jsonb_set(correct_composite, '{statementTotalFromFileCents}', '44991'::jsonb)
    );
    raise exception 'A função aceitou metadado protegido divergente.';
  exception when others then
    if sqlerrm = 'A função aceitou metadado protegido divergente.' then raise; end if;
  end;

  if (select count(*) from public.credit_card_statements
      where account_id = '29000000-0000-0000-0000-000000000001') <> 2
     or (select count(*) from public.credit_card_statement_conservation_snapshots
         where account_id = '29000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'Uma tentativa recusada deixou estado parcial.';
  end if;

  -- Falha induzida depois do INSERT do snapshot deve reverter a subtransação toda.
  create or replace function public.sprint2o_forced_failure()
  returns trigger language plpgsql as $trigger$
  begin
    if new.source_origin = 'atomic_statement_conservation' then
      raise exception 'falha induzida sprint 2o';
    end if;
    return new;
  end;
  $trigger$;
  create trigger sprint2o_forced_failure_trigger
  before insert on public.credit_card_statements
  for each row execute procedure public.sprint2o_forced_failure();

  begin
    perform public.conserve_credit_card_statement_duplicates_atomic_v1(
      '29000000-0000-0000-0000-000000000001', before_revision,
      'shadow-v1-05712d54', '2026-08',
      array[
        '69000000-0000-0000-0000-000000000001'::uuid,
        '69000000-0000-0000-0000-000000000002'::uuid
      ], 2, 1, correct_composite
    );
    raise exception 'A falha induzida não interrompeu a função.';
  exception when others then
    if sqlerrm = 'A falha induzida não interrompeu a função.' then raise; end if;
  end;
  drop trigger sprint2o_forced_failure_trigger on public.credit_card_statements;
  drop function public.sprint2o_forced_failure();

  if (select count(*) from public.credit_card_statements
      where account_id = '29000000-0000-0000-0000-000000000001') <> 2
     or (select count(*) from public.credit_card_statement_conservation_snapshots
         where account_id = '29000000-0000-0000-0000-000000000001') <> 0
     or public.get_credit_card_projection_revision(
       '29000000-0000-0000-0000-000000000001'
     ) <> before_revision then
    raise exception 'A falha induzida não foi atômica.';
  end if;

  conservation_result := public.conserve_credit_card_statement_duplicates_atomic_v1(
    '29000000-0000-0000-0000-000000000001', before_revision,
    'shadow-v1-05712d54', '2026-08',
    array[
      '69000000-0000-0000-0000-000000000001'::uuid,
      '69000000-0000-0000-0000-000000000002'::uuid
    ], 2, 1, correct_composite
  );
  snapshot_id := (conservation_result->>'snapshot_id')::uuid;
  select s.composite_statement_id into composite_id
  from public.credit_card_statement_conservation_snapshots s
  where s.id = snapshot_id;
  after_revision := conservation_result->>'after_revision';

  if (conservation_result->>'source_statements')::integer <> 2
     or (conservation_result->>'entries_relinked')::integer <> 2
     or (conservation_result->>'legacy_items_relinked')::integer <> 2
     or (conservation_result->>'payments_relinked')::integer <> 1 then
    raise exception 'A conservação não confirmou todas as cardinalidades.';
  end if;
  if (select count(*) from public.credit_card_statements
      where account_id = '29000000-0000-0000-0000-000000000001') <> 1
     or (select count(*) from public.transactions
         where "ID_Conta" = '29000000-0000-0000-0000-000000000001') <> 3
     or (select count(*) from public.credit_card_entries
         where statement_id = composite_id) <> 2
     or (select count(*) from public.credit_card_statement_items
         where statement_id = composite_id) <> 2
     or (select count(*) from public.credit_card_payments
         where statement_id = composite_id) <> 1 then
    raise exception 'A conservação alterou cardinalidades financeiras.';
  end if;
  if not exists (
    select 1 from public.credit_card_statements s
    where s.id = composite_id
      and s.statement_total = 449.90
      and s.total_payments = 399.90
      and s.open_balance = 50.00
      and s.manual_totals_json =
        '{"use_manual":true,"statement_total":449.90,"user_note":"preservar"}'::jsonb
      and s.statement_total_from_file = 449.90
      and s.total_payments_from_file = 399.90
      and s.lines_computed_total = 449.90
      and jsonb_array_length(s.source_import_lot_ids) = 2
  ) then
    raise exception 'A fatura composta não conservou valores e metadados.';
  end if;

  -- Idempotência: reaplicar o mesmo plano não pode produzir outra composta.
  begin
    perform public.conserve_credit_card_statement_duplicates_atomic_v1(
      '29000000-0000-0000-0000-000000000001', before_revision,
      'shadow-v1-05712d54', '2026-08',
      array[
        '69000000-0000-0000-0000-000000000001'::uuid,
        '69000000-0000-0000-0000-000000000002'::uuid
      ], 2, 1, correct_composite
    );
    raise exception 'A função permitiu reaplicação do mesmo plano.';
  exception when others then
    if sqlerrm = 'A função permitiu reaplicação do mesmo plano.' then raise; end if;
  end;
  if (select count(*) from public.credit_card_statements
      where account_id = '29000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'A reaplicação recusada alterou a cardinalidade.';
  end if;

  -- Isolamento: outro usuário não pode usar o snapshot.
  perform set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000002', true);
  begin
    perform public.rollback_credit_card_statement_conservation_atomic_v1(snapshot_id);
    raise exception 'Outro usuário conseguiu usar o snapshot.';
  exception when others then
    if sqlerrm = 'Outro usuário conseguiu usar o snapshot.' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);

  -- Uma mudança posterior bloqueia rollback; desfazê-la permite o rollback exato.
  update public.credit_card_statements set status = 'closed' where id = composite_id;
  begin
    perform public.rollback_credit_card_statement_conservation_atomic_v1(snapshot_id);
    raise exception 'Rollback ignorou uma revisão posterior.';
  exception when others then
    if sqlerrm = 'Rollback ignorou uma revisão posterior.' then raise; end if;
  end;
  update public.credit_card_statements set status = 'paid' where id = composite_id;
  if public.get_credit_card_projection_revision(
       '29000000-0000-0000-0000-000000000001'
     ) <> after_revision then
    raise exception 'A revisão posterior não retornou ao estado conservado.';
  end if;

  rollback_result := public.rollback_credit_card_statement_conservation_atomic_v1(snapshot_id);
  if not (rollback_result->>'rolled_back')::boolean
     or (rollback_result->>'restored_statements')::integer <> 2
     or (rollback_result->>'restored_entries')::integer <> 2
     or (rollback_result->>'restored_legacy_items')::integer <> 2
     or (rollback_result->>'restored_payments')::integer <> 1 then
    raise exception 'O rollback não confirmou a restauração integral.';
  end if;
  if public.get_credit_card_projection_revision(
       '29000000-0000-0000-0000-000000000001'
     ) <> before_revision then
    raise exception 'O rollback não restaurou a revisão exata.';
  end if;
  if (select count(*) from public.credit_card_statements
      where id in (
        '69000000-0000-0000-0000-000000000001',
        '69000000-0000-0000-0000-000000000002'
      )) <> 2
     or exists (select 1 from public.credit_card_statements where id = composite_id)
     or not exists (
       select 1 from public.credit_card_entries
       where id = '79000000-0000-0000-0000-000000000001'
         and statement_id = '69000000-0000-0000-0000-000000000001'
     )
     or not exists (
       select 1 from public.credit_card_statement_items
       where id = '89000000-0000-0000-0000-000000000002'
         and statement_id = '69000000-0000-0000-0000-000000000002'
     )
     or not exists (
       select 1 from public.credit_card_payments
       where id = '99000000-0000-0000-0000-000000000001'
         and statement_id = '69000000-0000-0000-0000-000000000001'
     ) then
    raise exception 'O rollback não restaurou as identidades físicas exatas.';
  end if;

  begin
    perform public.rollback_credit_card_statement_conservation_atomic_v1(snapshot_id);
    raise exception 'O mesmo snapshot foi revertido duas vezes.';
  exception when others then
    if sqlerrm = 'O mesmo snapshot foi revertido duas vezes.' then raise; end if;
  end;
end;
$$;

do $$
declare
  executor_oid oid := 'finelo_statement_conservation_executor'::regrole::oid;
  postgres_oid oid := 'postgres'::regrole::oid;
begin
  if not (select relrowsecurity from pg_class
          where oid = 'public.credit_card_statement_conservation_snapshots'::regclass) then
    raise exception 'RLS não está habilitada no snapshot.';
  end if;
  if (select count(*) from pg_policy
      where polrelid = 'public.credit_card_statement_conservation_snapshots'::regclass)
       <> 1
     or not exists (
       select 1 from pg_policy
       where polrelid = 'public.credit_card_statement_conservation_snapshots'::regclass
         and polname = 'Users can view own statement conservation snapshots'
         and polroles = array['authenticated'::regrole::oid]
     ) then
    raise exception 'As policies do snapshot não estão no conjunto mínimo esperado.';
  end if;
  if has_table_privilege(
       'authenticated', 'public.credit_card_statement_conservation_snapshots', 'INSERT'
     ) then
    raise exception 'Authenticated recebeu escrita direta no snapshot.';
  end if;
  if has_function_privilege(
       'anon',
       'public.conserve_credit_card_statement_duplicates_atomic_v1(uuid,text,text,text,uuid[],integer,integer,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'Anon recebeu execução do RPC de conservação.';
  end if;
  if not has_function_privilege(
       'authenticated',
       'public.conserve_credit_card_statement_duplicates_atomic_v1(uuid,text,text,text,uuid[],integer,integer,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'Authenticated não recebeu execução controlada do RPC.';
  end if;
  if has_function_privilege(
       'service_role',
       'public.conserve_credit_card_statement_duplicates_atomic_v1(uuid,text,text,text,uuid[],integer,integer,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'Service role recebeu execução não solicitada do RPC.';
  end if;
  if not has_function_privilege(
       'authenticated',
       'finelo_internal.conserve_credit_card_statement_duplicates_atomic_v1_impl(uuid,text,text,text,uuid[],integer,integer,jsonb)',
       'EXECUTE'
     ) or has_function_privilege(
       'anon',
       'finelo_internal.conserve_credit_card_statement_duplicates_atomic_v1_impl(uuid,text,text,text,uuid[],integer,integer,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'A ACL da implementação privada está incorreta.';
  end if;
  if has_function_privilege(
       'authenticated',
       'finelo_internal.get_credit_card_projection_revision_for_user(uuid,uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'finelo_statement_conservation_executor',
       'finelo_internal.get_credit_card_projection_revision_for_user(uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception 'A ACL do helper privado de revisão está incorreta.';
  end if;
  if has_schema_privilege('anon', 'finelo_internal', 'USAGE')
     or has_schema_privilege('authenticated', 'finelo_internal', 'CREATE')
     or has_schema_privilege(
       'finelo_statement_conservation_executor', 'finelo_internal', 'CREATE'
     ) then
    raise exception 'O schema privado possui privilégios além do necessário.';
  end if;
  if not has_schema_privilege('authenticated', 'finelo_internal', 'USAGE') then
    raise exception 'Authenticated não consegue atravessar o wrapper invoker.';
  end if;

  if exists (
    select 1 from pg_roles
    where rolname = 'finelo_statement_conservation_executor'
      and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole
           or rolreplication or not rolbypassrls)
  ) then
    raise exception 'O executor privado não está no perfil NOLOGIN/BYPASSRLS mínimo.';
  end if;
  if exists (
    select 1
    from pg_auth_members m
    join pg_roles member_role on member_role.oid = m.member
    where m.member = executor_oid
       or (
         m.roleid = executor_oid
         and (
           member_role.rolname <> 'postgres'
           or m.inherit_option
           or m.set_option
         )
       )
  ) then
    raise exception 'Um papel interno recebeu membership efetivo inesperado.';
  end if;
  if has_table_privilege(
       'finelo_statement_conservation_executor', 'auth.users', 'SELECT'
     ) or has_column_privilege(
       'finelo_statement_conservation_executor',
       'auth.users', 'raw_app_meta_data', 'SELECT'
     ) then
    raise exception 'O executor recebeu leitura direta de auth.users.';
  end if;
  if not has_column_privilege(
       'finelo_statement_conservation_executor',
       'public.credit_card_entries', 'statement_id', 'UPDATE'
     )
     or has_column_privilege(
       'finelo_statement_conservation_executor',
       'public.credit_card_entries', 'amount', 'UPDATE'
     ) then
    raise exception 'O UPDATE do executor não está limitado ao vínculo da fatura.';
  end if;

  if (select prosecdef from pg_proc where oid =
        'public.conserve_credit_card_statement_duplicates_atomic_v1(uuid,text,text,text,uuid[],integer,integer,jsonb)'::regprocedure)
     or (select prosecdef from pg_proc where oid =
        'public.rollback_credit_card_statement_conservation_atomic_v1(uuid)'::regprocedure)
     or (select prosecdef from pg_proc where oid =
        'public.get_atomic_card_statement_conservation_feature_state()'::regprocedure) then
    raise exception 'Um wrapper público ainda é SECURITY DEFINER.';
  end if;
  if not (select prosecdef from pg_proc where oid =
        'finelo_internal.conserve_credit_card_statement_duplicates_atomic_v1_impl(uuid,text,text,text,uuid[],integer,integer,jsonb)'::regprocedure)
     or not (select prosecdef from pg_proc where oid =
        'finelo_internal.rollback_credit_card_statement_conservation_atomic_v1_impl(uuid)'::regprocedure)
     or not (select prosecdef from pg_proc where oid =
        'finelo_internal.get_atomic_card_statement_conservation_feature_state_impl()'::regprocedure) then
    raise exception 'Uma implementação privada não é SECURITY DEFINER.';
  end if;
  if (select prosecdef from pg_proc where oid =
        'finelo_internal.get_credit_card_projection_revision_for_user(uuid,uuid)'::regprocedure) then
    raise exception 'O helper privado de revisão não é SECURITY INVOKER.';
  end if;
  if (select proowner from pg_proc where oid =
        'finelo_internal.get_atomic_card_statement_conservation_feature_state_impl()'::regprocedure)
       <> postgres_oid
     or (select proowner from pg_proc where oid =
        'finelo_internal.get_credit_card_projection_revision_for_user(uuid,uuid)'::regprocedure)
       <> executor_oid
     or (select proowner from pg_proc where oid =
        'finelo_internal.conserve_credit_card_statement_duplicates_atomic_v1_impl(uuid,text,text,text,uuid[],integer,integer,jsonb)'::regprocedure)
       <> executor_oid
     or (select proowner from pg_proc where oid =
        'finelo_internal.rollback_credit_card_statement_conservation_atomic_v1_impl(uuid)'::regprocedure)
       <> executor_oid then
    raise exception 'O owner de uma implementação privada está incorreto.';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.oid in (
      'public.get_atomic_card_statement_conservation_feature_state()'::regprocedure,
      'public.conserve_credit_card_statement_duplicates_atomic_v1(uuid,text,text,text,uuid[],integer,integer,jsonb)'::regprocedure,
      'public.rollback_credit_card_statement_conservation_atomic_v1(uuid)'::regprocedure,
      'finelo_internal.get_atomic_card_statement_conservation_feature_state_impl()'::regprocedure,
      'finelo_internal.get_credit_card_projection_revision_for_user(uuid,uuid)'::regprocedure,
      'finelo_internal.conserve_credit_card_statement_duplicates_atomic_v1_impl(uuid,text,text,text,uuid[],integer,integer,jsonb)'::regprocedure,
      'finelo_internal.rollback_credit_card_statement_conservation_atomic_v1_impl(uuid)'::regprocedure
    ) and not (
      coalesce(p.proconfig, '{}'::text[]) @> array['search_path=']
      or coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
    )
  ) then
    raise exception 'Uma função da Sprint 2O não possui search_path vazio.';
  end if;
  if position(
       'pg_advisory_xact_lock' in pg_get_functiondef(
         'finelo_internal.conserve_credit_card_statement_duplicates_atomic_v1_impl(uuid,text,text,text,uuid[],integer,integer,jsonb)'::regprocedure
       )
     ) = 0 then
    raise exception 'A implementação privada não contém lock transacional por conta.';
  end if;
end;
$$;

rollback;
