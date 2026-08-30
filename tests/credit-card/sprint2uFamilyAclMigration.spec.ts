import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260830210730_sprint_2u_structural_entry_executor_family_acl.sql'
  ),
  'utf8'
).toLowerCase();

const rollback = readFileSync(
  resolve(
    process.cwd(),
    'supabase/rollbacks/20260830210730_sprint_2u_structural_entry_executor_family_acl_down.sql'
  ),
  'utf8'
).toLowerCase();

describe('correção mínima da ACL estrutural Sprint 2U', () => {
  it('faz o grant de forma atômica e somente para o executor dedicado', () => {
    expect(migration.trimStart()).toMatch(/^--[\s\S]*\nbegin;/);
    expect(migration.trimEnd()).toMatch(/commit;$/);
    expect(migration).toContain(
      'grant execute on function public.has_family_access(uuid)\n  to finelo_structural_entry_executor;'
    );
    expect(migration).not.toMatch(/grant .* to (?:public|anon|authenticated|service_role)/);
  });

  it('falha fechado se o papel privilegiado deixar de ser mínimo', () => {
    expect(migration).toContain('and not r.rolcanlogin');
    expect(migration).toContain('and not r.rolinherit');
    expect(migration).toContain('and not r.rolbypassrls');
    expect(migration).toContain('and not r.rolsuper');
    expect(migration).toContain('executor estrutural possui membership inesperada');
    expect(migration).toContain('pg_catalog.aclexplode(p.proacl)');
  });

  it('não concede escrita a transações, faturas ou pagamentos', () => {
    expect(migration).toContain("'public.transactions'");
    expect(migration).toContain("'public.credit_card_statements'");
    expect(migration).toContain("'public.credit_card_payments'");
    expect(migration).toContain("'insert,update,delete'");
  });

  it('possui rollback atômico que remove somente o execute auxiliar', () => {
    expect(rollback.trimStart()).toMatch(/^begin;/);
    expect(rollback.trimEnd()).toMatch(/commit;$/);
    expect(rollback).toContain(
      'revoke execute on function public.has_family_access(uuid)\n  from finelo_structural_entry_executor;'
    );
    expect(rollback).toContain('pg_catalog.aclexplode(p.proacl)');
  });
});
