import '../appearance/financial.css';
import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import { formatCurrency } from '../../utils/formatters';
import type { CompetenceHistoryCard } from '../../services/creditCardRebuildFromImportHistoryService';
import {
  competenceCardsWithOpenBalance,
  incomeCategoriesForPayment,
  pickDefaultCreditCardPaymentCategory,
  pickOldestOpenCompetenceCard,
} from '../../services/creditCardDirectedPayment';
import type { Account, Category } from '../../types';
import { localTodayIso } from '../../utils/dateOnly';
import { formatPaymentAmountInput, parsePaymentAmountInput } from '../../domain/credit-card/invoicePaymentPair';

export interface PayCreditCardInvoiceModalProps {
  isOpen: boolean;
  account: Account | null;
  competenceCards: CompetenceHistoryCard[];
  categories: Category[];
  /** Contas de onde pode sair o pagamento (corrente, poupança, etc.). */
  fundingAccounts: Account[];
  savedPaymentCategory?: string | null;
  savedSourceAccountId?: string | null;
  lastCreatedCategory?: string | null;
  initialAmount?: number;
  /** Valor que o usuário já digitou em outra tela: vem preenchido no lugar do saldo em aberto. */
  presetAmount?: number;
  /** Conta de origem que o usuário já escolheu em outra tela. */
  presetSourceAccountId?: string;
  onClose: () => void;
  onOpenCreateCategory?: () => void;
  /** `false` = não registrou (o modal fica aberto com o que o usuário preencheu). */
  onSubmit: (payload: {
    referenceMonth: string;
    paymentDate: string;
    amount: number;
    category: string;
    sourceAccountId: string;
  }) => Promise<boolean | void>;
}

const competenceStatusLabel = (card: CompetenceHistoryCard): string => {
  if (card.openBalance <= 0.005) return 'Paga';
  const due = new Date(`${card.dueDate}T12:00:00`);
  if (!Number.isNaN(due.getTime()) && due < new Date()) return 'Vencida';
  return 'Aberta';
};

const PayCreditCardInvoiceModal: React.FC<PayCreditCardInvoiceModalProps> = ({
  isOpen,
  account,
  competenceCards,
  categories,
  fundingAccounts,
  savedPaymentCategory,
  savedSourceAccountId,
  lastCreatedCategory,
  initialAmount = 0,
  presetAmount,
  presetSourceAccountId,
  onClose,
  onOpenCreateCategory,
  onSubmit,
}) => {
  const openCards = useMemo(() => competenceCardsWithOpenBalance(competenceCards), [competenceCards]);
  const incomeCategories = useMemo(() => incomeCategoriesForPayment(categories), [categories]);

  const [referenceMonth, setReferenceMonth] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => localTodayIso());
  const [amountDraft, setAmountDraft] = useState('');
  const [category, setCategory] = useState('');
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [sourceAccountError, setSourceAccountError] = useState('');
  const [amountError, setAmountError] = useState('');
  /** O usuário já definiu o valor: trocar de fatura não sobrescreve. */
  const [amountTouched, setAmountTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const pickDefaultSourceAccountId = useMemo(() => {
    const ids = new Set(fundingAccounts.map((a) => a.id));
    if (presetSourceAccountId && ids.has(presetSourceAccountId)) return presetSourceAccountId;
    if (savedSourceAccountId && ids.has(savedSourceAccountId)) return savedSourceAccountId;
    const linked = (account as Account & { linked_payment_account_id?: string | null })
      ?.linked_payment_account_id;
    if (linked && ids.has(linked)) return linked;
    return fundingAccounts[0]?.id || '';
  }, [fundingAccounts, presetSourceAccountId, savedSourceAccountId, account]);

  useEffect(() => {
    if (!isOpen || !account) return;
    const oldest = pickOldestOpenCompetenceCard(competenceCards);
    const ref = oldest?.referenceMonth || openCards[0]?.referenceMonth || '';
    setReferenceMonth(ref);
    setPaymentDate(localTodayIso());
    const preset = presetAmount && presetAmount > 0.005 ? presetAmount : 0;
    const suggested =
      preset > 0
        ? preset
        : oldest && oldest.openBalance > 0.005
          ? oldest.openBalance
          : initialAmount > 0.005
            ? initialAmount
            : 0;
    setAmountDraft(suggested > 0 ? formatPaymentAmountInput(suggested) : '');
    setAmountTouched(preset > 0);
    setCategory(pickDefaultCreditCardPaymentCategory(categories, savedPaymentCategory));
    setSourceAccountId(pickDefaultSourceAccountId);
    setCategoryError('');
    setSourceAccountError('');
    setAmountError('');
  }, [
    isOpen,
    account,
    competenceCards,
    openCards,
    initialAmount,
    presetAmount,
    categories,
    savedPaymentCategory,
    pickDefaultSourceAccountId,
  ]);

  useEffect(() => {
    if (lastCreatedCategory) {
      setCategory(lastCreatedCategory);
      setCategoryError('');
    }
  }, [lastCreatedCategory]);

  const selectedCard = openCards.find((c) => c.referenceMonth === referenceMonth);
  const parsedAmount = parsePaymentAmountInput(amountDraft);

  /** Trocar de fatura preenche o que falta pagar nela, a menos que o usuário já tenha definido o valor. */
  const chooseInvoice = (card: CompetenceHistoryCard) => {
    setReferenceMonth(card.referenceMonth);
    if (!amountTouched && card.openBalance > 0.005) {
      setAmountDraft(formatPaymentAmountInput(card.openBalance));
      setAmountError('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account || !referenceMonth) return;
    if (!category.trim()) {
      setCategoryError('Escolha a categoria do pagamento.');
      return;
    }
    if (!sourceAccountId.trim()) {
      setSourceAccountError('Escolha a conta de onde sairá o pagamento.');
      return;
    }
    const amount = parsePaymentAmountInput(amountDraft);
    if (amount === null) {
      setAmountError('Informe o valor pago, por exemplo 2.000,00.');
      return;
    }
    if (!paymentDate) return;

    setIsSubmitting(true);
    try {
      const registered = await onSubmit({
        referenceMonth,
        paymentDate,
        amount,
        category: category.trim(),
        sourceAccountId: sourceAccountId.trim(),
      });
      if (registered !== false) onClose();
    } catch {
      /* onSubmit exibe alerta; mantém o modal aberto */
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !account) return null;

  return (
    <Modal manageFocus
      isOpen={isOpen}
      onClose={() => (isSubmitting ? undefined : onClose())}
      title="Pagar fatura do cartão"
      className="max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="pay-credit-card-invoice-form"
            disabled={isSubmitting || openCards.length === 0 || !referenceMonth || fundingAccounts.length === 0}
          >
            {isSubmitting ? 'Registrando…' : 'Registrar pagamento'}
          </Button>
        </div>
      }
    >
      <form id="pay-credit-card-invoice-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <p data-finance="muted" className="text-xs text-gray-400 leading-relaxed">
          Escolha qual <span data-finance="muted" className="text-gray-300 font-medium">fatura</span> você está pagando. O valor abate
          só nessa fatura. Pode pagar em partes: registre cada pagamento quando ele sair da conta.
        </p>
        <p data-finance="muted" className="text-sm text-gray-400">
          Cartão: <span data-finance="content" className="text-white font-medium">{account.Nome_Conta}</span>
        </p>

        {openCards.length === 0 ? (
          <p data-finance="warning" className="text-sm text-amber-200/90 py-4 text-center">
            Nenhuma fatura com valor em aberto neste cartão. Se você acabou de lançar compras, confira o
            histórico de faturas.
          </p>
        ) : fundingAccounts.length === 0 ? (
          <p data-finance="warning" className="text-sm text-amber-200/90 py-4 text-center">
            Cadastre uma conta corrente ou poupança para registrar de onde saiu o pagamento da fatura.
          </p>
        ) : (
          <>
            <div>
              <label data-finance="muted" className="block text-xs font-medium text-gray-400 mb-1.5">Fatura a pagar</label>
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {openCards.map((card) => {
                  const selected = card.referenceMonth === referenceMonth;
                  return (
                    <button data-finance={selected ? 'selected' : 'inset divider hover'} aria-pressed={selected}
                      key={card.referenceMonth}
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => chooseInvoice(card)}
                      className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                        selected
                          ? 'border-teal-500/60 bg-teal-500/10'
                          : 'border-white/10 bg-white/[0.03] hover:border-white/20'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <span data-finance="muted" className="text-[10px] text-gray-500 uppercase font-semibold">Fatura</span>
                          <p data-finance="content" className="text-sm font-bold text-white tabular-nums">{card.competenceBR}</p>
                          <p data-finance="muted" className="text-[10px] text-gray-500">Vence em {card.vencimentoBR}</p>
                        </div>
                        <span data-finance="muted" className="text-[10px] font-bold uppercase text-gray-400 shrink-0">
                          {competenceStatusLabel(card)}
                        </span>
                      </div>
                      <p data-finance="warning" className="text-xs text-amber-200/90 mt-1.5 tabular-nums">
                        Falta pagar: {formatCurrency(card.openBalance)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <Select
              label="Conta de origem do pagamento"
              name="sourceAccountId"
              value={sourceAccountId}
              onChange={(e) => {
                setSourceAccountId(e.target.value);
                setSourceAccountError('');
              }}
              error={sourceAccountError}
              disabled={isSubmitting}
            >
              <option value="" disabled>
                Selecione a conta que pagou a fatura…
              </option>
              {fundingAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.Nome_Conta} ({acc.Tipo_Conta})
                </option>
              ))}
            </Select>
            <p data-finance="muted" className="text-[11px] text-gray-500 -mt-2">
              O FinElo lança a <span data-finance="muted" className="text-gray-400">saída</span> nesta conta e o{' '}
              <span data-finance="muted" className="text-gray-400">abatimento</span> na fatura, juntos. Se excluir depois, os dois saem
              juntos.
            </p>

            <div className="flex items-end gap-2">
              <div className="flex-grow min-w-0">
                <Select
                  label="Categoria do pagamento"
                  name="Categoria"
                  value={category}
                  onChange={(e) => {
                    if (e.target.value === 'ADD_NEW_CATEGORY') {
                      onOpenCreateCategory?.();
                      return;
                    }
                    setCategory(e.target.value);
                    setCategoryError('');
                  }}
                  error={categoryError}
                  disabled={isSubmitting}
                >
                  <option value="" disabled>
                    {incomeCategories.length === 0 ? 'Nenhuma categoria de renda' : 'Selecione…'}
                  </option>
                  {incomeCategories.map((c) => (
                    <option key={c.Nome_Categoria} value={c.Nome_Categoria}>
                      {c.Nome_Categoria}
                    </option>
                  ))}
                  {onOpenCreateCategory ? <option value="ADD_NEW_CATEGORY">+ Nova categoria</option> : null}
                </Select>
              </div>
            </div>
            <p data-finance="muted" className="text-[11px] text-gray-500 -mt-2">
              Use a mesma categoria que você classifica pagamentos de fatura no extrato. A escolha fica salva para
              os próximos pagamentos.
            </p>

            <Input
              label="Data do pagamento"
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              disabled={isSubmitting}
            />
            <Input
              label="Valor pago (R$)"
              type="text"
              inputMode="decimal"
              value={amountDraft}
              onChange={(e) => {
                setAmountDraft(e.target.value);
                setAmountTouched(true);
                setAmountError('');
              }}
              placeholder="0,00"
              error={amountError}
              disabled={isSubmitting}
            />
            {selectedCard && parsedAmount !== null && parsedAmount > selectedCard.openBalance + 0.02 ? (
              <p data-finance="muted" className="text-[11px] text-gray-500">
                Valor acima do que falta pagar nesta fatura ({formatCurrency(selectedCard.openBalance)}). A diferença
                fica como crédito para as próximas faturas.
              </p>
            ) : selectedCard && parsedAmount !== null && parsedAmount < selectedCard.openBalance - 0.005 ? (
              <p data-finance="muted" className="text-[11px] text-gray-500">
                Pagamento parcial: depois dele ainda faltarão{' '}
                {formatCurrency(Math.round((selectedCard.openBalance - parsedAmount) * 100) / 100)} nesta fatura.
              </p>
            ) : null}
          </>
        )}
      </form>
    </Modal>
  );
};

export default PayCreditCardInvoiceModal;
