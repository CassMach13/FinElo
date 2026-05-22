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
  onClose: () => void;
  onOpenCreateCategory?: () => void;
  onSubmit: (payload: {
    referenceMonth: string;
    paymentDate: string;
    amount: number;
    category: string;
    sourceAccountId: string;
  }) => Promise<void>;
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
  onClose,
  onOpenCreateCategory,
  onSubmit,
}) => {
  const openCards = useMemo(() => competenceCardsWithOpenBalance(competenceCards), [competenceCards]);
  const incomeCategories = useMemo(() => incomeCategoriesForPayment(categories), [categories]);

  const [referenceMonth, setReferenceMonth] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amountDraft, setAmountDraft] = useState('');
  const [category, setCategory] = useState('');
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [sourceAccountError, setSourceAccountError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const pickDefaultSourceAccountId = useMemo(() => {
    const ids = new Set(fundingAccounts.map((a) => a.id));
    if (savedSourceAccountId && ids.has(savedSourceAccountId)) return savedSourceAccountId;
    const linked = (account as Account & { linked_payment_account_id?: string | null })
      ?.linked_payment_account_id;
    if (linked && ids.has(linked)) return linked;
    return fundingAccounts[0]?.id || '';
  }, [fundingAccounts, savedSourceAccountId, account]);

  useEffect(() => {
    if (!isOpen || !account) return;
    const oldest = pickOldestOpenCompetenceCard(competenceCards);
    const ref = oldest?.referenceMonth || openCards[0]?.referenceMonth || '';
    setReferenceMonth(ref);
    setPaymentDate(new Date().toISOString().slice(0, 10));
    const suggested =
      oldest && oldest.openBalance > 0.005
        ? oldest.openBalance
        : initialAmount > 0.005
          ? initialAmount
          : 0;
    setAmountDraft(suggested > 0 ? suggested.toFixed(2) : '');
    setCategory(pickDefaultCreditCardPaymentCategory(categories, savedPaymentCategory));
    setSourceAccountId(pickDefaultSourceAccountId);
    setCategoryError('');
    setSourceAccountError('');
  }, [
    isOpen,
    account,
    competenceCards,
    openCards,
    initialAmount,
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

  useEffect(() => {
    if (!referenceMonth) return;
    const card = openCards.find((c) => c.referenceMonth === referenceMonth);
    if (card && card.openBalance > 0.005) {
      setAmountDraft(card.openBalance.toFixed(2));
    }
  }, [referenceMonth, openCards]);

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
    const amount = Number(amountDraft.replace(',', '.'));
    if (Number.isNaN(amount) || amount <= 0) return;

    setIsSubmitting(true);
    try {
      await onSubmit({
        referenceMonth,
        paymentDate,
        amount,
        category: category.trim(),
        sourceAccountId: sourceAccountId.trim(),
      });
      onClose();
    } catch {
      /* onSubmit exibe alerta; mantém o modal aberto */
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !account) return null;

  return (
    <Modal
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
        <p className="text-xs text-gray-400 leading-relaxed">
          Escolha qual <span className="text-gray-300 font-medium">competência</span> do histórico você está
          quitando. O valor abate nessa fatura (não usa a regra automática do extrato XP por data).
        </p>
        <p className="text-sm text-gray-400">
          Cartão: <span className="text-white font-medium">{account.Nome_Conta}</span>
        </p>

        {openCards.length === 0 ? (
          <p className="text-sm text-amber-200/90 py-4 text-center">
            Nenhuma fatura com saldo em aberto. Confira o histórico ou importe o extrato.
          </p>
        ) : fundingAccounts.length === 0 ? (
          <p className="text-sm text-amber-200/90 py-4 text-center">
            Cadastre uma conta corrente ou poupança para registrar de onde saiu o pagamento da fatura.
          </p>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Fatura a pagar</label>
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {openCards.map((card) => {
                  const selected = card.referenceMonth === referenceMonth;
                  return (
                    <button
                      key={card.referenceMonth}
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setReferenceMonth(card.referenceMonth)}
                      className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                        selected
                          ? 'border-teal-500/60 bg-teal-500/10'
                          : 'border-white/10 bg-white/[0.03] hover:border-white/20'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <span className="text-[10px] text-gray-500 uppercase font-semibold">Competência</span>
                          <p className="text-sm font-bold text-white tabular-nums">{card.competenceBR}</p>
                          <p className="text-[10px] text-gray-500">Venc.: {card.vencimentoBR}</p>
                        </div>
                        <span className="text-[10px] font-bold uppercase text-gray-400 shrink-0">
                          {competenceStatusLabel(card)}
                        </span>
                      </div>
                      <p className="text-xs text-amber-200/90 mt-1.5 tabular-nums">
                        Em aberto: {formatCurrency(card.openBalance)}
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
            <p className="text-[11px] text-gray-500 -mt-2">
              Será lançada uma <span className="text-gray-400">saída</span> nesta conta e o{' '}
              <span className="text-gray-400">abatimento</span> na fatura do cartão, para conciliação correta.
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
            <p className="text-[11px] text-gray-500 -mt-2">
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
              value={amountDraft}
              onChange={(e) => setAmountDraft(e.target.value)}
              placeholder="0,00"
              disabled={isSubmitting}
            />
            {selectedCard && Number(amountDraft.replace(',', '.')) > selectedCard.openBalance + 0.02 ? (
              <p className="text-[11px] text-gray-500">
                Valor acima do saldo em aberto ({formatCurrency(selectedCard.openBalance)}). O excedente vira
                crédito nas competências seguintes.
              </p>
            ) : null}
          </>
        )}
      </form>
    </Modal>
  );
};

export default PayCreditCardInvoiceModal;
