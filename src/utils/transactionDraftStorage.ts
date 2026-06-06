import type { CardManualEntryKind } from '../services/creditCardDirectedPayment';

export const TRANSACTION_DRAFT_STORAGE_KEY = 'finelo_new_transaction_draft_v1';

/** Rascunho válido por 4h (troca de app / recarga da PWA no celular). */
export const TRANSACTION_DRAFT_TTL_MS = 4 * 60 * 60 * 1000;

export interface NewTransactionDraft {
  savedAt: number;
  transaction: {
    Data: string;
    Data_Pagamento: string;
    ID_Conta: string;
    Nome_Fantasia: string;
    Categoria: string;
    Valor: string;
    Tipo: '' | 'Renda' | 'Despesa';
    Descricao_Original: string;
    linked_asset_id: string;
  };
  cardEntryKind: CardManualEntryKind | '';
  refundReferenceMonth: string;
  isRecurrent: boolean;
  recurrenceType: 'installments' | 'fixed';
  recurrenceCount: string;
}

function isExpired(savedAt: number): boolean {
  return Date.now() - savedAt > TRANSACTION_DRAFT_TTL_MS;
}

function parseDraft(raw: string | null): NewTransactionDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as NewTransactionDraft;
    if (!parsed?.savedAt || !parsed.transaction) return null;
    if (isExpired(parsed.savedAt)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveTransactionDraft(draft: Omit<NewTransactionDraft, 'savedAt'>): void {
  const payload: NewTransactionDraft = { ...draft, savedAt: Date.now() };
  const raw = JSON.stringify(payload);
  try {
    sessionStorage.setItem(TRANSACTION_DRAFT_STORAGE_KEY, raw);
  } catch {
    /* quota */
  }
  try {
    localStorage.setItem(TRANSACTION_DRAFT_STORAGE_KEY, raw);
  } catch {
    /* quota */
  }
}

export function loadTransactionDraft(): NewTransactionDraft | null {
  try {
    const fromSession = parseDraft(sessionStorage.getItem(TRANSACTION_DRAFT_STORAGE_KEY));
    if (fromSession) return fromSession;
  } catch {
    /* ignore */
  }
  try {
    return parseDraft(localStorage.getItem(TRANSACTION_DRAFT_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearTransactionDraft(): void {
  try {
    sessionStorage.removeItem(TRANSACTION_DRAFT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(TRANSACTION_DRAFT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
