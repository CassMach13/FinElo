import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSqlFixture } from '../helpers/sqlFixture';

const currentDir = dirname(fileURLToPath(import.meta.url));
const migration = readSqlFixture(join(
    currentDir,
    '../../supabase/migrations/20260829223508_sprint_2u_structural_entry_reconciliation.sql'
  ));
const rollback = readSqlFixture(join(
    currentDir,
    '../../supabase/rollbacks/20260829223508_sprint_2u_structural_entry_reconciliation_down.sql'
  ));

const section = (start: string, end: string): string => {
  const startAt = migration.indexOf(start);
  const endAt = migration.indexOf(end, startAt + start.length);
  expect(startAt).toBeGreaterThanOrEqual(0);
  expect(endAt).toBeGreaterThan(startAt);
  return migration.slice(startAt, endAt);
};

describe('hardening da migration Sprint 2U', () => {
  it('mantém criação, ACLs e ownership na mesma transação', () => {
    expect(migration.match(/^(?:--.*\r?\n|\s)*([a-z]+);/im)?.[1]).toBe('begin');
    expect(migration.trimEnd().endsWith('commit;')).toBe(true);
    expect(migration).toMatch(
      /grant finelo_statement_conservation_executor to postgres\s+with set true, inherit false;[\s\S]*set local role finelo_statement_conservation_executor;[\s\S]*revoke finelo_statement_conservation_executor from postgres;/
    );
    expect(
      migration.match(
        /grant finelo_structural_entry_executor to postgres\s+with set true, inherit false;/g
      )
    ).toHaveLength(2);
    expect(
      migration.match(/revoke finelo_structural_entry_executor from postgres;/g)
    ).toHaveLength(2);
    expect(migration).toMatch(
      /grant finelo_structural_entry_gateway to postgres\s+with set true, inherit false;[\s\S]*revoke finelo_structural_entry_gateway from postgres;[\s\S]*commit;/
    );

    const featureBody = section(
      'create or replace function public.get_atomic_card_structural_entry_feature_state()',
      'alter function public.get_atomic_card_structural_entry_feature_state()'
    );
    expect(featureBody).toContain('security invoker');
    expect(featureBody).toContain("set search_path = ''");
    expect(featureBody).not.toContain('security definer');
    expect(featureBody).not.toContain('finelo_internal.');

    for (const name of [
      'public.reconcile_credit_card_structural_entries_atomic_v1(',
      'public.rollback_credit_card_structural_entries_atomic_v1(',
    ]) {
      const createAt = migration.indexOf(`create or replace function ${name}`);
      const revokeAt = migration.indexOf(`revoke all on function ${name}`, createAt);
      const grantAt = migration.indexOf(`grant execute on function ${name}`, revokeAt);
      expect(createAt).toBeGreaterThanOrEqual(0);
      expect(revokeAt).toBeGreaterThan(createAt);
      expect(grantAt).toBeGreaterThan(revokeAt);
    }
  });

  it('expõe somente wrappers invokers e mantém os definers de dados privados', () => {
    for (const name of [
      'public.reconcile_credit_card_structural_entries_atomic_v1(',
      'public.rollback_credit_card_structural_entries_atomic_v1(',
    ]) {
      const body = section(
        `create or replace function ${name}`,
        `revoke all on function ${name}`
      );
      expect(body).toContain('security invoker');
      expect(body).toContain("set search_path = ''");
      expect(body).not.toContain('security definer');
    }

    const applyBody = section(
      'create or replace function finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(',
      'grant create on schema finelo_structural_internal to finelo_structural_entry_executor;'
    );
    const rollbackBody = section(
      'create or replace function finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(',
      'grant create on schema finelo_structural_internal to finelo_structural_entry_executor;'
    );
    for (const body of [applyBody, rollbackBody]) {
      expect(body).toContain('security definer');
      expect(body).toContain("set search_path = ''");
      expect(body).not.toContain('auth.uid()');
      expect(body).not.toMatch(
        /\b(?:from|join|update|insert into|delete from)\s+(?:contas|transactions|credit_card_)/i
      );
    }
  });

  it('limita a escrita às três colunas estruturais dos lançamentos normalizados', () => {
    expect(migration).toContain(
      'alter role finelo_structural_entry_executor\n  nologin noinherit nobypassrls connection limit 0;'
    );
    expect(migration).toContain(
      'alter role finelo_structural_entry_gateway\n  nologin noinherit nobypassrls connection limit 0;'
    );
    expect(migration).not.toMatch(/alter role finelo_structural_entry_(?:executor|gateway) bypassrls;/);
    expect(migration).toContain(
      'grant update (transaction_id, statement_id, entry_type)'
    );
    expect(migration).toContain(
      'grant select on table public.credit_card_payments to finelo_structural_entry_executor;'
    );
    expect(migration).not.toContain('grant update (id) on table public.credit_cards');
    expect(migration).not.toMatch(
      /from public\.credit_cards c[\s\S]{0,240}for update/i
    );
    expect(migration).not.toMatch(
      /grant\s+update(?:\s*\([^)]*\))?\s+on table public\.transactions/i
    );
    expect(migration).not.toMatch(
      /grant\s+(?:insert|delete|update|all)[\s\S]{0,120}public\.credit_card_(?:payments|statements)/i
    );

    const applyBody = section(
      'create or replace function finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(',
      'grant create on schema finelo_structural_internal to finelo_structural_entry_executor;'
    );
    const entryUpdate = applyBody.match(
      /update public\.credit_card_entries e\s+set ([\s\S]*?)\s+from desired_updates desired/
    )?.[1];
    expect(entryUpdate).toBeDefined();
    expect(entryUpdate).toContain('transaction_id =');
    expect(entryUpdate).toContain('statement_id =');
    expect(entryUpdate).toContain('entry_type =');
    expect(entryUpdate).not.toMatch(/posted_date|amount|source_|import_lot|description/);
    expect(applyBody).not.toMatch(/\b(?:delete from|truncate|insert into public\.transactions)\b/i);
    expect(applyBody).not.toMatch(/update public\.credit_card_(?:payments|statements)/i);
    expect(applyBody).toContain("'transaction_records_changed', 0");
    expect(applyBody).toContain("'payment_records_changed', 0");
    expect(applyBody).toContain("'statement_records_changed', 0");
  });

  it('protege revisão, concorrência, unicidade, snapshot e rollback exato', () => {
    expect(migration).toContain('pg_catalog.pg_advisory_xact_lock(');
    expect(migration).toContain('for update of e;');
    expect(migration).toContain('p_expected_revision');
    expect(migration).toContain('p_shadow_checksum');
    expect(migration).toContain('v_final_entry_count <> v_final_identity_count');
    expect(migration).toContain('v_snapshot.after_revision');
    expect(migration).toContain('v_snapshot.before_revision');
    expect(migration).toContain('A projeção mudou depois da auditoria');
    expect(migration).toContain('A revisão restaurada não coincide com o snapshot');
    expect(migration).toContain(
      'finelo_structural_internal.credit_card_entry_reconciliation_snapshots'
    );
  });

  it('mantém snapshot fora da Data API, flag desligada por padrão e rollback rastreável', () => {
    expect(migration).toContain(
      'create schema if not exists finelo_structural_internal authorization postgres;'
    );
    expect(migration).not.toContain(
      'grant usage on schema finelo_internal to authenticated;'
    );
    expect(migration).toContain(
      "else 'unset'"
    );
    expect(migration).toContain(
      'alter table finelo_structural_internal.credit_card_entry_reconciliation_snapshots\n  enable row level security;'
    );
    expect(migration).toContain(
      'alter table finelo_structural_internal.credit_card_entry_reconciliation_snapshots\n  force row level security;'
    );
    expect(migration).toContain(
      'to finelo_structural_entry_executor\n  using (user_id = (select auth.uid()))\n  with check (user_id = (select auth.uid()));'
    );
    expect(migration).toContain(
      'create index if not exists idx_cc_entry_reconciliation_card'
    );
    expect(migration).toContain(
      'revoke all on table finelo_structural_internal.credit_card_entry_reconciliation_snapshots\n  from public, anon, authenticated, service_role;'
    );
    expect(migration).toContain(
      'grant usage on schema finelo_structural_internal to authenticated;'
    );
    expect(migration).toContain(
      'grant execute on function finelo_structural_internal.reconcile_credit_card_structural_entries_atomic_v1_impl(\n  uuid, text, text, jsonb\n) to authenticated;'
    );
    expect(migration).toContain(
      'finelo_structural_internal.rollback_credit_card_structural_entries_atomic_v1_impl(uuid)\n  to authenticated;'
    );
    expect(migration).toContain(
      "pg_catalog.pg_get_userbyid(p.proowner) <>\n      'finelo_structural_entry_gateway'"
    );
    expect(migration).toContain(
      "raise exception 'ACL privada mínima inválida nos wrappers Sprint 2U.'"
    );
    expect(migration).toContain('or membership.inherit_option');
    expect(migration).toContain('or membership.set_option');
    expect(migration).toContain(
      "raise exception 'Uma membership funcional Sprint 2U permaneceu ativa.'"
    );
    expect(rollback.match(/^(?:--.*\r?\n|\s)*([a-z]+);/im)?.[1]).toBe('begin');
    expect(rollback.trimEnd().endsWith('commit;')).toBe(true);
    expect(rollback).toContain(
      'drop table if exists\n  finelo_structural_internal.credit_card_entry_reconciliation_snapshots;'
    );
    expect(rollback).toContain(
      'drop schema if exists finelo_structural_internal;'
    );
    expect(rollback).toContain(
      'from authenticated, finelo_structural_entry_gateway;'
    );
    expect(rollback).toMatch(
      /grant finelo_statement_conservation_executor to postgres\s+with set true, inherit false;[\s\S]*set local role finelo_statement_conservation_executor;[\s\S]*revoke finelo_statement_conservation_executor from postgres;/
    );
    expect(rollback).not.toMatch(/delete from public\.credit_card_/i);
  });
});
