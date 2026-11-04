import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Proteção do fluxo de pagamento manual de cartão.
 *
 * Usuário comum: lança compras à mão e, de vez em quando, paga a fatura em partes. Cada pagamento são duas linhas
 * (abatimento no cartão + saída da conta) que precisam nascer, mudar e sumir juntas. Valores em centavos inteiros.
 */

const h = vi.hoisted(() => ({ db: null as any, alert: null as any, confirm: null as any }));
vi.mock('../../src/supabaseClient', async () => {
  const m = await import('../helpers/fakeEconomicDb');
  h.db = m.createFakeDb();
  return { supabase: h.db.supabase };
});
vi.mock('../../src/hooks/useDialogStore', () => {
  h.alert = vi.fn(async () => undefined);
  h.confirm = vi.fn(async () => true);
  return { appAlert: h.alert, appConfirm: h.confirm };
});

import { useAppStore } from '../../src/hooks/useAppStore';
import { registerInvoicePayment } from '../../src/services/payInvoiceRegistration';
import { buildDirectedPaymentDescription, buildFundingPaymentDescription } from '../../src/services/creditCardDirectedPayment';
import { creditCardRebuildFromImportHistoryService as svc } from '../../src/services/creditCardRebuildFromImportHistoryService';
import { projectCardTwoLedger } from '../../src/domain/credit-card/twoLedgerProjection';
import {
  INVOICE_PAYMENT_EDIT_GUIDANCE,
  accountLookup,
  describeInvoicePaymentLeg,
  detectInvoicePaymentFromBank,
  duplicatePaymentWarning,
  expandInvoicePaymentSelection,
  findInvoicePaymentPair,
  findPossibleDuplicatePayments,
  invoicePaymentDeletionMessage,
  parsePaymentAmountInput,
  restrictInvoicePaymentUpdate,
  wouldChangeInvoicePaymentMoney,
} from '../../src/domain/credit-card/invoicePaymentPair';
import { deleteTransactionsWithPaymentCleanup } from '../../src/services/invoicePaymentDeletion';
import type { Account, EconomicEvent, Transaction } from '../../src/types';

const A = 'user-a';
const CARD = 'card-nu';
const BANK = '11111111-1111-4111-8111-111111111111';
const BANK2 = '22222222-2222-4222-8222-222222222222';
const cartao = {
  id: CARD, user_id: A, Nome_Conta: 'Cartão Nubank', Tipo_Conta: 'Cartão de Crédito',
  dia_fechamento: 11, dia_vencimento: 18, limite_credito: 9000,
} as Account;
const banco = { id: BANK, user_id: A, Nome_Conta: 'Conta Itaú', Tipo_Conta: 'Conta Corrente' } as Account;
const banco2 = { id: BANK2, user_id: A, Nome_Conta: 'Poupança', Tipo_Conta: 'Poupança' } as Account;
const contas = [cartao, banco, banco2];

const db = () => h.db.state as {
  user: { id: string } | null;
  tables: Record<string, Array<Record<string, any>>>;
  log: Array<{ table: string; op: string; payload?: any; filters?: Array<[string, string, unknown]> }>;
  failEventDelete: boolean; seq: number; failUpdate: boolean; failEventInsert: boolean; beforeUpdate: null | (() => void);
};

let idSeq = 0;
const compra = (data: string, vencimento: string, valor: number): Transaction =>
  ({
    ID_Transacao: `c${++idSeq}`, user_id: A, ID_Conta: CARD, Origem: 'manual', Fonte: 'Manual', Tipo: 'Despesa',
    Data: data, Data_Pagamento: vencimento, Valor: -Math.abs(valor), Nome_Fantasia: `Compra ${idSeq}`,
    Categoria: 'Compras', Descricao_Original: `Compra ${idSeq}`, economic_event_id: null,
  }) as unknown as Transaction;

/** As duas linhas exatamente como o «Pagar fatura» grava (mesmos construtores da tela). */
const pernas = (ref: string, data: string, valor: number, source = BANK) => [
  {
    Data: data, Data_Pagamento: data, ID_Conta: CARD, Nome_Fantasia: 'Pagamento de Fatura', Categoria: 'Pagamento de Fatura',
    Tipo: 'Renda', Valor: valor, Fonte: 'Manual', Descricao_Original: buildDirectedPaymentDescription(ref, source),
  },
  {
    Data: data, Data_Pagamento: data, ID_Conta: source, Nome_Fantasia: `Pagamento Fatura — ${cartao.Nome_Conta}`,
    Categoria: 'Pagamento de Fatura', Tipo: 'Despesa', Valor: -Math.abs(valor), Fonte: 'Manual',
    Descricao_Original: buildFundingPaymentDescription(ref, cartao.Nome_Conta, source),
  },
] as never[];

/** Registra pelo serviço real do «Pagar», gravando no banco simulado. */
async function pagar(ref: string, data: string, valor: number, source = BANK) {
  const reg = await registerInvoicePayment({
    userId: A,
    cardAccount: cartao,
    sourceAccount: source === BANK ? banco : banco2,
    legs: pernas(ref, data, valor, source),
    addTransaction: async (legs) => {
      const rows = legs.map((l) => ({ ...l, ID_Transacao: `pg${++idSeq}`, user_id: A, Origem: 'manual', economic_event_id: (l as any).economic_event_id ?? null }));
      db().tables.transactions.push(...rows.map((r) => ({ ...r })));
      return rows as unknown as Transaction[];
    },
  });
  return reg;
}

const txs = () => db().tables.transactions.map((r) => ({ ...r })) as unknown as Transaction[];
const eventos = () => db().tables.economic_events.map((e) => ({ ...e })) as unknown as EconomicEvent[];

function projetar(transactions: Transaction[]) {
  const cards = svc.competenceHistoryCardsForAccount({
    accountId: CARD, account: cartao, accounts: contas, transactions, importLogs: [],
  });
  const p = projectCardTwoLedger(cards, { asOf: '2026-11-02' });
  const mes = (ref: string) => p.competences.find((c) => c.referenceMonth === ref);
  return { p, mes };
}

/** Saldo da conta de origem em centavos (só as linhas dela). */
const saldoConta = (transactions: Transaction[], id = BANK) =>
  transactions.filter((t) => t.ID_Conta === id).reduce((s, t) => s + Math.round(Number(t.Valor) * 100), 0);

const orfaos = () => {
  const usados = new Set(db().tables.transactions.map((t) => t.economic_event_id).filter(Boolean));
  return db().tables.economic_events.filter((e) => !usados.has(e.id));
};

const syncStore = () =>
  useAppStore.setState({
    user: { id: A } as never,
    accounts: contas as never,
    transactions: txs() as never,
    economicEvents: eventos() as never,
  });

beforeEach(() => {
  vi.clearAllMocks();
  const s = db();
  s.user = { id: A };
  s.tables.transactions = [];
  s.tables.economic_events = [];
  s.tables.credit_card_payments = [];
  s.log = [];
  s.failEventDelete = false; s.failUpdate = false; s.failEventInsert = false; s.beforeUpdate = null; s.seq = 0;
  idSeq = 0;
  useAppStore.setState(useAppStore.getInitialState(), true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  h.confirm.mockImplementation(async () => true);
});

/** Fatura 10/2026 (vence 18/11/2026) de R$ 5.431,93, como a do caso de referência. */
const seedFaturaOutubro = () => {
  db().tables.transactions.push(
    ...[compra('2026-10-12', '2026-11-18', 3000), compra('2026-10-20', '2026-11-18', 2431.93)].map((t) => ({ ...t }))
  );
};
/** Fatura 09/2026 (vence 18/10/2026) de R$ 1.000,00. */
const seedFaturaSetembro = () => {
  db().tables.transactions.push({ ...compra('2026-09-15', '2026-10-18', 1000) } as any);
};

// ---------------------------------------------------------------------------
describe('pagamento integral', () => {
  it('as duas linhas levam a fatura escolhida, a conta de origem e o mesmo evento; a fatura fica paga', async () => {
    seedFaturaOutubro();
    const reg = await pagar('2026-10', '2026-11-03', 5431.93);
    expect(reg.event?.kind).toBe('credit_card_payment');

    const all = txs();
    const legs = all.filter((t) => t.economic_event_id === reg.event!.id);
    expect(legs).toHaveLength(2);
    const lookup = accountLookup(contas);
    const info = legs.map((t) => describeInvoicePaymentLeg(t, lookup));
    expect(info.map((i) => i?.role).sort()).toEqual(['card', 'source']);
    expect(info.every((i) => i?.referenceMonth === '2026-10' && i?.sourceAccountId === BANK && i?.amountCents === 543193)).toBe(true);

    const { mes, p } = projetar(all);
    expect(mes('2026-10')?.statementTotalCents).toBe(543193);
    expect(mes('2026-10')?.economicOpenBalanceCents).toBe(0);
    expect(mes('2026-10')?.economicStatus).toBe('paid');
    expect(p.suspenseBalanceCents).toBe(0);
    expect(saldoConta(all)).toBe(-543193);

    // O par é achado a partir de qualquer lado.
    for (const leg of legs) {
      const pair = findInvoicePaymentPair(leg, all, contas)!;
      expect(pair.complete).toBe(true);
      expect(pair.legs.map((t) => t.ID_Transacao).sort()).toEqual(legs.map((t) => t.ID_Transacao).sort());
    }
    // Compra comum não é pagamento.
    expect(findInvoicePaymentPair(all.find((t) => t.Tipo === 'Despesa' && t.ID_Conta === CARD)!, all, contas)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('dois pagamentos parciais', () => {
  it('2.000,00 e depois 3.431,93: cada um conta uma vez e cada par fica com o seu evento', async () => {
    seedFaturaOutubro();
    const r1 = await pagar('2026-10', '2026-11-03', 2000);
    const depois1 = projetar(txs()).mes('2026-10')!;
    expect(depois1.recognizedPaymentsCents).toBe(200000);
    expect(depois1.economicOpenBalanceCents).toBe(343193);
    expect(depois1.economicStatus).toBe('open');

    const r2 = await pagar('2026-10', '2026-11-10', 3431.93);
    const all = txs();
    const { mes, p } = projetar(all);
    expect(mes('2026-10')?.recognizedPaymentsCents).toBe(543193);
    expect(mes('2026-10')?.economicOpenBalanceCents).toBe(0);
    expect(p.suspenseBalanceCents).toBe(0);
    expect(saldoConta(all)).toBe(-543193);

    expect(r1.event!.id).not.toBe(r2.event!.id);
    const pair1 = findInvoicePaymentPair(r1.cardLeg!, all, contas)!;
    const pair2 = findInvoicePaymentPair(r2.cardLeg!, all, contas)!;
    expect(pair1.legs.every((t) => t.economic_event_id === r1.event!.id)).toBe(true);
    expect(pair2.legs.every((t) => t.economic_event_id === r2.event!.id)).toBe(true);
  });

  it('dois parciais iguais no mesmo dia são aceitos (só aviso), e excluir um deixa o outro intacto', async () => {
    seedFaturaOutubro();
    await pagar('2026-10', '2026-11-03', 1000);
    expect(findPossibleDuplicatePayments({ cardAccountId: CARD, amount: 1000, dateIso: '2026-11-03', transactions: txs() })).toHaveLength(1);
    const r2 = await pagar('2026-10', '2026-11-03', 1000); // usuário confirmou: é outro pagamento
    expect(projetar(txs()).mes('2026-10')?.recognizedPaymentsCents).toBe(200000);

    syncStore();
    await useAppStore.getState().deleteTransaction(r2.cardLeg!.ID_Transacao!);
    const all = txs();
    expect(all.filter((t) => t.economic_event_id === r2.event!.id)).toHaveLength(0);
    expect(projetar(all).mes('2026-10')?.recognizedPaymentsCents).toBe(100000);
    expect(saldoConta(all)).toBe(-100000);
    expect(orfaos()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('tentativa de duplicidade', () => {
  it('avisa só quando valor E data coincidem; inclui pagamento importado; não bloqueia', async () => {
    seedFaturaOutubro();
    await pagar('2026-10', '2026-11-03', 2000);
    const importado = {
      ID_Transacao: 'imp1', ID_Conta: CARD, Origem: 'nubank_2026-11.csv', Tipo: 'Renda', Valor: 750, Data: '2026-11-05',
      Nome_Fantasia: 'Pagamento recebido', Descricao_Original: 'Pagamento recebido', Categoria: 'Pagamento Cartão de Crédito',
    } as unknown as Transaction;
    const all = [...txs(), importado];
    const dup = (amount: number, dateIso: string) => findPossibleDuplicatePayments({ cardAccountId: CARD, amount, dateIso, transactions: all });

    expect(dup(2000, '2026-11-03')).toHaveLength(1);
    expect(dup(2000, '2026-11-04')).toHaveLength(0); // mesma quantia, outro dia: sem aviso
    expect(dup(1999.99, '2026-11-03')).toHaveLength(0); // mesmo dia, outra quantia: sem aviso
    expect(dup(750, '2026-11-05')).toHaveLength(1); // igual a um pagamento importado do extrato
    // Compra do mesmo valor não é pagamento.
    expect(findPossibleDuplicatePayments({ cardAccountId: CARD, amount: 3000, dateIso: '2026-10-12', transactions: all })).toHaveLength(0);

    const msg = duplicatePaymentWarning(dup(2000, '2026-11-03'));
    expect(msg).toContain('03/11/2026');
    expect(msg).toMatch(/2\.000,00/);
    expect(msg).toMatch(/pode registrar/);
    expect(msg).not.toMatch(/compet|motor|ledger/i);
  });

  it('a tela pede confirmação e só desiste se o usuário voltar', () => {
    const view = readFileSync(resolve(__dirname, '../../src/components/views/TransactionsView.tsx'), 'utf8');
    const check = view.slice(view.indexOf('const confirmPayInvoiceRequest'), view.indexOf('const submitPayCreditCardInvoice'));
    expect(check).toMatch(/findPossibleDuplicatePayments\(/);
    expect(check).toMatch(/'Registrar mesmo assim'/);
    expect(check).toMatch(/if \(duplicates\.length === 0\) return true;/);
    const submit = view.slice(view.indexOf('const submitPayCreditCardInvoice'), view.indexOf('const openStatementHistory'));
    expect(submit.indexOf('await confirmPayInvoiceRequest(')).toBeGreaterThan(0);
    expect(submit.indexOf('await confirmPayInvoiceRequest(')).toBeLessThan(submit.indexOf('registerInvoicePayment('));
    expect(submit).toMatch(/\) \|\| !sourceAccount\) return false;/);
  });
});

// ---------------------------------------------------------------------------
describe('escolha e correção da fatura', () => {
  it('o pagamento vai para a fatura escolhida, não para a da data', async () => {
    seedFaturaSetembro();
    seedFaturaOutubro();
    // Pago em 03/11 (data da fatura de outubro), mas o usuário escolheu setembro.
    await pagar('2026-09', '2026-11-03', 1000);
    const { mes } = projetar(txs());
    expect(mes('2026-09')?.economicOpenBalanceCents).toBe(0);
    expect(mes('2026-10')?.recognizedPaymentsCents).toBe(0);
    expect(mes('2026-10')?.economicOpenBalanceCents).toBe(543193);
  });

  it('corrigir = excluir (os dois lados saem juntos) e registrar de novo na fatura certa', async () => {
    seedFaturaSetembro();
    seedFaturaOutubro();
    const errado = await pagar('2026-09', '2026-11-03', 2000); // fatura errada
    syncStore();
    await useAppStore.getState().deleteTransaction(errado.cardLeg!.ID_Transacao!);
    expect(txs().filter((t) => String(t.ID_Transacao).startsWith('pg'))).toHaveLength(0);
    expect(orfaos()).toHaveLength(0);

    await pagar('2026-10', '2026-11-03', 2000);
    const all = txs();
    const { mes } = projetar(all);
    expect(mes('2026-09')?.economicOpenBalanceCents).toBe(100000); // voltou a ficar em aberto
    expect(mes('2026-10')?.economicOpenBalanceCents).toBe(343193);
    expect(saldoConta(all)).toBe(-200000); // a conta saiu uma vez só
    expect(db().tables.economic_events).toHaveLength(1);
  });

  it('editar um lado só muda nome e categoria; valor, data, conta e fatura ficam e o usuário é orientado', async () => {
    seedFaturaOutubro();
    const reg = await pagar('2026-10', '2026-11-03', 2000);
    syncStore();
    const bankLeg = txs().find((t) => t.ID_Conta === BANK)!;
    await useAppStore.getState().updateTransaction({
      ...bankLeg, Valor: -3000, Data: '2026-11-04' as never, Descricao_Original: 'Pagamento Fatura', Nome_Fantasia: 'Fatura do Nubank',
    } as Transaction);
    const row = db().tables.transactions.find((t) => t.ID_Transacao === bankLeg.ID_Transacao)!;
    expect(row.Valor).toBe(-2000);
    expect(row.Data).toBe('2026-11-03');
    expect(row.Descricao_Original).toBe(bankLeg.Descricao_Original);
    expect(row.economic_event_id).toBe(reg.event!.id);
    expect(row.Nome_Fantasia).toBe('Fatura do Nubank');
    expect(h.alert).toHaveBeenCalledWith(INVOICE_PAYMENT_EDIT_GUIDANCE, 'Pagamento de fatura', 'warning');

    // Só nome: sem aviso.
    h.alert.mockClear();
    syncStore();
    const cardLeg = txs().find((t) => t.ID_Conta === CARD && t.Tipo === 'Renda')!;
    await useAppStore.getState().updateTransaction({ ...cardLeg, Categoria: 'Cartão' } as Transaction);
    expect(db().tables.transactions.find((t) => t.ID_Transacao === cardLeg.ID_Transacao)!.Categoria).toBe('Cartão');
    expect(h.alert).not.toHaveBeenCalled();
    expect(projetar(txs()).mes('2026-10')?.economicOpenBalanceCents).toBe(343193);
  });

  it('regra de edição isolada', () => {
    const prev = { ID_Transacao: 't', Nome_Fantasia: 'a', Categoria: 'b', Valor: 10, Data: '2026-11-03' } as unknown as Transaction;
    expect(restrictInvoicePaymentUpdate(prev, { Valor: 20, Nome_Fantasia: 'c', Categoria: 'b' })).toEqual({ Nome_Fantasia: 'c' });
    expect(wouldChangeInvoicePaymentMoney(prev, { Valor: 10, Data: new Date('2026-11-03T12:00:00') as never, Nome_Fantasia: 'z' })).toBe(false);
    expect(wouldChangeInvoicePaymentMoney(prev, { Valor: 10.01 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('pagamento iniciado pela tela de transações', () => {
  it('despesa na conta com cara de pagamento de fatura é reconhecida (e o cartão pelo nome)', () => {
    const cards = [cartao, { id: 'card-xp', Nome_Conta: 'XP Visa' } as Account];
    expect(detectInvoicePaymentFromBank({ nome: 'Pagamento fatura Cartão Nubank' }, cards)).toEqual({ looksLikePayment: true, cardId: CARD });
    expect(detectInvoicePaymentFromBank({ nome: 'Pgto fatura' }, cards)).toEqual({ looksLikePayment: true, cardId: null });
    expect(detectInvoicePaymentFromBank({ nome: 'Fatura XP Visa' }, cards)).toEqual({ looksLikePayment: true, cardId: 'card-xp' });
    expect(detectInvoicePaymentFromBank({ nome: 'Conta de luz', categoria: 'Moradia' }, cards).looksLikePayment).toBe(false);
    expect(detectInvoicePaymentFromBank({ nome: 'Pagamento boleto escola' }, cards).looksLikePayment).toBe(false);
    expect(detectInvoicePaymentFromBank({ nome: 'Pagamento fatura' }, []).looksLikePayment).toBe(false);
  });

  it('o formulário oferece «Pagar fatura» com o valor e a conta já preenchidos, sem salvar despesa em silêncio', () => {
    const form = readFileSync(resolve(__dirname, '../../src/components/modals/NewTransactionModal.tsx'), 'utf8');
    const submit = form.slice(form.indexOf('const handleSubmit'), form.indexOf('setIsSaving(true);\n\n    const valorBase'));
    // Lado da conta: confirma; «Voltar» não salva; «Ir» abre o Pagar com a conta de origem.
    expect(submit).toMatch(/bankSidePayment && bankSideTargetCard && selectedAccount && !notCardPayment/);
    expect(submit).toMatch(/openPayInvoiceFlow\(bankSideTargetCard, Number\.isFinite\(amount\) \? amount : 0, selectedAccount\.id\)/);
    // Lado do cartão: nunca salva pagamento fora do fluxo, e nunca em silêncio.
    expect(submit).not.toMatch(/cardEntryKind === 'invoice_payment'\) \{\n\s+return;/);
    expect(submit).toMatch(/Pagamento de fatura se registra em «Pagar fatura»/);

    const view = readFileSync(resolve(__dirname, '../../src/components/views/TransactionsView.tsx'), 'utf8');
    expect(view).toMatch(/handlePayInvoice\(account, suggestedAmount, \{ amount: suggestedAmount, sourceAccountId \}\)/);
    expect(view).toMatch(/presetSourceAccountId=\{payInvoiceModal\.presetSourceAccountId\}/);

    const modal = readFileSync(resolve(__dirname, '../../src/components/modals/PayCreditCardInvoiceModal.tsx'), 'utf8');
    expect(modal).toMatch(/if \(presetSourceAccountId && ids\.has\(presetSourceAccountId\)\) return presetSourceAccountId;/);
    expect(modal).toMatch(/if \(registered !== false\) onClose\(\);/);
    expect(modal).not.toMatch(/competência|compet[eê]ncias seguintes/);
  });

  it('valor digitado no formato brasileiro', () => {
    expect(parsePaymentAmountInput('2.000,00')).toBe(2000);
    expect(parsePaymentAmountInput('R$ 3.431,92')).toBe(3431.92);
    expect(parsePaymentAmountInput('3431,92')).toBe(3431.92);
    expect(parsePaymentAmountInput('3431.92')).toBe(3431.92);
    expect(parsePaymentAmountInput('2.000')).toBe(2000);
    expect(parsePaymentAmountInput('0,01')).toBe(0.01);
    for (const bad of ['', 'abc', '0', '0,00', '-5', '1,2,3', '2.000,005']) expect(parsePaymentAmountInput(bad)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('exclusão e reversão de um pagamento, sem eventos órfãos', () => {
  const seedOutros = () => {
    // Movimentação interna marcada pelo usuário (outro tipo de evento) e uma despesa comum: não podem ser tocadas.
    db().tables.economic_events.push({ id: 'ev-mov', user_id: A, kind: 'own_account_transfer', source: 'user', counterparty_account_id: null, created_by: A, created_at: 't' });
    db().tables.transactions.push(
      { ID_Transacao: 'mov1', user_id: A, ID_Conta: BANK, Origem: 'manual', Tipo: 'Despesa', Valor: -500, Data: '2026-11-03', Nome_Fantasia: 'Transferência', Descricao_Original: 'Transferência', Categoria: 'Transferência', economic_event_id: 'ev-mov' },
      { ID_Transacao: 'luz', user_id: A, ID_Conta: BANK, Origem: 'manual', Tipo: 'Despesa', Valor: -2000, Data: '2026-11-03', Nome_Fantasia: 'Conta de luz', Descricao_Original: 'Conta de luz', Categoria: 'Moradia', economic_event_id: null }
    );
  };

  it('excluir pela conta de origem: os dois lados, o evento e o registro do cartão saem; o resto fica', async () => {
    seedFaturaOutubro();
    seedOutros();
    const reg = await pagar('2026-10', '2026-11-03', 2000);
    db().tables.credit_card_payments.push(
      { id: 'ccp-1', card_id: 'eng-card', payment_transaction_id: reg.cardLeg!.ID_Transacao, source: 'manual', amount: 2000 },
      // Visto em staging: a sincronização do cartão grava um segundo registro para a mesma linha.
      { id: 'ccp-sync', card_id: 'eng-card', payment_transaction_id: reg.cardLeg!.ID_Transacao, source: 'imported_statement', amount: 2000 },
      { id: 'ccp-imp', card_id: 'eng-card', payment_transaction_id: 'imp-x', source: 'imported_statement', amount: 100 }
    );
    syncStore();
    const antes = projetar(txs());
    expect(antes.mes('2026-10')?.economicOpenBalanceCents).toBe(343193);

    const bankLeg = txs().find((t) => t.ID_Conta === BANK && t.economic_event_id === reg.event!.id)!;
    const pair = findInvoicePaymentPair(bankLeg, txs(), contas)!;
    const msg = invoicePaymentDeletionMessage(pair, contas);
    expect(msg).toMatch(/Os dois lados saem juntos/);
    expect(msg).toMatch(/fatura de outubro\/2026 do cartão Cartão Nubank/);
    expect(msg).not.toMatch(/compet|motor|evento/i);

    await useAppStore.getState().deleteTransaction(bankLeg.ID_Transacao!);

    const all = txs();
    expect(all.some((t) => t.economic_event_id === reg.event!.id)).toBe(false);
    expect(db().tables.economic_events.map((e) => e.id)).toEqual(['ev-mov']);
    expect(db().tables.credit_card_payments.map((p) => p.id)).toEqual(['ccp-imp']);
    expect(all.map((t) => t.ID_Transacao)).toEqual(expect.arrayContaining(['mov1', 'luz']));
    expect(orfaos()).toHaveLength(0);
    // Reversão completa: a fatura volta ao valor de antes do pagamento, a conta também.
    expect(projetar(all).mes('2026-10')?.economicOpenBalanceCents).toBe(543193);
    expect(saldoConta(all)).toBe(-250000); // só a transferência (500) e a luz (2.000)
    // O app esqueceu o evento e as duas linhas.
    const st = useAppStore.getState();
    expect(st.economicEvents.map((e) => e.id)).toEqual(['ev-mov']);
    expect(st.transactions.some((t) => t.economic_event_id === reg.event!.id)).toBe(false);
    // Um único comando apagou as duas linhas.
    const deletes = db().log.filter((l) => l.table === 'transactions' && l.op === 'delete');
    expect(deletes).toHaveLength(1);
    expect((deletes[0].filters![0][2] as string[]).sort()).toEqual(pair.legs.map((t) => t.ID_Transacao).sort());
  });

  it('pagamento antigo (sem evento comum, um evento por linha do backfill): os dois lados e os dois eventos saem', async () => {
    seedFaturaOutubro();
    const [c, b] = pernas('2026-10', '2026-10-30', 1500);
    db().tables.economic_events.push(
      { id: 'bf-1', user_id: A, kind: 'credit_card_payment', source: 'backfill_funding_marker', counterparty_account_id: null, created_by: A, created_at: 't' },
      { id: 'bf-2', user_id: A, kind: 'credit_card_payment', source: 'backfill_funding_marker', counterparty_account_id: null, created_by: A, created_at: 't' }
    );
    db().tables.transactions.push(
      { ...(c as any), ID_Transacao: 'old-card', user_id: A, Origem: 'manual', economic_event_id: 'bf-1' },
      { ...(b as any), ID_Transacao: 'old-bank', user_id: A, Origem: 'manual', economic_event_id: 'bf-2' }
    );
    syncStore();
    await useAppStore.getState().deleteTransaction('old-card');
    expect(txs().some((t) => t.ID_Transacao === 'old-bank')).toBe(false);
    expect(db().tables.economic_events).toHaveLength(0);
    expect(saldoConta(txs())).toBe(0);
  });

  it('exclusão em lote: selecionar só o lado do cartão leva o da conta; idênticos levam cada um o seu', async () => {
    seedFaturaOutubro();
    // Dois pagamentos antigos idênticos, sem evento.
    for (const n of [1, 2]) {
      const [c, b] = pernas('2026-10', '2026-10-30', 700);
      db().tables.transactions.push(
        { ...(c as any), ID_Transacao: `oc${n}`, user_id: A, Origem: 'manual', economic_event_id: null },
        { ...(b as any), ID_Transacao: `ob${n}`, user_id: A, Origem: 'manual', economic_event_id: null }
      );
    }
    const novo = await pagar('2026-10', '2026-11-03', 2000);
    syncStore();

    const sel = txs().filter((t) => ['oc1', 'oc2', novo.cardLeg!.ID_Transacao].includes(String(t.ID_Transacao)));
    const exp = expandInvoicePaymentSelection(sel, txs(), contas);
    expect(exp.addedIds.sort()).toEqual(['ob1', 'ob2', txs().find((t) => t.ID_Conta === BANK && t.economic_event_id === novo.event!.id)!.ID_Transacao].sort());

    const n = await useAppStore.getState().deleteManualTransactions(sel.map((t) => t.ID_Transacao!));
    expect(n).toBe(6);
    expect(txs().filter((t) => t.Tipo === 'Renda' || t.ID_Conta === BANK)).toHaveLength(0);
    expect(orfaos()).toHaveLength(0);
    expect(projetar(txs()).mes('2026-10')?.economicOpenBalanceCents).toBe(543193);
  });

  it('lado sem par (o outro já não existe): sai só ele e o seu evento; a mensagem avisa', async () => {
    seedFaturaOutubro();
    const reg = await pagar('2026-10', '2026-11-03', 2000);
    db().tables.transactions = db().tables.transactions.filter((t) => t.ID_Conta !== BANK);
    syncStore();
    const pair = findInvoicePaymentPair(reg.cardLeg!, txs(), contas)!;
    expect(pair.complete).toBe(false);
    expect(invoicePaymentDeletionMessage(pair, contas)).toMatch(/Só este lançamento será excluído/);
    await useAppStore.getState().deleteTransaction(reg.cardLeg!.ID_Transacao!);
    expect(db().tables.economic_events).toHaveLength(0);
    expect(txs().filter((t) => t.Tipo === 'Renda')).toHaveLength(0);
  });

  it('falha ao excluir: nada muda e o usuário é avisado em linguagem simples', async () => {
    seedFaturaOutubro();
    await pagar('2026-10', '2026-11-03', 2000);
    syncStore();
    const antes = JSON.stringify(db().tables);
    const out = deleteTransactionsWithPaymentCleanup({
      transactions: txs().filter((t) => t.Tipo === 'Renda'),
      deps: { deleteTransactions: async () => { throw new Error('rede'); } },
    });
    await expect(out).rejects.toThrow('Não foi possível excluir. Nada foi alterado. Tente novamente.');
    expect(JSON.stringify(db().tables)).toBe(antes);

    const realFrom = h.db.supabase.from;
    h.db.supabase.from = (t: string) => {
      if (t === 'transactions') {
        const q = realFrom(t);
        const del = q.delete.bind(q);
        q.delete = () => { del(); return { in: () => ({ select: async () => ({ data: null, error: { message: 'boom' } }) }) }; };
        return q;
      }
      return realFrom(t);
    };
    try {
      const card = txs().find((t) => t.Tipo === 'Renda')!;
      await useAppStore.getState().deleteTransaction(card.ID_Transacao!);
      expect(h.alert).toHaveBeenCalledWith('Não foi possível excluir. Nada foi alterado. Tente novamente.', 'Excluir pagamento', 'danger');
      expect(useAppStore.getState().transactions.filter((t) => String(t.ID_Transacao).startsWith('pg'))).toHaveLength(2);
    } finally {
      h.db.supabase.from = realFrom;
    }
  });

  it('excluir lançamento comum continua como antes e não toca pagamentos', async () => {
    seedFaturaOutubro();
    seedOutros();
    const reg = await pagar('2026-10', '2026-11-03', 2000);
    syncStore();
    await useAppStore.getState().deleteTransaction('luz');
    expect(txs().filter((t) => t.economic_event_id === reg.event!.id)).toHaveLength(2);
    expect(db().tables.economic_events.map((e) => e.id).sort()).toEqual(['ev-mov', reg.event!.id].sort());
    expect(h.confirm).not.toHaveBeenCalled();
  });
});
