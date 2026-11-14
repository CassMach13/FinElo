import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APPROVED_MULTI_ACCOUNT_SESSIONS, beforeApprovedMultiAccountSessions } from './approvedMultiAccountSessions';
import { APPROVED_SESSION_ISOLATION } from './approvedSessionIsolation';
import { sha256Lf } from '../transactions/approvedManualSave';

describe('exceção exata: alternância de contas — Etapa 2 (múltiplas sessões)', () => {
  it.each(Object.entries(APPROVED_MULTI_ACCOUNT_SESSIONS))('%s: o arquivo atual é exatamente o submetido e o patch o reverte ao anterior', (path, entry) => {
    const current = readFileSync(path, 'utf8');
    expect(sha256Lf(current)).toBe(entry.approved);
    expect(sha256Lf(beforeApprovedMultiAccountSessions(path, current))).toBe(entry.before);
  });

  it('o "antes" de cada arquivo é exatamente o "aprovado" da Etapa 1 (revisão 2): a cadeia não tem lacuna', () => {
    for (const [path, entry] of Object.entries(APPROVED_MULTI_ACCOUNT_SESSIONS)) {
      expect(entry.before).toBe(APPROVED_SESSION_ISOLATION[path].approved);
    }
  });

  it('qualquer edição adicional deixa de casar com a exceção (o selo volta a valer sobre o arquivo real)', () => {
    for (const path of Object.keys(APPROVED_MULTI_ACCOUNT_SESSIONS)) {
      const edited = readFileSync(path, 'utf8') + '\n// edição não revisada\n';
      expect(beforeApprovedMultiAccountSessions(path, edited)).toBe(edited);
    }
  });

  it('arquivos fora da exceção passam intactos', () => {
    expect(beforeApprovedMultiAccountSessions('src/utils/dateOnly.ts', 'x')).toBe('x');
  });

  it('o patch só toca os três arquivos da exceção', () => {
    const patch = readFileSync('tests/security/approved-multi-account-sessions.patch', 'utf8').replaceAll('\r\n', '\n');
    const touched = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]).sort();
    expect(touched).toEqual(Object.keys(APPROVED_MULTI_ACCOUNT_SESSIONS).sort());
  });

  it('nenhum outro arquivo selado mudou nesta etapa', async () => {
    const { execFileSync } = await import('node:child_process');
    const fs = await import('node:fs');
    const sealed = new Set<string>();
    for (const f of fs.readdirSync('tests/appearance')) {
      if (!f.endsWith('.json')) continue;
      for (const m of fs.readFileSync(`tests/appearance/${f}`, 'utf8').matchAll(/"(src\/[^"]+)"/g)) sealed.add(m[1]);
    }
    let base = 'origin/main';
    try {
      execFileSync('git', ['rev-parse', '--verify', base], { stdio: 'ignore' });
    } catch {
      base = 'HEAD';
    }
    const changed = execFileSync('git', ['diff', '--name-only', base, '--', 'src'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
    expect(changed.filter((p) => sealed.has(p)).sort()).toEqual(Object.keys(APPROVED_MULTI_ACCOUNT_SESSIONS).sort());
  });
});
