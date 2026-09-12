\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values (
  '1c000000-0000-4000-8000-000000000001',
  'structural-retirement@example.invalid'
);

insert into public.contas (
  id, user_id, "Nome_Conta", "Tipo_Conta", "Saldo_Inicial", "Data_Saldo_Inicial"
) values (
  '2c000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  'Cartao aposentadoria estrutural', 'Cartão de Crédito', 0, '2026-01-01'
);

insert into public.credit_cards (id, user_id, account_id, name, closing_day, due_day)
values (
  '3c000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '2c000000-0000-4000-8000-000000000001',
  'Cartao aposentadoria estrutural', 3, 10
);

-- O fixture representa um snapshot criado antes da aposentadoria. O trigger e
-- desabilitado apenas dentro desta transacao de teste e volta ao estado exato
-- no ROLLBACK final.
alter table finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  disable trigger trg_reject_legacy_snapshot_mutation;
insert into finelo_structural_internal.credit_card_entry_reconciliation_snapshots (
  id, user_id, account_id, card_id, operation_kind, shadow_checksum,
  before_revision, after_revision, before_rows, after_rows, entry_count,
  identity_update_count, competence_update_count, type_update_count
) values (
  '4c000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '2c000000-0000-4000-8000-000000000001',
  '3c000000-0000-4000-8000-000000000001',
  'structural_entry_reconciliation', 'shadow-v1-retired1',
  'before-revision', 'after-revision',
  '[{"rowId":"5c000000-0000-4000-8000-000000000001","transactionId":"6c000000-0000-4000-8000-000000000001","statementRowId":"7c000000-0000-4000-8000-000000000001","entryType":"needs_review"}]',
  '[{"rowId":"5c000000-0000-4000-8000-000000000001","transactionId":"6c000000-0000-4000-8000-000000000002","statementRowId":"7c000000-0000-4000-8000-000000000001","entryType":"purchase"}]',
  1, 1, 0, 1
);
alter table finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  enable trigger trg_reject_legacy_snapshot_mutation;

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role","sub":"automated-retirement-test"}',
  true
);
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

do $retirement_test$
declare
  v_result jsonb;
  v_replay jsonb;
  v_snapshot_hash text;
  v_financial_hash text;
  v_current_snapshot_hash text;
  v_current_financial_hash text;
begin
  select pg_catalog.md5(pg_catalog.to_jsonb(s)::text)
  into v_snapshot_hash
  from finelo_structural_internal.credit_card_entry_reconciliation_snapshots s
  where s.id = '4c000000-0000-4000-8000-000000000001';

  select pg_catalog.md5(pg_catalog.jsonb_build_array(
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t."ID_Transacao"), '[]'::jsonb) from public.transactions t),
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.id), '[]'::jsonb) from public.credit_card_entries e),
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.id), '[]'::jsonb) from public.credit_card_payments p),
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) order by s.id), '[]'::jsonb) from public.credit_card_statements s),
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by r.id), '[]'::jsonb) from public.credit_card_reconciliation_resolutions r),
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(v) order by v.id), '[]'::jsonb) from public.credit_card_reconciliation_resolution_reversals v)
  )::text)
  into v_financial_hash;

  v_result := public.retire_credit_card_structural_snapshot_v1(
    '4c000000-0000-4000-8000-000000000001',
    '2c000000-0000-4000-8000-000000000001',
    '3c000000-0000-4000-8000-000000000001',
    'after-revision',
    1,
    'Decisao de teste: preservar o snapshot sem executar rollback estrutural.',
    '8c000000-0000-4000-8000-000000000001'
  );

  if (v_result ->> 'decision') <> 'retired_without_rollback'
     or (v_result ->> 'idempotent_replay')::boolean
     or (v_result ->> 'financial_records_changed')::integer <> 0
     or (v_result ->> 'structural_rows_changed')::integer <> 0 then
    raise exception 'Resultado inicial inesperado: %', v_result;
  end if;

  v_replay := public.retire_credit_card_structural_snapshot_v1(
    '4c000000-0000-4000-8000-000000000001',
    '2c000000-0000-4000-8000-000000000001',
    '3c000000-0000-4000-8000-000000000001',
    'after-revision',
    1,
    'Decisao de teste: preservar o snapshot sem executar rollback estrutural.',
    '8c000000-0000-4000-8000-000000000001'
  );

  if not (v_replay ->> 'idempotent_replay')::boolean
     or (select pg_catalog.count(*) from finelo_structural_internal.credit_card_entry_reconciliation_retirements) <> 1 then
    raise exception 'A segunda execucao nao foi idempotente: %', v_replay;
  end if;

  select pg_catalog.md5(pg_catalog.to_jsonb(s)::text)
  into v_current_snapshot_hash
  from finelo_structural_internal.credit_card_entry_reconciliation_snapshots s
  where s.id = '4c000000-0000-4000-8000-000000000001';

  select pg_catalog.md5(pg_catalog.jsonb_build_array(
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t."ID_Transacao"), '[]'::jsonb) from public.transactions t),
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.id), '[]'::jsonb) from public.credit_card_entries e),
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.id), '[]'::jsonb) from public.credit_card_payments p),
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) order by s.id), '[]'::jsonb) from public.credit_card_statements s),
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by r.id), '[]'::jsonb) from public.credit_card_reconciliation_resolutions r),
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(v) order by v.id), '[]'::jsonb) from public.credit_card_reconciliation_resolution_reversals v)
  )::text)
  into v_current_financial_hash;

  if v_snapshot_hash <> v_current_snapshot_hash
     or v_financial_hash <> v_current_financial_hash then
    raise exception 'Snapshot ou dados financeiros mudaram durante a aposentadoria.';
  end if;

  begin
    perform public.reconcile_credit_card_structural_entries_atomic_v1(
      null, null, null, null
    );
    raise exception 'Apply legado permaneceu executavel.';
  exception when sqlstate '0A000' then null;
  end;

  begin
    perform public.rollback_credit_card_structural_entries_atomic_v1(
      '4c000000-0000-4000-8000-000000000001'
    );
    raise exception 'Rollback legado permaneceu executavel.';
  exception when sqlstate '0A000' then null;
  end;
end;
$retirement_test$;

do $unauthorized_and_acl_test$
begin
  if pg_catalog.has_function_privilege(
       'authenticated',
       'public.retire_credit_card_structural_snapshot_v1(uuid,uuid,uuid,text,integer,text,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.retire_credit_card_structural_snapshot_v1(uuid,uuid,uuid,text,integer,text,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.retire_credit_card_structural_snapshot_v1(uuid,uuid,uuid,text,integer,text,uuid)',
       'EXECUTE'
     ) then
    raise exception 'ACL administrativa inesperada.';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claims',
    '{"role":"authenticated","sub":"1c000000-0000-4000-8000-000000000001"}',
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

  begin
    perform finelo_structural_internal.retire_credit_card_structural_snapshot_v1_impl(
      '4c000000-0000-4000-8000-000000000001',
      '2c000000-0000-4000-8000-000000000001',
      '3c000000-0000-4000-8000-000000000001',
      'after-revision', 1,
      'Tentativa sem autorizacao deve ser recusada pelo executor privado.',
      '8c000000-0000-4000-8000-000000000002'
    );
    raise exception 'Chamador nao autorizado atravessou o executor privado.';
  exception when sqlstate '42501' then null;
  end;
end;
$unauthorized_and_acl_test$;

-- Prova automatizada do fail-safe para mais de um snapshot ativo. O indice e
-- removido apenas nesta transacao para alcancar a guarda interna; o ROLLBACK
-- final restaura indice, trigger e dados.
insert into public.contas (
  id, user_id, "Nome_Conta", "Tipo_Conta", "Saldo_Inicial", "Data_Saldo_Inicial"
) values (
  '2c000000-0000-4000-8000-000000000002',
  '1c000000-0000-4000-8000-000000000001',
  'Cartao cardinalidade invalida', 'Cartão de Crédito', 0, '2026-01-01'
);
insert into public.credit_cards (id, user_id, account_id, name, closing_day, due_day)
values (
  '3c000000-0000-4000-8000-000000000002',
  '1c000000-0000-4000-8000-000000000001',
  '2c000000-0000-4000-8000-000000000002',
  'Cartao cardinalidade invalida', 3, 10
);

drop index finelo_structural_internal.ux_structural_snapshot_single_unrolled_per_card;
alter table finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  disable trigger trg_reject_legacy_snapshot_mutation;
insert into finelo_structural_internal.credit_card_entry_reconciliation_snapshots (
  id, user_id, account_id, card_id, operation_kind, shadow_checksum,
  before_revision, after_revision, before_rows, after_rows, entry_count,
  identity_update_count, competence_update_count, type_update_count
) values
  (
    '4c000000-0000-4000-8000-000000000002',
    '1c000000-0000-4000-8000-000000000001',
    '2c000000-0000-4000-8000-000000000002',
    '3c000000-0000-4000-8000-000000000002',
    'structural_entry_reconciliation', 'shadow-v1-cardinality-a',
    'before-a', 'after-a',
    '[{"rowId":"5c000000-0000-4000-8000-000000000002","transactionId":"6c000000-0000-4000-8000-000000000002","statementRowId":"7c000000-0000-4000-8000-000000000002","entryType":"purchase"}]',
    '[{"rowId":"5c000000-0000-4000-8000-000000000002","transactionId":"6c000000-0000-4000-8000-000000000002","statementRowId":"7c000000-0000-4000-8000-000000000002","entryType":"purchase"}]',
    1, 0, 0, 0
  ),
  (
    '4c000000-0000-4000-8000-000000000003',
    '1c000000-0000-4000-8000-000000000001',
    '2c000000-0000-4000-8000-000000000002',
    '3c000000-0000-4000-8000-000000000002',
    'structural_entry_reconciliation', 'shadow-v1-cardinality-b',
    'before-b', 'after-b',
    '[{"rowId":"5c000000-0000-4000-8000-000000000003","transactionId":"6c000000-0000-4000-8000-000000000003","statementRowId":"7c000000-0000-4000-8000-000000000003","entryType":"purchase"}]',
    '[{"rowId":"5c000000-0000-4000-8000-000000000003","transactionId":"6c000000-0000-4000-8000-000000000003","statementRowId":"7c000000-0000-4000-8000-000000000003","entryType":"purchase"}]',
    1, 0, 0, 0
  );
alter table finelo_structural_internal.credit_card_entry_reconciliation_snapshots
  enable trigger trg_reject_legacy_snapshot_mutation;

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role","sub":"automated-retirement-test"}',
  true
);
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

do $cardinality_test$
begin
  begin
    perform public.retire_credit_card_structural_snapshot_v1(
      '4c000000-0000-4000-8000-000000000002',
      '2c000000-0000-4000-8000-000000000002',
      '3c000000-0000-4000-8000-000000000002',
      'after-a', 1,
      'A cardinalidade invalida precisa falhar sem registrar aposentadoria.',
      '8c000000-0000-4000-8000-000000000003'
    );
    raise exception 'Dois snapshots ativos foram aceitos.';
  exception when sqlstate '55000' then null;
  end;

  if exists (
    select 1
    from finelo_structural_internal.credit_card_entry_reconciliation_retirements r
    where r.card_id = '3c000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'A falha de cardinalidade gravou decisao parcial.';
  end if;
end;
$cardinality_test$;

rollback;
