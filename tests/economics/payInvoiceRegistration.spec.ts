import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { EconomicEvent, Transaction } from '../../src/types';
import {
  canCreateInvoicePaymentEvent,
  findInvoicePaymentLegs,
  registerInvoicePayment,
} from '../../src/services/payInvoiceRegistration';
import { buildDirectedPaymentDescription, buildFundingPaymentDescription } from '../../src/services/creditCardDirectedPayment';

const A = 'user-a';
const B = 'user-b';
const card = { id: 'card-1', user_id: A };
const bank = { id: 'bank-1', user_id: A };
const EVENT: EconomicEvent = {
  id: 'ev-1',
  user_id: A,
  kind: 'credit_card_payment',
  source: 'pay_invoice_flow',
  counterparty_account_id: null,
  created_by: A,
  created_at: '',
};

const legs = () =>
  [
    {
      Data: '2026-10-07',
      Data_Pagamento: '2026-10-07',
      ID_Conta: card.id,
      Nome_Fantasia: 'Pagamento de Fatura',
      Categoria: 'Pagamento Cartão',
      Tipo: 'Renda',
      Valor: 100,
      Fonte: 'Manual',
      Descricao_Original: buildDirectedPaymentDescription('2026-09', bank.id),
    },
    {
      Data: '2026-10-07',
      Data_Pagamento: '2026-10-07',
      ID_Conta: bank.id,
      Nome_Fantasia: 'Pagamento Fatura — Cartão',
      Categoria: 'Pagamento Cartão',
      Tipo: 'Despesa',
      Valor: -100,
      Fonte: 'Manual',
      Descricao_Original: buildFundingPaymentDescription('2026-09', 'Cartão', bank.id),
    },
  ] as never[];

/** Simula o INSERT: devolve linhas com IDs reais — propositalmente na ordem INVERSA (não pode importar). */
const fakeAdd = (reverse = true) =>
  vi.fn(async (input: Array<Record<string, unknown>>) => {
    const rows = input.map((l, i) => ({ ...l, ID_Transacao: `tx-${i + 1}`, user_id: A, Origem: 'manual' })) as unknown as Transaction[];
    return reverse ? [...rows].reverse() : rows;
  });

describe('Pagar — elegibilidade do evento (mesmo dono, provado pela conta)', () => {
  it('só com cartão E conta pagadora do usuário autenticado', () => {
    expect(canCreateInvoicePaymentEvent(A, card, bank)).toBe(true);
    expect(canCreateInvoicePaymentEvent(A, { user_id: B }, bank)).toBe(false);
    expect(canCreateInvoicePaymentEvent(A, card, { user_id: B })).toBe(false);
    expect(canCreateInvoicePaymentEvent(A, { user_id: undefined as unknown as string }, bank)).toBe(false);
    expect(canCreateInvoicePaymentEvent(null, card, bank)).toBe(false);
    expect(canCreateInvoicePaymentEvent(undefined, { user_id: undefined as unknown as string }, { user_id: undefined as unknown as string })).toBe(false);
  });
});

describe('Pagar — mesmo dono', () => {
  it('cria UM evento credit_card_payment/pay_invoice_flow e grava o MESMO id nas duas pernas', async () => {
    const createEvent = vi.fn(async () => EVENT);
    const add = fakeAdd();
    const r = await registerInvoicePayment({
      userId: A, cardAccount: card, sourceAccount: bank, legs: legs(), addTransaction: add, createEvent, deleteEvent: vi.fn(),
    });
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(createEvent).toHaveBeenCalledWith({ kind: 'credit_card_payment', source: 'pay_invoice_flow' }); // sem counterparty
    expect(add).toHaveBeenCalledTimes(1);
    const sent = add.mock.calls[0][0];
    expect(sent).toHaveLength(2);
    expect(sent.map((l) => l.economic_event_id)).toEqual(['ev-1', 'ev-1']);
    expect(r.event).toEqual(EVENT);
  });

  it('as duas pernas e os marcadores legados NÃO mudam (só ganham economic_event_id)', async () => {
    const add = fakeAdd();
    const original = legs();
    await registerInvoicePayment({
      userId: A, cardAccount: card, sourceAccount: bank, legs: original, addTransaction: add,
      createEvent: async () => EVENT, deleteEvent: vi.fn(),
    });
    const sent = add.mock.calls[0][0];
    sent.forEach((leg, i) => {
      const { economic_event_id, ...rest } = leg as Record<string, unknown>;
      expect(economic_event_id).toBe('ev-1');
      expect(rest).toEqual(original[i]);
    });
    const [cardLeg, bankLeg] = sent as Array<Record<string, any>>;
    expect([cardLeg.ID_Conta, cardLeg.Tipo, cardLeg.Valor]).toEqual(['card-1', 'Renda', 100]);
    expect([bankLeg.ID_Conta, bankLeg.Tipo, bankLeg.Valor]).toEqual(['bank-1', 'Despesa', -100]);
    expect(cardLeg.Descricao_Original).toContain('finelo_funding_account:bank-1');
    expect(bankLeg.Descricao_Original).toContain('finelo_funding_account:bank-1');
  });

  it('a perna do CARTÃO é achada pela estrutura, não pela ordem do retorno (nem a bancária)', async () => {
    for (const reverse of [true, false]) {
      const r = await registerInvoicePayment({
        userId: A, cardAccount: card, sourceAccount: bank, legs: legs(), addTransaction: fakeAdd(reverse),
        createEvent: async () => EVENT, deleteEvent: vi.fn(),
      });
      expect(r.cardLeg?.ID_Conta).toBe('card-1');
      expect(r.cardLeg?.Tipo).toBe('Renda');
      expect(r.cardLeg?.ID_Transacao).toBe('tx-1'); // a 1ª enviada (cartão), em qualquer ordem de retorno
    }
  });

  it('ambiguidade (duas Rendas no cartão) → nenhuma perna escolhida', () => {
    const mk = (id: string, conta: string, tipo: 'Renda' | 'Despesa') =>
      ({ ID_Transacao: id, ID_Conta: conta, Tipo: tipo, economic_event_id: 'ev-1' }) as unknown as Transaction;
    expect(
      findInvoicePaymentLegs({
        added: [mk('1', 'card-1', 'Renda'), mk('2', 'card-1', 'Renda'), mk('3', 'bank-1', 'Despesa')],
        cardAccountId: 'card-1', sourceAccountId: 'bank-1', eventId: 'ev-1',
      })
    ).toBeNull();
    expect(
      findInvoicePaymentLegs({
        added: [mk('1', 'card-1', 'Renda')], cardAccountId: 'card-1', sourceAccountId: 'bank-1', eventId: 'ev-1',
      })
    ).toBeNull();
  });
});

describe('Pagar — família / cross-owner', () => {
  it.each([
    ['cartão de outro dono', { id: 'card-1', user_id: B }, bank],
    ['conta pagadora de outro dono', card, { id: 'bank-1', user_id: B }],
    ['dono da conta desconhecido', { id: 'card-1', user_id: undefined }, bank],
  ])('%s → NÃO cria evento, fluxo legado intacto, sem perna do cartão para o motor', async (_n, c, s) => {
    const createEvent = vi.fn(async () => EVENT);
    const add = fakeAdd();
    const r = await registerInvoicePayment({
      userId: A, cardAccount: c as never, sourceAccount: s as never, legs: legs(), addTransaction: add,
      createEvent, deleteEvent: vi.fn(),
    });
    expect(createEvent).not.toHaveBeenCalled();
    expect(add.mock.calls[0][0].every((l) => !('economic_event_id' in (l as object)))).toBe(true);
    expect(r.event).toBeNull();
    expect(r.cardLeg).toBeNull();
    expect(r.added).toHaveLength(2);
  });

  it('sem usuário autenticado → fluxo legado', async () => {
    const createEvent = vi.fn(async () => EVENT);
    const r = await registerInvoicePayment({
      userId: null, cardAccount: card, sourceAccount: bank, legs: legs(), addTransaction: fakeAdd(), createEvent, deleteEvent: vi.fn(),
    });
    expect(createEvent).not.toHaveBeenCalled();
    expect(r.event).toBeNull();
  });
});

describe('Pagar — falhas', () => {
  it('falha ao CRIAR o evento: o pagamento segue pelo fluxo legado (nunca é bloqueado)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const add = fakeAdd();
    const r = await registerInvoicePayment({
      userId: A, cardAccount: card, sourceAccount: bank, legs: legs(), addTransaction: add,
      createEvent: async () => { throw new Error('tabela inexistente'); }, deleteEvent: vi.fn(),
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][0].every((l) => !('economic_event_id' in (l as object)))).toBe(true);
    expect(r.event).toBeNull();
    expect(r.cardLeg).toBeNull();
    warn.mockRestore();
  });

  it('falha no INSERT das pernas: apaga o evento órfão e repropaga o erro ORIGINAL', async () => {
    const deleteEvent = vi.fn(async () => {});
    const original = new Error('insert falhou');
    await expect(
      registerInvoicePayment({
        userId: A, cardAccount: card, sourceAccount: bank, legs: legs(),
        addTransaction: async () => { throw original; }, createEvent: async () => EVENT, deleteEvent,
      })
    ).rejects.toBe(original);
    expect(deleteEvent).toHaveBeenCalledWith('ev-1');
  });

  it('se a compensação também falhar: loga o erro secundário e ainda reporta o ORIGINAL', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = new Error('insert falhou');
    await expect(
      registerInvoicePayment({
        userId: A, cardAccount: card, sourceAccount: bank, legs: legs(),
        addTransaction: async () => { throw original; }, createEvent: async () => EVENT,
        deleteEvent: async () => { throw new Error('delete falhou'); },
      })
    ).rejects.toBe(original);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('sem evento criado e INSERT falhando: nada a compensar', async () => {
    const deleteEvent = vi.fn();
    await expect(
      registerInvoicePayment({
        userId: A, cardAccount: { id: 'card-1', user_id: B }, sourceAccount: bank, legs: legs(),
        addTransaction: async () => { throw new Error('x'); }, deleteEvent,
      })
    ).rejects.toThrow('x');
    expect(deleteEvent).not.toHaveBeenCalled();
  });
});

describe('Pagar — integração com a TransactionsView e o motor', () => {
  const view = readFileSync(resolve('src/components/views/TransactionsView.tsx'), 'utf8');
  const engine = readFileSync(resolve('src/services/creditCardEngineService.ts'), 'utf8');

  it('usa registerInvoicePayment e passa a perna do CARTÃO como payment_transaction_id (nunca a bancária)', () => {
    expect(view).toContain('registerInvoicePayment({');
    expect(view).toContain('cardLegTransactionId = registration.cardLeg?.ID_Transacao;');
    expect(view).toContain('paymentTransactionId: cardLegTransactionId,');
    expect(view).not.toMatch(/bankLeg/);
  });

  it('o motor persiste payment_transaction_id; sem ele grava null (comportamento anterior)', () => {
    expect(engine).toContain('payment_transaction_id: input.paymentTransactionId || null,');
  });

  it('o statement alvo não encontrado e a falha do motor não desfazem o evento nem as pernas (política preservada)', () => {
    const after = view.slice(view.indexOf('registerInvoicePayment({'));
    expect(after).toContain("console.error('[TransactionsView] Pagamento no motor (competência escolhida):', error);");
    expect(after.slice(after.indexOf('Pagamento no motor')).split('setCompetenceConfirmRevision')[0]).not.toMatch(/deleteEconomicEvent|deleteEvent/);
  });
});
