import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APPROVED_SESSION_ISOLATION, beforeApprovedSessionIsolation } from './approvedSessionIsolation';
import { APPROVED_MANUAL_SAVE, sha256Lf } from '../transactions/approvedManualSave';

describe('exceção exata: alternância de contas — Etapa 1 (isolamento de sessões)', () => {
  it.each(Object.entries(APPROVED_SESSION_ISOLATION))('%s: o arquivo atual é exatamente o aprovado e o patch o reverte ao anterior', (path, entry) => {
    const current = readFileSync(path, 'utf8');
    expect(sha256Lf(current)).toBe(entry.approved);
    expect(sha256Lf(beforeApprovedSessionIsolation(path, current))).toBe(entry.before);
  });

  it('o "antes" do store é exatamente o "aprovado" da exceção anterior (gravação manual): a cadeia não tem lacuna', () => {
    expect(APPROVED_SESSION_ISOLATION['src/hooks/useAppStore.ts'].before).toBe(APPROVED_MANUAL_SAVE['src/hooks/useAppStore.ts'].approved);
  });

  it('qualquer edição adicional deixa de casar com a exceção (o selo volta a valer sobre o arquivo real)', () => {
    for (const path of Object.keys(APPROVED_SESSION_ISOLATION)) {
      const edited = readFileSync(path, 'utf8') + '\n// edição não revisada\n';
      expect(beforeApprovedSessionIsolation(path, edited)).toBe(edited);
    }
  });

  it('arquivos fora da exceção passam intactos', () => {
    expect(beforeApprovedSessionIsolation('src/utils/dateOnly.ts', 'x')).toBe('x');
  });

  it('o patch aprovado só toca os quatro arquivos da exceção', () => {
    const patch = readFileSync('tests/security/approved-session-isolation.patch', 'utf8').replaceAll('\r\n', '\n');
    const touched = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]).sort();
    expect(touched).toEqual(Object.keys(APPROVED_SESSION_ISOLATION).sort());
  });
});
