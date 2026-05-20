import { describe, expect, it } from 'vitest';
import { sortRowsByVencimentoDesc, type CreditCardInvoiceCycleRow } from '../../src/components/modals/CreditCardInvoiceCyclesModal';

const base = (vencimentoBR: string, origin: string): CreditCardInvoiceCycleRow => ({
  key: origin,
  accountId: 'a1',
  accountName: 'XP',
  originComparable: origin,
  displayOrigin: origin,
  txCount: 1,
  competenciaBR: '',
  vencimentoBR,
  sortUploadMs: 0,
});

describe('sortRowsByVencimentoDesc', () => {
  it('ordena vencimento do mais recente para o mais antigo', () => {
    const sorted = sortRowsByVencimentoDesc([
      base('10/02/2026', 'feb'),
      base('10/05/2026', 'may'),
      base('10/03/2026', 'mar'),
    ]);
    expect(sorted.map((r) => r.displayOrigin)).toEqual(['may', 'mar', 'feb']);
  });
});
