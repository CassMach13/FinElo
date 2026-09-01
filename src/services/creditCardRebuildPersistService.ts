import { computeImportLedgerTotals } from '../domain/credit-card/importLedgerTotals';
import type { ClassificationRules } from '../domain/credit-card/classifiers';
import { Account, Transaction } from '../types';
import { creditCardEngineService } from './creditCardEngineService';
import {
  toImportLines,
  transactionsForFile,
  type ImportHistoryRebuildCycle,
  type ImportHistoryRebuildPreview,
  type ImportHistoryRebuildResult,
} from './creditCardRebuildFromImportHistoryService';

/**
 * Lado de I/O da reconstrucao a partir do historico de importacao.
 *
 * Separado do nucleo de calculo de proposito: `creditCardRebuildFromImportHistoryService`
 * passa a ser puro e portatil — sem cliente Supabase, sem motor —, de modo que o
 * MESMO codigo financeiro possa rodar no browser e num contexto server-side
 * confiavel. Toda persistencia mora aqui.
 */
export const creditCardRebuildPersistService = {
  async rebuildFromImportHistory(input: {
    userId: string;
    account: Account;
    cycles: ImportHistoryRebuildCycle[];
    transactions: Transaction[];
    rules?: ClassificationRules;
  }): Promise<ImportHistoryRebuildResult> {
    const { userId, account, cycles, transactions, rules } = input;
    const sorted = [...cycles].sort((a, b) => a.referenceMonth.localeCompare(b.referenceMonth));
    const previews: ImportHistoryRebuildPreview[] = [];
    let processedFiles = 0;

    await creditCardEngineService.ensureCreditCardForAccount(userId, account);

    for (const cycle of sorted) {
      const txs = transactionsForFile(account.id, cycle.fileName, transactions);
      if (txs.length === 0) continue;

      const accountId = account.id;
      const lines = toImportLines(txs);
      const totals = computeImportLedgerTotals(lines, rules);
      previews.push({
        fileName: cycle.fileName,
        referenceMonth: cycle.referenceMonth,
        dueDate: cycle.dueDate,
        transactionCount: txs.length,
        totals,
      });

      const dueParts = /^(\d{4})-(\d{2})-\d{2}$/.exec(cycle.dueDate.trim());
      if (!dueParts) {
        throw new Error(`Vencimento inválido para "${cycle.fileName}" — use AAAA-MM-DD.`);
      }
      const dueYear = Number(dueParts[1]);
      const dueMonth = Number(dueParts[2]);
      const rows = await creditCardEngineService.buildImportRowsFromTransactionsPreservingIndices({
        accountId,
        origin: cycle.fileName,
        transactions: txs,
      });

      await creditCardEngineService.normalizeAndPersistImportLot({
        userId,
        account,
        sourceFileName: cycle.fileName,
        rows,
        dueYear,
        dueMonth,
        dueDate: cycle.dueDate,
        purchaseReferenceLabel: cycle.referenceMonth,
        rules,
        fileTotals: {
          statementTotal: totals.statementTotal,
          totalPayments: totals.totalPayments,
        },
        skipRecalculateAllStatements: true,
      });

      processedFiles += 1;
    }

    if (processedFiles > 0) {
      const card = await creditCardEngineService.ensureCreditCardForAccount(userId, account);
      await creditCardEngineService.recalculateAllStatementsForCard(card.id);
    }

    return {
      processedFiles,
      previews,
      message:
        processedFiles > 0
          ? `${processedFiles} arquivo(s) reconstruído(s). Total da fatura = compras/estornos do arquivo; pagamentos de fatura no CSV abatem a competência anterior.`
          : 'Nenhum lançamento encontrado para os arquivos selecionados neste cartão.',
    };
  }
};
