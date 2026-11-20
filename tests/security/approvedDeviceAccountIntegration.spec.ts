import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APPROVED_DEVICE_ACCOUNT_INTEGRATION, beforeApprovedDeviceAccountIntegration, integrationPatch, sha256Lf } from './approvedDeviceAccountIntegration';
import { APPROVED_MULTI_ACCOUNT_SESSIONS } from './approvedMultiAccountSessions';
import sealedBase from './multi-account-sessions-sealed-base.json';

describe('exceção aprovada da Etapa 3', () => {
  it('restringe o patch aos três caminhos aprovados', () => {
    const paths = ['src/App.tsx', 'src/components/views/AuthView.tsx', 'src/components/views/UserAccountWidget.tsx'];
    expect(Object.keys(APPROVED_DEVICE_ACCOUNT_INTEGRATION).sort()).toEqual(paths);
    expect([...integrationPatch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map(match => match[1]).sort()).toEqual(paths);
  });

  it.each(Object.entries(APPROVED_DEVICE_ACCOUNT_INTEGRATION))('%s corresponde à aprovação e reverte ao hash anterior', (path, entry) => {
    const source = readFileSync(path, 'utf8');
    expect(sha256Lf(source)).toBe(entry.proposed);
    expect(sha256Lf(beforeApprovedDeviceAccountIntegration(path, source))).toBe(entry.before);

    const previousSeal = APPROVED_MULTI_ACCOUNT_SESSIONS[path]?.approved ?? (sealedBase.files as Record<string, string>)[path];
    // Fora dos selos anteriores, o hash de origem é fixado pelo manifesto aprovado.
    if (previousSeal) expect(entry.before).toBe(previousSeal);

    const edited = source + '\n// edição não aprovada\n';
    expect(beforeApprovedDeviceAccountIntegration(path, edited)).toBe(edited);
  });
});
