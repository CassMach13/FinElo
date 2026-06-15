import { describe, expect, it } from 'vitest';
import {
  inferManualRefundReferenceMonth,
  resolveRefundCompetenceMonthForEdit,
  toLocalDateIso,
} from '../../src/services/creditCardManualCompetence';
import type { Account, Transaction } from '../../src/types';

describe('toLocalDateIso', () => {
  it('normaliza timestamp Postgres com espaço e timezone', () => {
    expect(toLocalDateIso('2026-05-25 00:00:00+00')).toBe('2026-05-25');
    expect(toLocalDateIso('2026-05-25T00:00:00.000Z')).toBe('2026-05-25');
  });
});

describe('inferManualRefundReferenceMonth cashback', () => {
  const itau: Account = {
    id: 'acc-itau',
    Nome_Conta: 'Cartão Itaú',
    Tipo_Conta: 'Cartão de Crédito',
    dia_vencimento: 25,
  } as Account;

  it('cashback com datas Postgres no vencimento 25/05 → competência 2026-05', () => {
    const tx = {
      ID_Transacao: 'cb',
      Origem: 'manual',
      Tipo: 'Renda',
      Data: '2026-05-25 00:00:00+00',
      Data_Pagamento: '2026-05-25 00:00:00+00',
      Valor: 29,
      Nome_Fantasia: 'Cashback',
      Descricao_Original: 'Cashback',
    } as Transaction;

    expect(inferManualRefundReferenceMonth(tx, itau)).toBe('2026-05');
  });

  it('reinfere maio quando marcador finelo:2026-04 está incorreto', () => {
    const tx = {
      Origem: 'manual',
      Tipo: 'Renda',
      Data: '2026-05-25 00:00:00+00',
      Data_Pagamento: '2026-05-25 00:00:00+00',
      Valor: 29,
      Nome_Fantasia: 'Cashback',
      Descricao_Original: 'Cashback (2026-04) finelo_competence:2026-04',
    } as Transaction;

    expect(resolveRefundCompetenceMonthForEdit(tx, itau)).toBe('2026-05');
  });
});
