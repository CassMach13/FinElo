import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  clearTransactionDraft,
  loadTransactionDraft,
  saveTransactionDraft,
  TRANSACTION_DRAFT_STORAGE_KEY,
  TRANSACTION_DRAFT_TTL_MS,
  transactionDraftKey,
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
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map<string, string>();
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
    saveTransactionDraft('user-A', baseDraft);
    const loaded = loadTransactionDraft('user-A');
    expect(loaded?.transaction.Nome_Fantasia).toBe('Padaria');
    expect(loaded?.transaction.Valor).toBe('42.50');
  });

  it('descarta rascunho expirado', () => {
    vi.useFakeTimers();
    saveTransactionDraft('user-A', baseDraft);
    vi.advanceTimersByTime(TRANSACTION_DRAFT_TTL_MS + 1);
    expect(loadTransactionDraft('user-A')).toBeNull();
    vi.useRealTimers();
  });

  it('clear remove o rascunho', () => {
    saveTransactionDraft('user-A', baseDraft);
    clearTransactionDraft('user-A');
    expect(sessionStorage.getItem(transactionDraftKey('user-A'))).toBeNull();
    expect(localStorage.getItem(transactionDraftKey('user-A'))).toBeNull();
    expect(loadTransactionDraft('user-A')).toBeNull();
  });

  describe('troca de conta no mesmo navegador', () => {
    it('o rascunho da conta A não aparece para a conta B (nem o de B para A)', () => {
      saveTransactionDraft('user-A', baseDraft);
      expect(loadTransactionDraft('user-B')).toBeNull();
      saveTransactionDraft('user-B', { ...baseDraft, transaction: { ...baseDraft.transaction, Nome_Fantasia: 'Farmácia' } });
      expect(loadTransactionDraft('user-A')?.transaction.Nome_Fantasia).toBe('Padaria');
      expect(loadTransactionDraft('user-B')?.transaction.Nome_Fantasia).toBe('Farmácia');
    });

    it('limpar o rascunho de A não apaga o de B', () => {
      saveTransactionDraft('user-A', baseDraft);
      saveTransactionDraft('user-B', baseDraft);
      clearTransactionDraft('user-A');
      expect(loadTransactionDraft('user-A')).toBeNull();
      expect(loadTransactionDraft('user-B')).not.toBeNull();
    });

    it('sem usuário identificado: nada é gravado nem lido', () => {
      saveTransactionDraft(undefined, baseDraft);
      saveTransactionDraft(null, baseDraft);
      expect(store.size).toBe(0);
      expect(loadTransactionDraft(undefined)).toBeNull();
    });

    it('o rascunho antigo (chave sem id de usuário) nunca é carregado e é apagado', () => {
      const legacy = JSON.stringify({ ...baseDraft, savedAt: Date.now() });
      store.set(`s:${TRANSACTION_DRAFT_STORAGE_KEY}`, legacy);
      store.set(`l:${TRANSACTION_DRAFT_STORAGE_KEY}`, legacy);
      expect(loadTransactionDraft('user-B')).toBeNull();
      expect(store.has(`s:${TRANSACTION_DRAFT_STORAGE_KEY}`)).toBe(false);
      expect(store.has(`l:${TRANSACTION_DRAFT_STORAGE_KEY}`)).toBe(false);
    });
  });
});
