import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260830223000_sprint_2v_cycle_safe_entry_identity_guard.sql'
  ),
  'utf8'
).toLowerCase();

const rollback = readFileSync(
  resolve(
    process.cwd(),
    'supabase/rollbacks/20260830223000_sprint_2v_cycle_safe_entry_identity_guard_down.sql'
  ),
  'utf8'
).toLowerCase();

describe('Sprint 2V cycle-safe identity guard migration', () => {
  it('valida o estado final de inserts e updates com transition tables', () => {
    expect(migration).toContain('after insert on public.credit_card_entries');
    expect(migration).toContain('after update on public.credit_card_entries');
    expect(migration).toContain('referencing new table as new_credit_card_entries');
    expect(migration).toContain('old table as old_credit_card_entries');
    expect(migration).toContain('for each statement');
    expect(migration).not.toContain('before insert or update of transaction_id');
  });

  it('serializa identidades liberadas e reivindicadas em ordem determinística', () => {
    expect(migration).toContain('pg_catalog.pg_advisory_xact_lock');
    expect(migration).toContain('previous.transaction_id');
    expect(migration).toContain('updated.transaction_id');
    expect(migration).toContain('order by changed.transaction_id');
    expect(migration).toContain('having pg_catalog.count(*) > 1');
  });

  it('mantém as funções invoker sem execução RPC direta', () => {
    expect(migration).toMatch(/security invoker\s+set search_path = ''/);
    expect(migration).toContain(
      'revoke all on function public.prevent_new_credit_card_entry_transaction_duplicate_insert_stmt()'
    );
    expect(migration).toContain(
      'revoke all on function public.prevent_new_credit_card_entry_transaction_duplicate_update_stmt()'
    );
    expect(migration).toContain('from public, anon, authenticated');
  });

  it('é atômica e possui rollback para o guard row-level anterior', () => {
    expect(migration.trimStart().startsWith('begin;')).toBe(true);
    expect(migration.trimEnd().endsWith('commit;')).toBe(true);
    expect(rollback.trimStart().startsWith('begin;')).toBe(true);
    expect(rollback).toContain('before insert or update of transaction_id');
    expect(rollback).toContain('for each row');
    expect(rollback.trimEnd().endsWith('commit;')).toBe(true);
  });
});
