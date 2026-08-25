import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(
  currentDir,
  '../../supabase/migrations/20260824214213_sprint_2t_derived_settlement_reconciliation.sql'
);
const rollbackPath = join(
  currentDir,
  '../../supabase/rollbacks/20260824214213_sprint_2t_derived_settlement_reconciliation_down.sql'
);
const migration = readFileSync(migrationPath, 'utf8');
const rollback = readFileSync(rollbackPath, 'utf8');

const section = (start: string, end: string): string => {
  const startAt = migration.indexOf(start);
  const endAt = migration.indexOf(end, startAt + start.length);
  expect(startAt).toBeGreaterThanOrEqual(0);
  expect(endAt).toBeGreaterThan(startAt);
  return migration.slice(startAt, endAt);
};

describe('hardening da migration Sprint 2T', () => {
  it('mantém DDL, ownership temporário e ACLs na mesma transação', () => {
    expect(migration.match(/^(?:--.*\r?\n|\s)*([a-z]+);/im)?.[1]).toBe('begin');
    expect(migration.trimEnd().endsWith('commit;')).toBe(true);
    expect(migration).toMatch(
      /grant finelo_statement_conservation_executor to postgres;[\s\S]*grant finelo_derived_settlement_executor to postgres;[\s\S]*revoke finelo_statement_conservation_executor from postgres;[\s\S]*revoke finelo_derived_settlement_executor from postgres;[\s\S]*commit;/
    );

    for (const functionName of [
      'public.get_atomic_card_derived_settlement_feature_state()',
      'public.reconcile_credit_card_derived_settlement_atomic_v1(',
      'public.rollback_credit_card_derived_settlement_atomic_v1(',
    ]) {
      const createAt = migration.indexOf(`create or replace function ${functionName}`);
      const revokeAt = migration.indexOf(`revoke all on function ${functionName}`, createAt);
      const grantAt = migration.indexOf(`grant execute on function ${functionName}`, revokeAt);
      expect(createAt).toBeGreaterThanOrEqual(0);
      expect(revokeAt).toBeGreaterThan(createAt);
      expect(grantAt).toBeGreaterThan(revokeAt);
    }
  });

  it('expõe somente wrappers SECURITY INVOKER e mantém escrita privilegiada privada', () => {
    for (const wrapperName of [
      'public.get_atomic_card_derived_settlement_feature_state()',
      'public.reconcile_credit_card_derived_settlement_atomic_v1(',
      'public.rollback_credit_card_derived_settlement_atomic_v1(',
    ]) {
      const body = section(
        `create or replace function ${wrapperName}`,
        `revoke all on function ${wrapperName}`
      );
      expect(body).toContain('security invoker');
      expect(body).not.toContain('security definer');
      expect(body).toContain("set search_path = ''");
    }

    const applyBody = section(
      'create or replace function finelo_internal.reconcile_credit_card_derived_settlement_atomic_v1_impl(',
      'grant create on schema finelo_internal to finelo_derived_settlement_executor;'
    );
    const rollbackBody = section(
      'create or replace function finelo_internal.rollback_credit_card_derived_settlement_atomic_v1_impl(',
      'grant create on schema finelo_internal to finelo_derived_settlement_executor;'
    );
    for (const body of [applyBody, rollbackBody]) {
      expect(body).toContain('security definer');
      expect(body).toContain("set search_path = ''");
      expect(body).not.toContain('auth.uid()');
      expect(body).not.toMatch(/\b(?:from|join|update|insert into|delete from)\s+(?:contas|credit_cards|credit_card_)/i);
    }
  });

  it('restringe a mutação às quatro colunas derivadas e conserva registros físicos', () => {
    expect(migration).toContain('create role finelo_derived_settlement_executor;');
    expect(migration).toContain(
      'alter role finelo_derived_settlement_executor\n  nologin noinherit connection limit 0;'
    );
    expect(migration).toContain('alter role finelo_derived_settlement_executor bypassrls;');
    expect(migration).not.toMatch(
      /grant\s+(?:insert|delete|all)[\s\S]{0,100}public\.credit_card_statements[\s\S]{0,100}finelo_derived_settlement_executor/i
    );
    expect(migration).toContain(
      'grant update (total_payments, open_balance, open_amount, status)'
    );
    expect(migration).toContain(
      'grant select on table public.credit_card_entries to finelo_derived_settlement_executor;'
    );
    expect(migration).toContain(
      'create index if not exists idx_cc_reconciliation_card'
    );
    const applyBody = section(
      'create or replace function finelo_internal.reconcile_credit_card_derived_settlement_atomic_v1_impl(',
      'grant create on schema finelo_internal to finelo_derived_settlement_executor;'
    );
    const statementUpdate = applyBody.match(
      /update public\.credit_card_statements s\s+set ([\s\S]*?)\s+from desired/
    )?.[1];
    expect(statementUpdate).toBeDefined();
    expect(statementUpdate).toContain('total_payments =');
    expect(statementUpdate).toContain('open_balance =');
    expect(statementUpdate).toContain('open_amount =');
    expect(statementUpdate).toContain('status =');
    expect(statementUpdate).not.toMatch(/statement_total|reference_label|due_date|manual_totals/);
    expect(applyBody).not.toMatch(/\b(?:delete from|truncate)\b/i);
    expect(applyBody).not.toMatch(/update public\.credit_card_(?:entries|payments)/i);
    expect(applyBody).toContain("'entry_records_changed', 0");
    expect(applyBody).toContain("'payment_records_changed', 0");
  });

  it('protege concorrência, estado auditado, pagamentos e rollback exato', () => {
    expect(migration).toContain('pg_catalog.pg_advisory_xact_lock(');
    expect(migration).toContain('for update of cc;');
    expect(migration).toContain('p_expected_revision');
    expect(migration).toContain('p_shadow_checksum');
    expect(migration).toContain('from public.credit_card_payments p');
    expect(migration).toContain('v_snapshot.after_revision');
    expect(migration).toContain('v_snapshot.before_revision');
    expect(migration).toContain('A projeção mudou após a reconciliação');
    expect(migration).toContain('A restauração não reproduziu a revisão original');
  });

  it('nega PUBLIC, anon e service_role e preserva um rollback rastreável', () => {
    expect(migration).toContain(
      'revoke all on table public.credit_card_reconciliation_snapshots from public;'
    );
    expect(migration).toContain(
      'revoke all on table public.credit_card_reconciliation_snapshots from service_role;'
    );
    expect(migration).toContain("not ('search_path=\"\"' = any(p.proconfig))");
    expect(rollback.match(/^(?:--.*\r?\n|\s)*([a-z]+);/im)?.[1]).toBe('begin');
    expect(rollback.trimEnd().endsWith('commit;')).toBe(true);
    expect(rollback).toContain(
      'drop table if exists public.credit_card_reconciliation_snapshots;'
    );
    expect(rollback).toContain('set local role finelo_statement_conservation_executor;');
    expect(rollback).toContain(
      'revoke execute on function finelo_internal.get_credit_card_projection_revision_for_user(uuid, uuid)'
    );
    expect(rollback).not.toMatch(/delete from public\.credit_card_statements/i);
  });
});
