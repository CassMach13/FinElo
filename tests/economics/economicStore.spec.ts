import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  user: { id: 'user-a' } as { id: string } | null,
  rows: [] as Row[],
  inserted: [] as Row[][],
  patches: [] as Row[],
  events: [] as Row[],
  eventInserts: [] as Row[],
  eventDeletes: [] as string[],
  paymentInserts: [] as Row[],
  failEventInsert: false,
  failTxInsert: false,
  seq: 0,
}));

vi.mock('../../src/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'transactions') {
        return {
          insert: (payload: Row[]) => ({
            select: async () => {
              mocks.inserted.push(payload);
              if (mocks.failTxInsert) return { data: null, error: { message: 'boom' } };
              const created = payload.map((p) => ({ ID_Transacao: `tx${(mocks.seq += 1)}`, Origem: 'manual', ...p }));
              mocks.rows.push(...created);
              return { data: created, error: null };
            },
          }),
          update: (patch: Row) => ({
            eq: (_c: string, id: string) => ({
              select: async () => {
                mocks.patches.push(patch);
                const row = mocks.rows.find((r) => r.ID_Transacao === id);
                if (!row) return { data: [], error: null };
                Object.assign(row, patch);
                return { data: [{ ...row }], error: null };
              },
            }),
          }),
        };
      }
      if (table === 'economic_events') {
        return {
          insert: (payload: Row) => ({
            select: () => ({
              single: async () => {
                mocks.eventInserts.push(payload);
                if (mocks.failEventInsert) return { data: null, error: { message: 'boom' } };
                const row = { id: `ev${(mocks.seq += 1)}`, counterparty_account_id: null, created_at: 't', ...payload };
                mocks.events.push(row);
                return { data: row, error: null };
              },
            }),
          }),
          delete: () => ({
            eq: async (_c: string, id: string) => {
              mocks.eventDeletes.push(id);
              return { error: null };
            },
          }),
        };
      }
      if (table === 'credit_card_payments') {
        return { insert: async (payload: Row) => (mocks.paymentInserts.push(payload), { error: null }) };
      }
      throw new Error(`tabela inesperada: ${table}`);
    },
    auth: { getUser: async () => ({ data: { user: mocks.user } }), signOut: async () => ({ error: null }) },
  },
}));
vi.mock('../../src/hooks/useDialogStore', () => ({ appAlert: vi.fn(), appConfirm: vi.fn() }));

import { useAppStore } from '../../src/hooks/useAppStore';
import { createEconomicEvent, deleteEconomicEvent } from '../../src/services/economicEventService';

const state = () => useAppStore.getState();
const leg = (extra: Row = {}) =>
  ({ Data: '2026-10-07', Nome_Fantasia: 'x', Categoria: 'C', Tipo: 'Despesa', Valor: -5, ID_Conta: 'acc', ...extra }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    user: { id: 'user-a' }, rows: [], inserted: [], patches: [], events: [], eventInserts: [], eventDeletes: [],
    paymentInserts: [], failEventInsert: false, failTxInsert: false, seq: 0,
  });
  useAppStore.setState(useAppStore.getInitialState(), true);
});

describe('economicEventService', () => {
  it('createEconomicEvent usa SEMPRE o usuário da sessão como dono e autor', async () => {
    const ev = await createEconomicEvent({ kind: 'credit_card_payment', source: 'pay_invoice_flow', ...({ user_id: 'outro' } as object) });
    expect(mocks.eventInserts).toEqual([
      { user_id: 'user-a', created_by: 'user-a', kind: 'credit_card_payment', source: 'pay_invoice_flow', counterparty_account_id: null },
    ]);
    expect(ev.user_id).toBe('user-a');
    expect(ev.id).toMatch(/^ev/);
  });

  it('sem sessão ou com erro do banco: lança', async () => {
    mocks.user = null;
    await expect(createEconomicEvent({ kind: 'credit_card_payment', source: 'pay_invoice_flow' })).rejects.toThrow(/autenticado/);
    mocks.user = { id: 'user-a' };
    mocks.failEventInsert = true;
    await expect(createEconomicEvent({ kind: 'credit_card_payment', source: 'pay_invoice_flow' })).rejects.toBeTruthy();
  });

  it('deleteEconomicEvent apaga só o evento por id', async () => {
    await deleteEconomicEvent('ev9');
    expect(mocks.eventDeletes).toEqual(['ev9']);
  });

  it('não carrega eventos no estado global (Fase 1 só cria e grava o id)', () => {
    const store = readFileSync(resolve('src/hooks/useAppStore.ts'), 'utf8');
    expect(store).not.toMatch(/economicEvents|fetchEconomicEvents|economic_events/);
  });
});

describe('addTransaction — payload e retorno', () => {
  it('grava economic_event_id quando informado e null quando não (cliente antigo)', async () => {
    await state().addTransaction([leg({ economic_event_id: 'ev1' }), leg()]);
    expect(mocks.inserted[0].map((p) => p.economic_event_id)).toEqual(['ev1', null]);
    expect(mocks.inserted[0].every((p) => p.user_id === 'user-a')).toBe(true);
  });

  it('retorna exatamente as transações inseridas, com IDs reais (e o estado as contém)', async () => {
    const out = await state().addTransaction([leg({ Nome_Fantasia: 'p1' }), leg({ Nome_Fantasia: 'p2' })]);
    expect(out.map((t) => [t.ID_Transacao, t.Nome_Fantasia])).toEqual([['tx1', 'p1'], ['tx2', 'p2']]);
    expect(state().transactions.map((t) => t.ID_Transacao)).toEqual(['tx1', 'tx2']);
  });

  it('aceita uma transação avulsa; sem usuário devolve [] e não grava; erro continua lançando', async () => {
    expect(await state().addTransaction(leg())).toHaveLength(1);
    mocks.user = null;
    expect(await state().addTransaction(leg())).toEqual([]);
    expect(mocks.inserted).toHaveLength(1);
    mocks.user = { id: 'user-a' };
    mocks.failTxInsert = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(state().addTransaction(leg())).rejects.toBeTruthy();
  });

  it('chamadores que ignoram o retorno continuam funcionando', async () => {
    await expect(state().addTransaction(leg())).resolves.toBeDefined();
  });

  it('addMultipleTransactions e os RPCs de importação NÃO passam economic_event_id', () => {
    const store = readFileSync(resolve('src/hooks/useAppStore.ts'), 'utf8');
    const start = store.indexOf('addMultipleTransactions: async');
    expect(store.slice(start, start + 20000)).not.toContain('economic_event_id');
  });
});

describe('updateTransaction — preserva economic_event_id', () => {
  it('editar campos normais não envia nem zera economic_event_id', async () => {
    mocks.rows = [{ ID_Transacao: 't1', user_id: 'user-a', Origem: 'manual', Nome_Fantasia: 'antes', Valor: -5, Tipo: 'Despesa', Categoria: 'C', economic_event_id: 'ev1' }];
    useAppStore.setState({ transactions: mocks.rows.map((r) => ({ ...r })) as never });
    await state().updateTransaction({
      ID_Transacao: 't1', Nome_Fantasia: 'depois', Descricao_Original: 'depois', Categoria: 'D', Valor: -9, Data: '2026-10-08',
    } as never);
    expect(mocks.patches).toHaveLength(1);
    expect('economic_event_id' in mocks.patches[0]).toBe(false);
    const row = state().transactions.find((t) => t.ID_Transacao === 't1')!;
    expect(row.Nome_Fantasia).toBe('depois');
    expect(row.economic_event_id).toBe('ev1');
  });
});

describe('payStatement — payment_transaction_id', () => {
  const setup = async () => {
    // O serviço lê o detalhe da fatura e recalcula; aqui só interessa o payload gravado em credit_card_payments.
    const svc = (await import('../../src/services/creditCardEngineService')).creditCardEngineService as unknown as Record<string, unknown>;
    svc.getStatementDetail = async () => ({ statement: { cardId: 'card-row' } });
    svc.recalculateAllStatementsForCard = async () => {};
    svc.getCardStatements = async () => [{ id: 'st1' }];
    return svc as unknown as { payStatement: (u: string, s: string, i: Record<string, unknown>) => Promise<unknown> };
  };

  it('grava o ID informado (perna do cartão)', async () => {
    const svc = await setup();
    await svc.payStatement('user-a', 'st1', { paymentDate: '2026-10-07', amount: 10, paymentAccountId: 'bank', paymentTransactionId: 'tx-card' });
    expect(mocks.paymentInserts[0]).toMatchObject({ payment_transaction_id: 'tx-card', payment_account_id: 'bank', amount: 10, source: 'manual' });
  });

  it('sem ID informado grava null (comportamento anterior)', async () => {
    const svc = await setup();
    await svc.payStatement('user-a', 'st1', { paymentDate: '2026-10-07', amount: 10 });
    expect(mocks.paymentInserts[0].payment_transaction_id).toBeNull();
  });
});
