/**
 * Local-only HTTP/Auth evidence. Never contacts Belvo, Pluggy or a remote database.
 * Usage: node scripts/qa/open-finance-pause-http.mjs
 * Optional existing local Auth vault: --auth-dir <protected directory>
 * Without a local Auth vault, the real-auth gate is BLOCKED, never fabricated.
 */
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { registerHooks } from 'node:module';

const names = ['pluggy-token', 'pluggy-sync', 'belvo-token', 'belvo-consent', 'belvo-sync'];
const expected = { code: 'OPEN_FINANCE_PAUSED', error: 'Open Finance está pausado no momento.' };
const counters = { providerSdkImports: 0, providerCredentialReads: 0, outboundFetch: 0, requests: 0 };
const originalFetch = globalThis.fetch;
const useVite = process.argv.includes('--vite');
const makeVite = useVite ? (await import('vite')).createServer : null;
let client, jwt, auth = 'BLOCKED: no local Auth vault specified';
const authFlag = process.argv.indexOf('--auth-dir');
if (authFlag !== -1) {
  const folder = resolve(process.argv[authFlag + 1]);
  const runtime = JSON.parse(readFileSync(join(folder, 'runtime.json'), 'utf8'));
  const url = new URL(runtime.supabase_url);
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Auth must be loopback-only');
  assert(url.protocol === 'http:', 'Expected isolated local QA, never remote');
  const users = JSON.parse(readFileSync(join(folder, 'users.json'), 'utf8'));
  const { createClient } = await import('@supabase/supabase-js');
  client = createClient(url.href, runtime.supabase_anon_key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (target, options) => {
      assert.equal(new URL(typeof target === 'string' ? target : target.url || target.href).origin, url.origin);
      return originalFetch(target, options);
    } },
  });
  const { data, error } = await client.auth.signInWithPassword(users.wealth_monthly);
  assert.ifError(error);
  jwt = data.session.access_token;
  const verified = await client.auth.getUser(jwt);
  assert.ifError(verified.error);
  assert.equal(verified.data.user.id, data.user.id);
  auth = 'PASS: normal local Supabase Auth login and getUser validation; no financial query';
}

// Trap dependencies at module resolution, including unexpected future auth/data clients.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (['pluggy-sdk', 'belvo', 'belvo-sdk', '@supabase/supabase-js', 'stripe'].includes(specifier)) {
      counters.providerSdkImports++;
      throw new Error('Paused route attempted SDK/data client import');
    }
    return next(specifier, context);
  },
});
const originalEnv = process.env;
// Synthetic in-memory sentinels only; no credential/configuration file is modified.
const sentinels = ['PLUGGY_CLIENT_ID', 'PLUGGY_CLIENT_SECRET', 'BELVO_SECRET_ID', 'BELVO_SECRET_PASSWORD', 'BELVO_ENV', 'BELCO_SECRET_ID', 'BELCO_SECRET_PASSWORD'];
if (!useVite) sentinels.push('VITE_PLUGGY_CLIENT_ID', 'VITE_PLUGGY_CLIENT_SECRET');
const isolatedEnv = { ...originalEnv, ...Object.fromEntries(sentinels.map(key => [key, 'SYNTHETIC_NOT_A_CREDENTIAL'])) };
let requestPhase = !useVite;
process.env = new Proxy(isolatedEnv, {
  get(target, key) {
    if (requestPhase && /^(VITE_)?(PLUGGY|BELVO|BELCO)_/.test(String(key))) {
      counters.providerCredentialReads++;
      throw new Error('Paused route read provider credentials');
    }
    return Reflect.get(target, key);
  },
});
globalThis.fetch = () => {
  counters.outboundFetch++;
  throw new Error('Provider network is forbidden');
};
const handlers = new Map();
let server, viteServer;
try {
  for (const name of names) handlers.set('/api/' + name, (await import('../../api/' + name + '.js')).default);
  if (useVite) {
    viteServer = await makeVite({ mode: 'qa', server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { noDiscovery: true, include: [] } });
    await viteServer.listen();
    server = viteServer.httpServer;
  } else {
  server = createServer((req, res) => {
    const handler = handlers.get((req.url || '').split('?')[0].replace(/\/+$/, ''));
    if (!handler) { res.writeHead(404).end(); return; }
    // Detect body/identity inspection before responding.
    const opaque = new Proxy(req, { get() { throw new Error('Pause inspected the incoming request'); } });
    handler(opaque, res);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  }
  requestPhase = true;
  const port = server.address().port;
  const identities = [
    { name: 'anonymous', headers: {} },
    { name: 'invalid-jwt', headers: { Authorization: 'Bearer invalid.qa.jwt' } },
    ...(jwt ? [{ name: 'authenticated-local-qa', headers: { Authorization: 'Bearer ' + jwt } }] : []),
  ];
  const invoke = (name, identity, method, body = '{}') => new Promise((done, reject) => {
    const req = request({
      hostname: '127.0.0.1', port, agent: false, path: '/api/' + name + '?enabled=true', method,
      headers: { ...identity.headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          assert.equal(res.statusCode, 503);
          assert.equal(res.headers['cache-control'], 'no-store');
          assert.match(res.headers['content-type'], /^application\/json/);
          if (method !== 'HEAD') assert.deepEqual(JSON.parse(raw), expected);
          counters.requests++;
          done();
        } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Local HTTP timeout')));
    req.end(body);
  });
  // Concurrent real HTTP requests; no mock of the response or handler.
  await Promise.all(names.flatMap(name => identities.flatMap(identity =>
    ['POST', 'GET', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map(method => invoke(name, identity, method)))));
  for (const name of names) for (const identity of identities) {
    await invoke(name, identity, 'POST', '{"malformed":');
  }
  if (useVite) {
    await new Promise((done, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path: '/api/unrelated-route', method: 'OPTIONS', agent: false }, res => {
        try { assert.equal(res.statusCode, 204); res.resume(); res.on('end', done); } catch (e) { reject(e); }
      });
      req.on('error', reject); req.end();
    });
  }
  assert.equal(counters.providerSdkImports, 0);
  assert.equal(counters.providerCredentialReads, 0);
  assert.equal(counters.outboundFetch, 0);
  const evidence = {
    scope: 'isolated local HTTP and existing synthetic Auth only',
    entrypoint: useVite ? 'actual Vite dev middleware' : 'actual API module exports',
    auth, routes: names, identities: identities.map(x => x.name),
    methods: ['POST', 'GET', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
    unrelatedPreflightPreserved: useVite ? true : 'not applicable',
    syntheticCredentialSentinelsPresent: sentinels.length,
    credentialReadScope: useVite ? 'HTTP invocation; toolchain process-env copying excluded' : 'API module load and HTTP invocation',
    concurrent: true, malformedBodiesBlocked: true, ...counters,
    result: jwt ? 'PASS' : 'BLOCKED_REAL_AUTH',
  };
  mkdirSync('.local-qa', { recursive: true });
  writeFileSync(useVite ? '.local-qa/vite-http-evidence.json' : '.local-qa/http-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
  hooks.deregister();
  if (viteServer) await viteServer.close();
  else if (server) await new Promise(done => server.close(done));
  if (client) await client.auth.signOut();
}
