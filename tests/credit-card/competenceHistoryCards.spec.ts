import { describe, expect, it } from 'vitest';
import { computeImportLedgerTotals } from '../../src/domain/credit-card/importLedgerTotals';
import {
  creditCardRebuildFromImportHistoryService,
  listTransactionsForCompetenceCard,
} from '../../src/services/creditCardRebuildFromImportHistoryService';
import type { Account, Transaction } from '../../src/types';

const account: Account = {
  id: 'acc-xp',
  Nome_Conta: 'Cartão XP',
  Tipo_Conta: 'Cartão de Crédito',
  dia_vencimento: 10,
} as Account;

describe('competenceHistoryCardsForAccount', () => {
  it('recupera a competência automática pelas compras quando o log legado não a persistiu', () => {
    const fileName = '10_xp_cartao_fatura_julho_2026.csv';
    const transactions: Transaction[] = [
      { ID_Transacao: '1', ID_Conta: 'acc-xp', Origem: fileName, Data: '2026-07-02', Valor: -300, Tipo: 'Despesa', Descricao_Original: 'STG-QA CURSO ONLINE' } as Transaction,
      { ID_Transacao: '2', ID_Conta: 'acc-xp', Origem: fileName, Data: '2026-07-05', Valor: -120, Tipo: 'Despesa', Descricao_Original: 'STG-QA SUPERMERCADO' } as Transaction,
      { ID_Transacao: '3', ID_Conta: 'acc-xp', Origem: fileName, Data: '2026-07-10', Valor: -29.9, Tipo: 'Despesa', Descricao_Original: 'STG-QA ASSINATURA DIGITAL' } as Transaction,
      { ID_Transacao: '4', ID_Conta: 'acc-xp', Origem: fileName, Data: '2026-07-15', Valor: 50, Tipo: 'Renda', Descricao_Original: 'STG-QA ESTORNO CURSO' } as Transaction,
      { ID_Transacao: '5', ID_Conta: 'acc-xp', Origem: fileName, Data: '2026-07-25', Valor: 400, Tipo: 'Renda', Descricao_Original: 'Pagamentos Validos' } as Transaction,
    ];
    const importedDetails = transactions.map((transaction) => ({
      ID_Conta: transaction.ID_Conta,
      Data: transaction.Data,
      Valor: transaction.Valor,
      Tipo: transaction.Tipo,
      Card_Reference_Label: null,
      Card_Due_Date: '2026-07-28',
    }));

    const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: account.id,
      account: { ...account, dia_vencimento: 28 },
      accounts: [{ ...account, dia_vencimento: 28 }],
      transactions,
      importLogs: [{ id: 'legacy-auto', file_name: fileName, imported_details: importedDetails } as any],
    });

    const july = cards.find((card) => card.referenceMonth === '2026-07');
    expect(july).toBeDefined();
    expect(july?.dueDate).toBe('2026-07-28');
    expect(july?.statementTotal).toBeCloseTo(399.9, 2);
    expect(july?.totalRefunds).toBeCloseTo(50, 2);
  });

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

  it('pagamento no CSV da competência seguinte abate a competência anterior (cadeia XP)', () => {
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
    expect(fev?.paymentsOnExtracts).toBe(500);
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
        Tipo: 'Renda',
        Descricao_Original: 'Pagamentos Validos Normais',
      } as Transaction,
      {
        ID_Transacao: '2',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_Cartao_XP_Cassio_Dez_2025.csv',
        Data: '2025-12-10',
        Valor: -6052.63,
        Tipo: 'Despesa',
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

    expect(dez?.files.length).toBe(1);
    expect(dez?.statementTotal).toBe(6052.63);
    expect(dez?.totalPayments).toBe(0);
    expect(dez?.paymentsOnExtracts).toBe(7356.47);
    expect(dez?.openBalance).toBe(6052.63);
    // Pagamento do CSV repassado para 2025-10 (competência anterior); card só com pagamento não entra no histórico.
    expect(nov).toBeUndefined();
  });

  it('compra manual Despesa negativa (Netflix) entra no total da competência, não como estorno', () => {
    const transactions: Transaction[] = [
      {
        ID_Transacao: 'netflix-jan',
        ID_Conta: 'acc-xp',
        Origem: 'manual',
        Tipo: 'Despesa',
        Data: '2026-01-10',
        Data_Pagamento: '2026-02-10',
        Valor: -39.99,
        Nome_Fantasia: 'Netflix',
        Descricao_Original: 'Netflix',
      } as Transaction,
      {
        ID_Transacao: 'netflix-fev',
        ID_Conta: 'acc-xp',
        Origem: 'manual',
        Tipo: 'Despesa',
        Data: '2026-02-10',
        Data_Pagamento: '2026-03-10',
        Valor: -39.99,
        Nome_Fantasia: 'Netflix',
        Descricao_Original: 'Netflix',
      } as Transaction,
    ];

    const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: account.id,
      account,
      accounts: [account],
      transactions,
      importLogs: [],
    });

    const jan = cards.find((c) => c.referenceMonth === '2026-01');
    const fev = cards.find((c) => c.referenceMonth === '2026-02');

    expect(jan?.statementTotal).toBe(39.99);
    expect(jan?.openBalance).toBe(39.99);
    expect(jan?.files.some((f) => f.fileName === 'Lançamentos manuais')).toBe(true);
    expect(fev?.statementTotal).toBe(39.99);
    expect(fev?.openBalance).toBe(39.99);
  });

  it('micro-excedente de pagamento (< R$ 1) em abril não abate a fatura de maio', () => {
    const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: account.id,
      account,
      accounts: [account],
      transactions: [
        {
          ID_Transacao: 'abr',
          ID_Conta: 'acc-xp',
          Origem: 'Fatura_XP_Abr_2026.csv',
          Data: '2026-04-05',
          Valor: -6402.97,
          Tipo: 'Despesa',
          Descricao_Original: 'Compras abr',
        } as Transaction,
        {
          ID_Transacao: 'pgto',
          ID_Conta: 'acc-xp',
          Origem: 'Fatura_XP_Mai_2026.csv',
          Data: '2026-05-12',
          Valor: 6403.91,
          Tipo: 'Renda',
          Descricao_Original: 'Pagamento de fatura',
          Nome_Fantasia: 'Pagamento de fatura',
          Categoria: 'Pagamento Cartão de Crédito',
        } as Transaction,
        {
          ID_Transacao: 'mai',
          ID_Conta: 'acc-xp',
          Origem: 'Fatura_XP_Mai_2026.csv',
          Data: '2026-05-05',
          Valor: -6260.26,
          Tipo: 'Despesa',
          Descricao_Original: 'Compras mai',
        } as Transaction,
      ],
      importLogs: [
        {
          id: 'l-abr',
          file_name: 'Fatura_XP_Abr_2026.csv',
          imported_details: [
            { ID_Conta: 'acc-xp', Card_Reference_Label: '2026-04', Card_Due_Date: '2026-05-10' },
          ],
        } as any,
        {
          id: 'l-mai',
          file_name: 'Fatura_XP_Mai_2026.csv',
          imported_details: [
            { ID_Conta: 'acc-xp', Card_Reference_Label: '2026-05', Card_Due_Date: '2026-06-10' },
          ],
        } as any,
      ],
    });

    const abr = cards.find((c) => c.referenceMonth === '2026-04');
    const mai = cards.find((c) => c.referenceMonth === '2026-05');

    expect(abr?.openBalance).toBe(0);
    expect(abr?.creditCarriedForward).toBe(0);
    expect(mai?.statementTotal).toBe(6260.26);
    expect(mai?.priorCreditApplied).toBe(0);
    expect(mai?.openBalance).toBe(6260.26);
  });

  it('pagamento no CSV com regra de mapeamento (nome/categoria) abate fatura anterior', () => {
    const transactions: Transaction[] = [
      {
        ID_Transacao: '1',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_XP_Mai_2026.csv',
        Data: '2026-05-05',
        Valor: -19066.2,
        Descricao_Original: 'CREDITO OUTROS LANCAMENTOS',
        Tipo: 'Despesa',
      } as Transaction,
      {
        ID_Transacao: '2',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_XP_Jun_2026.csv',
        Data: '2026-05-12',
        Valor: 6402.97,
        Tipo: 'Renda',
        Descricao_Original: 'LANCAMENTO XP 12345',
        Nome_Fantasia: 'Pagamento de fatura',
        Categoria: 'Pagamento Cartão de Crédito',
      } as Transaction,
    ];

    const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: account.id,
      account,
      accounts: [account],
      transactions,
      importLogs: [
        {
          id: 'l-mai',
          file_name: 'Fatura_XP_Mai_2026.csv',
          imported_details: [
            { ID_Conta: 'acc-xp', Card_Reference_Label: '2026-05', Card_Due_Date: '2026-06-10' },
          ],
        } as any,
        {
          id: 'l-jun',
          file_name: 'Fatura_XP_Jun_2026.csv',
          imported_details: [
            { ID_Conta: 'acc-xp', Card_Reference_Label: '2026-06', Card_Due_Date: '2026-07-10' },
          ],
        } as any,
      ],
    });

    const mai = cards.find((c) => c.referenceMonth === '2026-05');
    expect(mai?.statementTotal).toBe(19066.2);
    expect(mai?.totalPayments).toBe(6402.97);
    expect(mai?.openBalance).toBe(12663.23);
  });

  it('pagamento no CSV de arquivo com competência 01/2025 abate fatura 12/2024', () => {
    const transactions: Transaction[] = [
      {
        ID_Transacao: '1',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_Cartao_XP_Cassio_Jan_2025.csv',
        Data: '2025-01-05',
        Valor: -5836.38,
        Descricao_Original: 'COMPRAS DEZ',
      } as Transaction,
      {
        ID_Transacao: '2',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_Cartao_XP_Cassio_Fev_2025.csv',
        Data: '2025-02-05',
        Valor: -100,
        Descricao_Original: 'COMPRAS FEV',
      } as Transaction,
      {
        ID_Transacao: '3',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_Cartao_XP_Cassio_Fev_2025.csv',
        Data: '2025-02-08',
        Valor: 5836.38,
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

    const dez = cards.find((c) => c.referenceMonth === '2024-12');
    expect(dez?.statementTotal).toBe(5836.38);
    expect(dez?.totalPayments).toBe(5836.38);
    expect(dez?.openBalance).toBe(0);
  });

  it('pagamento manual de fatura sem finelo_competence abate totalPayments da competência do vencimento', () => {
    const transactions: Transaction[] = [
      {
        ID_Transacao: 'compras-maio',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_XP_Mai_2026.csv',
        Data: '2026-05-05',
        Valor: -19066.2,
        Descricao_Original: 'Compras maio',
        Tipo: 'Despesa',
      } as Transaction,
      {
        ID_Transacao: 'pgto-manual',
        ID_Conta: 'acc-xp',
        Origem: 'manual',
        Tipo: 'Renda',
        Data: '2026-05-12',
        Data_Pagamento: '2026-06-10',
        Valor: 6402.97,
        Nome_Fantasia: 'Pagamento de fatura',
        Categoria: 'Pagamento Cartão de Crédito',
        Descricao_Original: 'Pagamento de fatura',
      } as Transaction,
    ];

    const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: account.id,
      account,
      accounts: [account],
      transactions,
      importLogs: [
        {
          id: 'l-mai',
          file_name: 'Fatura_XP_Mai_2026.csv',
          imported_details: [
            { ID_Conta: 'acc-xp', Card_Reference_Label: '2026-05', Card_Due_Date: '2026-06-10' },
          ],
        } as any,
      ],
    });

    const mai = cards.find((c) => c.referenceMonth === '2026-05');
    expect(mai?.statementTotal).toBe(19066.2);
    expect(mai?.totalPayments).toBe(6402.97);
    expect(mai?.openBalance).toBe(12663.23);
  });

  it('estorno manual Renda (sem finelo_competence) abate competência pelo mês da Data, não Data_Pagamento aleatória', () => {
    const transactions: Transaction[] = [
      {
        ID_Transacao: 'compra-maio',
        ID_Conta: 'acc-xp',
        Origem: 'manual',
        Tipo: 'Despesa',
        Data: '2026-05-10',
        Data_Pagamento: '2026-06-10',
        Valor: -50,
        Nome_Fantasia: 'teste',
      } as Transaction,
      {
        ID_Transacao: 'netflix-maio',
        ID_Conta: 'acc-xp',
        Origem: 'manual',
        Tipo: 'Despesa',
        Data: '2026-05-10',
        Data_Pagamento: '2026-06-10',
        Valor: -39.99,
        Nome_Fantasia: 'Netflix',
      } as Transaction,
      {
        ID_Transacao: 'estorno-teste',
        ID_Conta: 'acc-xp',
        Origem: 'manual',
        Tipo: 'Renda',
        Data: '2026-05-21',
        Data_Pagamento: '2026-05-21',
        Valor: 39.99,
        Nome_Fantasia: 'Teste',
        Categoria: 'Estornos/Reembolsos',
        Descricao_Original: 'Teste',
      } as Transaction,
    ];

    const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: account.id,
      account,
      accounts: [account],
      transactions,
      importLogs: [],
    });

    const mai = cards.find((c) => c.referenceMonth === '2026-05');
    expect(mai?.statementTotal).toBe(50);
    expect(mai?.directedManualRefundTotal).toBe(39.99);
    expect(mai?.openBalance).toBe(50);
  });

  it('cashback manual em maio com vencimento 25/05 compete em 05/2026, não 04/2026', () => {
    const itauAccount: Account = {
      id: 'acc-itau',
      Nome_Conta: 'Cartão Itaú',
      Tipo_Conta: 'Cartão de Crédito',
      dia_vencimento: 25,
    } as Account;

    const transactions: Transaction[] = [
      {
        ID_Transacao: 'cashback-mai',
        ID_Conta: 'acc-itau',
        Origem: 'manual',
        Tipo: 'Renda',
        Data: '2026-05-25 00:00:00+00',
        Data_Pagamento: '2026-05-25 00:00:00+00',
        Valor: 29,
        Nome_Fantasia: 'Cashback',
        Descricao_Original: 'Cashback',
      } as Transaction,
    ];

    const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: itauAccount.id,
      account: itauAccount,
      accounts: [itauAccount],
      transactions,
      importLogs: [],
    });

    const abr = cards.find((c) => c.referenceMonth === '2026-04');
    const mai = cards.find((c) => c.referenceMonth === '2026-05');
    expect(abr).toBeUndefined();
    expect(mai?.directedManualRefundTotal).toBe(29);
    expect(
      listTransactionsForCompetenceCard({
        card: mai!,
        accountId: itauAccount.id,
        account: itauAccount,
        transactions,
      }).map((t) => t.ID_Transacao)
    ).toEqual(['cashback-mai']);
  });

  it('compra manual no mesmo mês do vencimento compete nesse mês (sem marcador)', () => {
    const itauAccount: Account = {
      id: 'acc-itau',
      Nome_Conta: 'Cartão Itaú',
      Tipo_Conta: 'Cartão de Crédito',
      dia_vencimento: 25,
    } as Account;

    const transactions: Transaction[] = [
      {
        ID_Transacao: 'spotify-mai',
        ID_Conta: 'acc-itau',
        Origem: 'manual',
        Tipo: 'Despesa',
        Data: '2026-05-04',
        Data_Pagamento: '2026-05-25',
        Valor: -23.9,
        Nome_Fantasia: 'SpotyFy',
        Descricao_Original: 'SpotyFy',
      } as Transaction,
    ];

    const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: itauAccount.id,
      account: itauAccount,
      accounts: [itauAccount],
      transactions,
      importLogs: [],
    });

    const abr = cards.find((c) => c.referenceMonth === '2026-04');
    const mai = cards.find((c) => c.referenceMonth === '2026-05');
    expect(abr).toBeUndefined();
    expect(mai?.statementTotal).toBe(23.9);
  });

  it('compra manual abril com Data_Pagamento em maio entra na competência 05/2026 com finelo_competence', () => {
    const itauAccount: Account = {
      id: 'acc-itau',
      Nome_Conta: 'Cartão Itaú',
      Tipo_Conta: 'Cartão de Crédito',
      dia_vencimento: 25,
    } as Account;

    const transactions: Transaction[] = [
      {
        ID_Transacao: 'paris-1',
        ID_Conta: 'acc-itau',
        Origem: 'manual',
        Tipo: 'Despesa',
        Data: '2026-04-18',
        Data_Pagamento: '2026-05-25',
        Valor: -437.83,
        Nome_Fantasia: 'Brandy - compra San Sebastián',
        Descricao_Original: 'Brandy - compra San Sebastián finelo_competence:2026-05',
      } as Transaction,
      {
        ID_Transacao: 'paris-2',
        ID_Conta: 'acc-itau',
        Origem: 'manual',
        Tipo: 'Despesa',
        Data: '2026-04-19',
        Data_Pagamento: '2026-05-25',
        Valor: -158.36,
        Nome_Fantasia: 'Musee Claude Monet - França',
        Descricao_Original: 'Musee Claude Monet - França finelo_competence:2026-05',
      } as Transaction,
    ];

    const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: itauAccount.id,
      account: itauAccount,
      accounts: [itauAccount],
      transactions,
      importLogs: [],
    });

    const abr = cards.find((c) => c.referenceMonth === '2026-04');
    const mai = cards.find((c) => c.referenceMonth === '2026-05');

    expect(abr).toBeUndefined();
    expect(mai?.statementTotal).toBe(596.19);
    expect(mai?.files.some((f) => f.fileName === 'Lançamentos manuais')).toBe(true);
  });

  it('listTransactionsForCompetenceCard retorna lançamentos do arquivo e manuais da competência', () => {
    const transactions: Transaction[] = [
      {
        ID_Transacao: 'imp-1',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_XP_Jan_2026.csv',
        Data: '2026-01-08',
        Valor: -120,
        Nome_Fantasia: 'Mercado',
        Descricao_Original: 'Mercado',
        Tipo: 'Despesa',
      } as Transaction,
      {
        ID_Transacao: 'man-1',
        ID_Conta: 'acc-xp',
        Origem: 'manual',
        Data: '2026-01-12',
        Data_Pagamento: '2026-02-10',
        Valor: -45,
        Nome_Fantasia: 'Farmácia',
        Descricao_Original: 'Farmácia',
        Tipo: 'Despesa',
      } as Transaction,
      {
        ID_Transacao: 'out-1',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_XP_Fev_2026.csv',
        Data: '2026-02-03',
        Valor: -90,
        Descricao_Original: 'Outra fatura',
        Tipo: 'Despesa',
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
          file_name: 'Fatura_XP_Jan_2026.csv',
          imported_details: [
            { ID_Conta: 'acc-xp', Card_Reference_Label: '2026-01', Card_Due_Date: '2026-02-10' },
          ],
        } as any,
        {
          id: 'l2',
          file_name: 'Fatura_XP_Fev_2026.csv',
          imported_details: [
            { ID_Conta: 'acc-xp', Card_Reference_Label: '2026-02', Card_Due_Date: '2026-03-10' },
          ],
        } as any,
      ],
    });

    const jan = cards.find((c) => c.referenceMonth === '2026-01');
    expect(jan).toBeDefined();
    const ledger = listTransactionsForCompetenceCard({
      card: jan!,
      accountId: account.id,
      account,
      transactions,
    });
    expect(ledger.map((t) => t.ID_Transacao).sort()).toEqual(['imp-1', 'man-1'].sort());
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
