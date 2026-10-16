/**
 * Read-only replay of an explicitly supplied SELECT snapshot. No API clients,
 * database calls, persistence services or changes to financial data.
 * Run with: vite-node scripts/diagnostics/replay-card-net-worth.ts <temporary.json>
 * Raw customer snapshots must stay outside the repository.
 */
import { readFileSync } from 'node:fs';
import { creditCardRebuildFromImportHistoryService } from '../../src/services/creditCardRebuildFromImportHistoryService';
import { projectCardTwoLedger } from '../../src/domain/credit-card/twoLedgerProjection';
import { computeAccountCardDisplay } from '../../src/components/transactions/accountBalanceCardMetrics';
import { computeAccountBalanceAsOf } from '../../src/utils/dashboardNetWorth';

const filename = process.argv[2];
if (!filename) throw new Error('Supply a temporary read-only snapshot JSON path.');
const snapshot = JSON.parse(readFileSync(filename, 'utf8'));
const asOf = snapshot.captured_at.slice(0, 10);
const accounts = snapshot.accounts;
const creditCards = accounts.filter((a: any) => a.Tipo_Conta === 'Cartão de Crédito');
if (creditCards.length !== 1) throw new Error('This diagnostic replay requires exactly one credit card.');
const account = creditCards[0];
const transactions = snapshot.transactions;
if (transactions.some((t: any) => t.ID_Conta !== account.id)) throw new Error('Supply only movements of the selected card.');
const importLogs = snapshot.importLogs;
const defaults = {
  paymentKeywords: ['pagamentos válidos normais', 'pagamentos validos normais', 'pagamentos válidos', 'pagamentos validos', 'pagamento de fatura', 'pagto de fatura'],
  refundKeywords: ['estorno', 'reembolso', 'devolu', 'cancelamento', 'ajuste positivo'],
};
const keywordList = (input: unknown, fallback: string[]) => {
  const values = Array.isArray(input) ? input.filter((v) => typeof v === 'string').map((v: string) => v.trim()).filter(Boolean) : [];
  return values.length ? values : fallback;
};
const rules = {
  paymentKeywords: keywordList(snapshot.rulesMetadata?.paymentKeywords, defaults.paymentKeywords),
  refundKeywords: keywordList(snapshot.rulesMetadata?.refundKeywords, defaults.refundKeywords),
};
const resolutionsByMonth: Record<string, any[]> = {};
for (const r of snapshot.resolutions) (resolutionsByMonth[r.referenceMonth] ??= []).push(r);
const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
  accountId: account.id, account, accounts, transactions, importLogs,
  rules, userPaymentConfirmations: snapshot.confirmations,
});
const projection = projectCardTwoLedger(cards, { asOf, resolutionsByMonth });
const display = computeAccountCardDisplay(account, {
  transactions, accounts, importLogs, rules,
  userPaymentConfirmations: snapshot.confirmations,
  reconciliationResolutions: resolutionsByMonth,
  reconciliationSurfaceEnabled: true,
  cardV2Enabled: true, cardEngineEnabled: true, cardSnapshotPipelineEnabled: true,
});
const monetary = (cents: number) => cents / 100;
console.log(JSON.stringify({
  capturedAt: snapshot.captured_at, asOf,
  inputCounts: { accounts: accounts.length, cardTransactions: transactions.length, cardMovementsAuthoredByAnotherOwner: transactions.filter((t: any) => t.user_id !== account.user_id).length, importLogs: importLogs.length, confirmations: snapshot.confirmations.length, activeResolutions: snapshot.resolutions.length },
  legacyCardBalance: computeAccountBalanceAsOf(account, transactions, new Date(`${asOf}T12:00:00`)),
  display: { selectedInvoice: display.faturaAtual, dueDate: display.faturaDueDateIso, reconciliationBalance: display.reconciliacaoSaldo },
  totalEconomicObligations: monetary(projection.economicUsedCents),
  economicCredit: monetary(projection.economicCarryCents),
  reconciliationBalance: monetary(projection.suspenseBalanceCents),
  overdue: monetary(projection.competences.filter((c) => c.economicStatus === 'overdue').reduce((s, c) => s + c.economicOpenBalanceCents, 0)),
  notYetDue: monetary(projection.competences.filter((c) => c.economicStatus === 'open').reduce((s, c) => s + c.economicOpenBalanceCents, 0)),
  competences: projection.competences.map((c) => ({
    referenceMonth: c.referenceMonth, dueDate: c.dueDate,
    statementTotal: monetary(c.statementTotalCents), payments: monetary(c.recognizedPaymentsCents),
    open: monetary(c.economicOpenBalanceCents), status: c.economicStatus,
    reconciliationDelta: monetary(c.unresolvedReconciliationDeltaCents),
  })),
}, null, 2));
