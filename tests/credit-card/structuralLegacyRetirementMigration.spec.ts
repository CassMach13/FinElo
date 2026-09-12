import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSqlFixture } from '../helpers/sqlFixture';

const currentDir = dirname(fileURLToPath(import.meta.url));
const root = join(currentDir, '../..');
const migration = readSqlFixture(join(
  root,
  'supabase/migrations/20260912224658_retire_structural_legacy_flow.sql'
));
const rollback = readSqlFixture(join(
  root,
  'supabase/rollbacks/20260912224658_retire_structural_legacy_flow_down.sql'
));

const source = (path: string) => readFileSync(join(root, path), 'utf8');

describe('aposentadoria do fluxo estrutural legado', () => {
  it('fecha apply e rollback no banco sem depender do JWT', () => {
    expect(migration.match(/^(?:--.*\r?\n|\s)*([a-z]+);/im)?.[1]).toBe('begin');
    expect(migration.trimEnd().endsWith('commit;')).toBe(true);
    expect(migration).toContain('apply_enabled boolean not null default false');
    expect(migration).toContain('check (apply_enabled = false)');
    expect(migration).toContain('rollback_enabled boolean not null default false');
    expect(migration).toContain("select 'retired'::text;");
    expect(migration).not.toContain('atomic_card_structural_entry_reconciliation_enabled');

    for (const signature of [
      'public.reconcile_credit_card_structural_entries_atomic_v1(',
      'public.rollback_credit_card_structural_entries_atomic_v1(',
    ]) {
      const start = migration.lastIndexOf(`create or replace function ${signature}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const body = migration.slice(start, migration.indexOf('$retired_', start + 40) + 800);
      expect(body).toContain('security invoker');
      expect(body).toContain("using errcode = '0A000'");
    }

    expect(migration).toContain(
      'revoke update (transaction_id, statement_id, entry_type)\n  on table public.credit_card_entries'
    );
    expect(migration).not.toMatch(/grant execute on function public\.reconcile_credit_card_structural_entries_atomic_v1[\s\S]{0,120}to authenticated/i);
    expect(migration).not.toMatch(/grant execute on function public\.rollback_credit_card_structural_entries_atomic_v1[\s\S]{0,120}to authenticated/i);
  });

  it('registra a decisão separadamente e preserva o snapshot original', () => {
    expect(migration).toContain(
      'create table if not exists finelo_structural_internal.credit_card_entry_reconciliation_retirements'
    );
    expect(migration).toContain('snapshot_id uuid primary key');
    expect(migration).toContain("check (decision = 'retired_without_rollback')");
    expect(migration).toContain('idempotency_key uuid not null unique');
    expect(migration).toContain('retired_by_role text not null');
    expect(migration).toContain('retired_by_subject text not null');
    expect(migration).toContain('pg_catalog.pg_advisory_xact_lock(');
    expect(migration).toContain("'idempotent_replay', true");
    expect(migration).toContain('v_active_count <> 1');
    expect(migration).toContain('ux_structural_snapshot_single_unrolled_per_card');
    expect(migration).toContain('trg_reject_legacy_snapshot_mutation');
    expect(migration).toContain('trg_reject_retirement_update_delete');

    expect(migration).not.toMatch(/^\s*update\s+finelo_structural_internal\.credit_card_entry_reconciliation_snapshots/im);
    expect(migration).not.toMatch(/^\s*delete\s+from\s+finelo_structural_internal\.credit_card_entry_reconciliation_snapshots/im);
    expect(migration).not.toMatch(/^\s*update\s+public\.(?:transactions|credit_card_entries|credit_card_payments|credit_card_statements)/im);
    expect(migration).not.toMatch(/^\s*delete\s+from\s+public\.(?:transactions|credit_card_entries|credit_card_payments|credit_card_statements)/im);
  });

  it('usa executor privado mínimo e wrapper público sem elevação', () => {
    expect(migration).toContain(
      'alter role finelo_structural_retirement_executor\n  nologin noinherit nobypassrls connection limit 0;'
    );
    expect(migration).toContain(
      'create or replace function finelo_structural_internal.retire_credit_card_structural_snapshot_v1_impl('
    );
    expect(migration).toContain('security definer');
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      ') owner to finelo_structural_retirement_executor;'
    );
    expect(migration).toContain(
      'create or replace function public.retire_credit_card_structural_snapshot_v1('
    );
    expect(migration).toMatch(/create or replace function public\.retire_credit_card_structural_snapshot_v1\([\s\S]+?security invoker[\s\S]+?set search_path = ''/);
    expect(migration).toContain(
      ') to service_role;\nalter function public.retire_credit_card_structural_snapshot_v1('
    );
    expect(migration).toContain("v_request_role is distinct from 'service_role'");
    expect(migration).not.toMatch(/alter role finelo_structural_retirement_executor\s+bypassrls/i);
  });

  it('serializa intenção e cartão e mantém rollback fail-closed', () => {
    expect(migration.match(/pg_catalog\.pg_advisory_xact_lock\(/g)).toHaveLength(2);
    expect(migration).toContain('idempotency_key = p_idempotency_key');
    expect(rollback.match(/^(?:--.*\r?\n|\s)*([a-z]+);/im)?.[1]).toBe('begin');
    expect(rollback.trimEnd().endsWith('commit;')).toBe(true);
    expect(rollback).toContain('existe decisao de aposentadoria');
    expect(rollback).toContain('existe snapshot estrutural ativo');
    expect(rollback).toContain('Mantidos intencionalmente:');
    expect(rollback).not.toContain('grant execute on function public.reconcile_credit_card_structural_entries_atomic_v1');
    expect(rollback).not.toContain('grant execute on function public.rollback_credit_card_structural_entries_atomic_v1');
    expect(rollback).not.toMatch(/update\s+public\.(?:transactions|credit_card_entries|credit_card_payments|credit_card_statements)/i);
    const concurrency = readSqlFixture(join(
      root,
      'supabase/tests/20260912224658_retire_structural_legacy_flow_concurrency_test.sql'
    ));
    expect(concurrency.match(/dblink_send_query\(/g)).toHaveLength(2);
    expect(concurrency).toContain('idempotent_replay');
    expect(concurrency).toContain('Tentativas concorrentes nao convergiram');
  });

  it('remove do cliente todos os caminhos executáveis e mostra a aposentadoria', () => {
    const client = [
      source('src/services/creditCardAtomicRebuildService.ts'),
      source('src/hooks/useAppStore.ts'),
      source('src/components/modals/CreditCardInvoiceCyclesModal.tsx'),
    ].join('\n');

    for (const forbidden of [
      'reconcile_credit_card_structural_entries_atomic_v1',
      'rollback_credit_card_structural_entries_atomic_v1',
      'get_atomic_card_structural_entry_feature_state',
      'reconcileAtomicCardStructuralEntries',
      'rollbackAtomicCardStructuralEntries',
      'getAtomicCardStructuralEntryFeatureState',
    ]) {
      expect(client).not.toContain(forbidden);
    }

    const modal = source('src/components/modals/CreditCardInvoiceCyclesModal.tsx');
    expect(modal).toContain('Fluxo estrutural legado aposentado');
    expect(modal).toContain('usa o fluxo atual de dois livros e reconciliação explícita');
  });
});
