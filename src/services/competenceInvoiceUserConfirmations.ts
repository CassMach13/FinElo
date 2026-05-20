import type { CompetenceHistoryCard } from './creditCardRebuildFromImportHistoryService';
import { applySequentialCreditCarryForward } from './creditCardRebuildFromImportHistoryService';

const STORAGE_KEY = 'finelo_competence_payment_confirmations_v1';

export interface CompetencePaymentConfirmation {
  userId: string;
  accountId: string;
  referenceMonth: string;
  /** Saldo em aberto que o usuário confirmou como quitado no banco. */
  settledAmount: number;
  confirmedAt: string;
}

function readAll(): CompetencePaymentConfirmation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CompetencePaymentConfirmation[]) : [];
  } catch {
    return [];
  }
}

function writeAll(rows: CompetencePaymentConfirmation[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

export function listCompetencePaymentConfirmations(
  userId: string,
  accountId: string
): CompetencePaymentConfirmation[] {
  return readAll().filter((r) => r.userId === userId && r.accountId === accountId);
}

export function saveCompetencePaymentConfirmation(entry: CompetencePaymentConfirmation): void {
  const all = readAll().filter(
    (r) =>
      !(
        r.userId === entry.userId &&
        r.accountId === entry.accountId &&
        r.referenceMonth === entry.referenceMonth
      )
  );
  all.push(entry);
  writeAll(all);
}

export function removeCompetencePaymentConfirmation(
  userId: string,
  accountId: string,
  referenceMonth: string
): void {
  const all = readAll().filter(
    (r) =>
      !(
        r.userId === userId &&
        r.accountId === accountId &&
        r.referenceMonth === referenceMonth
      )
  );
  writeAll(all);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Aplica confirmações do usuário (saldo residual quitado no banco) e recalcula crédito em cascata.
 * Deve ser chamado sobre cards recém-calculados, antes de exibir.
 */
export function applyCompetenceUserPaymentConfirmations(
  cards: CompetenceHistoryCard[],
  confirmations: CompetencePaymentConfirmation[]
): CompetenceHistoryCard[] {
  if (confirmations.length === 0) return cards;

  const byRef = new Map(confirmations.map((c) => [c.referenceMonth.trim(), c]));

  const adjusted = cards.map((card) => {
    const conf = byRef.get(card.referenceMonth.trim());
    if (!conf || conf.settledAmount < 0.005) {
      return { ...card, files: [...card.files] };
    }
    return {
      ...card,
      files: [...card.files],
      userConfirmedPaid: true,
      userConfirmedAt: conf.confirmedAt,
      userConfirmedAmount: round2(conf.settledAmount),
      totalPayments: round2(card.totalPayments + conf.settledAmount),
    };
  });

  applySequentialCreditCarryForward(adjusted);
  return adjusted;
}
