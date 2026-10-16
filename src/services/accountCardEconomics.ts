import type { Account, ImportLog, Transaction } from '../types';
import type { ClassificationRules } from '../domain/credit-card/classifiers';
import type { ReconciliationResolutionInput } from '../domain/credit-card/twoLedgerBalance';
import { projectCardTwoLedger, type CardTwoLedgerProjection } from '../domain/credit-card/twoLedgerProjection';
import { creditCardRebuildFromImportHistoryService } from './creditCardRebuildFromImportHistoryService';
import { parseDirectedCompetenceFromPayment } from './creditCardDirectedPayment';
import { comparableImportOriginKey } from '../utils/importOriginKey';
import { toDateOnlyIso } from '../utils/dateOnly';

export interface CardEconomicAmounts {
  totalRecognizedCents: number;
  overdueUnpaidCents: number;
  upcomingCents: number;
  provenCreditCents: number;
}
export type CardCoverageIssue = 'no_competences' | 'invalid_fact' | 'duplicate_fact'
  | 'unassigned_import' | 'future_settlement' | 'unverified_future_purchase';
export interface AccountCardEconomics {
  accountId: string;
  accountName: string;
  asOf: string;
  completeness: 'complete' | 'partial' | 'unavailable';
  issues: CardCoverageIssue[];
  amounts: CardEconomicAmounts | null;
  projection: CardTwoLedgerProjection;
  origin: {
    engine: 'twoLedgerProjection';
    basis: 'registered_facts';
    transactions: number;
    manualTransactions: number;
    competences: number;
    confirmations: number;
    resolutions: number;
  };
}
export interface AccountCardEconomicsInput {
  account: Account;
  accounts: Account[];
  transactions: Transaction[];
  importLogs: ImportLog[];
  rules?: ClassificationRules;
  userPaymentConfirmations?: Array<{ referenceMonth: string; settledAmount: number; confirmedAt: string }>;
  reconciliationResolutions?: Record<string, ReconciliationResolutionInput[]>;
  /** Current civil date only; this adapter does NOT reconstruct history. */
  asOf: string;
}

/** One shared route to the existing canonical engine. No alternative invoice arithmetic. */
export function projectAccountCardEconomics(input: AccountCardEconomicsInput): AccountCardEconomics {
  const { account, accounts, transactions, importLogs, rules, asOf,
    userPaymentConfirmations = [], reconciliationResolutions = {} } = input;
  if (account.Tipo_Conta !== 'Cartão de Crédito') throw new Error('Expected a credit-card account.');
  const facts = transactions.filter((t) => t.ID_Conta === account.id);
  const issues = new Set<CardCoverageIssue>();
  const ids = new Set<string>();
  for (const t of facts) {
    if (!Number.isFinite(t.Valor) || !toDateOnlyIso(t.Data)) issues.add('invalid_fact');
    if (t.ID_Transacao && ids.has(t.ID_Transacao)) issues.add('duplicate_fact');
    if (t.ID_Transacao) ids.add(t.ID_Transacao);
    if (toDateOnlyIso(t.Data) > asOf) {
      // Future installment commitments are already represented by the canonical ledger.
      // Future settlements / unproven scheduled purchases cannot support an actual current position.
      if (t.Valor > 0) issues.add('future_settlement');
      else if (!(t.Total_Parcelas > 1 && t.Parcela_Atual >= 1)) issues.add('unverified_future_purchase');
    }
  }
  if (userPaymentConfirmations.some((c) => !Number.isFinite(c.settledAmount) || c.settledAmount < 0 || !toDateOnlyIso(c.confirmedAt))) {
    issues.add('invalid_fact');
  }
  if (userPaymentConfirmations.some((c) => toDateOnlyIso(c.confirmedAt) > asOf)) issues.add('future_settlement');
  for (const r of Object.values(reconciliationResolutions).flat()) {
    if ((r.resolvedAmountCents != null && !Number.isSafeInteger(r.resolvedAmountCents))
      || (r.authoritativeStatementTotalCents != null && !Number.isSafeInteger(r.authoritativeStatementTotalCents))) issues.add('invalid_fact');
  }
  const accountLogs = importLogs.filter((log) => {
    const rows = Array.isArray(log.imported_details) ? log.imported_details : [];
    const explicitAccounts = rows.map((row) => row?.ID_Conta).filter(Boolean);
    return !explicitAccounts.length || explicitAccounts.includes(account.id);
  });
  const cards = issues.has('invalid_fact') ? [] : creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
    accountId: account.id, account, accounts, transactions, importLogs: accountLogs, rules, userPaymentConfirmations,
  });
  const origins = new Set(cards.flatMap((c) => c.files.map((f) => comparableImportOriginKey(f.fileName))));
  for (const t of facts) {
    if (t.Origem && t.Origem.trim().toLowerCase() !== 'manual' && !parseDirectedCompetenceFromPayment(t)
      && !origins.has(comparableImportOriginKey(t.Origem))) issues.add('unassigned_import');
  }
  if (!cards.length) issues.add('no_competences');
  const projection = projectCardTwoLedger(cards, { asOf, resolutionsByMonth: reconciliationResolutions });
  const complete = issues.size === 0;
  return {
    accountId: account.id, accountName: account.Nome_Conta, asOf,
    completeness: complete ? 'complete' : cards.length ? 'partial' : 'unavailable',
    issues: [...issues],
    amounts: complete ? {
      totalRecognizedCents: projection.economicUsedCents,
      overdueUnpaidCents: projection.competences.filter((c) => c.economicStatus === 'overdue')
        .reduce((sum, c) => sum + c.economicOpenBalanceCents, 0),
      upcomingCents: projection.competences.filter((c) => c.economicStatus === 'open')
        .reduce((sum, c) => sum + c.economicOpenBalanceCents, 0),
      provenCreditCents: projection.economicCarryCents,
    } : null,
    projection,
    origin: {
      engine: 'twoLedgerProjection', basis: 'registered_facts', transactions: facts.length,
      manualTransactions: facts.filter((t) => !t.Origem || t.Origem.trim().toLowerCase() === 'manual').length,
      competences: cards.length, confirmations: userPaymentConfirmations.length,
      resolutions: Object.values(reconciliationResolutions).reduce((sum, rows) => sum + rows.length, 0),
    },
  };
}

export const DEFAULT_CARD_PAYMENT_KEYWORDS = ['pagamentos válidos normais', 'pagamentos validos normais', 'pagamentos válidos', 'pagamentos validos', 'pagamento de fatura', 'pagto de fatura'];
export const DEFAULT_CARD_CREDIT_KEYWORDS = ['estorno', 'reembolso', 'devolu', 'cancelamento', 'ajuste positivo'];
export function cardClassificationRulesFromMetadata(metadata: Record<string, unknown>): ClassificationRules {
  const list = (value: unknown, fallback: string[]) => {
    const values = Array.isArray(value) ? value.filter((v) => typeof v === 'string').map((v: string) => v.trim()).filter(Boolean) : [];
    return values.length ? values : fallback;
  };
  return { paymentKeywords: list(metadata.cardPaymentKeywords, DEFAULT_CARD_PAYMENT_KEYWORDS),
    refundKeywords: list(metadata.cardCreditKeywords, DEFAULT_CARD_CREDIT_KEYWORDS) };
}
