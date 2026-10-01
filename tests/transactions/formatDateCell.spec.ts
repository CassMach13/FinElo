import { describe, expect, it } from 'vitest';
import { formatDateCell } from '../../src/utils/formatDateCell';

describe('formatDateCell — célula de data da tabela de Transações', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string vazia', ''],
  ])('ausente (%s) aparece como "-"', (_nome, valor) => {
    expect(formatDateCell(valor as null | undefined | string)).toBe('-');
  });

  it('ausência nunca vira a época Unix (01/01/1970)', () => {
    for (const ausente of [null, undefined, '']) {
      expect(formatDateCell(ausente as null)).not.toContain('1970');
    }
  });

  it('data inválida também é "-", não "Invalid Date"', () => {
    expect(formatDateCell('não é data')).toBe('-');
    expect(formatDateCell(new Date('x'))).toBe('-');
  });

  it('data válida segue em pt-BR, no dia civil em UTC, como antes', () => {
    expect(formatDateCell(new Date('2026-09-10T00:00:00.000Z'))).toBe('10/09/2026');
    expect(formatDateCell('2026-09-10T00:00:00+00:00')).toBe('10/09/2026');
    expect(formatDateCell('2026-08-28T03:00:00.000Z')).toBe('28/08/2026');
  });
});

describe('ligação na tabela', () => {
  it('a célula de data usa o helper, não new Date(value) direto', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/views/TransactionsView.tsx', 'utf8');
    expect(src).toContain("if (type === 'date') return formatDateCell(");
    expect(src).not.toContain("new Date(value as Date).toLocaleDateString('pt-BR'");
  });
});
