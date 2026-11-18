import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APPROVED_MULTI_ACCOUNT_SESSIONS, beforeApprovedMultiAccountSessions } from './approvedMultiAccountSessions';
import { APPROVED_SESSION_ISOLATION } from './approvedSessionIsolation';
import { sha256Lf } from '../transactions/approvedManualSave';
import SEALED_BASE_JSON from './multi-account-sessions-sealed-base.json';

const SEALED_BASE = SEALED_BASE_JSON as { base: string; files: Record<string, string> };

/** Conjunto selado: todo caminho `src/...` citado nos baselines de aparência (mesma fonte dos selos). */
function sealedPaths(): string[] {
  const sealed = new Set<string>();
  for (const f of readdirSync('tests/appearance')) {
    if (!f.endsWith('.json')) continue;
    for (const m of readFileSync(`tests/appearance/${f}`, 'utf8').matchAll(/"(src\/[^"]+)"/g)) sealed.add(m[1]);
  }
  return [...sealed].sort();
}

const baseCommitAvailable = (() => {
  try {
    execFileSync('git', ['cat-file', '-e', `${SEALED_BASE.base}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

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

  /*
   * "Nenhum outro arquivo selado mudou" SEM depender de git: o manifesto `multi-account-sessions-sealed-base.json`
   * fixa o hash (sha256 LF) de CADA arquivo selado no commit base da Etapa 2. O contrato vale igual em checkout raso
   * ou completo, depois do merge na main e em worktrees. Ausência de arquivo, de entrada ou de casamento reprova;
   * nada é aprovado por falta de referência.
   */
  it('o manifesto da base cobre exatamente o conjunto selado (nenhum arquivo selado fica de fora)', () => {
    expect(Object.keys(SEALED_BASE.files).sort()).toEqual(sealedPaths());
    for (const hash of Object.values(SEALED_BASE.files)) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('nenhum outro arquivo selado mudou nesta etapa: revertida a exceção, todo arquivo selado é o da base', () => {
    const mismatched: string[] = [];
    const touchedByException: string[] = [];
    for (const path of sealedPaths()) {
      const current = readFileSync(path, 'utf8');
      const before = beforeApprovedMultiAccountSessions(path, current);
      if (before !== current) touchedByException.push(path);
      if (sha256Lf(before) !== SEALED_BASE.files[path]) mismatched.push(path);
    }
    expect(mismatched).toEqual([]);
    expect(touchedByException.sort()).toEqual(Object.keys(APPROVED_MULTI_ACCOUNT_SESSIONS).sort());
  });

  it('a base do manifesto é a da exceção: o "antes" aprovado de cada arquivo é o hash dele na base', () => {
    for (const [path, entry] of Object.entries(APPROVED_MULTI_ACCOUNT_SESSIONS)) expect(SEALED_BASE.files[path]).toBe(entry.before);
  });

  it.skipIf(!baseCommitAvailable)('o manifesto confere com o commit base no git (só quando o objeto existe localmente)', () => {
    const paths = sealedPaths();
    // Um único processo git: "<sha> blob <tamanho>\n<conteúdo>\n" por caminho, na ordem pedida.
    const out = execFileSync('git', ['cat-file', '--batch'], { input: paths.map((p) => `${SEALED_BASE.base}:${p}`).join('\n') + '\n', maxBuffer: 256 * 1024 * 1024 });
    let offset = 0;
    for (const path of paths) {
      const headerEnd = out.indexOf(0x0a, offset);
      const header = out.subarray(offset, headerEnd).toString('utf8');
      const size = Number(/^[0-9a-f]+ blob (\d+)$/.exec(header)?.[1]);
      expect(Number.isFinite(size), `${path}: ${header}`).toBe(true);
      const text = out.subarray(headerEnd + 1, headerEnd + 1 + size).toString('utf8');
      offset = headerEnd + 1 + size + 1;
      expect(sha256Lf(text), path).toBe(SEALED_BASE.files[path]);
    }
  });
});
