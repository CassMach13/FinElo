import {
  CreditCardClassificationSource,
  CreditCardEntryDirection,
  CreditCardEntryType,
  CreditCardImportEntry,
} from './types';

export interface ClassificationOverrides {
  bySourceRowHash?: Record<string, CreditCardEntryType>;
}

export interface ClassificationRules {
  paymentKeywords?: string[];
  refundKeywords?: string[];
  feeKeywords?: string[];
  interestKeywords?: string[];
}

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
const PAYMENT_KEYWORDS = [
  'pagamento de fatura',
  'pagto fatura',
  'pagamento cartao',
  'debito automatico fatura',
  /** XP Investimentos — agregado típico que liquida (em geral) a fatura do ciclo anterior no CSV */
  'pagamentos validos normais',
  'pagamentos validos',
];

const REFUND_KEYWORDS = ['estorno', 'reembolso', 'devolucao', 'cancelamento', 'credito', 'ajuste credor'];
const FEE_KEYWORDS = ['anuidade', 'tarifa'];
const INTEREST_KEYWORDS = ['juros', 'multa', 'encargos', 'iof', 'rotativo'];

const includesAnyKeyword = (normalizedText: string, keywords: string[]): boolean => {
  if (keywords.length === 0) return false;
  return keywords.some((k) => normalizedText.includes(normalizeText(k)));
};

export const inferDirection = (amount: number): CreditCardEntryDirection => (amount < 0 ? 'debit' : 'credit');

export const classifyEntryType = (
  entry: Pick<CreditCardImportEntry, 'amount' | 'descriptionNormalized' | 'sourceRowHash' | 'installmentTotal'>,
  rules?: ClassificationRules,
  overrides?: ClassificationOverrides
): {
  entryType: CreditCardEntryType;
  classificationSource: CreditCardClassificationSource;
  classificationConfidence: number;
} => {
  const normalized = entry.descriptionNormalized;
  const overridden = overrides?.bySourceRowHash?.[entry.sourceRowHash];
  if (overridden) {
    return {
      entryType: overridden,
      classificationSource: 'user',
      classificationConfidence: 1,
    };
  }

  const paymentKeywords = [...PAYMENT_KEYWORDS, ...(rules?.paymentKeywords || [])];
  const refundKeywords = [...REFUND_KEYWORDS, ...(rules?.refundKeywords || [])];
  const feeKeywords = [...FEE_KEYWORDS, ...(rules?.feeKeywords || [])];
  const interestKeywords = [...INTEREST_KEYWORDS, ...(rules?.interestKeywords || [])];

  if (includesAnyKeyword(normalized, paymentKeywords)) {
    return { entryType: 'invoice_payment', classificationSource: 'system', classificationConfidence: 0.95 };
  }
  if (includesAnyKeyword(normalized, refundKeywords)) {
    return { entryType: 'refund', classificationSource: 'system', classificationConfidence: 0.9 };
  }
  if (includesAnyKeyword(normalized, feeKeywords)) {
    return { entryType: 'fee', classificationSource: 'system', classificationConfidence: 0.85 };
  }
  if (includesAnyKeyword(normalized, interestKeywords)) {
    return { entryType: 'interest', classificationSource: 'system', classificationConfidence: 0.85 };
  }

  if (entry.amount === 0) {
    return { entryType: 'ignored', classificationSource: 'system', classificationConfidence: 0.99 };
  }

  if (entry.amount < 0) {
    if ((entry.installmentTotal || 0) > 1) {
      return { entryType: 'installment_purchase', classificationSource: 'system', classificationConfidence: 0.8 };
    }
    return { entryType: 'purchase', classificationSource: 'system', classificationConfidence: 0.8 };
  }

  /** Crédito na fatura (positivo em convenção cartão invertida) sem keyword: reduz valor a pagar — ex. estorno com descrição genérica tipo loja duplicada. */
  return { entryType: 'adjustment', classificationSource: 'system', classificationConfidence: 0.55 };
};

export const normalizeDescription = (value: string): string => normalizeText(value);

