import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  EconomicIdentityBadge,
  InternalMovementActionButton,
  internalMovementActionLabel,
} from '../../src/components/transactions/EconomicIdentityControls';
import {
  BADGE_CREDIT_CARD_PAYMENT,
  BADGE_INTERNAL_MOVEMENT,
  MARK_ACTION_LABEL,
  UNDO_ACTION_LABEL,
  canMarkInternalMovement,
  canUndoInternalMovement,
  countLegsByEventId,
  resolveEconomicIdentityBadge,
} from '../../src/domain/economics/manualEconomicIdentity';

const read = (p: string) => readFileSync(resolve(p), 'utf8').replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const view = read('src/components/views/TransactionsView.tsx');
const controls = read('src/components/transactions/EconomicIdentityControls.tsx');
const store = read('src/hooks/useAppStore.ts');

const A = 'user-a';
const B = 'user-b';
const tx = (o: Record<string, unknown> = {}) => ({ user_id: A, economic_event_id: null, Origem: 'manual', Fonte: 'Manual', Descricao_Original: 'x', ...o }) as never;

describe('selos', () => {
  it('renderiza o texto exato de cada selo', () => {
    expect(renderToStaticMarkup(React.createElement(EconomicIdentityBadge, { label: BADGE_CREDIT_CARD_PAYMENT }))).toContain('Pagamento de fatura');
    expect(renderToStaticMarkup(React.createElement(EconomicIdentityBadge, { label: BADGE_INTERNAL_MOVEMENT }))).toContain('Movimentação interna');
  });

  it('selo discreto: nada de alerta/erro (sem vermelho/amarelo)', () => {
    expect(controls).not.toMatch(/text-(red|danger|yellow|amber|rose)|bg-(red|danger|yellow|amber|rose)/);
  });

  it('o selo vem do evento CARREGADO: sem evento ⇒ sem selo, e o marcador do Pagar nunca gera selo', () => {
    expect(resolveEconomicIdentityBadge(undefined)).toBeNull();
    expect(view).toContain('resolveEconomicIdentityBadge(event)');
    expect(view).not.toMatch(/finelo_funding_account|hasFundingAccountMarker/);
  });

  it('o familiar (não dono) VÊ o selo mas não a ação', () => {
    const familyTx = tx({ user_id: B, economic_event_id: 'e1' });
    const event = { id: 'e1', kind: 'own_account_transfer', source: 'user', user_id: B } as never;
    expect(resolveEconomicIdentityBadge(event)).toBe('Movimentação interna');
    expect(canMarkInternalMovement(familyTx, A)).toBe(false);
    expect(canUndoInternalMovement(familyTx, event, A, 1)).toBe(false);
  });
});

describe('ações (desktop e mobile)', () => {
  it('rótulos exatos', () => {
    expect(MARK_ACTION_LABEL).toBe('Marcar como movimentação interna');
    expect(UNDO_ACTION_LABEL).toBe('Desfazer movimentação interna');
    expect(internalMovementActionLabel('mark')).toBe(MARK_ACTION_LABEL);
    expect(internalMovementActionLabel('undo')).toBe(UNDO_ACTION_LABEL);
  });

  it('desktop: botão de ícone com title e aria-label EXATOS; mobile: botão textual visível', () => {
    const icon = renderToStaticMarkup(React.createElement(InternalMovementActionButton, { mode: 'mark', variant: 'icon', onClick: () => {} }));
    expect(icon).toContain('title="Marcar como movimentação interna"');
    expect(icon).toContain('aria-label="Marcar como movimentação interna"');
    const text = renderToStaticMarkup(React.createElement(InternalMovementActionButton, { mode: 'undo', variant: 'text', onClick: () => {} }));
    expect(text).toContain('>Desfazer movimentação interna</button>');
  });

  it('a TransactionsView usa as duas variantes (tabela e card) e nunca esconde só atrás de swipe', () => {
    expect(view).toContain('variant="icon"');
    expect(view).toContain('variant="text"');
    const swipe = view.slice(view.indexOf('rightActions={['), view.indexOf('{mobileCardBody}\n          </SwipeableItem>'));
    expect(swipe).not.toMatch(/internal|Marcar|Desfazer|identity/i);
  });

  it('a ação só aparece para o dono elegível (decisão do domínio) e não aparece na seleção em lote', () => {
    expect(view).toContain('canMarkInternalMovement(t, user?.id)');
    expect(view).toContain('canUndoInternalMovement(t, event, user?.id,');
    expect(view).toContain('{!selectionMode && identity.action ? (');
  });

  it('o selo vai na área de descrição (sem coluna nova) e no card', () => {
    expect(view).toContain('badge={identity.badge ? <EconomicIdentityBadge label={identity.badge} /> : undefined}');
    expect(view).toContain('{identity.badge ? <EconomicIdentityBadge label={identity.badge} className="mt-0.5 self-start" /> : null}');
    expect(view).not.toMatch(/key: 'economic/);
  });
});

describe('confirmações e store', () => {
  it('copy da confirmação de marcar e de desfazer', () => {
    expect(view).toContain("'Marcar este lançamento como movimentação interna?'");
    expect(view).toContain("'Ele continuará no histórico da conta, mas não entrará nos cálculos de renda e gastos.'");
    expect(view).toContain("'Marcar',");
    expect(view).toContain("'Desfazer movimentação interna?'");
    expect(view).toContain("'O lançamento voltará a participar dos cálculos de renda e gastos.'");
    expect(view).toContain("'Desfazer',");
    expect(view).not.toMatch(/outra ponta|contraparte encontrada/i);
  });

  it('a UI usa as ações do store (porta única), não updateTransaction', () => {
    expect(view).toContain('await markTransactionAsInternalMovement(t.ID_Transacao)');
    expect(view).toContain('await unmarkTransactionInternalMovement(t.ID_Transacao)');
    const block = view.slice(view.indexOf('const runInternalMovementAction'), view.indexOf('const creditCardFundingAccounts'));
    expect(block).not.toMatch(/updateTransaction/);
  });

  it('feedback de erro amigável: sem Postgres/RLS/UUID/economic_event_id nas mensagens', () => {
    const service = read('src/services/transactionEconomicIdentityService.ts');
    const messages = service.slice(service.indexOf('const MESSAGES'), service.indexOf('const fail'));
    expect(messages).not.toMatch(/postgres|rls|uuid|economic_event_id|row-level/i);
    expect(store).toContain('error instanceof EconomicIdentityError ? error.message');
  });

  it('sem filtro novo, sem analytics e sem backfill nesta fase', () => {
    for (const src of [view, controls, store, read('src/services/transactionEconomicIdentityService.ts')]) {
      expect(src).not.toMatch(/internal_movement_marked|internal_movement_unmarked|trackProductEvent\([^)]*internal/);
    }
    expect(view).not.toMatch(/filtro.*movimenta[cç][aã]o interna|internalMovementFilter/i);
  });

  it('o service não usa o caminho genérico nem heurística de contraparte', () => {
    const service = code(read('src/services/transactionEconomicIdentityService.ts'));
    expect(service).not.toMatch(/updateTransaction|sanitizeTransactionUpdate|useAppStore/);
    expect(service).toContain(".is('economic_event_id', null)");
    expect(service).toContain(".eq('user_id', userId)");
    expect(service).not.toMatch(/Valor|\.eq\('Data|Nome_Fantasia|Categoria/);
  });

  it('as políticas econômicas e os KPIs não foram tocados pela 3B', () => {
    for (const f of ['src/domain/economics/transactionSemantics.ts', 'src/utils/dashboardMetrics.ts', 'src/domain/budgets/monthlyBudget.ts']) {
      expect(read(f), f).not.toMatch(/manualEconomicIdentity|markTransactionAsInternalMovement/);
    }
    expect(countLegsByEventId([])).toEqual(new Map());
  });
});
