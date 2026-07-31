import { describe, expect, it } from 'vitest';
import {
  getDistinctCardImportReferenceMonths,
  resolveAutomaticCardReferenceMonth,
} from '../../src/utils/cardImportReference';

describe('competência automática de importação do cartão', () => {
  it('usa a compra mais recente e ignora pagamento posterior', () => {
    const transactions = [
      { Data: '2026-07-15', Valor: -120, Tipo: 'Despesa' },
      { Data: '2026-08-02', Valor: 120, Tipo: 'Renda' },
    ];

    expect(getDistinctCardImportReferenceMonths(transactions)).toEqual(['2026-07', '2026-08']);
    expect(resolveAutomaticCardReferenceMonth(transactions)).toBe('2026-07');
  });

  it('preserva o mês de uma data ISO sem deslocamento de fuso horário', () => {
    expect(
      resolveAutomaticCardReferenceMonth([{ Data: '2026-08-01', Valor: -10, Tipo: 'Despesa' }])
    ).toBe('2026-08');
  });
});
