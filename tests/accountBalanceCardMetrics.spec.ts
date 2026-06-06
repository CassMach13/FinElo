import { describe, expect, it } from 'vitest';
import { computeAccountCardDisplay } from '../src/components/transactions/accountBalanceCardMetrics';
import {
  competenceAmountDue,
  competenceFaturaAtualDisplayAmount,
  pickFaturaAtualCompetenceCard,
} from '../src/services/creditCardManualCompetence';
import type { CompetenceHistoryCard } from '../src/services/creditCardRebuildFromImportHistoryService';
import type { Account, Transaction } from '../src/types';

const account: Account = {
  id: 'acc-xp',
  Nome_Conta: 'Cartão XP',
  Tipo_Conta: 'Cartão de Crédito',
  limite_credito: 36787.16,
  dia_vencimento: 10,
  Saldo_Inicial: 0,
} as Account;

describe('pickFaturaAtualCompetenceCard', () => {
  it('ignora resíduo contábil de abril quitado e mostra maio (ciclo vigente)', () => {
    const cards: CompetenceHistoryCard[] = [
      {
        referenceMonth: '2026-04',
        competenceBR: '04/2026',
        dueDate: '2026-05-10',
        vencimentoBR: '10/05/2026',
        dueYear: 2026,
        dueMonth: 5,
        files: [],
        statementTotal: 6402.97,
        totalPayments: 6342.45,
        openBalance: 0,
        totalDebits: 0,
        totalRefunds: 0,
      },
      {
        referenceMonth: '2026-05',
        competenceBR: '05/2026',
        dueDate: '2026-06-10',
        vencimentoBR: '10/06/2026',
        dueYear: 2026,
        dueMonth: 6,
        files: [],
        statementTotal: 6260.26,
        totalPayments: 0,
        openBalance: 6260.26,
        openBalanceBeforeCarry: 6260.26,
        totalDebits: 0,
        totalRefunds: 0,
      },
    ];

    const picked = pickFaturaAtualCompetenceCard(cards, '2026-06-06');
    expect(picked?.referenceMonth).toBe('2026-05');
    expect(competenceFaturaAtualDisplayAmount(picked!)).toBeCloseTo(6260.26, 2);
    expect(competenceAmountDue(cards[0])).toBe(0);
  });
});

describe('computeAccountCardDisplay', () => {
  it('usa ledger de competências: abril paga + maio aberta → fatura atual e limite só de maio', () => {
    const transactions: Transaction[] = [
      {
        ID_Transacao: 'abr-compra',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_XP_Abr_2026.csv',
        Data: '2026-04-05',
        Valor: -6436.77,
        Tipo: 'Despesa',
        Descricao_Original: 'Compras abr',
      } as Transaction,
      {
        ID_Transacao: 'abr-estorno',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_XP_Abr_2026.csv',
        Data: '2026-04-08',
        Valor: 33.8,
        Tipo: 'Renda',
        Descricao_Original: 'Estorno',
      } as Transaction,
      {
        ID_Transacao: 'mai-compra',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_XP_Mai_2026.csv',
        Data: '2026-05-05',
        Valor: -6260.26,
        Tipo: 'Despesa',
        Descricao_Original: 'Compras mai',
      } as Transaction,
      {
        ID_Transacao: 'pgto-abr',
        ID_Conta: 'acc-xp',
        Origem: 'Fatura_XP_Mai_2026.csv',
        Data: '2026-05-12',
        Valor: 6402.97,
        Tipo: 'Renda',
        Descricao_Original: 'LANCAMENTO XP',
        Nome_Fantasia: 'Pagamento de fatura',
        Categoria: 'Pagamento Cartão de Crédito',
      } as Transaction,
    ];

    const display = computeAccountCardDisplay(account, {
      transactions,
      accounts: [account],
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
      cardV2Enabled: true,
      cardEngineEnabled: true,
      cardSnapshotPipelineEnabled: true,
      cardV2Snapshot: {
        currentOpenAmount: 12663.23,
        hasData: true,
        fetchCompleted: true,
      },
    });

    expect(display.faturaAtual).toBeCloseTo(6260.26, 2);
    expect(display.limiteUsadoPct).toBeCloseTo((6260.26 / 36787.16) * 100, 1);
    expect(display.limiteDisponivel).toBeCloseTo(36787.16 - 6260.26, 1);
  });
});
