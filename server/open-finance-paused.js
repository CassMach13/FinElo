/**
 * Product decision: Belvo/Pluggy are paused because of cost.
 * Intentionally unconditional: do not import SDKs, auth, data clients or archives.
 * Resumption requires a separately reviewed server change, not a feature flag.
 */
export const OPEN_FINANCE_PATHS = Object.freeze([
  '/api/pluggy-token',
  '/api/pluggy-sync',
  '/api/belvo-token',
  '/api/belvo-consent',
  '/api/belvo-sync',
]);

export const OPEN_FINANCE_PAUSED_RESPONSE = Object.freeze({
  code: 'OPEN_FINANCE_PAUSED',
  error: 'Open Finance está pausado no momento.',
});

export default function openFinancePaused(_req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.statusCode = 503;
  res.end(JSON.stringify(OPEN_FINANCE_PAUSED_RESPONSE));
}
