import { supabase } from '../supabaseClient';
import type { CompetenceHistoryCard } from './creditCardRebuildFromImportHistoryService';
import { applySequentialCreditCarryForward } from './creditCardRebuildFromImportHistoryService';

const STORAGE_KEY = 'finelo_competence_payment_confirmations_v1';
const MIGRATED_FLAG_KEY = 'finelo_competence_payment_confirmations_db_migrated_v1';
const TABLE = 'credit_card_competence_payment_confirmations';

export interface CompetencePaymentConfirmation {
  userId: string;
  accountId: string;
  referenceMonth: string;
  /** Saldo em aberto que o usuário confirmou como quitado no banco. */
  settledAmount: number;
  confirmedAt: string;
}

interface DbRow {
  user_id: string;
  account_id: string;
  reference_month: string;
  settled_amount: number | string;
  confirmed_at: string;
}

function rowToConfirmation(row: DbRow): CompetencePaymentConfirmation {
  return {
    userId: row.user_id,
    accountId: row.account_id,
    referenceMonth: row.reference_month,
    settledAmount: Number(row.settled_amount),
    confirmedAt: row.confirmed_at,
  };
}

function readLegacyLocal(): CompetencePaymentConfirmation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CompetencePaymentConfirmation[]) : [];
  } catch {
    return [];
  }
}

async function migrateLegacyLocalStorageIfNeeded(): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(MIGRATED_FLAG_KEY) === '1') return;

  const legacy = readLegacyLocal();
  if (legacy.length > 0) {
    for (const entry of legacy) {
      const { error } = await supabase.from(TABLE).upsert(
        {
          user_id: entry.userId,
          account_id: entry.accountId,
          reference_month: entry.referenceMonth.trim(),
          settled_amount: entry.settledAmount,
          confirmed_at: entry.confirmedAt,
        },
        { onConflict: 'user_id,account_id,reference_month' }
      );
      if (error) {
        console.warn('[competencePaymentConfirmations] Falha ao migrar legado:', error.message);
        return;
      }
    }
    localStorage.removeItem(STORAGE_KEY);
  }

  localStorage.setItem(MIGRATED_FLAG_KEY, '1');
}

export async function listCompetencePaymentConfirmations(
  userId: string,
  accountId: string
): Promise<CompetencePaymentConfirmation[]> {
  await migrateLegacyLocalStorageIfNeeded();

  const { data, error } = await supabase
    .from(TABLE)
    .select('user_id, account_id, reference_month, settled_amount, confirmed_at')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .order('reference_month', { ascending: true });

  if (error) {
    console.error('[competencePaymentConfirmations] list:', error.message);
    throw error;
  }

  return (data || []).map((row) => rowToConfirmation(row as DbRow));
}

export async function saveCompetencePaymentConfirmation(
  entry: CompetencePaymentConfirmation
): Promise<void> {
  const { error } = await supabase.from(TABLE).upsert(
    {
      user_id: entry.userId,
      account_id: entry.accountId,
      reference_month: entry.referenceMonth.trim(),
      settled_amount: entry.settledAmount,
      confirmed_at: entry.confirmedAt,
    },
    { onConflict: 'user_id,account_id,reference_month' }
  );

  if (error) {
    console.error('[competencePaymentConfirmations] save:', error.message);
    throw error;
  }
}

export async function removeCompetencePaymentConfirmation(
  userId: string,
  accountId: string,
  referenceMonth: string
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .eq('reference_month', referenceMonth.trim());

  if (error) {
    console.error('[competencePaymentConfirmations] remove:', error.message);
    throw error;
  }
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
