import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { reverseSessionPatch } from '../appearance/reverseSessionPatch';

export const sha256Lf = (text: string) => createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');

// Aprovação específica da PR #102, comentário 7045356112, no commit 93ba1f1fe610ab2ed59f68d877b689acdff5cac9.
const directory = new URL('../../docs/diagnostics/etapa3-proposta-selos/v2/', import.meta.url);
export const integrationPatch = readFileSync(new URL('etapa3-integracao-selada.patch', directory), 'utf8').replaceAll('\r\n', '\n');
const manifest = readFileSync(new URL('sha256-lf.json', directory), 'utf8');
if (sha256Lf(integrationPatch) !== '10ebb2c4f322c8ac46670fdb8a19004b750b41de349f7bacbf305486d5063a01' ||
    sha256Lf(manifest) !== '6c2f8520f756b9434e2095f3c29b447b59ff6e692013a6a2b4f9cd4b5d5b3389') {
  throw new Error('Artefatos da exceção da Etapa 3 divergem da aprovação.');
}
export const APPROVED_DEVICE_ACCOUNT_INTEGRATION: Record<string, { before: string; proposed: string }> = JSON.parse(manifest).files;

export function beforeApprovedDeviceAccountIntegration(path: string, source: string): string {
  const entry = APPROVED_DEVICE_ACCOUNT_INTEGRATION[path];
  if (!entry || sha256Lf(source) !== entry.proposed) return source;
  const before = reverseSessionPatch(source, integrationPatch, path);
  if (sha256Lf(before) !== entry.before) throw new Error('Reversão divergente na Etapa 3: ' + path);
  return before;
}
