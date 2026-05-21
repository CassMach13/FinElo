import type { CompetenceHistoryCard } from './creditCardRebuildFromImportHistoryService';
import { Transaction } from '../types';

/** Marcador em `Observacoes` para abater pagamento manual em competência escolhida. */
export const COMPETENCE_PAYMENT_OBS_PREFIX = 'finelo_competence:';

const REF_MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function buildCompetencePaymentObservacao(referenceMonth: string): string {
  return `${COMPETENCE_PAYMENT_OBS_PREFIX}${referenceMonth.trim()}`;
}

/** Descrição persistida no banco (coluna sem `Observacoes` dedicada). */
export function buildDirectedPaymentDescription(referenceMonth: string): string {
  const ref = referenceMonth.trim();
  return `Pagamento de Fatura (${ref}) ${buildCompetencePaymentObservacao(ref)}`;
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

/** Pagamento de fatura manual (Renda no cartão). */
export function isManualInvoicePayment(tx: Transaction): boolean {
  if (String(tx.Tipo) !== 'Renda') return false;
  if (isDirectedCompetencePayment(tx)) return true;
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
