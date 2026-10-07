import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BADGE_CREDIT_CARD_PAYMENT,
  BADGE_INTERNAL_MOVEMENT,
  canMarkInternalMovement,
  canUndoInternalMovement,
  countLegsByEventId,
  resolveEconomicIdentityBadge,
} from '../../src/domain/economics/manualEconomicIdentity';

const A = 'user-a';
const B = 'user-b';
const tx = (o: Record<string, unknown> = {}) =>
  ({ user_id: A, economic_event_id: null, Origem: 'manual', Fonte: 'Manual', Descricao_Original: 'x', ...o }) as never;
const ev = (o: Record<string, unknown> = {}) => ({ id: 'e1', kind: 'own_account_transfer', source: 'user', user_id: A, ...o }) as never;

describe('canMarkInternalMovement', () => {
  it('dono + sem evento + normal ⇒ pode (manual e importada)', () => {
    expect(canMarkInternalMovement(tx(), A)).toBe(true);
    expect(canMarkInternalMovement(tx({ Origem: 'extrato.csv', Fonte: 'Conta' }), A)).toBe(true);
  });
  it('familiar (não dono), sem sessão ou sem user_id ⇒ não', () => {
    expect(canMarkInternalMovement(tx({ user_id: B }), A)).toBe(false);
    expect(canMarkInternalMovement(tx(), null)).toBe(false);
    expect(canMarkInternalMovement(tx({ user_id: undefined }), A)).toBe(false);
  });
  it('demo, marcador do Pagar e já classificada ⇒ não', () => {
    expect(canMarkInternalMovement(tx({ Origem: 'demo.csv' }), A)).toBe(false);
    expect(canMarkInternalMovement(tx({ Fonte: 'Demo' }), A)).toBe(false);
    expect(canMarkInternalMovement(tx({ Descricao_Original: 'Pagamento finelo_funding_account:abc' }), A)).toBe(false);
    expect(canMarkInternalMovement(tx({ economic_event_id: 'e1' }), A)).toBe(false);
  });
});

describe('canUndoInternalMovement', () => {
  const linked = tx({ economic_event_id: 'e1' });
  it('own_account_transfer/user do dono, 1 perna ⇒ desfaz', () => {
    expect(canUndoInternalMovement(linked, ev(), A, 1)).toBe(true);
  });
  it('eventos automáticos e outros tipos ⇒ nunca', () => {
    for (const source of ['pay_invoice_flow', 'backfill_funding_marker', 'transfer_flow']) {
      expect(canUndoInternalMovement(linked, ev({ source }), A, 1)).toBe(false);
    }
    expect(canUndoInternalMovement(linked, ev({ kind: 'credit_card_payment' }), A, 1)).toBe(false);
  });
  it('multi-leg, 0 pernas, outro dono ou evento diferente do da transação ⇒ não', () => {
    expect(canUndoInternalMovement(linked, ev(), A, 2)).toBe(false);
    expect(canUndoInternalMovement(linked, ev(), A, 0)).toBe(false);
    expect(canUndoInternalMovement(linked, ev({ user_id: B }), A, 1)).toBe(false);
    expect(canUndoInternalMovement(linked, ev({ id: 'e2' }), A, 1)).toBe(false);
    expect(canUndoInternalMovement(linked, ev(), null, 1)).toBe(false);
  });
  it('evento desconhecido ⇒ sem desfazer', () => {
    expect(canUndoInternalMovement(linked, undefined, A, 1)).toBe(false);
  });
});

describe('selos', () => {
  it('um por tipo; evento desconhecido ⇒ sem selo; nada inferido pelo marcador do Pagar', () => {
    expect(resolveEconomicIdentityBadge({ kind: 'credit_card_payment' })).toBe(BADGE_CREDIT_CARD_PAYMENT);
    expect(resolveEconomicIdentityBadge({ kind: 'own_account_transfer' })).toBe(BADGE_INTERNAL_MOVEMENT);
    expect(BADGE_CREDIT_CARD_PAYMENT).toBe('Pagamento de fatura');
    expect(BADGE_INTERNAL_MOVEMENT).toBe('Movimentação interna');
    expect(resolveEconomicIdentityBadge(undefined)).toBeNull();
    expect(resolveEconomicIdentityBadge(null)).toBeNull();
    expect(resolveEconomicIdentityBadge({ kind: 'refund' as never })).toBeNull();
  });
  it('contagem de pernas por evento', () => {
    expect([...countLegsByEventId([{ economic_event_id: 'a' }, { economic_event_id: 'a' }, { economic_event_id: 'b' }, { economic_event_id: null }, {}])]).toEqual([['a', 2], ['b', 1]]);
  });
  it('o domínio é puro (sem React, Supabase ou store)', () => {
    const src = readFileSync(resolve('src/domain/economics/manualEconomicIdentity.ts'), 'utf8');
    expect(src).not.toMatch(/supabase|useAppStore|from 'react'|economicEventService/);
  });
});
