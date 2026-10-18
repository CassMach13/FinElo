import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import paused, { OPEN_FINANCE_PATHS, OPEN_FINANCE_PAUSED_RESPONSE } from '../../server/open-finance-paused.js';

const routeNames = ['pluggy-token', 'pluggy-sync', 'belvo-token', 'belvo-consent', 'belvo-sync'];
const blockedSdk = vi.hoisted(() => ({ imports: 0, constructions: 0 }));
vi.mock('pluggy-sdk', () => {
  blockedSdk.imports++;
  return { PluggyClient: class { constructor() { blockedSdk.constructions++; throw new Error('Provider forbidden'); } } };
});
const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const response = () => ({
  statusCode: 0,
  headers: {} as Record<string, string>,
  body: '',
  setHeader(name: string, value: string) { this.headers[name] = value; },
  end(body: string) { this.body = body; },
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Open Finance pause at the server boundary', () => {
  for (const name of routeNames) {
    for (const identity of ['anonymous', 'invalid JWT', 'authenticated']) {
      it(name + ': 503 for ' + identity + ' before reading auth or body', async () => {
        const network = vi.fn(() => { throw new Error('No provider network allowed'); });
        vi.stubGlobal('fetch', network);
        const request = new Proxy({}, {
          get() { throw new Error('Paused routes must not read auth, method, body or connections'); },
        });
        const { default: handler } = await import('../../api/' + name + '.js');
        expect(handler).toBe(paused);
        const res = response();
        await handler(request, res);
        expect(res.statusCode).toBe(503);
        expect(JSON.parse(res.body)).toEqual(OPEN_FINANCE_PAUSED_RESPONSE);
        expect(res.headers['Cache-Control']).toBe('no-store');
        expect(network).not.toHaveBeenCalled();
        expect(blockedSdk).toEqual({ imports: 0, constructions: 0 });
      });
    }
  }

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])(
    'never reactivates via method %s or a feature/plan override', method => {
      const res = response();
      paused({ method, body: { enabled: true, isRetail: true, linkId: 'mock-belvo-qa' },
        headers: { authorization: 'Bearer invalid', 'x-feature-enabled': 'true' } }, res);
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body).code).toBe('OPEN_FINANCE_PAUSED');
    },
  );

  it('contains only a public stable code and a legacy-compatible error string', () => {
    const res = response();
    paused(null, res);
    expect(Object.keys(JSON.parse(res.body)).sort()).toEqual(['code', 'error']);
    expect(JSON.parse(res.body).error).toBe('Open Finance está pausado no momento.');
    expect(res.headers['Access-Control-Allow-Headers']).toContain('Authorization');
    expect(res.body).not.toMatch(/stack|secret|password|credential|transactions|accounts|accessToken|user_id/i);
  });

  it('the public entrypoints import only the inert pause handler, never the archive', () => {
    for (const name of routeNames) {
      expect(read('api/' + name + '.js').replace(/^\/\/.*\r?\n/, '').trim())
        .toBe("export { default } from '../server/open-finance-paused.js';");
    }
    const handler = read('server/open-finance-paused.js').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(handler).not.toMatch(/\bimport\b|process\.env|fetch\(|supabase|PluggyClient|req\./);
    expect(OPEN_FINANCE_PATHS).toEqual(routeNames.map(name => '/api/' + name));
  });

  it('preserves canonical source of all five implementations, outside executable routes', () => {
    const folder = 'docs/archive/open-finance-paused/';
    const manifest = JSON.parse(read(folder + 'source-manifest.json'));
    for (const name of routeNames) {
      const bytes = readFileSync(resolve(process.cwd(), folder + name + '.js.disabled'));
      expect(createHash('sha256').update(bytes.toString('utf8').replaceAll('\r\n', '\n')).digest('hex')).toBe(manifest.files['api/' + name + '.js']);
    }
    expect(readdirSync(resolve(process.cwd(), folder)).filter(name => /\.(js|ts)$/.test(name))).toEqual([]);
  });

  it('the Vite server blocks the same five routes and no longer has a provider proxy', () => {
    const config = read('vite.config.ts');
    expect(config).toContain("name: 'open-finance-paused'");
    expect(config).toContain('OPEN_FINANCE_PATHS.includes(pathname)');
    expect(config).toContain('openFinancePaused(req, res)');
    expect(config).toContain('cors: { preflightContinue: true }');
    expect(config).toContain("loadEnv(mode, process.cwd(), 'GEMINI_API_KEY')");
    expect(config).toContain('res.statusCode = 204;');
    expect(config).not.toMatch(/api\.pluggy\.ai|sandbox\.belvo\.com|PLUGGY_CLIENT|BELVO_SECRET|fetch\(/);
    // Existing worker caches fonts only; it cannot cache a successful Open Finance POST.
    expect(config).toContain("urlPattern: /^https:\\/\\/fonts\\.googleapis");
    expect(config).not.toContain("cacheName: 'open-finance");
  });
});
