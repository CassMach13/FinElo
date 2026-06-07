import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Transaction, Account, Category, Asset, MappingRule } from '../../types';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import { formatCurrency } from '../../utils/formatters';
import { appAlert, appConfirm } from '../../hooks/useDialogStore';
import { useAppStore } from '../../hooks/useAppStore';
import MappingRuleModal from './MappingRuleModal';
import {
  clearTransactionDraft,
  loadTransactionDraft,
  saveTransactionDraft,
} from '../../utils/transactionDraftStorage';
import type { CompetenceHistoryCard } from '../../services/creditCardRebuildFromImportHistoryService';
import {
  buildDirectedRefundDescription,
  type CardManualEntryKind,
  inferCardManualEntryKind,
  looksLikeInvoicePaymentText,
  parseDirectedCompetenceFromPayment,
  referenceMonthFromIsoDate,
} from '../../services/creditCardDirectedPayment';
import { inferManualRefundReferenceMonth } from '../../services/creditCardManualCompetence';

interface NewTransactionModalProps {
  onClose: () => void;
  onSave: (transactions: Omit<Transaction, 'ID_Transacao' | 'Origem'>[]) => void | Promise<void>;
  accounts: Account[];
  categories: Category[];
  assets: Asset[];
  onOpenCreateAccount: () => void;
  onOpenCreateCategory: () => void;
  lastCreatedAccount: string | null;
  lastCreatedCategory: string | null;
  transaction?: Transaction | null;
  /** Abre o fluxo Pagar fatura (competência explícita). */
  onPayCreditCardInvoice?: (account: Account, suggestedAmount: number) => void;
  /** Histórico de competências do cartão (estorno/crédito). */
  loadCompetenceCards?: (account: Account) => Promise<CompetenceHistoryCard[]>;
  cardPaymentKeywords?: string[];
  cardCreditKeywords?: string[];
}

const NewTransactionModal: React.FC<NewTransactionModalProps> = ({
  onClose,
  onSave,
  accounts,
  categories,
  assets,
  onOpenCreateAccount,
  onOpenCreateCategory,
  lastCreatedAccount,
  lastCreatedCategory,
  transaction: initialTransaction,
  onPayCreditCardInvoice,
  loadCompetenceCards,
  cardPaymentKeywords = [],
  cardCreditKeywords = [],
}) => {
  const { addMappingRule } = useAppStore();
  const editTransactionId = initialTransaction?.ID_Transacao ?? null;

  const getTodayString = () => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  };

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [cardEntryKind, setCardEntryKind] = useState<CardManualEntryKind | ''>('');
  const [competenceCards, setCompetenceCards] = useState<CompetenceHistoryCard[]>([]);
  const [competenceLoading, setCompetenceLoading] = useState(false);
  const [refundReferenceMonth, setRefundReferenceMonth] = useState('');
  const [payCardTargetId, setPayCardTargetId] = useState('');
  const [mappingRuleModalOpen, setMappingRuleModalOpen] = useState(false);
  const draftPersistSkipRef = useRef(false);

  const creditCardAccounts = useMemo(
    () => accounts.filter((a) => a.Tipo_Conta === 'Cartão de Crédito'),
    [accounts]
  );

  const [transaction, setTransaction] = useState({
    Data: getTodayString(),
    Data_Pagamento: '',
    ID_Conta: '',
    Nome_Fantasia: '',
    Categoria: '',
    Valor: '',
    Tipo: '' as 'Renda' | 'Despesa',
    Descricao_Original: 'Lançamento Manual',
    linked_asset_id: '',
  });

  const [isRecurrent, setIsRecurrent] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState<'installments' | 'fixed'>('installments');
  const [recurrenceCount, setRecurrenceCount] = useState<string>('2');

  const isInstallment = isRecurrent && recurrenceType === 'installments';
  const isFixed = isRecurrent && recurrenceType === 'fixed';

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === transaction.ID_Conta),
    [accounts, transaction.ID_Conta]
  );

  const isCreditCardAccount = selectedAccount?.Tipo_Conta === 'Cartão de Crédito';

  /** Só compras no cartão de crédito têm vencimento separado da data da compra. */
  const showSeparatePaymentDate =
    isCreditCardAccount && cardEntryKind !== 'refund';

  const openPayInvoiceFlow = useCallback(
    (account: Account, suggestedAmount?: number) => {
      if (!onPayCreditCardInvoice) return;
      const parsed = suggestedAmount ?? parseFloat(transaction.Valor);
      onPayCreditCardInvoice(account, Number.isFinite(parsed) ? parsed : 0);
      onClose();
    },
    [onPayCreditCardInvoice, onClose, transaction.Valor]
  );

  useEffect(() => {
    if (initialTransaction || creditCardAccounts.length === 0) return;
    if (isCreditCardAccount && selectedAccount) {
      setPayCardTargetId(selectedAccount.id);
      return;
    }
    setPayCardTargetId((prev) =>
      prev && creditCardAccounts.some((c) => c.id === prev) ? prev : creditCardAccounts[0].id
    );
  }, [initialTransaction, creditCardAccounts, isCreditCardAccount, selectedAccount?.id]);

  const syncCardEntryKind = useCallback(
    (tipo: string, patch?: { categoria?: string; nome?: string; descricao?: string }) => {
      if (!isCreditCardAccount) {
        setCardEntryKind('');
        return;
      }
      const inferred = inferCardManualEntryKind(
        tipo,
        {
          categoria: patch?.categoria ?? transaction.Categoria,
          nome: patch?.nome ?? transaction.Nome_Fantasia,
          descricao: patch?.descricao ?? transaction.Descricao_Original,
        },
        { paymentKeywords: cardPaymentKeywords, creditKeywords: cardCreditKeywords }
      );
      setCardEntryKind(inferred || (tipo === 'Despesa' ? 'purchase' : ''));
    },
    [
      isCreditCardAccount,
      transaction.Categoria,
      transaction.Nome_Fantasia,
      transaction.Descricao_Original,
      cardPaymentKeywords,
      cardCreditKeywords,
    ]
  );

  useEffect(() => {
    if (lastCreatedAccount) {
      setTransaction((prev) => ({ ...prev, ID_Conta: lastCreatedAccount }));
    }
  }, [lastCreatedAccount]);

  useEffect(() => {
    if (lastCreatedCategory) {
      setTransaction((prev) => ({ ...prev, Categoria: lastCreatedCategory }));
    }
  }, [lastCreatedCategory]);

  useEffect(() => {
    if (!editTransactionId || !initialTransaction) return;
    draftPersistSkipRef.current = true;
    const dataIso = initialTransaction.Data
      ? typeof initialTransaction.Data === 'string'
        ? initialTransaction.Data.split('T')[0]
        : initialTransaction.Data.toISOString().split('T')[0]
      : getTodayString();
    const directedRef = parseDirectedCompetenceFromPayment(initialTransaction);
    const editAccount = accounts.find((a) => a.id === initialTransaction.ID_Conta);
    const isCard = editAccount?.Tipo_Conta === 'Cartão de Crédito';
    const inferredKind = isCard
      ? inferCardManualEntryKind(
          String(initialTransaction.Tipo || ''),
          {
            categoria: initialTransaction.Categoria,
            nome: initialTransaction.Nome_Fantasia,
            descricao: initialTransaction.Descricao_Original,
          },
          { paymentKeywords: cardPaymentKeywords, creditKeywords: cardCreditKeywords }
        )
      : null;
    setTransaction({
      Data: dataIso,
      Data_Pagamento: initialTransaction.Data_Pagamento
        ? typeof initialTransaction.Data_Pagamento === 'string'
          ? initialTransaction.Data_Pagamento.split('T')[0]
          : initialTransaction.Data_Pagamento.toISOString().split('T')[0]
        : '',
      ID_Conta: initialTransaction.ID_Conta || '',
      Nome_Fantasia: initialTransaction.Nome_Fantasia || '',
      Categoria: initialTransaction.Categoria || '',
      Valor: Math.abs(initialTransaction.Valor).toFixed(2),
      Tipo: initialTransaction.Tipo as 'Renda' | 'Despesa',
      Descricao_Original: initialTransaction.Descricao_Original || '',
      linked_asset_id: initialTransaction.linked_asset_id || '',
    });
    setCardEntryKind(
      inferredKind || (initialTransaction.Tipo === 'Despesa' && isCard ? 'purchase' : '')
    );
    setRefundReferenceMonth(
      directedRef ||
        (isCard && inferredKind === 'refund' && editAccount
          ? inferManualRefundReferenceMonth(initialTransaction, editAccount) || ''
          : '')
    );
    setIsRecurrent(false);
  }, [editTransactionId, initialTransaction, accounts, cardPaymentKeywords, cardCreditKeywords]);

  useEffect(() => {
    if (editTransactionId) return;

    const draft = loadTransactionDraft();
    if (draft) {
      draftPersistSkipRef.current = false;
      setTransaction(draft.transaction);
      setCardEntryKind(draft.cardEntryKind);
      setRefundReferenceMonth(draft.refundReferenceMonth);
      setIsRecurrent(draft.isRecurrent);
      setRecurrenceType(draft.recurrenceType);
      setRecurrenceCount(draft.recurrenceCount);
      return;
    }

    draftPersistSkipRef.current = false;
    setTransaction({
      Data: getTodayString(),
      Data_Pagamento: '',
      ID_Conta: '',
      Nome_Fantasia: '',
      Categoria: '',
      Valor: '',
      Tipo: '' as 'Renda' | 'Despesa',
      Descricao_Original: 'Lançamento Manual',
      linked_asset_id: '',
    });
    setCardEntryKind('');
    setRefundReferenceMonth('');
    setIsRecurrent(false);
  }, [editTransactionId]);

  const persistDraft = useCallback(() => {
    if (editTransactionId || draftPersistSkipRef.current) return;
    const hasContent =
      transaction.Nome_Fantasia.trim() ||
      transaction.Valor.trim() ||
      transaction.ID_Conta ||
      transaction.Categoria ||
      transaction.Tipo;
    if (!hasContent) return;
    saveTransactionDraft({
      transaction,
      cardEntryKind,
      refundReferenceMonth,
      isRecurrent,
      recurrenceType,
      recurrenceCount,
    });
  }, [
    editTransactionId,
    transaction,
    cardEntryKind,
    refundReferenceMonth,
    isRecurrent,
    recurrenceType,
    recurrenceCount,
  ]);

  useEffect(() => {
    persistDraft();
  }, [persistDraft]);

  useEffect(() => {
    if (editTransactionId) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') persistDraft();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [editTransactionId, persistDraft]);

  const transactionForRule = useMemo(
    (): Transaction =>
      ({
        ID_Transacao: 'draft',
        Origem: 'manual',
        Data: transaction.Data,
        Data_Pagamento: transaction.Data_Pagamento || undefined,
        Nome_Fantasia: transaction.Nome_Fantasia,
        Descricao_Original: transaction.Nome_Fantasia.trim() || transaction.Descricao_Original,
        Categoria: transaction.Categoria,
        Tipo: transaction.Tipo || 'Despesa',
        Valor: parseFloat(transaction.Valor) || 0,
        linked_asset_id: transaction.linked_asset_id || undefined,
      }) as Transaction,
    [transaction]
  );

  const handleSaveMappingRule = useCallback(
    (ruleData: Omit<MappingRule, 'id'>) => {
      addMappingRule(ruleData);
      const matchedCategory = categories.find(
        (c) => c.Nome_Categoria === ruleData.Categoria_Sugerida
      );
      const inferredTipo =
        matchedCategory?.Tipo === 'Renda'
          ? 'Renda'
          : matchedCategory?.Tipo === 'Despesa'
            ? 'Despesa'
            : null;

      setTransaction((prev) => ({
        ...prev,
        Nome_Fantasia: ruleData.Nome_Fantasia_Sugerido,
        Categoria: ruleData.Categoria_Sugerida,
        Tipo: inferredTipo || prev.Tipo || 'Despesa',
        linked_asset_id: ruleData.linked_asset_id || prev.linked_asset_id,
      }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next.Nome_Fantasia;
        delete next.Categoria;
        if (inferredTipo) delete next.Tipo;
        return next;
      });
      setMappingRuleModalOpen(false);
      void appAlert(
        'Regra salva e lançamento preenchido com a mesma categoria.',
        'Regra criada',
        'success'
      );
    },
    [addMappingRule, categories]
  );

  useEffect(() => {
    if (!isCreditCardAccount) {
      setCardEntryKind('');
      setCompetenceCards([]);
      setRefundReferenceMonth('');
      return;
    }
    syncCardEntryKind(transaction.Tipo);
  }, [isCreditCardAccount, transaction.ID_Conta, transaction.Tipo, syncCardEntryKind]);

  useEffect(() => {
    if (!isCreditCardAccount || cardEntryKind !== 'refund' || !selectedAccount || !loadCompetenceCards) {
      return;
    }
    let cancelled = false;
    setCompetenceLoading(true);
    void loadCompetenceCards(selectedAccount)
      .then((cards) => {
        if (cancelled) return;
        setCompetenceCards(cards);
        if (!refundReferenceMonth) {
          const draft: Transaction = {
            ID_Transacao: 'draft',
            ID_Conta: selectedAccount.id,
            Origem: 'manual',
            Data: transaction.Data,
            Data_Pagamento: transaction.Data_Pagamento || undefined,
            Tipo: 'Renda',
            Categoria: transaction.Categoria,
            Nome_Fantasia: transaction.Nome_Fantasia,
            Descricao_Original: transaction.Descricao_Original,
            Valor: parseFloat(transaction.Valor) || 0,
          } as Transaction;
          const inferred = inferManualRefundReferenceMonth(draft, selectedAccount);
          const match =
            inferred && cards.some((c) => c.referenceMonth === inferred) ? inferred : null;
          const fromDate = referenceMonthFromIsoDate(transaction.Data);
          const fromData =
            fromDate && cards.some((c) => c.referenceMonth === fromDate) ? fromDate : null;
          setRefundReferenceMonth(match || fromData || cards[0]?.referenceMonth || '');
        }
      })
      .finally(() => {
        if (!cancelled) setCompetenceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isCreditCardAccount, cardEntryKind, selectedAccount, loadCompetenceCards, transaction.Data]);

  const showPaymentGuide =
    isCreditCardAccount &&
    (cardEntryKind === 'invoice_payment' ||
      (transaction.Tipo === 'Renda' &&
        looksLikeInvoicePaymentText(
          {
            categoria: transaction.Categoria,
            nome: transaction.Nome_Fantasia,
            descricao: transaction.Descricao_Original,
          },
          cardPaymentKeywords
        )));

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!transaction.Data) newErrors.Data = 'A data é obrigatória.';
    if (!transaction.ID_Conta) newErrors.ID_Conta = 'A conta é obrigatória.';
    if (!transaction.Nome_Fantasia.trim()) newErrors.Nome_Fantasia = 'A descrição é obrigatória.';
    if (!transaction.Categoria) newErrors.Categoria = 'A categoria é obrigatória.';
    if (!transaction.Valor.trim() || isNaN(parseFloat(transaction.Valor))) newErrors.Valor = 'O valor é obrigatório.';
    if (!transaction.Tipo) newErrors.Tipo = 'O tipo é obrigatório.';

    if (isCreditCardAccount && !cardEntryKind) {
      newErrors.cardEntryKind = 'Selecione o tipo de lançamento no cartão (compra, estorno ou pagamento).';
    }

    if (isCreditCardAccount && cardEntryKind === 'refund' && !refundReferenceMonth) {
      newErrors.RefundCompetence = 'Selecione a competência da fatura que recebe o estorno.';
    }

    if (isRecurrent) {
      const count = parseInt(recurrenceCount);
      if (isNaN(count) || count < 2) {
        newErrors.Recurrence = 'Informe um número válido maior que 1 para a repetição.';
      }
    }

    if (isCreditCardAccount && cardEntryKind === 'refund' && isRecurrent) {
      newErrors.Recurrence = 'Estornos no cartão não podem ser parcelados neste fluxo.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || isSaving) return;

    if (
      isCreditCardAccount &&
      selectedAccount &&
      !initialTransaction &&
      (cardEntryKind === 'invoice_payment' ||
        (transaction.Tipo === 'Renda' &&
          looksLikeInvoicePaymentText(
            {
              categoria: transaction.Categoria,
              nome: transaction.Nome_Fantasia,
              descricao: transaction.Descricao_Original,
            },
            cardPaymentKeywords
          )))
    ) {
      const amount = parseFloat(transaction.Valor);
      const goPay = await appConfirm(
        'Pagamentos de fatura no cartão devem usar o fluxo Pagar, onde você escolhe qual competência está quitando. Caso contrário, o sistema pode abater a fatura errada pela data do lançamento.',
        'Usar fluxo Pagar fatura?',
        'Ir para Pagar fatura',
        'warning',
        'Voltar e ajustar'
      );
      if (goPay && onPayCreditCardInvoice) {
        openPayInvoiceFlow(selectedAccount, Number.isFinite(amount) ? amount : 0);
      }
      return;
    }

    if (isCreditCardAccount && cardEntryKind === 'invoice_payment') {
      return;
    }

    setIsSaving(true);

    const valorBase = parseFloat(transaction.Valor);
    const loopCount = isRecurrent ? parseInt(recurrenceCount) : 1;

    let valorParcela = valorBase;
    if (isInstallment) {
      valorParcela = valorBase / loopCount;
    }

    const finalValue = transaction.Tipo === 'Despesa' ? -Math.abs(valorParcela) : Math.abs(valorParcela);
    const baseDate = new Date(transaction.Data);

    const transactionsToSave: Omit<Transaction, 'ID_Transacao' | 'Origem'>[] = [];

    for (let i = 0; i < loopCount; i++) {
      const currentTxDate = new Date(baseDate);
      currentTxDate.setMonth(baseDate.getMonth() + i);

      let currentPaymentDate: Date | undefined = undefined;
      const paymentDateSource = showSeparatePaymentDate
        ? transaction.Data_Pagamento || transaction.Data
        : transaction.Data;
      if (paymentDateSource) {
        const basePayDate = new Date(paymentDateSource);
        currentPaymentDate = new Date(basePayDate);
        currentPaymentDate.setMonth(basePayDate.getMonth() + i);
      }

      let description = transaction.Nome_Fantasia;
      let parcelaAtual: number | null = null;
      let totalParcelas: number | null = null;

      if (isInstallment) {
        description = `${transaction.Nome_Fantasia} (${i + 1}/${loopCount})`;
        parcelaAtual = i + 1;
        totalParcelas = loopCount;
      }

      let descricaoOriginal = description;
      if (isCreditCardAccount && cardEntryKind === 'refund' && refundReferenceMonth) {
        descricaoOriginal = buildDirectedRefundDescription(refundReferenceMonth, description);
      }

      transactionsToSave.push({
        Data: currentTxDate,
        ID_Conta: transaction.ID_Conta,
        Data_Pagamento: currentPaymentDate,
        Nome_Fantasia: description,
        Categoria: transaction.Categoria,
        Tipo: transaction.Tipo,
        Valor: finalValue,
        Parcela_Atual: parcelaAtual,
        Total_Parcelas: totalParcelas,
        Fonte: 'Manual',
        Descricao_Original: descricaoOriginal,
        linked_asset_id: transaction.linked_asset_id || undefined,
      });
    }

    try {
      await onSave(transactionsToSave);
      if (!editTransactionId) {
        clearTransactionDraft();
        draftPersistSkipRef.current = true;
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'ID_Conta') {
      const acc = accounts.find((a) => a.id === value);
      if (acc?.Tipo_Conta === 'Cartão de Crédito' && !initialTransaction) {
        setCardEntryKind('');
        setRefundReferenceMonth('');
        setPayCardTargetId(value);
      } else if (acc?.Tipo_Conta !== 'Cartão de Crédito') {
        setCardEntryKind('');
        setRefundReferenceMonth('');
      }
    }
    if (name === 'cardEntryKind' && value === 'refund') {
      setTransaction((prev) => ({ ...prev, Data_Pagamento: prev.Data }));
    }
    setTransaction((prev) => {
      const next = { ...prev, [name]: value };
      const acc = accounts.find((a) => a.id === (name === 'ID_Conta' ? value : next.ID_Conta));
      const isCard = acc?.Tipo_Conta === 'Cartão de Crédito';
      const kind = name === 'cardEntryKind' ? (value as CardManualEntryKind | '') : cardEntryKind;
      const needsSeparatePay = isCard && kind !== 'refund';
      if (!needsSeparatePay && (name === 'Data' || name === 'ID_Conta' || name === 'cardEntryKind')) {
        next.Data_Pagamento = next.Data;
      }
      if (name === 'Tipo' || name === 'Categoria' || name === 'Nome_Fantasia') {
        queueMicrotask(() =>
          syncCardEntryKind(String(next.Tipo), {
            categoria: next.Categoria,
            nome: next.Nome_Fantasia,
            descricao: next.Descricao_Original,
          })
        );
      }
      return next;
    });
  };

  const handleCardKindChange = (kind: CardManualEntryKind) => {
    if (kind === 'invoice_payment' && selectedAccount && onPayCreditCardInvoice) {
      const amount = parseFloat(transaction.Valor);
      openPayInvoiceFlow(selectedAccount, Number.isFinite(amount) ? amount : 0);
      return;
    }
    setCardEntryKind(kind);
    if (kind === 'refund') {
      setTransaction((prev) => ({ ...prev, Tipo: 'Renda', Data_Pagamento: prev.Data }));
      setIsRecurrent(false);
    }
    if (kind === 'purchase') {
      setRefundReferenceMonth('');
    }
  };

  const getDynamicLabel = () => {
    if (isInstallment) return 'Valor TOTAL da Compra (R$)';
    if (isFixed) return 'Valor Mensal (R$)';
    return 'Valor (R$)';
  };

  const mustPickCardEntryKind = isCreditCardAccount && !cardEntryKind;

  const submitDisabled =
    isSaving ||
    mustPickCardEntryKind ||
    (isCreditCardAccount && cardEntryKind === 'invoice_payment' && !initialTransaction);

  return (
    <>
    <Modal
      isOpen={true}
      onClose={onClose}
      overlayClassName="z-[55]"
      title={initialTransaction ? 'Editar Lançamento' : 'Adicionar Lançamento'}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="new-transaction-form" disabled={submitDisabled}>
            {isSaving
              ? 'Salvando…'
              : isRecurrent
                ? `Gerar ${recurrenceCount || '?'} Lançamentos`
                : 'Salvar'}
          </Button>
        </div>
      }
    >
      <form id="new-transaction-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {!initialTransaction && onPayCreditCardInvoice && creditCardAccounts.length > 0 && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-3">
            <p className="text-xs text-emerald-100/95 leading-relaxed">
              Quer <strong className="text-white">pagar a fatura</strong> do cartão? Use o fluxo dedicado — você
              escolhe a competência e a conta de origem do pagamento.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
              {creditCardAccounts.length > 1 && (
                <div className="flex-grow">
                  <Select
                    label="Cartão"
                    name="payCardTargetId"
                    value={payCardTargetId}
                    onChange={(e) => setPayCardTargetId(e.target.value)}
                  >
                    {creditCardAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.Nome_Conta}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <Button
                type="button"
                variant="secondary"
                className="sm:shrink-0 h-[42px] mb-px"
                onClick={() => {
                  const card =
                    creditCardAccounts.find((c) => c.id === payCardTargetId) ?? creditCardAccounts[0];
                  if (card) openPayInvoiceFlow(card);
                }}
              >
                Pagar fatura do cartão
              </Button>
            </div>
          </div>
        )}

        <div className={showSeparatePaymentDate ? 'grid grid-cols-1 sm:grid-cols-2 gap-4' : ''}>
          <Input
            label="Data da Compra"
            name="Data"
            type="date"
            value={transaction.Data}
            onChange={handleChange}
            error={errors.Data}
            title={
              isCreditCardAccount
                ? 'Data em que a compra ou estorno ocorreu'
                : 'Data em que a compra ou pagamento ocorreu'
            }
          />
          {showSeparatePaymentDate && (
            <Input
              label="Data do Pagamento"
              name="Data_Pagamento"
              type="date"
              value={transaction.Data_Pagamento}
              onChange={handleChange}
              placeholder="Vencimento na fatura"
              title="Quando a compra entra na fatura (vencimento)"
            />
          )}
        </div>
        {!showSeparatePaymentDate && selectedAccount && (
          <p className="text-[11px] text-gray-500 -mt-2">
            Para {selectedAccount.Tipo_Conta === 'Cartão de Crédito' ? 'estornos' : 'débito, alimentação ou dinheiro'},
            a data da compra é a mesma do pagamento.
          </p>
        )}

        <div className="flex items-end gap-2">
          <div className="flex-grow">
            <Select
              label="Conta"
              name="ID_Conta"
              value={transaction.ID_Conta}
              onChange={handleChange}
              error={errors.ID_Conta}
            >
              <option value="" disabled>
                Selecione uma conta...
              </option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.Nome_Conta}
                  {acc.Tipo_Conta === 'Cartão de Crédito' ? ' (cartão)' : ''}
                </option>
              ))}
            </Select>
          </div>
          <Button
            type="button"
            onClick={onOpenCreateAccount}
            className="mb-px h-[42px] shrink-0 px-3 text-xs font-bold"
            variant="secondary"
            title="Criar nova conta"
          >
            + Conta
          </Button>
        </div>

        {isCreditCardAccount && selectedAccount && (
          <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-3 space-y-3">
            <p className="text-xs text-cyan-100/90 leading-relaxed">
              Conta de <strong className="text-white">cartão de crédito</strong>: escolha o tipo abaixo. Compras usam{' '}
              <strong className="text-white">Data da Compra</strong> e{' '}
              <strong className="text-white">Data do Pagamento</strong> (vencimento na fatura); estornos usam só a data
              da compra e a competência da fatura; pagamentos devem usar{' '}
              <strong className="text-white">Pagar fatura</strong>.
            </p>
            <Select
              label="Tipo de lançamento no cartão"
              name="cardEntryKind"
              value={cardEntryKind}
              onChange={(e) => handleCardKindChange(e.target.value as CardManualEntryKind)}
              error={errors.cardEntryKind}
            >
              <option value="" disabled>
                Selecione o tipo...
              </option>
              <option value="purchase">Compra / despesa no cartão</option>
              <option value="refund">Estorno ou crédito na fatura</option>
              <option value="invoice_payment">Pagamento de fatura</option>
            </Select>

            {showPaymentGuide && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 space-y-2">
                <p className="text-xs text-amber-100/90 leading-relaxed">
                  Pagamento de fatura deve usar o botão <strong>Pagar</strong> no card do cartão para
                  escolher qual competência você está quitando.
                </p>
                {onPayCreditCardInvoice && (
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full sm:w-auto"
                    onClick={() => {
                      const amount = parseFloat(transaction.Valor);
                      openPayInvoiceFlow(
                        selectedAccount,
                        Number.isFinite(amount) ? amount : 0
                      );
                    }}
                  >
                    Ir para Pagar fatura
                  </Button>
                )}
              </div>
            )}

            {cardEntryKind === 'refund' && loadCompetenceCards && (
              <div className="space-y-1.5">
                <Select
                  label="Competência da fatura (estorno)"
                  name="refundReferenceMonth"
                  value={refundReferenceMonth}
                  onChange={(e) => setRefundReferenceMonth(e.target.value)}
                  error={errors.RefundCompetence}
                  disabled={competenceLoading || isSaving}
                >
                  <option value="" disabled>
                    {competenceLoading ? 'Carregando faturas…' : 'Selecione a competência…'}
                  </option>
                  {competenceCards.map((card) => (
                    <option key={card.referenceMonth} value={card.referenceMonth}>
                      {card.competenceBR} — venc. {card.vencimentoBR} — total{' '}
                      {formatCurrency(card.statementTotal)}
                    </option>
                  ))}
                </Select>
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  O estorno reduz o total da fatura na competência escolhida (não usa só a data do
                  lançamento).
                </p>
              </div>
            )}
          </div>
        )}

        <div className="space-y-1">
          <div className="flex items-end gap-2">
            <div className="flex-grow min-w-0">
              <Input
                label="Descrição"
                name="Nome_Fantasia"
                value={transaction.Nome_Fantasia}
                onChange={handleChange}
                error={errors.Nome_Fantasia}
                placeholder={
                  cardEntryKind === 'refund' ? 'Ex: Estorno compra loja X' : 'Ex: Mercado, Aluguel...'
                }
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              className="mb-px h-[42px] shrink-0 px-3 text-xs font-bold"
              title="Criar regra para preencher importações com texto parecido"
              onClick={() => setMappingRuleModalOpen(true)}
            >
              + Regra
            </Button>
          </div>
          <p className="text-[11px] text-slate-400 leading-snug">
            Use <span className="text-slate-300 font-medium">+ Regra</span> para mapear esta descrição em
            futuras importações (ex.: todo &quot;UBER&quot; vira &quot;Uber Viagem&quot;).
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Tipo"
            name="Tipo"
            value={transaction.Tipo}
            onChange={handleChange}
            error={errors.Tipo}
            disabled={cardEntryKind === 'refund'}
          >
            <option value="" disabled>
              Selecione...
            </option>
            <option value="Despesa">Despesa (Saída)</option>
            <option value="Renda">Renda (Entrada)</option>
          </Select>
          <div className="flex items-end gap-2">
            <div className="flex-grow">
              <Select
                label="Categoria"
                name="Categoria"
                value={transaction.Categoria}
                onChange={(e) => {
                  if (e.target.value === 'ADD_NEW_CATEGORY') {
                    onOpenCreateCategory();
                  } else {
                    handleChange(e);
                  }
                }}
                error={errors.Categoria}
              >
                <option value="">Selecione...</option>
                {categories
                  .filter((c) => (transaction.Tipo ? c.Tipo === 'Ambos' || c.Tipo === transaction.Tipo : true))
                  .filter((c) => c.Nome_Categoria !== '' && c.Nome_Categoria !== '-')
                  .sort((a, b) => a.Nome_Categoria.localeCompare(b.Nome_Categoria))
                  .map((c) => (
                    <option key={c.id} value={c.Nome_Categoria}>
                      {c.Nome_Categoria}
                    </option>
                  ))}
                <option value="ADD_NEW_CATEGORY" className="text-highlight font-bold">
                  + Adicionar Categoria
                </option>
              </Select>
            </div>
            <Button
              type="button"
              onClick={onOpenCreateCategory}
              className="mb-px h-[42px] shrink-0 px-3 text-xs font-bold"
              variant="secondary"
              title="Criar nova categoria"
            >
              + Categoria
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <Input
            label={getDynamicLabel()}
            name="Valor"
            type="number"
            step="0.01"
            value={transaction.Valor}
            onChange={handleChange}
            error={errors.Valor}
            placeholder="0,00"
          />
          {isInstallment && transaction.Valor && !isNaN(parseFloat(transaction.Valor)) && (
            <p className="text-xs text-accent text-right">
              Isso resultará em {recurrenceCount} parcelas de{' '}
              <strong>{formatCurrency(parseFloat(transaction.Valor) / parseFloat(recurrenceCount))}</strong>
            </p>
          )}
        </div>

        {transaction.Tipo === 'Despesa' && assets.length > 0 && (
          <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50 space-y-2">
            <Select
              label="Vincular a um Patrimônio / Financiamento"
              name="linked_asset_id"
              value={transaction.linked_asset_id}
              onChange={handleChange}
            >
              <option value="">-</option>
              {assets
                .filter((a) => a.is_financed)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} (Saldo: {formatCurrency(a.remaining_balance || 0)})
                  </option>
                ))}
            </Select>
            <p className="text-[10px] text-gray-500 italic">
              * Ao vincular, o valor será abatido automaticamente do saldo devedor do bem.
            </p>
          </div>
        )}

        {!(isCreditCardAccount && cardEntryKind === 'refund') && (
          <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
            <div className="flex items-center gap-2 mb-3">
              <input
                type="checkbox"
                id="isRecurrent"
                checked={isRecurrent}
                onChange={(e) => setIsRecurrent(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-highlight focus:ring-accent"
              />
              <label htmlFor="isRecurrent" className="text-sm font-medium text-gray-200 cursor-pointer select-none">
                Repetir este lançamento?
              </label>
            </div>

            {isRecurrent && (
              <div className="pl-6 space-y-3 animate-fadeIn">
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="recurrenceType"
                      value="installments"
                      checked={recurrenceType === 'installments'}
                      onChange={() => setRecurrenceType('installments')}
                      className="text-highlight focus:ring-accent bg-gray-700 border-gray-600"
                    />
                    <span className="text-sm text-gray-300">Parcelado (Compra 10x)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="recurrenceType"
                      value="fixed"
                      checked={recurrenceType === 'fixed'}
                      onChange={() => setRecurrenceType('fixed')}
                      className="text-highlight focus:ring-accent bg-gray-700 border-gray-600"
                    />
                    <span className="text-sm text-gray-300">Fixo Mensal (Recorrente)</span>
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-400">
                    {isInstallment ? 'Número de parcelas:' : 'Repetir por quantos meses?'}
                  </span>
                  <Input
                    type="number"
                    value={recurrenceCount}
                    onChange={(e) => setRecurrenceCount(e.target.value)}
                    min="2"
                    max="360"
                    className="w-24 !mb-0"
                    error={errors.Recurrence}
                  />
                  {isFixed && <span className="text-xs text-gray-500">(Use um número alto para "indefinido")</span>}
                </div>

                <div className="text-xs text-accent bg-accent/10 p-2 rounded border border-accent/20">
                  {isInstallment
                    ? `O valor total será dividido em ${recurrenceCount}x. Ex: "TV (1/${recurrenceCount})", "TV (2/${recurrenceCount})"...`
                    : `O lançamento será clonado ${recurrenceCount || 0} vezes para os próximos meses.`}
                </div>
              </div>
            )}
          </div>
        )}
      </form>
    </Modal>

    {mappingRuleModalOpen ? (
      <MappingRuleModal
        rule={null}
        transaction={transactionForRule}
        categories={categories}
        assets={assets}
        overlayClassName="z-[70]"
        onClose={() => setMappingRuleModalOpen(false)}
        onSave={handleSaveMappingRule}
      />
    ) : null}
    </>
  );
};

export default NewTransactionModal;
