import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null as any }));
vi.mock('../../src/supabaseClient', async () => {
  const m = await import('../helpers/fakeEconomicDb');
  h.db = m.createFakeDb();
  return { supabase: h.db.supabase };
});
vi.mock('../../src/hooks/useDialogStore', () => ({ appAlert: vi.fn(), appConfirm: vi.fn() }));

import { useAppStore } from '../../src/hooks/useAppStore';
import {
  EconomicIdentityError,
  cleanupOrphanUserEvent,
  markTransactionAsInternalMovement,
  unmarkTransactionInternalMovement,
} from '../../src/services/transactionEconomicIdentityService';
import { buildEconomicKindByEventId } from '../../src/domain/economics/transactionSemantics';
import { toOperationalChartData, buildCategorySets } from '../../src/utils/dashboardMetrics';
import { canMarkInternalMovement } from '../../src/domain/economics/manualEconomicIdentity';
import { sanitizeTransactionUpdate } from '../../src/domain/transactions/transactionEditPolicy';
import type { Transaction } from '../../src/types';

const A = 'user-a';
const B = 'user-b';
const FUNDING = 'Pagamento finelo_funding_account:acc-1';

const db = () => h.db.state as {
  user: { id: string } | null;
  tables: Record<string, Array<Record<string, any>>>;
  log: Array<{ table: string; op: string; payload?: any; filters?: Array<[string, string, unknown]> }>;
  failUpdate: boolean; failEventInsert: boolean; failEventDelete: boolean; beforeUpdate: null | (() => void); seq: number;
};
const txRow = (id: string, extra: Record<string, any> = {}) => ({
  ID_Transacao: id, user_id: A, Origem: 'manual', Fonte: 'Manual', Descricao_Original: 'x', Nome_Fantasia: id,
  Valor: -100, Tipo: 'Despesa', Categoria: 'Mercado', Data: '2026-09-10', economic_event_id: null, ...extra,
});
const seedEvent = (id: string, o: Record<string, any> = {}) =>
  db().tables.economic_events.push({ id, user_id: A, kind: 'own_account_transfer', source: 'user', counterparty_account_id: null, created_by: A, created_at: 't', ...o });
const seed = (rows: Array<Record<string, any>>) => { db().tables.transactions = rows.map((r) => ({ ...r })); };
const localState = () => {
  useAppStore.setState({ user: { id: A } as never, transactions: db().tables.transactions.map((r) => ({ ...r })) as never, economicEvents: db().tables.economic_events.map((e) => ({ ...e })) as never });
};

beforeEach(() => {
  vi.clearAllMocks();
  const s = db();
  s.user = { id: A }; s.tables.transactions = []; s.tables.economic_events = []; s.log = [];
  s.failUpdate = false; s.failEventInsert = false; s.failEventDelete = false; s.beforeUpdate = null; s.seq = 0;
  useAppStore.setState(useAppStore.getInitialState(), true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const created = () => db().log.filter((l) => l.table === 'economic_events' && l.op === 'insert');
const rejects = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(EconomicIdentityError);
  expect((err as EconomicIdentityError).code).toBe(code);
};

describe('markTransactionAsInternalMovement — service', () => {
  it('dono, lançamento manual: cria own_account_transfer/user e vincula SÓ por economic_event_id', async () => {
    seed([txRow('t1')]);
    const { event, transaction } = await markTransactionAsInternalMovement('t1');
    expect(event).toMatchObject({ kind: 'own_account_transfer', source: 'user', user_id: A, created_by: A, counterparty_account_id: null });
    expect(transaction.economic_event_id).toBe(event.id);
    expect(db().tables.transactions[0].economic_event_id).toBe(event.id);
    const update = db().log.find((l) => l.table === 'transactions' && l.op === 'update')!;
    expect(update.payload).toEqual({ economic_event_id: event.id }); // nenhum outro campo
  });

  it('lançamento IMPORTADO do dono também pode (e não passa por sanitizeTransactionUpdate)', async () => {
    seed([txRow('t2', { Origem: 'extrato.csv', Fonte: 'Conta' })]);
    const { event } = await markTransactionAsInternalMovement('t2');
    expect(db().tables.transactions[0].economic_event_id).toBe(event.id);
    // prova do porquê: o caminho genérico DESCARTA o campo em importadas
    const sanitized = sanitizeTransactionUpdate({ ...txRow('t2', { Origem: 'extrato.csv' }) } as unknown as Transaction, { economic_event_id: 'x' } as never);
    expect('economic_event_id' in sanitized).toBe(false);
  });

  it('o UPDATE é condicional: id + dono + economic_event_id IS NULL', async () => {
    seed([txRow('t1')]);
    await markTransactionAsInternalMovement('t1');
    const update = db().log.find((l) => l.table === 'transactions' && l.op === 'update')!;
    expect(update.filters).toEqual(expect.arrayContaining([['ID_Transacao', 'eq', 't1'], ['user_id', 'eq', A], ['economic_event_id', 'is', null]]));
  });

  it('transação de FAMÍLIA (outro dono): negado ANTES de criar evento', async () => {
    seed([txRow('t3', { user_id: B })]);
    await rejects(markTransactionAsInternalMovement('t3'), 'not_owner');
    expect(created()).toHaveLength(0);
    expect(db().tables.transactions[0].economic_event_id).toBeNull();
  });

  it.each([
    ['já classificada', txRow('t4', { economic_event_id: 'ev-x' }), 'already_marked'],
    ['demo (Origem demo.csv)', txRow('t5', { Origem: 'demo.csv' }), 'not_markable'],
    ['demo (Fonte Demo)', txRow('t6', { Fonte: 'Demo' }), 'not_markable'],
    ['marcador do Pagar', txRow('t7', { Descricao_Original: FUNDING }), 'not_markable'],
  ])('%s: negado sem criar evento', async (_n, row, code) => {
    seed([row]);
    await rejects(markTransactionAsInternalMovement(row.ID_Transacao), code);
    expect(created()).toHaveLength(0);
  });

  it('sem sessão e transação inexistente', async () => {
    db().user = null;
    await rejects(markTransactionAsInternalMovement('t1'), 'not_authenticated');
    db().user = { id: A };
    await rejects(markTransactionAsInternalMovement('nao-existe'), 'not_found');
    expect(created()).toHaveLength(0);
  });

  it('falha no vínculo: o evento recém-criado é COMPENSADO (apagado) e o erro é propagado', async () => {
    seed([txRow('t1')]);
    db().failUpdate = true;
    await rejects(markTransactionAsInternalMovement('t1'), 'failed');
    expect(created()).toHaveLength(1);
    expect(db().tables.economic_events).toHaveLength(0);
  });

  it('concorrência: se outra sessão vinculou antes, o UPDATE não sobrescreve e o evento é apagado', async () => {
    seed([txRow('t1')]);
    db().beforeUpdate = () => { db().tables.transactions[0].economic_event_id = 'ev-concorrente'; };
    await rejects(markTransactionAsInternalMovement('t1'), 'conflict');
    expect(db().tables.transactions[0].economic_event_id).toBe('ev-concorrente');
    expect(db().tables.economic_events).toHaveLength(0);
  });

  it('se a compensação também falhar: loga e preserva o erro principal', async () => {
    seed([txRow('t1')]);
    db().failUpdate = true;
    db().failEventDelete = true;
    await rejects(markTransactionAsInternalMovement('t1'), 'failed');
  });
});

describe('unmarkTransactionInternalMovement — service', () => {
  it('manual single-leg do dono: apaga o evento, a transação permanece com economic_event_id NULL', async () => {
    seedEvent('ev1');
    seed([txRow('t1', { economic_event_id: 'ev1' })]);
    const { eventId, transaction } = await unmarkTransactionInternalMovement('t1');
    expect(eventId).toBe('ev1');
    expect(transaction.economic_event_id).toBeNull();
    expect(db().tables.economic_events).toHaveLength(0);
    expect(db().tables.transactions).toHaveLength(1);
  });

  it.each([
    ['pay_invoice_flow', { kind: 'credit_card_payment', source: 'pay_invoice_flow' }],
    ['backfill_funding_marker', { kind: 'credit_card_payment', source: 'backfill_funding_marker' }],
    ['transfer_flow', { kind: 'own_account_transfer', source: 'transfer_flow' }],
    ['credit_card_payment/user', { kind: 'credit_card_payment', source: 'user' }],
  ])('evento automático/outro tipo (%s): negado e nada é apagado', async (_n, over) => {
    seedEvent('ev1', over);
    seed([txRow('t1', { economic_event_id: 'ev1' })]);
    await rejects(unmarkTransactionInternalMovement('t1'), 'not_undoable');
    expect(db().tables.economic_events).toHaveLength(1);
  });

  it('multi-leg (confirmado no BANCO): negado', async () => {
    seedEvent('ev1');
    seed([txRow('t1', { economic_event_id: 'ev1' }), txRow('t2', { economic_event_id: 'ev1' })]);
    await rejects(unmarkTransactionInternalMovement('t1'), 'not_undoable');
    expect(db().tables.economic_events).toHaveLength(1);
  });

  it('evento de outro dono ou transação de outro dono: negado', async () => {
    seedEvent('ev1', { user_id: B });
    seed([txRow('t1', { economic_event_id: 'ev1' }), txRow('t2', { user_id: B, economic_event_id: 'ev1' })]);
    await rejects(unmarkTransactionInternalMovement('t1'), 'not_owner');
    await rejects(unmarkTransactionInternalMovement('t2'), 'not_owner');
    expect(db().tables.economic_events).toHaveLength(1);
  });

  it('sem classificação: nada a desfazer', async () => {
    seed([txRow('t1')]);
    await rejects(unmarkTransactionInternalMovement('t1'), 'not_undoable');
  });
});

describe('cleanupOrphanUserEvent', () => {
  it('apaga só evento manual do dono SEM pernas; preserva evento com perna e eventos automáticos', async () => {
    seedEvent('orfao');
    seedEvent('com-perna'); seed([txRow('t1', { economic_event_id: 'com-perna' })]);
    seedEvent('auto', { kind: 'credit_card_payment', source: 'pay_invoice_flow' });
    expect(await cleanupOrphanUserEvent('orfao')).toBe(true);
    expect(await cleanupOrphanUserEvent('com-perna')).toBe(false);
    expect(await cleanupOrphanUserEvent('auto')).toBe(false);
    expect(db().tables.economic_events.map((e) => e.id).sort()).toEqual(['auto', 'com-perna']);
  });
});

describe('store — marcar, desfazer e estado imediato', () => {
  it('marcar: transaction e economicEvents atualizados sem reload; a visão econômica já neutraliza', async () => {
    seed([txRow('t1')]);
    localState();
    expect(await useAppStore.getState().markTransactionAsInternalMovement('t1')).toBe(true);
    const s = useAppStore.getState();
    const tx = s.transactions.find((t) => t.ID_Transacao === 't1')!;
    expect(tx.economic_event_id).toBeTruthy();
    expect(s.economicEvents.map((e) => e.id)).toEqual([tx.economic_event_id]);
    const sets = buildCategorySets([{ id: '1', Nome_Categoria: 'Mercado', Tipo: 'Despesa' } as never]);
    const map = buildEconomicKindByEventId(s.economicEvents);
    expect(toOperationalChartData(s.transactions, sets, map)).toHaveLength(0); // neutralizada
    expect(toOperationalChartData(s.transactions, sets)).toHaveLength(1); // sem o mapa: legado
  });

  it('marcar negado (família/demo/marcador): false, estado intacto e nenhum evento', async () => {
    seed([txRow('t3', { user_id: B }), txRow('t5', { Origem: 'demo.csv' }), txRow('t7', { Descricao_Original: FUNDING })]);
    localState();
    for (const id of ['t3', 't5', 't7']) expect(await useAppStore.getState().markTransactionAsInternalMovement(id)).toBe(false);
    expect(created()).toHaveLength(0);
    expect(useAppStore.getState().economicEvents).toEqual([]);
  });

  it('desfazer: evento sai do store, transação volta a participar dos cálculos', async () => {
    seedEvent('ev1');
    seed([txRow('t1', { economic_event_id: 'ev1' })]);
    localState();
    expect(await useAppStore.getState().unmarkTransactionInternalMovement('t1')).toBe(true);
    const s = useAppStore.getState();
    expect(s.economicEvents).toEqual([]);
    expect(s.transactions[0].economic_event_id).toBeNull();
    const sets = buildCategorySets([{ id: '1', Nome_Categoria: 'Mercado', Tipo: 'Despesa' } as never]);
    expect(toOperationalChartData(s.transactions, sets, buildEconomicKindByEventId(s.economicEvents))).toHaveLength(1);
  });

  it('desfazer evento automático ou multi-leg: false e nada muda', async () => {
    seedEvent('auto', { kind: 'credit_card_payment', source: 'pay_invoice_flow' });
    seedEvent('multi');
    seed([txRow('a1', { economic_event_id: 'auto' }), txRow('m1', { economic_event_id: 'multi' }), txRow('m2', { economic_event_id: 'multi' })]);
    localState();
    for (const id of ['a1', 'm1']) expect(await useAppStore.getState().unmarkTransactionInternalMovement(id)).toBe(false);
    expect(useAppStore.getState().economicEvents).toHaveLength(2);
  });

  it('um fetch ANTIGO não ressuscita o evento desfeito (forget invalida a geração)', async () => {
    seedEvent('ev1');
    seed([txRow('t1', { economic_event_id: 'ev1' })]);
    localState();
    // fetch inicia lendo o snapshot que AINDA contém ev1
    const snapshot = db().tables.economic_events.map((e) => ({ ...e }));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const original = h.db.supabase.from;
    h.db.supabase.from = (table: string) => {
      const q = original(table);
      if (table === 'economic_events') {
        const run = q.range.bind(q);
        q.range = () => ({ then: (res: any, rej: any) => gate.then(() => ({ data: snapshot, error: null })).then(res, rej), range: run });
      }
      return q;
    };
    const pending = useAppStore.getState().fetchEconomicEvents();
    await useAppStore.getState().unmarkTransactionInternalMovement('t1');
    release();
    await pending;
    h.db.supabase.from = original;
    expect(useAppStore.getState().economicEvents).toEqual([]);
  });

  it('evento de OUTRA sessão não contamina o estado', () => {
    useAppStore.setState({ user: { id: B } as never });
    useAppStore.getState().rememberEconomicEvent({ id: 'e', user_id: A, kind: 'own_account_transfer', source: 'user', counterparty_account_id: null, created_by: A, created_at: 't' });
    expect(useAppStore.getState().economicEvents).toEqual([]);
  });
});

describe('store — exclusão limpa o evento manual single-leg', () => {
  const evAuto = () => seedEvent('auto', { kind: 'credit_card_payment', source: 'pay_invoice_flow' });

  it('deleteTransaction: manual com evento manual single-leg ⇒ evento apagado (depois da transação)', async () => {
    seedEvent('ev1');
    seed([txRow('t1', { economic_event_id: 'ev1' })]);
    localState();
    await useAppStore.getState().deleteTransaction('t1');
    expect(db().tables.transactions).toHaveLength(0);
    expect(db().tables.economic_events).toHaveLength(0);
    expect(useAppStore.getState().economicEvents).toEqual([]);
    const ops = db().log.filter((l) => l.op === 'delete').map((l) => l.table);
    expect(ops.indexOf('transactions')).toBeLessThan(ops.lastIndexOf('economic_events'));
  });

  it('deleteTransaction: evento automático (Pagar) permanece, mesmo apagando uma perna; multi-leg permanece', async () => {
    evAuto(); seedEvent('multi');
    seed([txRow('p1', { economic_event_id: 'auto' }), txRow('p2', { economic_event_id: 'auto' }), txRow('m1', { economic_event_id: 'multi' }), txRow('m2', { economic_event_id: 'multi' })]);
    localState();
    await useAppStore.getState().deleteTransaction('p1');
    await useAppStore.getState().deleteTransaction('m1');
    expect(db().tables.economic_events.map((e) => e.id).sort()).toEqual(['auto', 'multi']);
    expect(db().tables.transactions.find((t) => t.ID_Transacao === 'p2')!.economic_event_id).toBe('auto');
  });

  it('deleteTransaction: lançamento IMPORTADO excluído não dispara a limpeza (limitação V1 documentada)', async () => {
    seedEvent('ev1');
    seed([txRow('i1', { Origem: 'extrato.csv', economic_event_id: 'ev1' })]);
    localState();
    await useAppStore.getState().deleteTransaction('i1');
    expect(db().tables.economic_events.map((e) => e.id)).toEqual(['ev1']); // órfão inerte
  });

  it('deleteManualTransactions: limpa só os eventos manuais single-leg adequados', async () => {
    seedEvent('u1'); seedEvent('u2'); evAuto();
    seed([
      txRow('a', { economic_event_id: 'u1' }),
      txRow('b', { economic_event_id: 'auto' }),
      txRow('c', { economic_event_id: 'u2' }), txRow('d', { economic_event_id: 'u2' }), // u2 tem 2 pernas; só 'c' é apagada
    ]);
    localState();
    await useAppStore.getState().deleteManualTransactions(['a', 'b', 'c']);
    expect(db().tables.economic_events.map((e) => e.id).sort()).toEqual(['auto', 'u2']);
  });

  it('se a limpeza do evento falhar, a transação continua excluída (sem rollback) e o erro é logado', async () => {
    seedEvent('ev1');
    seed([txRow('t1', { economic_event_id: 'ev1' })]);
    localState();
    db().failEventDelete = true;
    await useAppStore.getState().deleteTransaction('t1');
    expect(db().tables.transactions).toHaveLength(0);
    expect(db().tables.economic_events).toHaveLength(1);
  });
});

describe('edição preserva a identidade', () => {
  it('updateTransaction de campos normais não envia nem zera economic_event_id', async () => {
    seedEvent('ev1');
    seed([txRow('t1', { economic_event_id: 'ev1' })]);
    localState();
    await useAppStore.getState().updateTransaction({ ID_Transacao: 't1', Nome_Fantasia: 'novo', Categoria: 'Outra', Valor: -5 } as never);
    const update = db().log.find((l) => l.table === 'transactions' && l.op === 'update')!;
    expect('economic_event_id' in (update.payload as object)).toBe(false);
    expect(db().tables.transactions[0].economic_event_id).toBe('ev1');
    expect(useAppStore.getState().transactions[0].economic_event_id).toBe('ev1');
  });
});

// ---------------------------------------------------------------------------------------------------------
// fetchTransactions iniciado ANTES de marcar/desfazer não pode sobrescrever o economic_event_id recém-alterado.
// ---------------------------------------------------------------------------------------------------------
describe('fetchTransactions antigo × marcar/desfazer (revisão de identidade)', () => {
  /** Faz o PRÓXIMO select de transactions usar o snapshot capturado agora e só responder quando liberado. */
  const holdNextTransactionsFetch = () => {
    const snapshot = db().tables.transactions.map((r) => ({ ...r }));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const original = h.db.supabase.from;
    let used = false;
    h.db.supabase.from = (table: string) => {
      const q = original(table);
      if (table === 'transactions' && !used) {
        q.range = () => {
          used = true;
          h.db.supabase.from = original; // só este fetch é segurado
          return { then: (res: any, rej: any) => gate.then(() => ({ data: snapshot, error: null })).then(res, rej) };
        };
      }
      return q;
    };
    return { release, restore: () => { h.db.supabase.from = original; } };
  };
  const kindMap = () => buildEconomicKindByEventId(useAppStore.getState().economicEvents);
  const sets = buildCategorySets([{ id: '1', Nome_Categoria: 'Mercado', Tipo: 'Despesa' } as never]);

  it('MARK: o snapshot antigo (sem o id) não reverte a marcação; evento e neutralização permanecem', async () => {
    seed([txRow('t1')]);
    localState();
    const held = holdNextTransactionsFetch();
    const pending = useAppStore.getState().fetchTransactions();
    expect(await useAppStore.getState().markTransactionAsInternalMovement('t1')).toBe(true);
    const idAfterMark = useAppStore.getState().transactions[0].economic_event_id;
    expect(idAfterMark).toBeTruthy();
    held.release();
    await pending;
    const s = useAppStore.getState();
    expect(s.transactions[0].economic_event_id).toBe(idAfterMark);
    expect(s.economicEvents.map((e) => e.id)).toEqual([idAfterMark]);
    expect(toOperationalChartData(s.transactions, sets, kindMap())).toHaveLength(0); // continua neutra
    expect(s.isLoading).toBe(false);
  });

  it('UNDO: o snapshot antigo (com o id) não ressuscita o vínculo; marcar volta a ser possível', async () => {
    seedEvent('ev1');
    seed([txRow('t1', { economic_event_id: 'ev1' })]);
    localState();
    const held = holdNextTransactionsFetch();
    const pending = useAppStore.getState().fetchTransactions();
    expect(await useAppStore.getState().unmarkTransactionInternalMovement('t1')).toBe(true);
    expect(useAppStore.getState().transactions[0].economic_event_id).toBeNull();
    held.release();
    await pending;
    const s = useAppStore.getState();
    expect(s.transactions[0].economic_event_id).toBeNull();
    expect(s.economicEvents).toEqual([]);
    expect(canMarkInternalMovement(s.transactions[0], A)).toBe(true);
    expect(s.isLoading).toBe(false);
  });

  it('um fetch iniciado DEPOIS do mark continua AUTORITATIVO (a revisão não bloqueia os próximos)', async () => {
    seed([txRow('t1')]);
    localState();
    await useAppStore.getState().markTransactionAsInternalMovement('t1');
    db().tables.transactions.push(txRow('t-novo', { Nome_Fantasia: 'chegou depois' }));
    await useAppStore.getState().fetchTransactions();
    const s = useAppStore.getState();
    expect(s.transactions.map((t) => t.ID_Transacao).sort()).toEqual(['t-novo', 't1']); // snapshot aplicado
    expect(s.transactions.find((t) => t.ID_Transacao === 't1')!.economic_event_id).toBeTruthy(); // o banco já tem o id
  });

  it('um fetch iniciado DEPOIS do undo também é aplicado', async () => {
    seedEvent('ev1');
    seed([txRow('t1', { economic_event_id: 'ev1' })]);
    localState();
    await useAppStore.getState().unmarkTransactionInternalMovement('t1');
    db().tables.transactions.push(txRow('t-novo'));
    await useAppStore.getState().fetchTransactions();
    const s = useAppStore.getState();
    expect(s.transactions).toHaveLength(2);
    expect(s.transactions.find((t) => t.ID_Transacao === 't1')!.economic_event_id).toBeNull();
  });

  it('mark/undo que FALHAM não invalidam o fetch em voo (a revisão só avança no sucesso)', async () => {
    seed([txRow('t1', { user_id: B })]); // família: o mark é negado
    localState();
    db().tables.transactions.push(txRow('t-fresh'));
    const held = holdNextTransactionsFetch();
    const pending = useAppStore.getState().fetchTransactions();
    expect(await useAppStore.getState().markTransactionAsInternalMovement('t1')).toBe(false);
    held.release();
    await pending;
    expect(useAppStore.getState().transactions.map((t) => t.ID_Transacao).sort()).toEqual(['t-fresh', 't1']);
  });

  it('o snapshot descartado não deixa isLoading preso', async () => {
    seed([txRow('t1')]);
    localState();
    const held = holdNextTransactionsFetch();
    const pending = useAppStore.getState().fetchTransactions();
    expect(useAppStore.getState().isLoading).toBe(true);
    await useAppStore.getState().markTransactionAsInternalMovement('t1');
    held.release();
    await pending;
    expect(useAppStore.getState().isLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------
// fetchTransactions: nenhuma resposta de uma sessão antiga (ou de um fetch mais velho) é gravada no store atual.
// ---------------------------------------------------------------------------------------------------------
describe('fetchTransactions × sessão/geração', () => {
  const hold = (snapshot?: Array<Record<string, any>>) => {
    const rows = (snapshot ?? db().tables.transactions).map((r) => ({ ...r }));
    let release!: () => void;
    let fail = false;
    const gate = new Promise<void>((r) => { release = r; });
    const original = h.db.supabase.from;
    let used = false;
    h.db.supabase.from = (table: string) => {
      const q = original(table);
      if (table === 'transactions' && !used) {
        q.range = () => {
          used = true;
          h.db.supabase.from = original;
          return { then: (res: any, rej: any) => gate.then(() => (fail ? { data: null, error: { message: 'boom' } } : { data: rows, error: null })).then(res, rej) };
        };
      }
      return q;
    };
    return { release: () => release(), releaseWithError: () => { fail = true; release(); } };
  };
  const ids = () => useAppStore.getState().transactions.map((t) => t.ID_Transacao);

  it('A → B: a resposta tardia de A NÃO entra no estado de B', async () => {
    seed([txRow('tx-de-A')]);
    useAppStore.setState({ user: { id: A } as never, transactions: [] as never });
    const held = hold();
    const pending = useAppStore.getState().fetchTransactions();
    await useAppStore.getState().signOut();
    useAppStore.setState({ user: { id: B } as never, transactions: [] as never });
    held.release();
    await pending;
    expect(ids()).toEqual([]);
  });

  it('logout → o MESMO usuário A loga de novo: o snapshot da sessão antiga também NÃO entra (só o user_id não basta)', async () => {
    seed([txRow('velho')]);
    useAppStore.setState({ user: { id: A } as never, transactions: [] as never });
    const held = hold();
    const pending = useAppStore.getState().fetchTransactions();
    await useAppStore.getState().signOut();
    useAppStore.setState({ user: { id: A } as never, transactions: [] as never }); // nova sessão, mesmo id
    held.release();
    await pending;
    expect(ids()).toEqual([]);
  });

  it('troca de usuário SEM signOut (id diferente, geração atual): descarta e não deixa o loading preso', async () => {
    seed([txRow('tx-de-A')]);
    useAppStore.setState({ user: { id: A } as never, transactions: [] as never });
    const held = hold();
    const pending = useAppStore.getState().fetchTransactions();
    useAppStore.setState({ user: { id: B } as never });
    held.release();
    await pending;
    expect(ids()).toEqual([]);
    expect(useAppStore.getState().isLoading).toBe(false);
  });

  it('o fetch MAIS NOVO vence: o #1 que responde depois não sobrescreve o #2', async () => {
    seed([txRow('v1')]);
    useAppStore.setState({ user: { id: A } as never, transactions: [] as never });
    const first = hold([txRow('snapshot-velho')]);
    const p1 = useAppStore.getState().fetchTransactions();
    db().tables.transactions = [txRow('snapshot-novo')];
    const p2 = useAppStore.getState().fetchTransactions(); // sem hold: responde já
    await p2;
    expect(ids()).toEqual(['snapshot-novo']);
    first.release();
    await p1;
    expect(ids()).toEqual(['snapshot-novo']);
  });

  it('loading: um fetch stale por geração NÃO libera o isLoading enquanto o mais novo ainda está em voo', async () => {
    seed([txRow('x')]);
    useAppStore.setState({ user: { id: A } as never, transactions: [] as never });
    const first = hold([txRow('velho')]);
    const p1 = useAppStore.getState().fetchTransactions();
    const second = hold([txRow('novo')]);
    const p2 = useAppStore.getState().fetchTransactions();
    expect(useAppStore.getState().isLoading).toBe(true);
    first.release();
    await p1; // stale por geração
    expect(useAppStore.getState().isLoading).toBe(true); // o #2 ainda não chegou
    expect(ids()).toEqual([]);
    second.release();
    await p2;
    expect(useAppStore.getState().isLoading).toBe(false);
    expect(ids()).toEqual(['novo']);
  });

  it('erro de um fetch de sessão antiga: sem alerta, sem mudar o status da sessão nova, sem tocar nas transações', async () => {
    seed([txRow('x')]);
    useAppStore.setState({ user: { id: A } as never, transactions: [] as never, initialDataLoadStatus: 'idle' });
    const held = hold();
    const pending = useAppStore.getState().fetchTransactions();
    await useAppStore.getState().signOut();
    useAppStore.setState({ user: { id: B } as never, transactions: [txRow('de-B')] as never, initialDataLoadStatus: 'loading' });
    const { appAlert } = await import('../../src/hooks/useDialogStore');
    (appAlert as any).mockClear();
    held.releaseWithError();
    await pending;
    expect(appAlert).not.toHaveBeenCalled();
    expect(useAppStore.getState().initialDataLoadStatus).toBe('loading');
    expect(ids()).toEqual(['de-B']);
  });

  it('erro do fetch ATUAL continua tratado: alerta e status de erro', async () => {
    seed([txRow('x')]);
    useAppStore.setState({ user: { id: A } as never, transactions: [] as never, initialDataLoadStatus: 'idle' });
    const held = hold();
    const pending = useAppStore.getState().fetchTransactions();
    const { appAlert } = await import('../../src/hooks/useDialogStore');
    (appAlert as any).mockClear();
    held.releaseWithError();
    await pending;
    expect(appAlert).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().initialDataLoadStatus).toBe('error');
    expect(useAppStore.getState().isLoading).toBe(false);
  });

  it('sem usuário não consulta o banco e não deixa isLoading preso', async () => {
    useAppStore.setState({ user: null as never, transactions: [] as never });
    db().log = [];
    await useAppStore.getState().fetchTransactions();
    expect(db().log.filter((l) => l.table === 'transactions')).toHaveLength(0);
    expect(useAppStore.getState().isLoading).toBe(false);
  });

  it('a revisão de mark/undo continua independente e preservada', async () => {
    seed([txRow('t1')]);
    localState();
    const held = hold();
    const pending = useAppStore.getState().fetchTransactions();
    await useAppStore.getState().markTransactionAsInternalMovement('t1');
    const id = useAppStore.getState().transactions[0].economic_event_id;
    held.release();
    await pending;
    expect(useAppStore.getState().transactions[0].economic_event_id).toBe(id);
  });
});

describe('signOut e o loading de um fetch em voo', () => {
  it('logout durante o fetch: o loading é liberado pelo próprio signOut (a resposta antiga é descartada)', async () => {
    seed([txRow('x')]);
    useAppStore.setState({ user: { id: A } as never, transactions: [] as never });
    const original = h.db.supabase.from;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    h.db.supabase.from = (table: string) => {
      const q = original(table);
      if (table === 'transactions') q.range = () => ({ then: (res: any, rej: any) => gate.then(() => ({ data: [txRow('x')], error: null })).then(res, rej) });
      return q;
    };
    const pending = useAppStore.getState().fetchTransactions();
    expect(useAppStore.getState().isLoading).toBe(true);
    await useAppStore.getState().signOut();
    expect(useAppStore.getState().isLoading).toBe(false);
    release();
    await pending;
    h.db.supabase.from = original;
    expect(useAppStore.getState().transactions).toEqual([]);
    expect(useAppStore.getState().isLoading).toBe(false);
  });
});
