import { CreditCardImportEntry, CreditCardStatement, CreditCardStatementAudit } from './types';
import { inferDirection } from './classifiers';

const round2 = (value: number): number => Math.round(value * 100) / 100;

export interface BuildAuditInput {
  statement: CreditCardStatement;
  importEntries: CreditCardImportEntry[];
  statementEntries: CreditCardImportEntry[];
}

export const buildStatementAudit = (input: BuildAuditInput): CreditCardStatementAudit => {
  const { statement, importEntries, statementEntries } = input;
  const sourceHashCounts = new Map<string, number>();
  importEntries.forEach((entry) => {
    sourceHashCounts.set(entry.sourceRowHash, (sourceHashCounts.get(entry.sourceRowHash) || 0) + 1);
  });

  const duplicateSourceHashes = Array.from(sourceHashCounts.values()).filter((count) => count > 1).length;
  const ignoredRows = importEntries.filter((entry) => entry.entryType === 'ignored').length;
  const needsReviewRows = importEntries.filter((entry) => entry.entryType === 'needs_review').length;
  const unclassifiedPositiveEntries = importEntries.filter((entry) => entry.amount > 0 && entry.entryType === 'needs_review').length;

  const purchasesTotal = round2(
    statementEntries
      .filter((entry) => entry.entryType === 'purchase' || entry.entryType === 'installment_purchase')
      .reduce((acc, entry) => acc + Math.abs(entry.amount), 0)
  );
  const refundsTotal = round2(
    statementEntries
      .filter((entry) => entry.entryType === 'refund' || entry.entryType === 'adjustment')
      .reduce((acc, entry) => acc + Math.abs(entry.amount), 0) +
      statementEntries
        .filter(
          (entry) =>
            entry.entryType === 'needs_review' && entry.amount > 0 && inferDirection(entry.amount) === 'credit'
        )
        .reduce((acc, entry) => acc + Math.abs(entry.amount), 0)
  );
  const feesTotal = round2(
    statementEntries
      .filter((entry) => entry.entryType === 'fee')
      .reduce((acc, entry) => acc + Math.abs(entry.amount), 0)
  );
  const interestTotal = round2(
    statementEntries
      .filter((entry) => entry.entryType === 'interest')
      .reduce((acc, entry) => acc + Math.abs(entry.amount), 0)
  );

  const statementHashes = new Set(statementEntries.map((entry) => entry.sourceRowHash));
  const importHashes = new Set(importEntries.map((entry) => entry.sourceRowHash));

  let rowsInImportNotInStatement = 0;
  importHashes.forEach((hash) => {
    if (!statementHashes.has(hash)) rowsInImportNotInStatement += 1;
  });

  let rowsInStatementNotInImport = 0;
  statementHashes.forEach((hash) => {
    if (!importHashes.has(hash)) rowsInStatementNotInImport += 1;
  });

  return {
    statementId: statement.id,
    sourceCsvRows: importEntries.length,
    importedEntries: importEntries.length,
    statementItems: statementEntries.length,
    ignoredRows,
    needsReviewRows,
    purchasesTotal,
    refundsTotal,
    feesTotal,
    interestTotal,
    paymentsFromNextInvoice: round2(statement.totalPayments),
    statementTotal: round2(statement.statementTotal),
    openBalance: round2(statement.openBalance),
    unclassifiedPositiveEntries,
    rowsInImportNotInStatement,
    rowsInStatementNotInImport,
    duplicateSourceHashes,
    crossCardContaminationRisk: false,
  };
};

