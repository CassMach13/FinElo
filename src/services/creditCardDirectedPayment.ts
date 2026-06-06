import type { CompetenceHistoryCard } from './creditCardRebuildFromImportHistoryService';
import { Transaction } from '../types';

/** Marcador em `Observacoes` para abater pagamento manual em competência escolhida. */
export const COMPETENCE_PAYMENT_OBS_PREFIX = 'finelo_competence:';

/** Conta bancária de onde saiu o dinheiro do pagamento (par conciliado). */
export const FUNDING_ACCOUNT_OBS_PREFIX = 'finelo_funding_account:';

export function buildFundingAccountObservacao(sourceAccountId: string): string {
  return `${FUNDING_ACCOUNT_OBS_PREFIX}${sourceAccountId.trim()}`;
}

export function parseFundingAccountFromPayment(
  tx: Pick<Transaction, 'Observacoes' | 'Descricao_Original'>
): string | null {
  for (const raw of [tx.Observacoes, tx.Descricao_Original]) {
    const m = new RegExp(`${FUNDING_ACCOUNT_OBS_PREFIX}([a-f0-9-]{36})`, 'i').exec(String(raw || ''));
    if (m?.[1]) return m[1];
  }
  return null;
}

const REF_MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function buildCompetencePaymentObservacao(referenceMonth: string): string {
  return `${COMPETENCE_PAYMENT_OBS_PREFIX}${referenceMonth.trim()}`;
}

/** Descrição persistida no banco (marcadores em `Descricao_Original`, sem coluna `Observacoes`). */
export function buildDirectedPaymentDescription(
  referenceMonth: string,
  sourceAccountId?: string
): string {
  const ref = referenceMonth.trim();
  const funding =
    sourceAccountId?.trim() ? ` ${buildFundingAccountObservacao(sourceAccountId)}` : '';
  return `Pagamento de Fatura (${ref}) ${buildCompetencePaymentObservacao(ref)}${funding}`;
}

/** Lançamento de saída na conta corrente/poupança que pagou a fatura. */
export function buildFundingPaymentDescription(
  referenceMonth: string,
  cardAccountName: string,
  sourceAccountId?: string
): string {
  const ref = referenceMonth.trim();
  const card = cardAccountName.trim() || 'Cartão';
  const funding =
    sourceAccountId?.trim() ? ` ${buildFundingAccountObservacao(sourceAccountId)}` : '';
  return `Pagamento Fatura ${card} (${ref}) ${buildCompetencePaymentObservacao(ref)}${funding}`;
}

/** Estorno/crédito manual com competência explícita na fatura. */
export function buildDirectedRefundDescription(referenceMonth: string, label = 'Estorno'): string {
  const ref = referenceMonth.trim();
  const base = label.trim() || 'Estorno';
  return `${base} (${ref}) ${buildCompetencePaymentObservacao(ref)}`;
}

export type CardManualEntryKind = 'purchase' | 'refund' | 'invoice_payment';

const DEFAULT_REFUND_HINTS = ['estorno', 'reembolso', 'devolucao', 'cancelamento', 'credito', 'ajuste credor'];

const textBlob = (parts: Array<string | undefined | null>) =>
  normalize(parts.filter(Boolean).join(' '));

/** Pagamento explícito na descrição/nome (ignora categoria — evita falso positivo em "Pagamento Cartão"). */
export function looksLikeStrictInvoicePaymentText(
  parts: { nome?: string; descricao?: string },
  paymentKeywords: string[] = []
): boolean {
  const blob = textBlob([parts.nome, parts.descricao]);
  if (
    blob.includes('pagamento de fatura') ||
    (blob.includes('pagamento') && blob.includes('fatura'))
  ) {
    return true;
  }
  return paymentKeywords.some((k) => {
    const kw = normalize(k);
    return kw.length > 2 && blob.includes(kw);
  });
}

/** Texto usado para classificar compras/pagamentos no ledger (inclui regra de mapeamento). */
export function ledgerClassificationTextFromTransaction(
  tx: Pick<Transaction, 'Nome_Fantasia' | 'Descricao_Original' | 'Categoria'>
): string {
  return [tx.Nome_Fantasia, tx.Descricao_Original, tx.Categoria]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' ');
}

/** Pagamento de fatura vindo de CSV/OFX (regra pode ter renomeado só Nome/Categoria). */
export function isImportedInvoicePayment(
  tx: Pick<Transaction, 'Nome_Fantasia' | 'Descricao_Original' | 'Categoria' | 'Tipo' | 'Origem'>,
  paymentKeywords?: string[]
): boolean {
  if (String(tx.Tipo) !== 'Renda') return false;
  const origin = String(tx.Origem || 'manual').trim().toLowerCase();
  if (origin === 'manual') return false;
  return looksLikeInvoicePaymentText(
    { categoria: tx.Categoria, nome: tx.Nome_Fantasia, descricao: tx.Descricao_Original },
    paymentKeywords
  );
}

export function looksLikeInvoicePaymentText(
  parts: { categoria?: string; nome?: string; descricao?: string },
  paymentKeywords: string[] = []
): boolean {
  const blob = textBlob([parts.categoria, parts.nome, parts.descricao]);
  if (
    blob.includes('pagamento de fatura') ||
    (blob.includes('pagamento') && blob.includes('fatura'))
  ) {
    return true;
  }
  if (looksLikeStrictInvoicePaymentText(parts, paymentKeywords)) return true;
  const cat = normalize(String(parts.categoria || ''));
  return cat.includes('pagamento') && (cat.includes('fatura') || cat.includes('cartao') || cat.includes('credito'));
}

export function looksLikeCardRefundText(
  parts: { categoria?: string; nome?: string; descricao?: string },
  creditKeywords: string[] = DEFAULT_REFUND_HINTS
): boolean {
  const blob = textBlob([parts.categoria, parts.nome, parts.descricao]);
  if (blob.includes(COMPETENCE_PAYMENT_OBS_PREFIX.toLowerCase())) {
    if (looksLikeStrictInvoicePaymentText(parts)) return false;
    return true;
  }
  return creditKeywords.some((k) => {
    const kw = normalize(k);
    return kw.length > 2 && blob.includes(kw);
  });
}

export function inferCardManualEntryKind(
  tipo: string,
  parts: { categoria?: string; nome?: string; descricao?: string },
  opts?: { paymentKeywords?: string[]; creditKeywords?: string[] }
): CardManualEntryKind | null {
  if (tipo === 'Despesa') return 'purchase';
  if (tipo !== 'Renda') return null;
  if (looksLikeInvoicePaymentText(parts, opts?.paymentKeywords)) return 'invoice_payment';
  if (looksLikeCardRefundText(parts, opts?.creditKeywords)) return 'refund';
  return null;
}

export function referenceMonthFromIsoDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || '').trim());
  if (!m || !REF_MONTH_RE.test(`${m[1]}-${m[2]}`)) return null;
  return `${m[1]}-${m[2]}`;
}

const DIRECTED_COMPETENCE_RE = new RegExp(
  `${COMPETENCE_PAYMENT_OBS_PREFIX}(\\d{4}-(?:0[1-9]|1[0-2]))`
);

export function parseDirectedCompetenceFromPayment(tx: Transaction): string | null {
  for (const raw of [tx.Observacoes, tx.Descricao_Original]) {
    const m = DIRECTED_COMPETENCE_RE.exec(String(raw || ''));
    if (m && REF_MONTH_RE.test(m[1])) return m[1];
  }
  return null;
}

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Pagamento registrado pelo modal Pagar (marcador de competência na descrição). */
export function isDirectedCompetencePayment(tx: Transaction): boolean {
  return parseDirectedCompetenceFromPayment(tx) != null;
}

/** Estorno/crédito manual no cartão (Renda, não é pagamento de fatura). */
export function isManualCardRefund(tx: Transaction, creditKeywords?: string[]): boolean {
  if (String(tx.Tipo) !== 'Renda') return false;
  if (isManualInvoicePayment(tx)) return false;
  const directed = parseDirectedCompetenceFromPayment(tx);
  if (directed) return true;
  return looksLikeCardRefundText(
    {
      categoria: tx.Categoria,
      nome: tx.Nome_Fantasia,
      descricao: tx.Descricao_Original,
    },
    creditKeywords
  );
}

/** Lançamento manual com competência escolhida via modal Pagar. */
export function isDirectedManualInvoicePayment(tx: Transaction): boolean {
  if (!isDirectedCompetencePayment(tx) || String(tx.Tipo) !== 'Renda') return false;
  return looksLikeStrictInvoicePaymentText({
    nome: tx.Nome_Fantasia,
    descricao: tx.Descricao_Original,
  });
}

/** Estorno/crédito manual com competência explícita (marcador finelo_competence, não é pagamento). */
export function isDirectedManualRefund(tx: Transaction): boolean {
  if (!isDirectedCompetencePayment(tx) || String(tx.Tipo) !== 'Renda') return false;
  return !isDirectedManualInvoicePayment(tx);
}

/** Pagamento de fatura manual (Renda no cartão). */
export function isManualInvoicePayment(tx: Transaction): boolean {
  if (String(tx.Tipo) !== 'Renda') return false;
  if (isDirectedCompetencePayment(tx)) {
    return isDirectedManualInvoicePayment(tx);
  }
  const cat = normalize(String(tx.Categoria || ''));
  const nome = normalize(String(tx.Nome_Fantasia || ''));
  const desc = normalize(String(tx.Descricao_Original || ''));
  return (
    cat.includes('pagamento') ||
    nome.includes('pagamento de fatura') ||
    desc.includes('pagamento de fatura') ||
    (nome.includes('pagamento') && nome.includes('fatura')) ||
    (desc.includes('pagamento') && desc.includes('fatura'))
  );
}

/** Competência em aberto mais antiga (para pré-seleção no modal Pagar). */
export function pickOldestOpenCompetenceCard(
  cards: CompetenceHistoryCard[]
): CompetenceHistoryCard | undefined {
  const open = cards.filter((c) => c.openBalance > 0.005);
  if (open.length === 0) return undefined;
  return [...open].sort((a, b) => a.referenceMonth.localeCompare(b.referenceMonth))[0];
}

export function competenceCardsWithOpenBalance(cards: CompetenceHistoryCard[]): CompetenceHistoryCard[] {
  return [...cards]
    .filter((c) => c.openBalance > 0.005)
    .sort((a, b) => a.referenceMonth.localeCompare(b.referenceMonth));
}

export type PaymentCategoryOption = { Nome_Categoria: string; Tipo: string };

/** Categorias de Renda/Ambos para o modal Pagar. */
export function incomeCategoriesForPayment(categories: PaymentCategoryOption[]): PaymentCategoryOption[] {
  return categories.filter((c) => c.Tipo === 'Renda' || c.Tipo === 'Ambos');
}

/** Preferência salva → nome com “pagamento”+cartão → qualquer “pagamento” → primeira de renda. */
export function pickDefaultCreditCardPaymentCategory(
  categories: PaymentCategoryOption[],
  savedPreference?: string | null
): string {
  const income = incomeCategoriesForPayment(categories);
  const names = new Set(income.map((c) => c.Nome_Categoria));

  const saved = (savedPreference || '').trim();
  if (saved && names.has(saved)) return saved;

  const cardPayment = income.find((c) => {
    const n = normalize(c.Nome_Categoria);
    return n.includes('pagamento') && (n.includes('cartao') || n.includes('credito'));
  });
  if (cardPayment) return cardPayment.Nome_Categoria;

  const anyPayment = income.find((c) => normalize(c.Nome_Categoria).includes('pagamento'));
  if (anyPayment) return anyPayment.Nome_Categoria;

  return income[0]?.Nome_Categoria || '';
}
