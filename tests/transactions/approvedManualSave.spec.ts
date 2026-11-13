import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APPROVED_MANUAL_SAVE, beforeApprovedManualSave, sha256Lf } from './approvedManualSave';

describe('exceção exata: confirmação de gravação de lançamentos manuais', () => {
  it.each(Object.entries(APPROVED_MANUAL_SAVE))('%s: o arquivo atual é exatamente o aprovado e o patch o reverte ao original', (path, entry) => {
    const current = readFileSync(path, 'utf8');
    expect(sha256Lf(current)).toBe(entry.approved);
    expect(sha256Lf(beforeApprovedManualSave(path, current))).toBe(entry.before);
  });

  it('qualquer edição adicional deixa de casar com a exceção (o selo volta a valer sobre o arquivo real)', () => {
    for (const path of Object.keys(APPROVED_MANUAL_SAVE)) {
      const edited = readFileSync(path, 'utf8') + '\n// edição não revisada\n';
      expect(beforeApprovedManualSave(path, edited)).toBe(edited);
    }
  });

  it('arquivos fora da exceção passam intactos', () => {
    expect(beforeApprovedManualSave('src/utils/dateOnly.ts', 'x')).toBe('x');
  });
});
