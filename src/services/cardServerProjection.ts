import type { Account, ImportLog, Transaction } from '../types.ts';
import { creditCardRebuildFromImportHistoryService } from './creditCardRebuildFromImportHistoryService.ts';
import { projectCardTwoLedger, type CardTwoLedgerProjection } from '../domain/credit-card/twoLedgerProjection.ts';
import {
  activeResolutionsByMonth,
  paymentConfirmationInputsFromRows,
  type PaymentConfirmationRow,
  type ResolutionRow,
} from '../domain/credit-card/reconciliationRows.ts';

/**
 * A projeção que a Edge function `card-reconciliation` grava no snapshot,
 * a partir das linhas cruas do banco.
 *
 * Mora fora de `supabase/functions/.../index.ts` porque o entrypoint executa
 * `Deno.serve` na importação e não pode ser carregado por um teste. Assim a
 * paridade com o card, o histórico e o patrimônio é demonstrada contra o
 * código que o servidor realmente roda, não contra uma cópia.
 *
 * Devolve `null` quando a conta não está entre as linhas lidas.
 */
export function projectCardAccountFromRows(input: {
  accountId: string;
  contas: ReadonlyArray<Record<string, unknown>>;
  transactions: ReadonlyArray<Record<string, unknown>>;
  importLogs: ReadonlyArray<Record<string, unknown>>;
  confirmacoes: ReadonlyArray<PaymentConfirmationRow>;
  resolucoes: ReadonlyArray<ResolutionRow>;
  asOf: string;
}): CardTwoLedgerProjection | null {
  const account = input.contas.find((c) => c.id === input.accountId);
  if (!account) return null;

  const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
    accountId: input.accountId,
    account: account as unknown as Account,
    accounts: input.contas as unknown as Account[],
    transactions: input.transactions as unknown as Transaction[],
    importLogs: input.importLogs as unknown as ImportLog[],
    userPaymentConfirmations: paymentConfirmationInputsFromRows(input.confirmacoes),
  });

  return projectCardTwoLedger(cards, {
    asOf: input.asOf,
    resolutionsByMonth: activeResolutionsByMonth(input.resolucoes),
  });
}
