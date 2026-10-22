import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPEN_FINANCE_PAUSED_RESPONSE } from '../../server/open-finance-paused.js';

const persistence = vi.hoisted(() => ({ from: vi.fn(), getState: vi.fn() }));
vi.mock('../../src/supabaseClient', () => ({ supabase: { from: persistence.from } }));
vi.mock('../../src/hooks/useAppStore', () => ({ useAppStore: { getState: persistence.getState } }));
import { getBelvoWidgetToken, getPluggyConnectToken, fetchTransactionsForReview } from '../../src/services/openFinanceService';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('unchanged installed/PWA client consumes the paused server response', () => {
  const cases = [
    ['Belvo token', () => getBelvoWidgetToken(), '/api/belvo-token'],
    ['legacy Pluggy token alias', () => getPluggyConnectToken('old-item'), '/api/belvo-token'],
    ['existing connection sync', () => fetchTransactionsForReview('historical-link', '2026-10-01', '2026-10-17'), '/api/belvo-sync'],
  ] as const;
  for (const [name, action, endpoint] of cases) {
    it(name + ' displays the public error and never reaches persistence or financial data', async () => {
      const network = vi.fn(async () => new Response(JSON.stringify(OPEN_FINANCE_PAUSED_RESPONSE), {
        status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }));
      vi.stubGlobal('fetch', network);
      await expect(action()).rejects.toThrow('Open Finance está pausado no momento.');
      expect(network).toHaveBeenCalledTimes(1);
      expect(network.mock.calls[0][0]).toBe(endpoint);
      expect(persistence.from).not.toHaveBeenCalled();
      expect(persistence.getState).not.toHaveBeenCalled();
    });
  }
});
