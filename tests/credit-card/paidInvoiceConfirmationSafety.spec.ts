import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatCurrency } from '../../src/utils/formatters';
import {
  paidInvoiceConfirmationDialog,
  undoPaidInvoiceConfirmationDialog,
} from '../../src/components/transactions/paidInvoiceConfirmationCopy';
import { GlobalDialog } from '../../src/components/ui/GlobalDialog';
import { useDialogStore } from '../../src/hooks/useDialogStore';
import {
  saveCompetencePaymentConfirmation,
  removeCompetencePaymentConfirmation,
} from '../../src/services/competenceInvoiceUserConfirmations';

const storage = vi.hoisted(() => {
  const eq = vi.fn();
  eq.mockReturnValue({ eq });
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn(() => ({ eq }));
  return { eq, upsert, remove, from: vi.fn(() => ({ upsert, delete: remove })) };
});
vi.mock('../../src/supabaseClient', () => ({ supabase: { from: storage.from } }));
// SSR normally uses Zustand's initial snapshot; render the current test state instead.
vi.mock('../../src/hooks/useDialogStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/hooks/useDialogStore')>();
  return {
    ...actual,
    useDialogStore: Object.assign(() => actual.useDialogStore.getState(), actual.useDialogStore),
  };
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => useDialogStore.setState({ isOpen: false, options: null, resolvePromise: null }));

describe('paid invoice confirmation safety', () => {
  it.each([0.12, 322.2, 123456.78])('shows the whole balance (%s) and its effects before confirmation', (amount) => {
    const dialog = paidInvoiceConfirmationDialog(amount, '09/2026');
    expect(dialog.message).toContain(`saldo em aberto inteiro de ${formatCurrency(amount)}`);
    expect(dialog.message).toContain('09/2026');
    expect(dialog.message).toContain('já foi pago fora do FinElo');
    expect(dialog.message).toContain('saldo em aberto ficará R$ 0,00');
    expect(dialog.message).toContain('limite do cartão poderá ser liberado');
    expect(dialog.message).toContain('não cria um lançamento');
    expect(dialog.message).toContain('não movimenta nenhuma conta bancária');
    expect(dialog.message).toContain('efetivamente quitado');
    expect(dialog.message).toContain('Desfazer');
    expect(dialog.message).toContain('use Pagar');
    expect(dialog.message).not.toMatch(/residual|centavos|arredondamento/i);
    expect(dialog.confirmText).toBe(`Confirmar ${formatCurrency(amount)}`);
  });

  it('renders the exact amount with Cancelar and wrapping actions in the real dialog', () => {
    useDialogStore.setState({
      isOpen: true,
      options: { ...paidInvoiceConfirmationDialog(322.2, '09/2026'), variant: 'info', hideCancel: false },
    });
    const html = renderToStaticMarkup(React.createElement(GlobalDialog));
    expect(html).toContain(`Confirmar ${formatCurrency(322.2)}`);
    expect(html).toContain('Cancelar');
    expect(html).toContain('flex-wrap');
    expect(html).toContain('max-w-full');
  });

  it('explains that Desfazer removes only the confirmation and recalculates balance/limit', () => {
    const dialog = undoPaidInvoiceConfirmationDialog(322.2, '09/2026');
    expect(dialog.confirmText).toBe('Desfazer');
    expect(dialog.message).toContain(formatCurrency(322.2));
    expect(dialog.message).toContain('sem essa confirmação');
    expect(dialog.message).toContain('não estorna um pagamento no banco');
    expect(dialog.message).toContain('nem cria ou remove lançamentos');
  });

  it('keeps the whole open balance, cancellation, undo and Pagar wired separately', () => {
    const view = readFileSync('src/components/views/TransactionsView.tsx', 'utf8');
    const confirm = view.slice(view.indexOf('const handleConfirmCompetenceResidualPaid'), view.indexOf('const handleUndoCompetenceResidualPaid'));
    expect(confirm).toContain('const amount = card.openBalance;');
    expect(confirm).toContain('paidInvoiceConfirmationDialog(amount, card.competenceBR)');
    expect(confirm).toContain('if (!ok) return;');
    expect(confirm).toContain('await saveCompetencePaymentConfirmation({');
    expect(confirm).toContain('settledAmount: amount,');
    expect(confirm).not.toMatch(/addTransaction|updateAccount|submitPayCreditCardInvoice/);

    const box = view.slice(view.indexOf('{card.openBalance > 0.005 && !card.userConfirmedPaid'), view.indexOf('{card.files.length === 0 && card.totalPayments'));
    expect(box).toContain('Saldo em aberto inteiro:');
    expect(box).toContain('formatCurrency(card.openBalance)');
    expect(box).toContain('já foi pago fora do FinElo');
    expect(box).toContain('Não cria lançamento');
    expect(box).toContain('nem movimenta conta');
    expect(box).not.toMatch(/\b(residual|centavos|arredondamento)\b/i);
    expect(box).toContain('handleUndoCompetenceResidualPaid(card)');
    expect(view).toContain('const submitPayCreditCardInvoice');
    expect(view).toContain('buildDirectedPaymentDescription(referenceMonth, sourceAccountId)');
  });

  it('persists the same confirmation contract, without transactions or account updates', async () => {
    await saveCompetencePaymentConfirmation({
      userId: 'qa-user', accountId: 'qa-card', referenceMonth: '2026-09',
      settledAmount: 322.2, confirmedAt: '2026-10-03T12:00:00.000Z',
    });
    expect(storage.from).toHaveBeenCalledTimes(1);
    expect(storage.from).toHaveBeenCalledWith('credit_card_competence_payment_confirmations');
    expect(storage.upsert).toHaveBeenCalledTimes(1);
    expect(storage.upsert).toHaveBeenCalledWith({
      user_id: 'qa-user', account_id: 'qa-card', reference_month: '2026-09',
      settled_amount: 322.2, confirmed_at: '2026-10-03T12:00:00.000Z',
    }, { onConflict: 'user_id,account_id,reference_month' });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('undo keeps the existing user/account/month-scoped deletion', async () => {
    await removeCompetencePaymentConfirmation('qa-user', 'qa-card', '2026-09');
    expect(storage.from).toHaveBeenCalledTimes(1);
    expect(storage.from).toHaveBeenCalledWith('credit_card_competence_payment_confirmations');
    expect(storage.remove).toHaveBeenCalledOnce();
    expect(storage.eq.mock.calls).toEqual([
      ['user_id', 'qa-user'], ['account_id', 'qa-card'], ['reference_month', '2026-09'],
    ]);
    expect(storage.upsert).not.toHaveBeenCalled();
  });
});
