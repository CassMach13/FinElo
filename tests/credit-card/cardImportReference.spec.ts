import { describe, expect, it } from 'vitest';
import {
  getDistinctCardImportReferenceMonths,
  resolveAutomaticCardReferenceMonth,
  resolveCardImportCycleCoordinates,
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

  it('sugere o mes anterior ao vencimento mesmo com compras depois da virada do mes', () => {
    const transactions = [
      { Data: '2026-06-25', Valor: -80, Tipo: 'Despesa' },
      { Data: '2026-07-02', Valor: -45, Tipo: 'Despesa' },
      { Data: '2026-07-03', Valor: -20, Tipo: 'Despesa' },
    ];

    expect(resolveAutomaticCardReferenceMonth(transactions, '2026-07-10')).toBe('2026-06');
  });

  it('mantem competencia manual e vencimento em eixos independentes', () => {
    expect(
      resolveCardImportCycleCoordinates({
        referenceLabel: '2026-06',
        dueDate: '2026-07-10',
      })
    ).toEqual({
      purchaseReferenceLabel: '2026-06',
      dueYear: 2026,
      dueMonth: 7,
      dueDate: '2026-07-10',
    });
  });

  it('preserva o caso explicito de competencia e vencimento no mesmo mes', () => {
    expect(
      resolveCardImportCycleCoordinates({
        referenceLabel: '2026-07',
        dueDate: '2026-07-28',
      })
    ).toEqual({
      purchaseReferenceLabel: '2026-07',
      dueYear: 2026,
      dueMonth: 7,
      dueDate: '2026-07-28',
    });
  });

  it('recusa data calendaria invalida sem inventar vencimento', () => {
    expect(
      resolveCardImportCycleCoordinates({
        referenceLabel: '2026-06',
        dueDate: '2026-02-31',
      })
    ).toEqual({
      purchaseReferenceLabel: '2026-06',
      dueYear: 2026,
      dueMonth: 6,
    });
  });
});
