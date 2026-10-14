import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { User } from '@supabase/supabase-js';
import type { Asset } from '../src/types';
import { A, B, C, D, E, BASE_SCHEMA, as, q } from './helpers/investmentsPgFixture';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../src/supabaseClient', () => ({ supabase: { from: mocks.from } }));
import { useAppStore } from '../src/hooks/useAppStore';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
let db: PGlite;
const id = 'a0000000-0000-4000-8000-000000000010';
const original: Asset = {
  id, user_id: A, name: 'Synthetic financed asset', type: 'car', value: 20000,
  is_financed: true, financed_amount: 20000, remaining_balance: 13000, paid_installments: 7,
  updated_at: '2026-10-01T00:00:00.000Z',
};
let writes: number;

beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
  // The existing family predicate is loaded from migration 055 by BASE_SCHEMA.
  // Minimal local tables model the legacy family SELECT/UPDATE contract; no remote database is used.
  await db.exec(BASE_SCHEMA + `
    create table public.assets (
      id uuid primary key, user_id uuid not null, name text, type text, value numeric,
      is_financed boolean, financed_amount numeric, remaining_balance numeric,
      paid_installments integer, updated_at timestamptz
    );
    create table public.transactions (user_id uuid, linked_asset_id uuid, "Valor" numeric, "Tipo" text);
    alter table public.assets enable row level security;
    alter table public.transactions enable row level security;
    create policy "Family Access Assets" on public.assets for all to public
      using (public.has_family_access(user_id)) with check (public.has_family_access(user_id));
    create policy "Family Access Transactions" on public.transactions for all to public
      using (public.has_family_access(user_id)) with check (public.has_family_access(user_id));
    insert into public.assets values ('${id}', '${A}', 'Synthetic financed asset', 'car', 20000,
      true, 20000, 13000, 7, '2026-10-01T00:00:00Z');
    insert into public.transactions values ('${A}', '${id}', -8000, 'Despesa');
  `);
});
afterAll(async () => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  await db?.close();
});
beforeEach(async () => {
  await as(db, 'postgres');
  await q(db, 'update public.assets set name = $1, remaining_balance = 13000, paid_installments = 7', [original.name]);
  useAppStore.setState(useAppStore.getInitialState(), true);
  writes = 0;
  mocks.from.mockImplementation((table: string) => {
    if (table === 'transactions') return {
      select: () => ({ eq: async (_column: string, assetId: string) => ({
        data: await q(db, 'select "Valor"::float8 as "Valor", "Tipo" from public.transactions where linked_asset_id = $1', [assetId]), error: null,
      }) }),
    };
    if (table === 'assets') return {
      update: (patch: Record<string, unknown>) => ({ eq: (_column: string, assetId: string) => ({
        select: async () => {
          const keys = Object.keys(patch);
          if (!keys.every(k => ['remaining_balance', 'paid_installments', 'updated_at', 'name'].includes(k))) throw new Error('Unexpected field');
          const rows = await q(db, `update public.assets set ${keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')} where id = $${keys.length + 1} returning *`, [...keys.map(k => patch[k]), assetId]);
          writes += rows.length;
          return { data: rows, error: null };
        },
      }) }),
    };
    throw new Error(`Unexpected table: ${table}`);
  });
});
const session = async (userId: string) => {
  useAppStore.getState().setUser({ id: userId } as User);
  // Even a forged/stale client snapshot must not grant permission to write a third party asset.
  useAppStore.setState({ assets: [{ ...original }] });
  await as(db, 'authenticated', userId);
};
const persisted = async () => {
  await as(db, 'postgres');
  return (await q<{ balance: number; name: string; paid_installments: number }>(db,
    'select remaining_balance::float8 as balance, name, paid_installments from public.assets where id = $1', [id]))[0];
};

describe('asset writes under the existing family authorization contract (local PostgreSQL)', () => {
  it('accepted family member can explicitly edit and recalculate the owner asset', async () => {
    await session(B);
    await useAppStore.getState().updateAsset({ id, name: 'Authorized family edit' });
    expect(writes).toBe(2);
    expect(await persisted()).toEqual({ balance: 12000, name: 'Authorized family edit', paid_installments: 1 });
  });

  it.each([C, D, E])('outsider/pending/declined user %s cannot update or recalculate another owner asset', async userId => {
    await session(userId);
    await useAppStore.getState().updateAsset({ id, name: 'Unauthorized edit' });
    await useAppStore.getState().recalculateAssetBalance(id);
    expect(writes).toBe(0);
    expect(useAppStore.getState().assets).toEqual([original]);
    expect(await persisted()).toEqual({ balance: 13000, name: original.name, paid_installments: 7 });
  });

  it('revoking an accepted link prevents the same explicit recalculation from writing', async () => {
    await as(db, 'postgres');
    await q(db, "update public.family_members set status = 'declined' where owner_id = $1 and member_email = $2", [A, 'b@example.test']);
    await session(B);
    await useAppStore.getState().recalculateAssetBalance(id);
    expect(writes).toBe(0);
    expect(await persisted()).toEqual({ balance: 13000, name: original.name, paid_installments: 7 });
  });
});
