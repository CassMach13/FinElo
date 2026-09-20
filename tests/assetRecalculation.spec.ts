import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset } from '../src/types';

const mocks = vi.hoisted(() => ({ from: vi.fn(), update: vi.fn() }));
vi.mock('../src/supabaseClient', () => ({ supabase: { from: mocks.from } }));

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
