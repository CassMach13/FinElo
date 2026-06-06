import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  clearTransactionDraft,
  loadTransactionDraft,
  saveTransactionDraft,
  TRANSACTION_DRAFT_STORAGE_KEY,
  TRANSACTION_DRAFT_TTL_MS,
} from '../src/utils/transactionDraftStorage';

const baseDraft = {
  transaction: {
    Data: '2026-05-10',
    Data_Pagamento: '2026-05-10',
    ID_Conta: 'acc-1',
    Nome_Fantasia: 'Padaria',
    Categoria: 'Alimentação',
    Valor: '42.50',
    Tipo: 'Despesa' as const,
    Descricao_Original: 'Lançamento Manual',
    linked_asset_id: '',
  },
  cardEntryKind: '' as const,
  refundReferenceMonth: '',
  isRecurrent: false,
  recurrenceType: 'installments' as const,
  recurrenceCount: '2',
};

describe('transactionDraftStorage', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(`s:${k}`) ?? null,
      setItem: (k: string, v: string) => store.set(`s:${k}`, v),
      removeItem: (k: string) => store.delete(`s:${k}`),
    });
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(`l:${k}`) ?? null,
      setItem: (k: string, v: string) => store.set(`l:${k}`, v),
      removeItem: (k: string) => store.delete(`l:${k}`),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('salva e restaura rascunho', () => {
    saveTransactionDraft(baseDraft);
    const loaded = loadTransactionDraft();
    expect(loaded?.transaction.Nome_Fantasia).toBe('Padaria');
    expect(loaded?.transaction.Valor).toBe('42.50');
  });

  it('descarta rascunho expirado', () => {
    vi.useFakeTimers();
    saveTransactionDraft(baseDraft);
    vi.advanceTimersByTime(TRANSACTION_DRAFT_TTL_MS + 1);
    expect(loadTransactionDraft()).toBeNull();
    vi.useRealTimers();
  });

  it('clear remove o rascunho', () => {
    saveTransactionDraft(baseDraft);
    clearTransactionDraft();
    expect(sessionStorage.getItem(TRANSACTION_DRAFT_STORAGE_KEY)).toBeNull();
    expect(loadTransactionDraft()).toBeNull();
  });
});
