import type { CardManualEntryKind } from '../services/creditCardDirectedPayment';

export const TRANSACTION_DRAFT_STORAGE_KEY = 'finelo_new_transaction_draft_v1';

/**
 * O rascunho pertence a UM usuário: a chave leva o id da conta. Sem usuário identificado nada é lido nem
 * gravado. A chave antiga (sem id) não dá para atribuir a ninguém; é apagada e nunca carregada.
 */
export const transactionDraftKey = (userId: string) => `${TRANSACTION_DRAFT_STORAGE_KEY}:${userId}`;

function removeLegacyDraft(): void {
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

export function saveTransactionDraft(
  userId: string | null | undefined,
  draft: Omit<NewTransactionDraft, 'savedAt'>
): void {
  if (!userId) return;
  const key = transactionDraftKey(userId);
  const payload: NewTransactionDraft = { ...draft, savedAt: Date.now() };
  const raw = JSON.stringify(payload);
  try {
    sessionStorage.setItem(key, raw);
  } catch {
    /* quota */
  }
  try {
    localStorage.setItem(key, raw);
  } catch {
    /* quota */
  }
}

export function loadTransactionDraft(userId: string | null | undefined): NewTransactionDraft | null {
  removeLegacyDraft();
  if (!userId) return null;
  const key = transactionDraftKey(userId);
  try {
    const fromSession = parseDraft(sessionStorage.getItem(key));
    if (fromSession) return fromSession;
  } catch {
    /* ignore */
  }
  try {
    return parseDraft(localStorage.getItem(key));
  } catch {
    return null;
  }
}

export function clearTransactionDraft(userId: string | null | undefined): void {
  removeLegacyDraft();
  if (!userId) return;
  const key = transactionDraftKey(userId);
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
