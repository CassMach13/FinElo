import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../src/types';

/**
 * Transporte sintético: o `from('transactions')` do Supabase é substituído por um objeto em memória.
 * Nenhuma escrita financeira real acontece. Exercita a ação REAL do store.
 */
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  alert: vi.fn(),
}));
vi.mock('../src/supabaseClient', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc, auth: { getUser: mocks.getUser } },
}));
vi.mock('../src/hooks/useDialogStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/hooks/useDialogStore')>()),
  appAlert: mocks.alert,
}));

import { useAppStore } from '../src/hooks/useAppStore';
import { buildManualEntryPayload } from '../src/domain/transactions/manualEntryPayload';
import { saveNewTransactions, classifyThrownSave, UNCERTAIN_MESSAGE } from '../src/utils/transactionSaveOutcome';

const userA = {
  id: 'user-A',
  user_metadata: { credit_card_engine_disabled: true, card_v2_disabled: true, card_v2_shadow_disabled: true },
  app_metadata: {},
};
const userB = { ...userA, id: 'user-B' };

type Reply = { data: unknown; error: unknown } | (() => Promise<{ data: unknown; error: unknown }>);

/** Registra cada chamada ao «banco» e responde com o que o teste mandar. */
function transport() {
  const log = { inserts: [] as unknown[][], updates: [] as { payload: unknown; id: unknown }[] };
  let insertReply: Reply = { data: [], error: null };
  let updateReply: Reply = { data: [], error: null };
  const settle = (reply: Reply) => (typeof reply === 'function' ? reply() : Promise.resolve(reply));
  mocks.from.mockImplementation((table: string) => {
    if (table !== 'transactions') throw new Error(`Tabela inesperada: ${table}`);
    return {
      insert: (payloads: unknown[]) => {
        log.inserts.push(payloads);
        return { select: () => settle(insertReply) };
      },
      update: (payload: unknown) => ({
        eq: (_col: string, id: unknown) => {
          log.updates.push({ payload, id });
          return { select: () => settle(updateReply) };
        },
      }),
    };
  });
  return {
    log,
    onInsert(reply: Reply) {
      insertReply = reply;
    },
    onUpdate(reply: Reply) {
      updateReply = reply;
    },
  };
}

const existing = (over: Partial<Transaction> = {}): Transaction =>
  ({
    ID_Transacao: 'tx-1',
    user_id: 'user-A',
    Origem: 'manual',
    Fonte: 'Manual',
    ID_Conta: 'acc-1',
    Data: new Date('2026-11-01'),
    Nome_Fantasia: 'Padaria',
    Descricao_Original: 'Padaria',
    Categoria: 'Alimentação',
    Tipo: 'Despesa',
    Valor: -42.5,
    ...over,
  }) as Transaction;

const manualInput = (over: Record<string, unknown> = {}) =>
  buildManualEntryPayload({
    Data: new Date('2026-11-10'),
    ID_Conta: 'acc-1',
    Data_Pagamento: new Date('2026-11-10'),
    Nome_Fantasia: 'Mercado',
    Categoria: 'Alimentação',
    Tipo: 'Despesa',
    Valor: -80,
    Parcela_Atual: null,
    Total_Parcelas: null,
    Fonte: 'Manual',
    Descricao_Original: 'Mercado',
    ...over,
  } as never);

const serverRow = (p: Record<string, unknown>, i: number) => ({ ...p, ID_Transacao: `srv-${i}`, user_id: 'user-A' });

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState(useAppStore.getInitialState(), true);
  mocks.getUser.mockResolvedValue({ data: { user: userA } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useAppStore.setState({ user: userA, transactions: [existing()], accounts: [], assets: [] } as never);
});

describe('store.addTransaction + saveNewTransactions (transporte sintético)', () => {
  it('gravação confirmada: saved, uma única chamada de insert, linha no store', async () => {
    const t = transport();
    const payload = manualInput();
    t.onInsert({ data: [serverRow(payload, 0)], error: null });
    const out = await saveNewTransactions([payload], {
      add: useAppStore.getState().addTransaction,
      readTransactions: () => useAppStore.getState().transactions,
    });
    expect(out).toEqual({ status: 'saved' });
    expect(t.log.inserts).toHaveLength(1);
    expect(useAppStore.getState().transactions.map((x) => x.ID_Transacao)).toEqual(['tx-1', 'srv-0']);
  });

  it('erro explícito do servidor: refused, store intacto, sem reenvio', async () => {
    const t = transport();
    t.onInsert({ data: null, error: Object.assign(new Error('permission denied'), { code: '42501' }) });
    const before = useAppStore.getState().transactions;
    const out = await saveNewTransactions([manualInput()], {
      add: useAppStore.getState().addTransaction,
      readTransactions: () => useAppStore.getState().transactions,
    });
    expect(out.status).toBe('refused');
    expect(t.log.inserts).toHaveLength(1);
    expect(useAppStore.getState().transactions).toBe(before);
  });

  it('resposta vazia do insert NÃO é sucesso', async () => {
    const t = transport();
    t.onInsert({ data: [], error: null });
    const out = await saveNewTransactions([manualInput()], {
      add: useAppStore.getState().addTransaction,
      readTransactions: () => useAppStore.getState().transactions,
    });
    expect(out.status).toBe('uncertain');
    expect(t.log.inserts).toHaveLength(1);
  });

  it('sem sessão: addTransaction devolve [] sem tocar o banco; o resultado não é sucesso', async () => {
    const t = transport();
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const out = await saveNewTransactions([manualInput()], {
      add: useAppStore.getState().addTransaction,
      readTransactions: () => useAppStore.getState().transactions,
    });
    expect(out.status).not.toBe('saved');
    expect(t.log.inserts).toHaveLength(0);
  });

  it('falha de rede (sem SQLSTATE): uncertain, uma só tentativa', async () => {
    const t = transport();
    t.onInsert({ data: null, error: Object.assign(new Error('TypeError: Failed to fetch'), { code: '' }) });
    const out = await saveNewTransactions([manualInput()], {
      add: useAppStore.getState().addTransaction,
      readTransactions: () => useAppStore.getState().transactions,
    });
    expect(out.status).toBe('uncertain');
    expect(t.log.inserts).toHaveLength(1);
  });

  it('parcelado (3x): um insert atômico com as 3 parcelas, numeração e valores preservados', async () => {
    const t = transport();
    const parcelas = [1, 2, 3].map((n) =>
      manualInput({ Nome_Fantasia: `TV (${n}/3)`, Descricao_Original: `TV (${n}/3)`, Valor: -100, Parcela_Atual: n, Total_Parcelas: 3, Data: new Date(`2026-1${n - 1}-10T12:00:00`), Data_Pagamento: new Date(`2026-1${n - 1}-10T12:00:00`) })
    );
    t.onInsert({ data: parcelas.map(serverRow), error: null });
    const out = await saveNewTransactions(parcelas, {
      add: useAppStore.getState().addTransaction,
      readTransactions: () => useAppStore.getState().transactions,
    });
    expect(out).toEqual({ status: 'saved' });
    expect(t.log.inserts).toHaveLength(1);
    const sent = t.log.inserts[0] as Record<string, unknown>[];
    expect(sent.map((r) => [r.Nome_Fantasia, r.Parcela_Atual, r.Total_Parcelas, r.Valor])).toEqual([
      ['TV (1/3)', 1, 3, -100],
      ['TV (2/3)', 2, 3, -100],
      ['TV (3/3)', 3, 3, -100],
    ]);
    expect(sent.every((r) => r.user_id === 'user-A' && r.Fonte === 'Manual' && r.Origem === 'manual')).toBe(true);
  });

  it('recorrente fixo (12x): um insert, 12 linhas; devolução parcial não é sucesso', async () => {
    const t = transport();
    const meses = Array.from({ length: 12 }, (_, i) => manualInput({ Nome_Fantasia: 'Aluguel', Valor: -1500, Data: new Date(2026, 10 + i, 5, 12) }));
    t.onInsert({ data: meses.slice(0, 11).map(serverRow), error: null });
    const out = await saveNewTransactions(meses, {
      add: useAppStore.getState().addTransaction,
      readTransactions: () => useAppStore.getState().transactions,
    });
    expect(t.log.inserts).toHaveLength(1);
    expect((t.log.inserts[0] as unknown[]).length).toBe(12);
    expect(out.status).toBe('uncertain');
  });

  it('troca de conta durante o envio: a resposta de A não entra no estado de B', async () => {
    const t = transport();
    const payload = manualInput();
    let release!: () => void;
    t.onInsert(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ data: [serverRow(payload, 0)], error: null });
        })
    );
    const pending = useAppStore.getState().addTransaction(payload as never);
    await vi.waitFor(() => expect(t.log.inserts).toHaveLength(1));
    // A sai, B entra com o seu próprio estado
    useAppStore.setState({ user: userB, transactions: [existing({ ID_Transacao: 'b-1', user_id: 'user-B' })] } as never);
    release();
    const rows = await pending;
    expect(rows).toHaveLength(1); // gravado para A
    expect(useAppStore.getState().transactions.map((x) => x.ID_Transacao)).toEqual(['b-1']);
  });
});

describe('store.updateTransaction — modo estrito (formulário)', () => {
  const edit = { ID_Transacao: 'tx-1', Nome_Fantasia: 'Padaria Nova' };

  it('linha devolvida: resolve e o store reflete o servidor', async () => {
    const t = transport();
    t.onUpdate({ data: [existing({ Nome_Fantasia: 'Padaria Nova' })], error: null });
    await expect(useAppStore.getState().updateTransaction(edit, { strict: true })).resolves.toBeUndefined();
    expect(t.log.updates).toHaveLength(1);
    expect(useAppStore.getState().transactions[0].Nome_Fantasia).toBe('Padaria Nova');
  });

  it('erro explícito: lança com o código (refused) e o store fica como estava', async () => {
    const t = transport();
    t.onUpdate({ data: null, error: Object.assign(new Error('rls'), { code: '42501' }) });
    const before = useAppStore.getState().transactions;
    const failure = await useAppStore.getState().updateTransaction(edit, { strict: true }).catch((e) => e);
    expect(failure).toMatchObject({ code: '42501' });
    expect(classifyThrownSave(failure).status).toBe('refused');
    expect(useAppStore.getState().transactions).toBe(before);
    expect(t.log.updates).toHaveLength(1);
  });

  it('nenhuma linha atualizada: lança (refused) e NÃO coloca undefined no store', async () => {
    transport().onUpdate({ data: [], error: null });
    const before = useAppStore.getState().transactions;
    const failure = await useAppStore.getState().updateTransaction(edit, { strict: true }).catch((e) => e);
    expect(classifyThrownSave(failure).status).toBe('refused');
    expect(useAppStore.getState().transactions).toBe(before);
    expect(useAppStore.getState().transactions.every(Boolean)).toBe(true);
  });

  it('servidor responde sem erro e sem linha (data: null): não é gravação confirmada; incerto, store intacto', async () => {
    const t = transport();
    t.onUpdate({ data: null, error: null });
    const before = useAppStore.getState().transactions;
    const failure = await useAppStore.getState().updateTransaction(edit, { strict: true }).catch((e) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(classifyThrownSave(failure)).toEqual({ status: 'uncertain', message: UNCERTAIN_MESSAGE.edit });
    expect(t.log.updates).toHaveLength(1); // sem reenvio
    expect(useAppStore.getState().transactions).toBe(before);
  });

  it('falha de rede: lança sem código (uncertain)', async () => {
    transport().onUpdate({ data: null, error: Object.assign(new Error('TypeError: Failed to fetch'), { code: '' }) });
    const failure = await useAppStore.getState().updateTransaction(edit, { strict: true }).catch((e) => e);
    expect(classifyThrownSave(failure).status).toBe('uncertain');
  });

  it('linha inexistente no store: lança e não grava às cegas', async () => {
    const t = transport();
    const failure = await useAppStore
      .getState()
      .updateTransaction({ ID_Transacao: 'nao-existe', Nome_Fantasia: 'x' }, { strict: true })
      .catch((e) => e);
    expect(classifyThrownSave(failure).status).toBe('refused');
    expect(t.log.updates).toHaveLength(0);
  });
});

describe('store.updateTransaction — contrato antigo (sem strict) preservado', () => {
  const edit = { ID_Transacao: 'tx-1', Categoria: 'Lazer' };

  it('erro do servidor: continua resolvendo (só registra), como antes', async () => {
    transport().onUpdate({ data: null, error: Object.assign(new Error('rls'), { code: '42501' }) });
    await expect(useAppStore.getState().updateTransaction(edit)).resolves.toBeUndefined();
  });

  it('linha inexistente: continua resolvendo sem gravar', async () => {
    const t = transport();
    await expect(useAppStore.getState().updateTransaction({ ID_Transacao: 'nao-existe', Categoria: 'Lazer' })).resolves.toBeUndefined();
    expect(t.log.updates).toHaveLength(0);
  });

  it('nenhuma linha atualizada: não corrompe mais o store com undefined', async () => {
    transport().onUpdate({ data: [], error: null });
    const before = useAppStore.getState().transactions;
    await expect(useAppStore.getState().updateTransaction(edit)).resolves.toBeUndefined();
    expect(useAppStore.getState().transactions).toBe(before);
  });

  it('data: null sem erro: continua resolvendo sem tocar o store, como antes', async () => {
    transport().onUpdate({ data: null, error: null });
    const before = useAppStore.getState().transactions;
    await expect(useAppStore.getState().updateTransaction(edit)).resolves.toBeUndefined();
    expect(useAppStore.getState().transactions).toBe(before);
  });

  it('sucesso: idêntico ao anterior', async () => {
    transport().onUpdate({ data: [existing({ Categoria: 'Lazer' })], error: null });
    await useAppStore.getState().updateTransaction(edit);
    expect(useAppStore.getState().transactions[0].Categoria).toBe('Lazer');
  });
});
