import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const proposal = readFileSync('scripts/diagnostics/pwa-r2/activation-gate-proposal.js', 'utf8');
const { swTemplate } = require('workbox-build/build/templates/sw-template.js');
// Exercise the actual installed generator's legacy handler, not a reimplementation.
const generated = swTemplate.match(/self.addEventListener\('message',[\s\S]*?\n\}\);/)?.[0];
if (!generated) throw Error('Review the installed Workbox generator before using this diagnostic');

function runtime(withGate: boolean, clients = [{id: 'a', type: 'window', url: 'https://qa.invalid/app'}]) {
  const listeners: Array<(event: any) => void> = [];
  const replies: any[] = [];
  let activations = 0;
  let unavailable = false;
  const self = {
    registration: {scope: 'https://qa.invalid/'},
    clients: {
      get: async (id: string) => clients.find(client => client.id === id),
      matchAll: async (options: any) => {
        expect(options).toEqual({type: 'all', includeUncontrolled: true});
        if (unavailable) throw Error('inventory unavailable');
        return clients;
      },
    },
    skipWaiting: () => { activations++; },
    addEventListener: (_name: string, handler: (event: any) => void) => listeners.push(handler),
  };
  const context = vm.createContext({self, URL});
  if (withGate) vm.runInContext(proposal, context);
  vm.runInContext(generated, context);
  return {
    activations: () => activations,
    failInventory: () => { unavailable = true; },
    async send(data: any, source = 'a', withPort = true) {
      let stopped = false;
      const pending: Promise<void>[] = [];
      const event = {data, source: {id: source},
        ports: withPort ? [{postMessage: (message: any) => replies.push(message)}] : [],
        stopImmediatePropagation: () => { stopped = true; },
        waitUntil: (promise: Promise<void>) => pending.push(promise)};
      for (const listener of listeners) { listener(event); if (stopped) break; }
      await Promise.all(pending);
      return JSON.parse(JSON.stringify(replies));
    },
  };
}

const inventory = {namespace: 'FINELO_PWA_R2', protocol: 1, requestId: 'fresh-request', type: 'INVENTORY'};

describe('R2 architectural boundary — proposal only, not product acceptance', () => {
  it('reproduces the installed Workbox handler accepting an uncoordinated legacy message', async () => {
    const worker = runtime(false);
    await worker.send({type: 'SKIP_WAITING'}, 'a', false);
    expect(worker.activations()).toBe(1);
  });
  it('contains legacy activation only when the proposed gate precedes that handler', async () => {
    const worker = runtime(true);
    expect(await worker.send({type: 'SKIP_WAITING'})).toMatchObject([{status: 'BLOCKED', reason: 'LEGACY_ACTIVATION_DISABLED'}]);
    expect(worker.activations()).toBe(0);
  });
  it('does not depend on a legacy caller providing a reply port', async () => {
    const worker = runtime(true);
    await worker.send({type: 'SKIP_WAITING'}, 'a', false);
    expect(worker.activations()).toBe(0);
  });
  it('enumerates silent and uncontrolled clients as UNKNOWN, never CLEAN', async () => {
    const worker = runtime(true, [{id: 'a', type: 'window', url: 'https://qa.invalid/app'},
      {id: 'silent', type: 'window', url: 'https://qa.invalid/app'},
      {id: 'background', type: 'worker', url: 'https://qa.invalid/job.js'}]);
    const [reply] = await worker.send(inventory);
    expect(reply.status).toBe('INVENTORY_ONLY');
    expect(reply.clients.map((client: any) => client.readiness)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(JSON.stringify(reply)).not.toContain('https:');
    expect(worker.activations()).toBe(0);
  });
  it('refuses a caller not present in the real client inventory', async () => {
    expect(await runtime(true).send(inventory, 'invented')).toMatchObject([{reason: 'INVALID_CLIENT'}]);
  });
  it('does not infer safety from an inventory failure', async () => {
    const worker = runtime(true); worker.failInventory();
    expect(await worker.send(inventory)).toMatchObject([{status: 'BLOCKED', reason: 'INVENTORY_FAILED'}]);
    expect(worker.activations()).toBe(0);
  });
  it.each(['ACTIVATE', 'COMMIT', 'PREPARE'])('refuses %s because the full protocol is not installed', async type => {
    const worker = runtime(true);
    expect(await worker.send({...inventory, type})).toMatchObject([{reason: 'COORDINATION_NOT_INSTALLED'}]);
    expect(worker.activations()).toBe(0);
  });
  it.each([{...inventory, protocol: 0}, {...inventory, requestId: ''}, {...inventory, requestId: 'x'.repeat(129)}])('rejects malformed protocol messages', async data => {
    const worker = runtime(true);
    expect(await worker.send(data)).toEqual([]);
    expect(worker.activations()).toBe(0);
  });
});
