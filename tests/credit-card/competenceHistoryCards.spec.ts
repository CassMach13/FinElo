import { describe, expect, it } from 'vitest';
import { computeImportLedgerTotals } from '../../src/domain/credit-card/importLedgerTotals';
import { creditCardRebuildFromImportHistoryService } from '../../src/services/creditCardRebuildFromImportHistoryService';
import type { Account, Transaction } from '../../src/types';

const account: Account = {
  id: 'acc-xp',
  Nome_Conta: 'Cartão XP',
  Tipo_Conta: 'Cartão de Crédito',
  dia_vencimento: 10,
} as Account;

describe('competenceHistoryCardsForAccount', () => {
  it('agrupa dois arquivos na mesma competência somando totais', () => {
    const transactions: Transaction[] = [
      {
        ID_Transacao: '1',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_Cartao_XP_Cassio_Fev_2026.csv',
        Data: '2026-02-01',
        Valor: -100,
        Descricao_Original: 'Compra A',
      } as Transaction,
      {
        ID_Transacao: '2',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_Cartao_XP_Ione_Fev_2026.csv',
        Data: '2026-02-02',
        Valor: -50,
        Descricao_Original: 'Compra B',
      } as Transaction,
    ];

    const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: account.id,
      account,
      accounts: [account],
      transactions,
      importLogs: [
        {
          id: 'l1',
          file_name: 'Fatura_Cartao_XP_Cassio_Fev_2026.csv',
          imported_details: [
            {
              ID_Conta: 'acc-xp',
              Card_Reference_Label: '2026-01',
              Card_Due_Date: '2026-02-10',
            },
          ],
        } as any,
        {
          id: 'l2',
          file_name: 'Fatura_Cartao_XP_Ione_Fev_2026.csv',
          imported_details: [
            {
              ID_Conta: 'acc-xp',
              Card_Reference_Label: '2026-01',
              Card_Due_Date: '2026-02-10',
            },
          ],
        } as any,
      ],
    });

    expect(cards).toHaveLength(1);
    expect(cards[0].files).toHaveLength(2);
    expect(cards[0].statementTotal).toBe(150);
    expect(cards[0].competenceBR).toBe('01/2026');
  });

  it('pagamento no CSV da competência seguinte abate a competência anterior', () => {
    const transactions: Transaction[] = [
      {
        ID_Transacao: '1',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_Cartao_XP_Cassio_Jan_2025.csv',
        Data: '2025-01-05',
        Valor: -500,
        Descricao_Original: 'COMPRA JAN',
      } as Transaction,
      {
        ID_Transacao: '2',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_Cartao_XP_Cassio_Fev_2025.csv',
        Data: '2025-02-05',
        Valor: -200,
        Descricao_Original: 'COMPRA FEV',
      } as Transaction,
      {
        ID_Transacao: '3',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_Cartao_XP_Cassio_Fev_2025.csv',
        Data: '2025-02-08',
        Valor: 500,
        Descricao_Original: 'Pagamentos Validos Normais',
      } as Transaction,
    ];

    const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: account.id,
      account,
      accounts: [account],
      transactions,
      importLogs: [
        {
          id: 'l-jan',
          file_name: 'Fatura_Cartao_XP_Cassio_Jan_2025.csv',
          imported_details: [
            { ID_Conta: 'acc-xp', Card_Reference_Label: '2024-12', Card_Due_Date: '2025-01-10' },
          ],
        } as any,
        {
          id: 'l-fev',
          file_name: 'Fatura_Cartao_XP_Cassio_Fev_2025.csv',
          imported_details: [
            { ID_Conta: 'acc-xp', Card_Reference_Label: '2025-01', Card_Due_Date: '2025-02-10' },
          ],
        } as any,
      ],
    });

    const jan = cards.find((c) => c.referenceMonth === '2024-12');
    const fev = cards.find((c) => c.referenceMonth === '2025-01');
    expect(jan?.statementTotal).toBe(500);
    expect(jan?.totalPayments).toBe(500);
    expect(jan?.openBalance).toBe(0);
    expect(fev?.statementTotal).toBe(200);
    expect(fev?.totalPayments).toBe(0);
    expect(fev?.openBalance).toBe(200);
  });

  it('aplica crédito de pagamento a mais da competência anterior no mês seguinte', () => {
    const transactions: Transaction[] = [
      {
        ID_Transacao: '1',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_Cartao_XP_Cassio_Fev_2025.csv',
        Data: '2025-02-01',
        Valor: -100,
        Descricao_Original: 'COMPRAS FEV',
      } as Transaction,
      {
        ID_Transacao: '2',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_Cartao_XP_Cassio_Mar_2025.csv',
        Data: '2025-03-01',
        Valor: -80,
        Descricao_Original: 'COMPRAS MAR',
      } as Transaction,
      {
        ID_Transacao: '3',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_Cartao_XP_Cassio_Mar_2025.csv',
        Data: '2025-03-05',
        Valor: 160,
        Descricao_Original: 'Pagamentos Validos Normais',
      } as Transaction,
    ];

    const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: account.id,
      account,
      accounts: [account],
      transactions,
      importLogs: [
        {
          id: 'l-fev',
          file_name: 'Fatura_Cartao_XP_Cassio_Fev_2025.csv',
          imported_details: [
            { ID_Conta: 'acc-xp', Card_Reference_Label: '2025-02', Card_Due_Date: '2025-03-10' },
          ],
        } as any,
        {
          id: 'l-mar',
          file_name: 'Fatura_Cartao_XP_Cassio_Mar_2025.csv',
          imported_details: [
            { ID_Conta: 'acc-xp', Card_Reference_Label: '2025-03', Card_Due_Date: '2025-04-10' },
          ],
        } as any,
      ],
    });

    const fev = cards.find((c) => c.referenceMonth === '2025-02');
    const mar = cards.find((c) => c.referenceMonth === '2025-03');

    expect(fev?.statementTotal).toBe(100);
    expect(fev?.totalPayments).toBe(160);
    expect(fev?.openBalanceBeforeCarry).toBe(0);
    expect(fev?.creditCarriedForward).toBe(60);

    expect(mar?.statementTotal).toBe(80);
    expect(mar?.totalPayments).toBe(0);
    expect(mar?.openBalanceBeforeCarry).toBe(80);
    expect(mar?.priorCreditApplied).toBe(60);
    expect(mar?.openBalance).toBe(20);
  });

  it('não gera crédito remanescente em competência só com pagamento redirecionado (sem CSV)', () => {
    const transactions: Transaction[] = [
      {
        ID_Transacao: '1',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_Cartao_XP_Cassio_Dez_2025.csv',
        Data: '2025-12-05',
        Valor: 7356.47,
        Descricao_Original: 'Pagamentos Validos Normais',
      } as Transaction,
      {
        ID_Transacao: '2',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_Cartao_XP_Cassio_Dez_2025.csv',
        Data: '2025-12-10',
        Valor: -6052.63,
        Descricao_Original: 'COMPRAS DEZ',
      } as Transaction,
    ];

    const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: account.id,
      account,
      accounts: [account],
      transactions,
      importLogs: [
        {
          id: 'l-dez',
          file_name: 'Fatura_Cartao_XP_Cassio_Dez_2025.csv',
          imported_details: [
            { ID_Conta: 'acc-xp', Card_Reference_Label: '2025-11', Card_Due_Date: '2025-12-10' },
          ],
        } as any,
      ],
    });

    const nov = cards.find((c) => c.referenceMonth === '2025-10');
    const dez = cards.find((c) => c.referenceMonth === '2025-11');

    expect(nov?.files.length).toBe(0);
    expect(nov?.statementTotal).toBe(0);
    expect(nov?.totalPayments).toBe(7356.47);
    expect(nov?.creditCarriedForward).toBe(0);

    expect(dez?.files.length).toBe(1);
    expect(dez?.creditCarriedForward).toBeLessThan(1);
  });
});

describe('computeImportLedgerTotals payment chain', () => {
  it('pagamento de um mês não entra no total de outro arquivo isolado', () => {
    const mar = computeImportLedgerTotals([
      { postedDate: '2026-03-01', description: 'LOJA', amount: -100 },
    ]);
    const abr = computeImportLedgerTotals([
      { postedDate: '2026-04-01', description: 'LOJA', amount: -80 },
      { postedDate: '2026-04-05', description: 'Pagamentos Validos Normais', amount: 100 },
    ]);
    expect(mar.totalPayments).toBe(0);
    expect(abr.totalPayments).toBe(100);
    expect(abr.statementTotal).toBe(80);
  });
});
