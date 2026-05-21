import type { ClassificationRules } from '../domain/credit-card/classifiers';
import { Account, ImportLog, Transaction, User } from '../types';
import { isCardV2Enabled, isCardV2ShadowEnabled, isCreditCardEngineEnabled } from './featureFlagService';
import { creditCardEngineService } from './creditCardEngineService';
import {
  creditCardRebuildFromImportHistoryService,
  type CompetenceHistoryCard,
} from './creditCardRebuildFromImportHistoryService';
import {
  pickCurrentCompetenceCard,
  referenceMonthFromTransaction,
} from './creditCardManualCompetence';
import {
  creditCardStatementService,
  type CardClassifierRules,
} from './creditCardStatementService';

export const MANUAL_MOTOR_ORIGIN_PREFIX = 'manual:';

export function manualMotorOriginKey(referenceMonth: string): string {
  return `${MANUAL_MOTOR_ORIGIN_PREFIX}${referenceMonth.trim()}`;
}

export function isManualMotorOrigin(origin: string): boolean {
  return origin.startsWith(MANUAL_MOTOR_ORIGIN_PREFIX);
}

const REF_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function collectManualReferenceMonths(
  transactions: Transaction[],
  account: Account,
  accountId: string
): string[] {
  const refs = new Set<string>();
  transactions.forEach((t) => {
    if (t.ID_Conta !== accountId) return;
    if (String(t.Origem || 'manual').trim().toLowerCase() !== 'manual') return;
    const ref = referenceMonthFromTransaction(t, account).trim();
    if (REF_MONTH_RE.test(ref)) refs.add(ref);
  });
  return [...refs];
}

function competenceCardForRef(
  cards: CompetenceHistoryCard[],
  ref: string
): CompetenceHistoryCard | undefined {
  return cards.find((c) => c.referenceMonth.trim() === ref.trim());
}

/**
 * Sincroniza lançamentos manuais no motor (lote `manual:AAAA-MM` por competência).
 * Não altera lotes de CSV; mescla entradas na mesma statement quando a competência coincide.
 */
export async function syncManualCreditCardAccount(opts: {
  getState: () => { transactions: Transaction[]; accounts: Account[]; importLogs: ImportLog[] };
  user: User;
  accountId: string;
  /** Competências a reprocessar; se vazio, deriva dos manuais atuais + extras (ex. ref após exclusão). */
  referenceMonths?: string[];
  /** Refs que podem não ter mais transações (ex. após delete). */
  extraReferenceMonths?: string[];
  rules?: ClassificationRules;
  classifierRules?: CardClassifierRules;
}): Promise<void> {
  const { transactions, accounts, importLogs } = opts.getState();
  const account = accounts.find((a) => a.id === opts.accountId);
  if (!account || account.Tipo_Conta !== 'Cartão de Crédito') return;

  const manualTx = transactions.filter(
    (t) =>
      t.ID_Conta === opts.accountId &&
      String(t.Origem || 'manual').trim().toLowerCase() === 'manual'
  );

  const refSet = new Set<string>([
    ...collectManualReferenceMonths(transactions, account, opts.accountId),
    ...(opts.referenceMonths || []).filter((r) => REF_MONTH_RE.test(r.trim())),
    ...(opts.extraReferenceMonths || []).filter((r) => REF_MONTH_RE.test(r.trim())),
  ]);

  if (refSet.size === 0) return;

  const competenceCards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
    accountId: opts.accountId,
    account,
    accounts,
    transactions,
    importLogs,
    rules: opts.rules,
  });

  const card = await creditCardEngineService.ensureCreditCardForAccount(opts.user.id, account);
  let engineTouched = false;

  for (const ref of refSet) {
    const origin = manualMotorOriginKey(ref);
    const txsForRef = manualTx.filter(
      (t) => referenceMonthFromTransaction(t, account).trim() === ref
    );
    const competence = competenceCardForRef(competenceCards, ref);
    const dueYear = competence?.dueYear;
    const dueMonth = competence?.dueMonth;
    const dueDate = competence?.dueDate;

    try {
      if (isCreditCardEngineEnabled(opts.user)) {
        if (txsForRef.length === 0) {
          await creditCardEngineService.removeOriginFromEngine({
            accountId: account.id,
            origin,
          });
          engineTouched = true;
        } else if (dueYear && dueMonth && dueYear > 0 && dueMonth > 0) {
          await creditCardEngineService.reprocessImportOriginFromTransactions({
            userId: opts.user.id,
            account,
            origin,
            transactions: txsForRef,
            rules: opts.rules,
            dueYear,
            dueMonth,
            dueDate,
            skipRecalculateAllStatements: true,
          });
          engineTouched = true;
        }
      } else if (isCardV2ShadowEnabled(opts.user) || isCardV2Enabled(opts.user)) {
        if (txsForRef.length === 0) {
          await creditCardStatementService.removeOriginFromStatements({
            userId: opts.user.id,
            account,
            origin,
            deletedTransactions: [],
          });
        } else if (dueYear && dueMonth) {
          await creditCardStatementService.reprocessImportOrigin({
            userId: opts.user.id,
            account,
            origin,
            transactions: txsForRef,
            cardCycle: {
              referenceLabel: ref,
              dueDate,
            },
            classifierRules: opts.classifierRules,
          });
        }
      }
    } catch (err) {
      console.error('[CardV2][Manual] Falha ao sincronizar competência manual:', ref, err);
    }
  }

  if (isCreditCardEngineEnabled(opts.user) && engineTouched) {
    await creditCardEngineService.recalculateAllStatementsForCard(card.id);
  }
}

/** Dispara sync do motor sem bloquear a UI (salvar lançamento manual). */
export function scheduleManualCreditCardSync(opts: {
  getState: () => { transactions: Transaction[]; accounts: Account[]; importLogs: ImportLog[] };
  user: User;
  accountId: string;
  referenceMonths?: string[];
  extraReferenceMonths?: string[];
  rules?: ClassificationRules;
  classifierRules?: CardClassifierRules;
  onComplete?: () => void;
}): void {
  void (async () => {
    try {
      await syncManualCreditCardAccount(opts);
      opts.onComplete?.();
    } catch (err) {
      console.error('[CardV2][Manual] Falha no sync em background:', err);
    }
  })();
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Evita snapshot parcial do motor menor que o ledger (import + manual). CSV-only não altera. */
export function mergeMotorSnapshotWithManualLedger(params: {
  accountId: string;
  account: Account;
  accounts: Account[];
  transactions: Transaction[];
  importLogs: ImportLog[];
  rules?: ClassificationRules;
  userPaymentConfirmations?: Array<{
    referenceMonth: string;
    settledAmount: number;
    confirmedAt: string;
  }>;
  snapshot: { currentOpenAmount: number; hasData: boolean };
  todayIso?: string;
}): { currentOpenAmount: number; hasData: boolean } {
  const hasManual = params.transactions.some(
    (t) =>
      t.ID_Conta === params.accountId &&
      String(t.Origem || 'manual').trim().toLowerCase() === 'manual'
  );
  if (!hasManual) return params.snapshot;

  const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
    accountId: params.accountId,
    account: params.account,
    accounts: params.accounts,
    transactions: params.transactions,
    importLogs: params.importLogs,
    rules: params.rules,
    userPaymentConfirmations: params.userPaymentConfirmations,
  });
  const today = params.todayIso || new Date().toISOString().slice(0, 10);
  const current = pickCurrentCompetenceCard(cards, today);
  if (!current) return params.snapshot;

  const ledgerFatura = Math.max(current.openBalance, 0);
  const merged =
    ledgerFatura > 0.005
      ? Math.max(params.snapshot.currentOpenAmount, ledgerFatura)
      : Math.min(params.snapshot.currentOpenAmount, ledgerFatura);
  return {
    currentOpenAmount: round2(merged),
    hasData: params.snapshot.hasData || ledgerFatura > 0.005,
  };
}
