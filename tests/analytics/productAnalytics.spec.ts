import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  insert: vi.fn(),
  from: vi.fn(),
}));
vi.mock('../../src/supabaseClient', () => ({
  supabase: { auth: { getSession: mocks.getSession }, from: mocks.from },
}));

import {
  PRODUCT_MILESTONES,
  resetProductAnalyticsForTests,
  sanitizeProperties,
  trackAppSessionStarted,
  trackOpenFinanceCompleted,
  trackProductEvent,
  trackProductMilestone,
  type ProductEventName,
} from '../../src/services/productAnalytics';

const withSession = (id: string | null = 'user-1') =>
  mocks.getSession.mockResolvedValue({ data: { session: id ? { user: { id } } : null } });

const sessionStore = new Map<string, string>();

beforeEach(() => {
  vi.clearAllMocks();
  resetProductAnalyticsForTests();
  sessionStore.clear();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => sessionStore.get(k) ?? null,
    setItem: (k: string, v: string) => void sessionStore.set(k, v),
  });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.from.mockImplementation((table: string) => {
    expect(table).toBe('product_events');
    return { insert: mocks.insert };
  });
  withSession();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('payload', () => {
  it('envia só user_id, nome, dedupe e propriedades — nunca occurred_at (o horário é do banco)', async () => {
    await trackProductEvent('import_failed', { stage: 'parse' });

    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      event_name: 'import_failed',
      dedupe_key: null,
      properties: { stage: 'parse' },
    });
    expect(Object.keys(mocks.insert.mock.calls[0][0])).not.toContain('occurred_at');
  });

  it('evento sem propriedades vai com objeto vazio', async () => {
    await trackProductEvent('import_started');
    expect(mocks.insert.mock.calls[0][0].properties).toEqual({});
  });

  it('o user_id sai da sessão e nunca entra em properties', async () => {
    await trackProductEvent('account_created');
    const sent = mocks.insert.mock.calls[0][0];
    expect(sent.user_id).toBe('user-1');
    expect(JSON.stringify(sent.properties)).not.toContain('user-1');
  });

  it('milestone usa a chave de dedupe fixa', async () => {
    await trackProductMilestone('first_dashboard_with_real_data');
    expect(mocks.insert.mock.calls[0][0].dedupe_key).toBe('first-dashboard-with-real-data');
    expect(PRODUCT_MILESTONES.onboarding_viewed).toBe('onboarding-v1-first-view');
  });
});

describe('privacidade por construção', () => {
  const hostil = {
    stage: 'parse',
    version: 1,
    filename: 'extrato-itau.csv',
    bank: 'Itaú',
    amount: 1234.56,
    email: 'a@b.com',
    message: 'ENOENT /Users/fulano/arquivo.csv',
    description: 'PIX MERCADO',
    account: 'conta-1',
    user_id: 'user-1',
  };

  it('só as chaves permitidas de cada evento saem, com valores permitidos', () => {
    expect(sanitizeProperties('import_failed', hostil)).toEqual({ stage: 'parse' });
    expect(sanitizeProperties('onboarding_viewed', hostil)).toEqual({ version: 1 });
    expect(sanitizeProperties('onboarding_dismissed', hostil)).toEqual({ version: 1 });
    expect(sanitizeProperties('onboarding_resumed', hostil)).toEqual({ version: 1 });
  });

  it('eventos sem propriedades descartam tudo', () => {
    const semPropriedades: ProductEventName[] = [
      'app_session_started',
      'account_created',
      'import_started',
      'import_completed',
      'manual_transaction_created',
      'open_finance_started',
      'open_finance_completed',
      'first_dashboard_with_real_data',
    ];
    for (const nome of semPropriedades) expect(sanitizeProperties(nome, hostil), nome).toEqual({});
  });

  it('valor fora da lista é descartado (mensagem bruta de erro não vira stage)', () => {
    expect(sanitizeProperties('import_failed', { stage: 'ENOENT: arquivo.csv' })).toEqual({});
    expect(sanitizeProperties('import_failed', { stage: 'quota' })).toEqual({ stage: 'quota' });
    expect(sanitizeProperties('onboarding_viewed', { version: 2 })).toEqual({});
  });

  it('o que sai do navegador nunca contém dado hostil, mesmo se um chamador tentar enviar', async () => {
    await trackProductEvent('import_failed', hostil as never);
    const enviado = JSON.stringify(mocks.insert.mock.calls[0][0]);
    for (const proibido of ['extrato-itau', 'Itaú', '1234.56', 'a@b.com', 'ENOENT', 'PIX MERCADO', 'conta-1']) {
      expect(enviado, proibido).not.toContain(proibido);
    }
  });
});

describe('falha nunca atrapalha o produto', () => {
  it('sem usuário autenticado é no-op', async () => {
    withSession(null);
    await expect(trackProductEvent('import_started')).resolves.toBeUndefined();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('erro do banco não propaga', async () => {
    mocks.insert.mockResolvedValue({ error: { code: '42501', message: 'permission denied' } });
    await expect(trackProductEvent('import_started')).resolves.toBeUndefined();
  });

  it('exceção ao inserir ou ao ler a sessão não propaga', async () => {
    mocks.insert.mockRejectedValue(new Error('rede'));
    await expect(trackProductEvent('import_started')).resolves.toBeUndefined();
    mocks.getSession.mockRejectedValue(new Error('sessão'));
    await expect(trackProductEvent('import_started')).resolves.toBeUndefined();
  });

  it('milestone duplicado (23505) é sucesso silencioso', async () => {
    mocks.insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    await expect(trackProductMilestone('first_dashboard_with_real_data')).resolves.toBeUndefined();
    expect(console.debug).not.toHaveBeenCalled();
  });

  it('o mesmo milestone não volta ao banco na mesma aba', async () => {
    await trackProductMilestone('onboarding_viewed', { version: 1 });
    await trackProductMilestone('onboarding_viewed', { version: 1 });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it('evento repetível pode ser registrado várias vezes', async () => {
    await trackProductEvent('manual_transaction_created');
    await trackProductEvent('manual_transaction_created');
    expect(mocks.insert).toHaveBeenCalledTimes(2);
  });
});

describe('app_session_started', () => {
  it('uma vez por sessão do navegador', async () => {
    await trackAppSessionStarted();
    await trackAppSessionStarted();
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.insert.mock.calls[0][0]).toMatchObject({ event_name: 'app_session_started', dedupe_key: null });
  });

  it('nova sessão (storage limpo) registra de novo: é o sinal de retorno', async () => {
    await trackAppSessionStarted();
    sessionStore.clear();
    await trackAppSessionStarted();
    expect(mocks.insert).toHaveBeenCalledTimes(2);
  });
});

describe('app_session_started — a marca só é consumida com usuário autenticado', () => {
  it('sem sessão nada é consumido: a próxima tentativa, já autenticada, registra', async () => {
    withSession(null);
    await trackAppSessionStarted();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(sessionStore.size).toBe(0);

    withSession('user-1');
    await trackAppSessionStarted();
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it('chamadas simultâneas registram uma vez só', async () => {
    await Promise.all([trackAppSessionStarted(), trackAppSessionStarted(), trackAppSessionStarted()]);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });
});

describe('open_finance_completed — só com transação nova persistida', () => {
  it('A. inserted > 0 dispara, sem properties', async () => {
    await trackOpenFinanceCompleted({ inserted: 5, merged: 2 });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      event_name: 'open_finance_completed',
      dedupe_key: null,
      properties: {},
    });
  });

  it('B. só merged (lançamento manual que já existia) não dispara', async () => {
    await trackOpenFinanceCompleted({ inserted: 0, merged: 3 });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('C. nada inserido nem mesclado não dispara', async () => {
    await trackOpenFinanceCompleted({ inserted: 0, merged: 0 });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('D. falha do analytics não derruba a sincronização', async () => {
    mocks.insert.mockRejectedValue(new Error('rede'));
    await expect(trackOpenFinanceCompleted({ inserted: 1, merged: 0 })).resolves.toBeUndefined();
    mocks.getSession.mockRejectedValue(new Error('sessão'));
    await expect(trackOpenFinanceCompleted({ inserted: 1, merged: 0 })).resolves.toBeUndefined();
  });
});
