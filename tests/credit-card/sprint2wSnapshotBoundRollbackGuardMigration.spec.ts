import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260830231933_sprint_2w_snapshot_bound_rollback_identity_guard.sql'
  ),
  'utf8'
).toLowerCase();

const rollback = readFileSync(
  resolve(
    process.cwd(),
    'supabase/rollbacks/20260830231933_sprint_2w_snapshot_bound_rollback_identity_guard_down.sql'
  ),
  'utf8'
).toLowerCase();

const structuralTest = readFileSync(
  resolve(
    process.cwd(),
    'supabase/tests/20260829223508_sprint_2u_structural_entry_reconciliation_test.sql'
  ),
  'utf8'
).toLowerCase();

describe('Sprint 2W snapshot-bound rollback identity guard', () => {
  it('só abre a exceção para o executor privado e um snapshot ativo exato', () => {
    expect(migration).toContain("current_user = 'finelo_structural_entry_executor'");
    expect(migration).toContain(
      'finelo.structural_identity_guard_rollback_snapshot_id'
    );
    expect(migration).toContain('snapshot.rolled_back_at is null');
    expect(migration).toContain('snapshot.after_revision is not null');
    expect(migration).toContain('actual.row_ids is distinct from expected.row_ids');
    expect(migration).toContain('if not v_snapshot_restoration_matches then');
    expect(migration).toContain("constraint = 'credit_card_entries_transaction_id_guard'");
  });

  it('cria e limpa o contexto somente dentro do rollback privado', () => {
    const occurrences = migration.match(
      /finelo\.structural_identity_guard_rollback_snapshot_id/g
    );
    expect(occurrences?.length).toBeGreaterThanOrEqual(5);
    expect(migration).toContain('perform pg_catalog.set_config(');
    expect(migration).toMatch(
      /finelo\.structural_identity_guard_rollback_snapshot_id'[\s\S]*v_snapshot\.id::text,[\s\S]*true/
    );
    expect(migration).toMatch(
      /finelo\.structural_identity_guard_rollback_snapshot_id'[\s\S]*'',\s*true/
    );
    expect(migration).toContain('security definer');
    expect(migration).toContain("v_rollback_owner <> 'finelo_structural_entry_executor'");
  });

  it('mantém a migration e o rollback de schema atômicos', () => {
    expect(migration.trimStart().startsWith('begin;')).toBe(true);
    expect(migration.trimEnd().endsWith('commit;')).toBe(true);
    expect(rollback.trimStart().startsWith('begin;')).toBe(true);
    expect(rollback.trimEnd().endsWith('commit;')).toBe(true);
    expect(rollback).toContain(
      'create or replace function public.prevent_new_credit_card_entry_transaction_duplicate_update_stmt()'
    );
    expect(rollback).not.toContain(
      "pg_catalog.set_config(\n    'finelo.structural_identity_guard_rollback_snapshot_id'"
    );
  });

  it('cobre separação, rollback para duplicidade histórica e GUC forjado', () => {
    expect(structuralTest).toContain(
      'simula o estado histórico anterior ao guard de identidade'
    );
    expect(structuralTest).toContain(
      'disable trigger trg_prevent_new_cc_entry_transaction_duplicate_insert'
    );
    expect(structuralTest).toContain("(v_result->>'identity_updates')::integer <> 2");
    expect(structuralTest).toContain(
      'um chamador autenticado forjou o contexto privado do rollback'
    );
    expect(structuralTest).toContain('exception when unique_violation then null');
  });
});
