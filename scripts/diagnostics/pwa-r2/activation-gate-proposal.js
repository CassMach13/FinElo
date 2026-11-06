/* PROPOSAL ONLY: not imported by the application or its generated worker.
 * Necessary containment/inventory boundary, NOT a complete update protocol.
 * No request is allowed to activate until a reviewed coordinator exists.
 * Import BEFORE the Workbox-generated SKIP_WAITING listener.
 */
(() => {
  const namespace = 'FINELO_PWA_R2';
  const inScope = client => {
    try {
      const scope = new URL(self.registration.scope);
      const url = new URL(client.url);
      return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
    } catch { return false; }
  };
  self.addEventListener('message', event => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'SKIP_WAITING') {
      // A second listener cannot veto a skipWaiting() that has already run.
      event.stopImmediatePropagation();
      event.ports?.[0]?.postMessage({namespace, status: 'BLOCKED', reason: 'LEGACY_ACTIVATION_DISABLED'});
      return;
    }
    if (data.namespace !== namespace) return;
    event.stopImmediatePropagation();
    if (data.protocol !== 1 || typeof data.requestId !== 'string' ||
        !data.requestId || data.requestId.length > 128 || !event.ports?.[0]) return;
    const reply = value => event.ports[0].postMessage({namespace, protocol: 1, requestId: data.requestId, ...value});
    event.waitUntil((async () => {
      try {
        const source = event.source?.id ? await self.clients.get(event.source.id) : null;
        if (!source || source.type !== 'window' || !inScope(source)) {
          reply({status: 'BLOCKED', reason: 'INVALID_CLIENT'});
          return;
        }
        if (data.type !== 'INVENTORY') {
          reply({status: 'BLOCKED', reason: 'COORDINATION_NOT_INSTALLED'});
          return;
        }
        const clients = await self.clients.matchAll({type: 'all', includeUncontrolled: true});
        // IDs are ephemeral browser client IDs. Never send account, URL,
        // credentials, form values or financial data between clients.
        reply({status: 'INVENTORY_ONLY', clients: clients.filter(inScope)
          .map(client => ({id: client.id, type: client.type, readiness: 'unknown'}))});
      } catch {
        reply({status: 'BLOCKED', reason: 'INVENTORY_FAILED'});
      }
    })());
  });
})();
