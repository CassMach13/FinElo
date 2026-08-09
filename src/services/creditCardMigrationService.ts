import { Account, ImportLog, Transaction } from '../types';
import { creditCardEngineService } from './creditCardEngineService';
import { toDateOnlyIso } from '../utils/dateOnly';
import { resolveCardImportCycleCoordinates } from '../utils/cardImportReference';

interface BuildRowsInput {
  transactions: Transaction[];
}

const buildRowsFromTransactions = ({ transactions }: BuildRowsInput) =>
  transactions
    .slice()
    .sort((a, b) => toDateOnlyIso(a.Data).localeCompare(toDateOnlyIso(b.Data)))
    .map((tx, index) => ({
      sourceRowIndex: index + 1,
      postedDate: toDateOnlyIso(tx.Data),
      description: tx.Descricao_Original || tx.Nome_Fantasia || '',
      holderName: tx.Portador || undefined,
      amount: Number(tx.Valor || 0),
      installmentCurrent: tx.Parcela_Atual || undefined,
      installmentTotal: tx.Total_Parcelas || undefined,
      merchantName: tx.Nome_Fantasia || undefined,
      transactionId: tx.ID_Transacao || undefined,
    }));

const extractCardCycleFromImportLog = (log: ImportLog, accountId: string): {
  dueYear?: number;
  dueMonth?: number;
  dueDate?: string;
  purchaseReferenceLabel?: string;
} => {
  const details = Array.isArray(log.imported_details) ? log.imported_details : [];
  const row = details.find((item: any) => item?.ID_Conta === accountId);
  if (!row) return {};

  return resolveCardImportCycleCoordinates({
    referenceLabel:
      typeof row.Card_Reference_Label === 'string' ? row.Card_Reference_Label : null,
    dueDate: typeof row.Card_Due_Date === 'string' ? row.Card_Due_Date : null,
  });
};

export const creditCardMigrationService = {
  async backfillAccountFromTransactions(input: {
    userId: string;
    account: Account;
    transactions: Transaction[];
    importLogs: ImportLog[];
  }): Promise<{ processedLots: number; processedEntries: number }> {
    if (input.account.Tipo_Conta !== 'Cartão de Crédito') {
      return { processedLots: 0, processedEntries: 0 };
    }

    const accountTx = input.transactions.filter(
      (tx) => tx.ID_Conta === input.account.id && tx.Origem && tx.Origem !== 'manual'
    );
    if (accountTx.length === 0) {
      return { processedLots: 0, processedEntries: 0 };
    }

    const groupedByOrigin = new Map<string, Transaction[]>();
    accountTx.forEach((tx) => {
      const origin = tx.Origem as string;
      const current = groupedByOrigin.get(origin) || [];
      current.push(tx);
      groupedByOrigin.set(origin, current);
    });

    let processedLots = 0;
    let processedEntries = 0;
    for (const [origin, originTransactions] of groupedByOrigin.entries()) {
      const importLog = input.importLogs
        .filter((log) => log.file_name === origin)
        .sort((a, b) => new Date(b.import_date || 0).getTime() - new Date(a.import_date || 0).getTime())[0];

      const cardCycle = importLog ? extractCardCycleFromImportLog(importLog, input.account.id) : {};
      const result = await creditCardEngineService.normalizeAndPersistImportLot({
        userId: input.userId,
        account: input.account,
        sourceFileName: origin,
        rows: buildRowsFromTransactions({ transactions: originTransactions }),
        dueYear: cardCycle.dueYear,
        dueMonth: cardCycle.dueMonth,
        dueDate: cardCycle.dueDate,
        purchaseReferenceLabel: cardCycle.purchaseReferenceLabel,
      });

      processedLots += 1;
      processedEntries += result.entries;
    }

    return { processedLots, processedEntries };
  },
};
