import { describe, expect, it } from 'vitest';
import {
  resolveCreditCardInvoiceCycleDueDateIso,
  sortRowsByVencimentoDesc,
  type CreditCardInvoiceCycleRow,
} from '../../src/components/modals/CreditCardInvoiceCyclesModal';

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

describe('resolveCreditCardInvoiceCycleDueDateIso', () => {
  it('preserva o vencimento confirmado mesmo quando ele está no mesmo mês da competência', () => {
    const row = {
      ...base('28/07/2026', 'july'),
      competenciaBR: '07/2026',
    };

    expect(resolveCreditCardInvoiceCycleDueDateIso(row, 28)).toBe('2026-07-28');
  });

  it('calcula o mês seguinte apenas quando o histórico não possui vencimento', () => {
    const row = {
      ...base('', 'july'),
      competenciaBR: '07/2026',
    };

    expect(resolveCreditCardInvoiceCycleDueDateIso(row, 28)).toBe('2026-08-28');
  });
});
