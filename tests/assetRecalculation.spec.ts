import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { Asset, Transaction } from '../src/types';

const mocks = vi.hoisted(() => ({ from: vi.fn(), update: vi.fn(), getUser: vi.fn() }));
vi.mock('../src/supabaseClient', () => ({ supabase: { from: mocks.from, auth: { getUser: mocks.getUser } } }));

import { useAppStore } from '../src/hooks/useAppStore';

const originalTimestamp = '2026-09-01T00:00:00.000Z';
const now = '2026-09-20T15:00:00.000Z';
const serverTimestamp = '2026-09-20T15:00:00.001Z';
type Payment = { Valor: number; Tipo: 'Despesa' | 'Renda' };
let storedAssets: Asset[];
let payments: Record<string, Payment[]>;
let transactionReads: string[];
let updatedIds: string[];

const asset = (overrides: Partial<Asset> = {}): Asset => ({
  id: 'asset-1',
  user_id: 'user-1',
  name: 'Financed asset',
  type: 'car',
  value: 20000,
  is_financed: true,
  financed_amount: 20000,
  remaining_balance: 12000,
  paid_installments: 8,
  updated_at: originalTimestamp,
  ...overrides,
});

const seed = (assets: Asset[]) => {
  storedAssets = assets.map(a => ({ ...a }));
  useAppStore.setState({ assets });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network access'); }));
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().setUser({ id: 'user-1' } as User);
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  storedAssets = [];
  transactionReads = [];
  updatedIds = [];
  payments = { 'asset-1': Array.from({ length: 8 }, () => ({ Valor: -1000, Tipo: 'Despesa' })) };

  mocks.update.mockImplementation((patch: Partial<Asset>) => ({
    eq: (column: string, id: string) => {
      expect(column).toBe('id');
      updatedIds.push(id);
      return {
        select: async () => {
          const existing = storedAssets.find(a => a.id === id);
          if (!existing) throw new Error(`Unknown asset: ${id}`);
          const returned = { ...existing, ...patch, updated_at: serverTimestamp };
          storedAssets = storedAssets.map(a => a.id === id ? returned : a);
          return { data: [returned], error: null };
        },
      };
    },
  }));
  mocks.from.mockImplementation((table: string) => {
    if (table === 'assets') return {
      update: mocks.update,
      select: (columns: string) => {
        expect(columns).toBe('*');
        return { order: async (column: string) => {
          expect(column).toBe('name');
          return { data: storedAssets.map(a => ({ ...a })), error: null };
        } };
      },
    };
    if (table === 'transactions') return {
      select: (columns: string) => {
        expect(columns).toBe('Valor, Tipo');
        return { eq: async (column: string, id: string) => {
          expect(column).toBe('linked_asset_id');
          transactionReads.push(id);
          if (!(id in payments)) throw new Error(`Unexpected transaction read: ${id}`);
          return { data: payments[id], error: null };
        } };
      },
    };
    throw new Error(`Unexpected table: ${table}`);
  });
});

afterEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('asset balance persistence', () => {
  it('A: skips UPDATE and preserves the timestamp and state for an unchanged asset', async () => {
    const current = asset();
    seed([current]);
    const assetsBefore = useAppStore.getState().assets;

    await useAppStore.getState().recalculateAssetBalance(current.id);

    expect(transactionReads).toEqual([current.id]);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(useAppStore.getState().assets).toBe(assetsBefore);
    expect(useAppStore.getState().assets[0]).toEqual(current);
    expect(storedAssets[0].updated_at).toBe(originalTimestamp);
  });

  it('B: writes a changed balance once, timestamps it and uses the returned record', async () => {
    seed([asset({ remaining_balance: 13000 })]);

    await useAppStore.getState().recalculateAssetBalance('asset-1');

    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith({
      remaining_balance: 12000, paid_installments: 8, updated_at: now,
    });
    expect(updatedIds).toEqual(['asset-1']);
    expect(useAppStore.getState().assets[0]).toEqual(storedAssets[0]);
    expect(useAppStore.getState().assets[0].updated_at).toBe(serverTimestamp);

    await useAppStore.getState().recalculateAssetBalance('asset-1');
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('C: writes once when only the installment count changes', async () => {
    seed([asset({ paid_installments: 7 })]);

    await useAppStore.getState().recalculateAssetBalance('asset-1');

    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith({
      remaining_balance: 12000, paid_installments: 8, updated_at: now,
    });
    expect(useAppStore.getState().assets[0].paid_installments).toBe(8);
  });

  it('D: ignores binary floating point differences at the same cent value', async () => {
    seed([asset({ financed_amount: 0.3, remaining_balance: 0.1, paid_installments: 1 })]);
    payments['asset-1'] = [{ Valor: -0.2, Tipo: 'Despesa' }];
    expect(0.3 - 0.2).not.toBe(0.1);

    await useAppStore.getState().recalculateAssetBalance('asset-1');

    expect(mocks.update).not.toHaveBeenCalled();
    expect(useAppStore.getState().assets[0]).toMatchObject({
      remaining_balance: 0.1, updated_at: originalTimestamp,
    });
  });

  it('persists a real one-cent difference with a normalized monetary value', async () => {
    seed([asset({ financed_amount: 0.3, remaining_balance: 0.09, paid_installments: 1 })]);
    payments['asset-1'] = [{ Valor: -0.2, Tipo: 'Despesa' }];

    await useAppStore.getState().recalculateAssetBalance('asset-1');

    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith({
      remaining_balance: 0.1, paid_installments: 1, updated_at: now,
    });
  });

  it('E: batch recalculation writes only divergent financed assets', async () => {
    const correct = asset();
    const staleBalance = asset({ id: 'stale-balance', remaining_balance: 13000 });
    const staleCount = asset({ id: 'stale-count', paid_installments: 7 });
    const unfinanced = asset({ id: 'unfinanced', is_financed: false });
    payments[staleBalance.id] = payments['asset-1'];
    payments[staleCount.id] = payments['asset-1'];
    seed([correct, staleBalance, staleCount, unfinanced]);

    await useAppStore.getState().recalculateAllAssetBalances();

    expect(transactionReads).toEqual([correct.id, staleBalance.id, staleCount.id]);
    expect(updatedIds).toEqual([staleBalance.id, staleCount.id]);
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().assets[0]).toBe(correct);
    expect(useAppStore.getState().assets[3]).toBe(unfinanced);
    expect(useAppStore.getState().assets.slice(1, 3)).toEqual(storedAssets.slice(1, 3));
  });

  it('fetchAssets keeps automatic synchronization without no-op writes', async () => {
    storedAssets = [asset(), asset({ id: 'stale', remaining_balance: 13000 })];
    payments.stale = payments['asset-1'];

    await useAppStore.getState().fetchAssets();
    await vi.waitFor(() => expect(useAppStore.getState().assets[1].updated_at).toBe(serverTimestamp));

    expect(transactionReads).toEqual(['asset-1', 'stale']);
    expect(updatedIds).toEqual(['stale']);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().assets[0].updated_at).toBe(originalTimestamp);
  });

  it('initializes missing financing values instead of treating them as stored zeroes', async () => {
    seed([asset({ financed_amount: 0, remaining_balance: undefined, paid_installments: undefined })]);
    payments['asset-1'] = [];

    await useAppStore.getState().recalculateAssetBalance('asset-1');

    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith({
      remaining_balance: 0, paid_installments: 0, updated_at: now,
    });
  });
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};
const switchTo = (id: string | null) => useAppStore.getState().setUser(id ? { id } as User : null);
const familyAsset = () => asset({ id: 'family', user_id: 'user-2', remaining_balance: 13000 });

// All fixtures and clients are local; unexpected network access throws in beforeEach.
describe('automatic owner scope and explicit family administration', () => {
  it('loads family assets for consultation but only recalculates the authenticated owner', async () => {
    storedAssets = [asset({ remaining_balance: 13000 }), familyAsset()];
    payments.family = payments['asset-1'];
    const familyBefore = { ...storedAssets[1] };
    await useAppStore.getState().fetchAssets();
    expect(transactionReads).toEqual(['asset-1']);
    expect(updatedIds).toEqual(['asset-1']);
    expect(storedAssets[1]).toEqual(familyBefore);
    expect(useAppStore.getState().assets[1]).toEqual(familyBefore);
  });

  it('does not read payments or write when only a divergent financed family asset is loaded', async () => {
    storedAssets = [familyAsset()];
    await useAppStore.getState().fetchAssets();
    expect(transactionReads).toEqual([]);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(useAppStore.getState().assets[0]).toEqual(familyAsset());
  });

  it('preserves explicit family recalculation, including the explicit batch default', async () => {
    payments.family = payments['asset-1'];
    seed([familyAsset()]);
    await useAppStore.getState().recalculateAllAssetBalances();
    expect(transactionReads).toEqual(['family']);
    expect(updatedIds).toEqual(['family']);
    expect(storedAssets[0]).toMatchObject({ remaining_balance: 12000, paid_installments: 8 });
  });

  it('explicit updateAsset still updates and recalculates a financed family asset', async () => {
    payments.family = payments['asset-1'];
    seed([familyAsset()]);
    await useAppStore.getState().updateAsset({ id: 'family', name: 'Explicit family edit' });
    expect(updatedIds).toEqual(['family', 'family']);
    expect(storedAssets[0]).toMatchObject({ name: 'Explicit family edit', remaining_balance: 12000 });
  });

  it('a permitted linked transaction updates the family asset balance', async () => {
    payments.family = payments['asset-1'];
    seed([familyAsset()]);
    const originalFrom = mocks.from.getMockImplementation()!;
    const tx = { ID_Transacao: 'payment-9', user_id: 'user-1', linked_asset_id: 'family', Valor: -1000, Tipo: 'Despesa', Origem: 'manual' } as Transaction;
    mocks.from.mockImplementation(table => table === 'transactions' ? {
      ...originalFrom(table),
      insert: () => ({ select: async () => {
        payments.family = [...payments.family, { Valor: -1000, Tipo: 'Despesa' }];
        return { data: [tx], error: null };
      } }),
    } : originalFrom(table));
    await useAppStore.getState().addTransaction(tx);
    expect(updatedIds).toEqual(['family']);
    expect(storedAssets[0]).toMatchObject({ remaining_balance: 11000, paid_installments: 9 });
  });

  it('addAsset preserves the explicit initial financing recalculation', async () => {
    const originalFrom = mocks.from.getMockImplementation()!;
    mocks.from.mockImplementation(table => table === 'assets' ? {
      ...originalFrom(table),
      insert: () => ({ select: async () => {
        storedAssets = [asset({ remaining_balance: 13000 })];
        return { data: storedAssets, error: null };
      } }),
    } : originalFrom(table));
    await useAppStore.getState().addAsset(asset());
    expect(updatedIds).toEqual(['asset-1']);
    expect(storedAssets[0].remaining_balance).toBe(12000);
  });

  it('without an authenticated user no automatic or explicit recalculation starts', async () => {
    switchTo(null);
    seed([asset({ remaining_balance: 13000 })]);
    await useAppStore.getState().fetchAssets();
    await useAppStore.getState().recalculateAllAssetBalances();
    await useAppStore.getState().recalculateAssetBalance('asset-1');
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe('asset session races', () => {
  it.each(['user-2', null, 'relogin'] as const)('discards a late fetch after session transition %s', async next => {
    const read = deferred<{ data: Asset[]; error: null }>();
    mocks.from.mockReturnValue({ select: () => ({ order: () => read.promise }) });
    const pending = useAppStore.getState().fetchAssets();
    switchTo(next === 'relogin' ? null : next);
    if (next === 'relogin') switchTo('user-1');
    read.resolve({ data: [asset({ remaining_balance: 13000 })], error: null });
    await pending;
    expect(useAppStore.getState().assets).toEqual([]);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('discards the older fetch when two loads in the same session finish out of order', async () => {
    const read = deferred<{ data: Asset[]; error: null }>();
    const originalFrom = mocks.from.getMockImplementation()!;
    mocks.from.mockImplementationOnce(() => ({ select: () => ({ order: () => read.promise }) }));
    const old = useAppStore.getState().fetchAssets();
    mocks.from.mockImplementation(originalFrom);
    storedAssets = [asset()];
    await useAppStore.getState().fetchAssets();
    read.resolve({ data: [asset({ remaining_balance: 13000 })], error: null });
    await old;
    expect(useAppStore.getState().assets[0].remaining_balance).toBe(12000);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each(['user-2', null, 'relogin'] as const)('never writes from a late payment query after %s', async next => {
    seed([asset({ remaining_balance: 13000 })]);
    const read = deferred<{ data: Payment[]; error: null }>();
    mocks.from.mockReturnValue({ select: () => ({ eq: () => read.promise }) });
    const pending = useAppStore.getState().recalculateAssetBalance('asset-1');
    switchTo(next === 'relogin' ? null : next);
    if (next === 'relogin') switchTo('user-1');
    read.resolve({ data: payments['asset-1'], error: null });
    await pending;
    expect(mocks.update).not.toHaveBeenCalled();
    expect(useAppStore.getState().assets).toEqual([]);
  });

  it('stops an automatic batch instead of starting the next asset in the new session', async () => {
    const second = asset({ id: 'second', remaining_balance: 13000 });
    seed([asset({ remaining_balance: 13000 }), second]);
    const read = deferred<{ data: Payment[]; error: null }>();
    mocks.from.mockReturnValue({ select: () => ({ eq: () => read.promise }) });
    const pending = useAppStore.getState().recalculateAllAssetBalances('self');
    switchTo('user-2');
    read.resolve({ data: payments['asset-1'], error: null });
    await pending;
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not apply an UPDATE response to the next session', async () => {
    seed([asset({ remaining_balance: 13000 })]);
    const response = deferred<{ data: Asset[]; error: null }>();
    mocks.update.mockReturnValue({ eq: () => ({ select: () => response.promise }) });
    const pending = useAppStore.getState().recalculateAssetBalance('asset-1');
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    switchTo('user-2');
    seed([asset({ user_id: 'user-2', name: 'New session asset' })]);
    response.resolve({ data: [asset({ name: 'Old session response' })], error: null });
    await pending;
    expect(useAppStore.getState().assets[0].name).toBe('New session asset');
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('a late explicit update response cannot launch a recalculation in the next session', async () => {
    seed([familyAsset()]);
    const response = deferred<{ data: Asset[]; error: null }>();
    mocks.update.mockReturnValue({ eq: () => ({ select: () => response.promise }) });
    const pending = useAppStore.getState().updateAsset({ id: 'family', name: 'Edit' });
    switchTo('user-2');
    seed([familyAsset()]);
    response.resolve({ data: [familyAsset()], error: null });
    await pending;
    expect(transactionReads).toEqual([]);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('does not insert an asset after a late auth response from a previous session', async () => {
    const response = deferred<{ data: { user: User }; error: null }>();
    mocks.getUser.mockReturnValue(response.promise);
    const pending = useAppStore.getState().addAsset(asset());
    switchTo('user-2');
    response.resolve({ data: { user: { id: 'user-1' } as User }, error: null });
    await pending;
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('a late linked transaction result cannot launch family asset writes in the next session', async () => {
    const tx = { ID_Transacao: 'late', linked_asset_id: 'family', Origem: 'manual' } as Transaction;
    const response = deferred<{ data: Transaction[]; error: null }>();
    mocks.from.mockReturnValue({ insert: () => ({ select: () => response.promise }) });
    const pending = useAppStore.getState().addTransaction(tx);
    await vi.waitFor(() => expect(mocks.from).toHaveBeenCalledTimes(1));
    switchTo('user-2');
    seed([familyAsset()]);
    response.resolve({ data: [tx], error: null });
    await pending;
    expect(transactionReads).toEqual([]);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
