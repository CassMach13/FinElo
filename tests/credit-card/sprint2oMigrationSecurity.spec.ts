import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(
  currentDir,
  '../../supabase/migrations/20260822221118_sprint_2o_atomic_statement_conservation.sql'
);
const migration = readFileSync(migrationPath, 'utf8');

function section(start: string, end: string): string {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return migration.slice(startIndex, endIndex);
}

describe('hardening da migration Sprint 2O', () => {
  it('mantém todo o DDL e todas as ACLs em uma transação explícita', () => {
    const firstStatement = migration.match(/^(?:--.*\r?\n|\s)*([a-z]+);/im)?.[1];
    expect(firstStatement?.toLowerCase()).toBe('begin');
    expect(migration.trimEnd().toLowerCase().endsWith('commit;')).toBe(true);
    expect(migration).toMatch(
      /grant finelo_statement_conservation_executor to postgres;[\s\S]*revoke finelo_statement_conservation_executor from postgres;[\s\S]*commit;/
    );
    expect(migration).not.toMatch(
      /create role finelo_statement_conservation_flag_reader/i
    );
    expect(migration).toContain(
      "execute 'drop role finelo_statement_conservation_flag_reader';"
    );

    for (const functionName of [
      'public.get_atomic_card_statement_conservation_feature_state()',
      'public.conserve_credit_card_statement_duplicates_atomic_v1(',
      'public.rollback_credit_card_statement_conservation_atomic_v1(',
    ]) {
      const createAt = migration.indexOf(`create or replace function ${functionName}`);
      const revokeAt = migration.indexOf(`revoke all on function ${functionName}`, createAt);
      const grantAt = migration.indexOf(`grant execute on function ${functionName}`, revokeAt);
      expect(createAt).toBeGreaterThanOrEqual(0);
      expect(revokeAt).toBeGreaterThan(createAt);
      expect(grantAt).toBeGreaterThan(revokeAt);
    }
  });

  it('expõe somente wrappers SECURITY INVOKER e mantém as implementações no schema privado', () => {
    const wrappers = migration.slice(
      migration.indexOf('-- A Data API expõe somente wrappers SECURITY INVOKER.')
    );
    expect(wrappers.match(/security invoker/g)).toHaveLength(3);
    expect(wrappers).not.toContain('security definer');

    const privateDefinitions = migration.slice(0, migration.indexOf(wrappers));
    expect(privateDefinitions.match(/create or replace function finelo_internal\./g)).toHaveLength(4);
    expect(privateDefinitions.match(/security definer/g)).toHaveLength(3);
    expect(privateDefinitions.match(/security invoker/g)).toHaveLength(1);
    expect(privateDefinitions.match(/set search_path = ''/g)).toHaveLength(4);
    expect(migration).toContain('revoke all on schema finelo_internal from public;');
    expect(migration).toContain('revoke all on schema finelo_internal from anon;');
  });

  it('isola BYPASSRLS em um executor NOLOGIN com ACL estreita e feature bridge privada', () => {
    expect(migration).toMatch(
      /alter role finelo_statement_conservation_executor[\s\S]*?connection limit 0;/
    );
    expect(migration).toContain(
      'alter role finelo_statement_conservation_executor bypassrls;'
    );
    expect(migration).toContain('or r.rolreplication or not r.rolbypassrls');
    expect(migration).not.toMatch(
      /grant\s+(?:select|all)[\s\S]{0,100}on (?:table )?auth\.users[\s\S]{0,100}finelo_statement_conservation_executor/i
    );

    const executorBody = section(
      'create or replace function finelo_internal.conserve_credit_card_statement_duplicates_atomic_v1_impl(',
      'grant create on schema finelo_internal\n  to finelo_statement_conservation_executor;'
    );
    expect(executorBody).not.toContain('from auth.users');
    expect(executorBody).not.toContain('auth.uid()');
    expect(executorBody).toContain(
      'finelo_internal.get_atomic_card_statement_conservation_feature_state_impl()'
    );
    expect(executorBody).toContain(
      'finelo_internal.get_credit_card_projection_revision_for_user('
    );
    expect(migration).toContain(
      'drop policy if exists "Conservation executor can manage own snapshots"'
    );
    expect(migration).not.toContain(
      'create policy "Conservation executor can manage own snapshots"'
    );
  });

  it('mantém relações e helpers da aplicação explicitamente qualificados', () => {
    const privateBodies = [
      section(
        'create or replace function finelo_internal.get_atomic_card_statement_conservation_feature_state_impl()',
        'revoke all on function finelo_internal.get_atomic_card_statement_conservation_feature_state_impl()'
      ),
      section(
        'create or replace function finelo_internal.get_credit_card_projection_revision_for_user(',
        'grant create on schema finelo_internal\n  to finelo_statement_conservation_executor;'
      ),
      section(
        'create or replace function finelo_internal.conserve_credit_card_statement_duplicates_atomic_v1_impl(',
        'grant create on schema finelo_internal\n  to finelo_statement_conservation_executor;'
      ),
      section(
        'create or replace function finelo_internal.rollback_credit_card_statement_conservation_atomic_v1_impl(',
        'grant create on schema finelo_internal\n  to finelo_statement_conservation_executor;'
      ),
    ].join('\n');

    expect(privateBodies).not.toMatch(
      /\b(?:from|join|update|insert into|delete from)\s+(?:contas|credit_cards|credit_card_)/i
    );
    expect(privateBodies).toContain('from auth.users u');
    expect(privateBodies).toContain('from public.credit_card_statements s');
    expect(privateBodies).toContain(
      'finelo_internal.get_credit_card_projection_revision_for_user('
    );
    expect(privateBodies).not.toContain('public.get_credit_card_projection_revision(');
  });
});
