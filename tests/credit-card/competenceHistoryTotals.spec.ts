import { describe, expect, it } from 'vitest';
import {
  isMeaninglessCompetenceHistoryCard,
  isPaymentOnlyGhostCompetenceCard,
  reconcileCardStatementTotalFromFiles,
  type CompetenceHistoryCard,
} from '../../src/services/creditCardRebuildFromImportHistoryService';
import { MANUAL_COMPETENCE_FILE_LABEL } from '../../src/services/creditCardManualCompetence';

const baseCard = (): CompetenceHistoryCard => ({
  referenceMonth: '2026-05',
  competenceBR: '05/2026',
  dueDate: '2026-06-10',
  vencimentoBR: '10/06/2026',
  dueYear: 2026,
  dueMonth: 6,
  files: [],
  totalDebits: 0,
  totalRefunds: 0,
  statementTotal: 0,
  totalPayments: 0,
  openBalanceBeforeCarry: 0,
  priorCreditApplied: 0,
  openBalance: 0,
  creditCarriedForward: 0,
});

describe('reconcileCardStatementTotalFromFiles', () => {
  it('abatimento de estorno manual em linha separada reduz o total do import', () => {
    const card = baseCard();
    card.files = [
      {
        fileName: 'xp_jun.csv',
        transactionCount: 10,
        totalDebits: 6026.64,
        totalRefunds: 0,
        statementTotal: 6026.64,
        totalPayments: 0,
      },
      {
        fileName: MANUAL_COMPETENCE_FILE_LABEL,
        transactionCount: 1,
        totalDebits: 0,
        totalRefunds: 39.99,
        statementTotal: 0,
        totalPayments: 0,
      },
    ];
    reconcileCardStatementTotalFromFiles(card);
    expect(card.statementTotal).toBe(5986.65);
  });

  it('não zera fatura quando só há extrato importado', () => {
    const card = baseCard();
    card.files = [
      {
        fileName: 'xp_mai.csv',
        transactionCount: 5,
        totalDebits: 1200,
        totalRefunds: 50,
        statementTotal: 1150,
        totalPayments: 0,
      },
    ];
    reconcileCardStatementTotalFromFiles(card);
    expect(card.statementTotal).toBe(1150);
  });
});

describe('isPaymentOnlyGhostCompetenceCard', () => {
  it('marca competência fantasma só com pagamento alocado do mês seguinte', () => {
    const card = baseCard();
    card.referenceMonth = '2026-04';
    card.totalPayments = 500;
    expect(isPaymentOnlyGhostCompetenceCard(card)).toBe(true);
  });

  it('não oculta competência com estorno manual direcionado', () => {
    const card = baseCard();
    card.directedManualRefundTotal = 39.99;
    card.files.push({
      fileName: MANUAL_COMPETENCE_FILE_LABEL,
      transactionCount: 1,
      totalDebits: 0,
      totalRefunds: 39.99,
      statementTotal: 0,
      totalPayments: 0,
    });
    expect(isPaymentOnlyGhostCompetenceCard(card)).toBe(false);
  });

  it('oculta competência só com metadado de import e totais zerados', () => {
    const card = baseCard();
    card.referenceMonth = '2026-01';
    card.files.push({
      fileName: 'xp_fev.csv',
      transactionCount: 3,
      totalDebits: 0,
      totalRefunds: 0,
      statementTotal: 0,
      totalPayments: 0,
    });
    expect(isMeaninglessCompetenceHistoryCard(card)).toBe(true);
  });

  it('não oculta competência com extrato importado e compras', () => {
    const card = baseCard();
    card.files.push({
      fileName: 'xp_fev.csv',
      transactionCount: 1,
      totalDebits: 100,
      totalRefunds: 100,
      statementTotal: 0,
      totalPayments: 0,
    });
    expect(isPaymentOnlyGhostCompetenceCard(card)).toBe(false);
  });
});
