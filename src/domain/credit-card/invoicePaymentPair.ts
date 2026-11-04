/**
 * Pagamento de fatura registrado pelo «Pagar fatura»: duas linhas que só fazem sentido juntas.
 *
 * - Lado do cartão: Renda no cartão, abate a fatura escolhida.
 * - Lado da conta: Despesa na conta de onde saiu o dinheiro.
 *
 * As duas levam na `Descricao_Original` a fatura (`finelo_competence:AAAA-MM`) e a conta de origem
 * (`finelo_funding_account:<id>`). Desde a identidade econômica, as duas também levam o MESMO
 * `economic_event_id`. Pagamentos antigos têm só os marcadores (e um evento por linha, do backfill).
 *
 * Mexer em um lado só desalinha fatura, saldo da conta e limite disponível. Por isso:
 * - excluir remove os dois lados juntos;
 * - editar só muda o nome e a categoria (valor, data, conta e fatura ficam como foram pagos).
 */
import type { Account, Transaction } from '../../types';
import {
  FUNDING_ACCOUNT_OBS_PREFIX,
  COMPETENCE_PAYMENT_OBS_PREFIX,
  isImportedInvoicePayment,
  isManualInvoicePayment,
  parseDirectedCompetenceFromPayment,
  parseFundingAccountFromPayment,
} from '../../services/creditCardDirectedPayment';
import { toDateOnlyIso } from '../../utils/dateOnly';
import { formatCurrency } from '../../utils/formatters';

export type InvoicePaymentLegRole = 'card' | 'source';

export interface InvoicePaymentLeg {
  role: InvoicePaymentLegRole;
  /** Fatura escolhida (AAAA-MM). */
  referenceMonth: string;
  /** Conta de onde saiu o dinheiro. */
  sourceAccountId: string;
  amountCents: number;
  dateIso: string;
}

export interface InvoicePaymentPair {
  /** A linha pedida primeiro; a outra (quando achada) em seguida. */
  legs: Transaction[];
  cardLeg: Transaction | null;
  sourceLeg: Transaction | null;
  /** Os dois lados foram encontrados. */
  complete: boolean;
}

/** Campos que uma edição pode mudar num pagamento de fatura: só identificação, nunca dinheiro. */
export const INVOICE_PAYMENT_EDITABLE_FIELDS = ['Nome_Fantasia', 'Categoria'] as const satisfies readonly (keyof Transaction)[];
const EDITABLE = new Set<string>(INVOICE_PAYMENT_EDITABLE_FIELDS);

/** Campos travados na tabela para um pagamento de fatura. */
export const INVOICE_PAYMENT_LOCKED_FIELDS: (keyof Transaction)[] = [
  'Data',
  'Data_Pagamento',
  'ID_Conta',
  'Valor',
  'Tipo',
  'Parcela_Atual',
  'Total_Parcelas',
  'Descricao_Original',
  'linked_asset_id',
];

const CREDIT_CARD = 'Cartão de Crédito';
const isManual = (t: Pick<Transaction, 'Origem'>) => String(t.Origem || 'manual').trim().toLowerCase() === 'manual';
const cents = (v: unknown) => Math.round(Math.abs(Number(v) || 0) * 100);

type AccountLookup = ReadonlyMap<string, Pick<Account, 'id' | 'Tipo_Conta' | 'Nome_Conta'>>;

export function accountLookup(accounts: ReadonlyArray<Pick<Account, 'id' | 'Tipo_Conta' | 'Nome_Conta'>>): AccountLookup {
  return new Map(accounts.map((a) => [a.id, a]));
}

/**
 * Reconhece uma linha gravada pelo «Pagar fatura» pela estrutura que só esse fluxo grava:
 * lançamento manual com a fatura e a conta de origem na descrição original, do lado certo.
 * Texto digitado pelo usuário (nome, categoria) nunca decide.
 */
export function describeInvoicePaymentLeg(
  tx: Transaction,
  accounts: AccountLookup
): InvoicePaymentLeg | null {
  if (!isManual(tx)) return null;
  const desc = String(tx.Descricao_Original || '');
  if (!desc.includes(COMPETENCE_PAYMENT_OBS_PREFIX) || !desc.includes(FUNDING_ACCOUNT_OBS_PREFIX)) return null;
  const referenceMonth = parseDirectedCompetenceFromPayment(tx);
  const sourceAccountId = parseFundingAccountFromPayment(tx);
  if (!referenceMonth || !sourceAccountId || !tx.ID_Conta) return null;

  const account = accounts.get(tx.ID_Conta);
  const amountCents = cents(tx.Valor);
  const dateIso = toDateOnlyIso(tx.Data as unknown as string);
  if (amountCents <= 0) return null;

  if (account?.Tipo_Conta === CREDIT_CARD && tx.Tipo === 'Renda') {
    return { role: 'card', referenceMonth, sourceAccountId, amountCents, dateIso };
  }
  if (tx.Tipo === 'Despesa' && tx.ID_Conta === sourceAccountId && account?.Tipo_Conta !== CREDIT_CARD) {
    return { role: 'source', referenceMonth, sourceAccountId, amountCents, dateIso };
  }
  return null;
}

export const isInvoicePaymentLeg = (tx: Transaction, accounts: AccountLookup): boolean =>
  describeInvoicePaymentLeg(tx, accounts) !== null;

const sameMoney = (a: InvoicePaymentLeg, b: InvoicePaymentLeg) =>
  a.role !== b.role &&
  a.referenceMonth === b.referenceMonth &&
  a.sourceAccountId === b.sourceAccountId &&
  a.amountCents === b.amountCents;

/** O lado da conta cita o cartão pelo nome («Pagamento Fatura <cartão> (AAAA-MM)»). */
const sourceMentionsCard = (sourceLeg: Transaction, card: Pick<Account, 'Nome_Conta'> | undefined) => {
  const name = String(card?.Nome_Conta || '').trim();
  return !name || String(sourceLeg.Descricao_Original || '').includes(`Pagamento Fatura ${name} (`);
};

/**
 * Acha o outro lado de um pagamento de fatura.
 *
 * 1. Mesmo `economic_event_id` (pagamentos novos): é o vínculo gravado pelo próprio fluxo.
 * 2. Pagamentos antigos, sem evento comum: mesmos marcadores, mesmo valor e mesma data.
 *    Se houver mais de um candidato idêntico, qualquer um deixa a conta igual; fica o primeiro por id.
 *
 * Devolve `null` quando a linha não é um pagamento de fatura.
 */
export function findInvoicePaymentPair(
  tx: Transaction,
  transactions: ReadonlyArray<Transaction>,
  accountsList: ReadonlyArray<Pick<Account, 'id' | 'Tipo_Conta' | 'Nome_Conta'>>
): InvoicePaymentPair | null {
  const accounts = accountLookup(accountsList);
  const me = describeInvoicePaymentLeg(tx, accounts);
  if (!me) return null;

  const others = transactions
    .filter((t) => t.ID_Transacao && t.ID_Transacao !== tx.ID_Transacao)
    .map((t) => ({ t, leg: describeInvoicePaymentLeg(t, accounts) }))
    .filter((x): x is { t: Transaction; leg: InvoicePaymentLeg } => x.leg !== null && sameMoney(me, x.leg));

  let other: Transaction | null = null;

  if (tx.economic_event_id) {
    const linked = others.filter((x) => x.t.economic_event_id === tx.economic_event_id);
    if (linked.length === 1) other = linked[0].t;
  }

  if (!other) {
    const shared = new Map<string, number>();
    for (const t of transactions) {
      if (t.economic_event_id) shared.set(t.economic_event_id, (shared.get(t.economic_event_id) ?? 0) + 1);
    }
    const candidates = others
      .filter((x) => x.leg.dateIso === me.dateIso)
      // Linha já unida a outro pagamento pelo evento não serve de par para esta.
      .filter((x) => !x.t.economic_event_id || (shared.get(x.t.economic_event_id) ?? 0) <= 1)
      .filter((x) =>
        me.role === 'card'
          ? sourceMentionsCard(x.t, accounts.get(String(tx.ID_Conta)))
          : sourceMentionsCard(tx, accounts.get(String(x.t.ID_Conta)))
      )
      .sort((a, b) => String(a.t.ID_Transacao).localeCompare(String(b.t.ID_Transacao)));
    if (!tx.economic_event_id || (shared.get(tx.economic_event_id) ?? 0) <= 1) {
      other = candidates[0]?.t ?? null;
    }
  }

  const legs = other ? [tx, other] : [tx];
  const cardLeg = legs.find((t) => describeInvoicePaymentLeg(t, accounts)?.role === 'card') ?? null;
  const sourceLeg = legs.find((t) => describeInvoicePaymentLeg(t, accounts)?.role === 'source') ?? null;
  return { legs, cardLeg, sourceLeg, complete: !!other };
}

/**
 * Edição de um pagamento de fatura: só nome e categoria, e só se mudaram.
 * Valor, data, conta e fatura descrevem o pagamento feito; mudar um lado só desalinha o cartão.
 */
export function restrictInvoicePaymentUpdate(
  previous: Transaction,
  requested: Partial<Transaction>
): Partial<Transaction> {
  const safe: Partial<Transaction> = {};
  for (const [field, value] of Object.entries(requested)) {
    if (!EDITABLE.has(field) || value === undefined) continue;
    if (value === (previous as unknown as Record<string, unknown>)[field]) continue;
    (safe as Record<string, unknown>)[field] = value;
  }
  return safe;
}

/** Algum campo pedido, além de nome e categoria, mudaria o pagamento? */
export function wouldChangeInvoicePaymentMoney(previous: Transaction, requested: Partial<Transaction>): boolean {
  for (const [field, value] of Object.entries(requested)) {
    if (EDITABLE.has(field) || field === 'ID_Transacao' || value === undefined) continue;
    const before = (previous as unknown as Record<string, unknown>)[field];
    if (field === 'Data' || field === 'Data_Pagamento') {
      if (toDateOnlyIso(value as string) !== toDateOnlyIso(before as string)) return true;
      continue;
    }
    if (field === 'Valor') {
      if (Math.round(Number(value) * 100) !== Math.round(Number(before) * 100)) return true;
      continue;
    }
    const norm = (v: unknown) => (v === undefined || v === null ? '' : v);
    if (norm(value) !== norm(before)) return true;
  }
  return false;
}

const brDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** «fatura de outubro/2026» — sem jargão. */
export function invoiceLabel(referenceMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(referenceMonth);
  if (!m) return 'fatura';
  return `fatura de ${MONTHS[Number(m[2]) - 1]}/${m[1]}`;
}

/** Texto da confirmação de exclusão: deixa claro que os dois lados saem juntos. */
export function invoicePaymentDeletionMessage(
  pair: InvoicePaymentPair,
  accountsList: ReadonlyArray<Pick<Account, 'id' | 'Tipo_Conta' | 'Nome_Conta'>>
): string {
  const accounts = accountLookup(accountsList);
  const base = pair.cardLeg ?? pair.sourceLeg ?? pair.legs[0];
  const leg = describeInvoicePaymentLeg(base, accounts);
  const amount = formatCurrency((leg?.amountCents ?? 0) / 100);
  const card = pair.cardLeg?.ID_Conta ? accounts.get(pair.cardLeg.ID_Conta)?.Nome_Conta : undefined;
  const source = leg ? accounts.get(leg.sourceAccountId)?.Nome_Conta : undefined;
  const fatura = leg ? invoiceLabel(leg.referenceMonth) : 'fatura';

  if (pair.complete) {
    return (
      `Este é um pagamento de ${amount} da ${fatura}${card ? ` do cartão ${card}` : ''}. ` +
      `Os dois lados saem juntos: o abatimento na fatura e a saída da conta${source ? ` ${source}` : ''}. ` +
      'A fatura volta a mostrar esse valor em aberto.'
    );
  }
  return (
    `Este é um pagamento de ${amount} da ${fatura}. O outro lado do pagamento não foi encontrado ` +
    '(pode já ter sido excluído). Só este lançamento será excluído.'
  );
}

/** Orientação quando o usuário tenta mudar valor, data, conta ou fatura de um pagamento. */
export const INVOICE_PAYMENT_EDIT_GUIDANCE =
  'Este lançamento é um pagamento de fatura. Aqui você pode mudar só o nome e a categoria. ' +
  'Para corrigir o valor, a data, a conta ou a fatura, exclua o pagamento (os dois lados saem juntos) ' +
  'e registre de novo em «Pagar fatura».';

export interface PaymentDuplicateCandidate {
  transaction: Transaction;
  dateIso: string;
  amount: number;
}

/**
 * Pagamentos já lançados neste cartão com o mesmo valor e a mesma data: provável duplicidade.
 * É só um aviso; dois pagamentos iguais podem ser legítimos e o usuário decide.
 */
export function findPossibleDuplicatePayments(input: {
  cardAccountId: string;
  amount: number;
  dateIso: string;
  transactions: ReadonlyArray<Transaction>;
}): PaymentDuplicateCandidate[] {
  const target = cents(input.amount);
  if (target <= 0 || !input.dateIso) return [];
  return input.transactions
    .filter((t) => t.ID_Conta === input.cardAccountId && t.Tipo === 'Renda')
    .filter((t) => cents(t.Valor) === target && toDateOnlyIso(t.Data as unknown as string) === input.dateIso)
    .filter((t) => (isManual(t) ? isManualInvoicePayment(t) : isImportedInvoicePayment(t)))
    .map((t) => ({ transaction: t, dateIso: input.dateIso, amount: target / 100 }));
}

export function duplicatePaymentWarning(candidates: PaymentDuplicateCandidate[]): string {
  const first = candidates[0];
  const amount = formatCurrency(first.amount);
  const times = candidates.length > 1 ? `${candidates.length} pagamentos` : 'um pagamento';
  return (
    `Já existe ${times} de ${amount} em ${brDate(first.dateIso)} neste cartão. ` +
    'Se for um pagamento diferente, pode registrar. Se for o mesmo, registrar de novo vai contar o valor duas vezes.'
  );
}

/**
 * Valor digitado no formato brasileiro: «2.000,00», «2000,5», «R$ 3.431,92». Também aceita «3431.92».
 * Devolve `null` quando não dá para ler um valor maior que zero.
 */
export function parsePaymentAmountInput(raw: string): number | null {
  let text = String(raw || '').replace(/R\$/gi, '').replace(/\s/g, '');
  if (!text) return null;
  if (text.includes(',')) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, '');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const value = Math.round(Number(text) * 100) / 100;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Valor para o campo do formulário: «5431,93». */
export const formatPaymentAmountInput = (value: number): string => value.toFixed(2).replace('.', ',');

const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/**
 * Despesa numa conta bancária que parece o pagamento da fatura de um cartão cadastrado no FinElo
 * («Pagamento fatura Nubank», «pgto fatura»). Lançada como despesa comum, a fatura continuaria em aberto
 * e o gasto contaria duas vezes (compras no cartão + pagamento).
 */
export function detectInvoicePaymentFromBank(
  parts: { nome?: string; descricao?: string; categoria?: string },
  cards: ReadonlyArray<Pick<Account, 'id' | 'Nome_Conta'>>
): { looksLikePayment: boolean; cardId: string | null } {
  if (cards.length === 0) return { looksLikePayment: false, cardId: null };
  const blob = plain([parts.nome, parts.descricao, parts.categoria].map((x) => String(x || '')).join(' '));
  const mentionsInvoice = /\bfatura\b/.test(blob);
  const mentionsPayment = /\b(pagamento|pgto|pagto|pag)\b/.test(blob);
  const card =
    cards.find((c) => {
      const name = plain(String(c.Nome_Conta || '')).trim();
      return name.length >= 3 && blob.includes(name);
    }) ?? null;
  const looksLikePayment = mentionsInvoice && (mentionsPayment || card !== null);
  return { looksLikePayment, cardId: looksLikePayment ? (card?.id ?? null) : null };
}

/**
 * Seleção para excluir: cada lado de pagamento de fatura leva o seu outro lado junto.
 * Um outro lado já reservado para uma linha não serve para outra (pagamentos antigos idênticos
 * selecionados juntos levam cada um o seu par, sem deixar sobra).
 */
export function expandInvoicePaymentSelection(
  selected: ReadonlyArray<Transaction>,
  all: ReadonlyArray<Transaction>,
  accountsList: ReadonlyArray<Pick<Account, 'id' | 'Tipo_Conta' | 'Nome_Conta'>>
): { transactions: Transaction[]; addedIds: string[] } {
  const chosen = new Map<string, Transaction>();
  const selectedIds = new Set(selected.map((t) => String(t.ID_Transacao)));
  const claimed = new Set<string>();
  for (const t of selected) {
    const id = String(t.ID_Transacao);
    chosen.set(id, t);
    if (claimed.has(id)) continue;
    const pool = all.filter((x) => !claimed.has(String(x.ID_Transacao)) || x === t);
    // Prefere um par que também esteja selecionado.
    const pair =
      findInvoicePaymentPair(t, pool.filter((x) => x === t || selectedIds.has(String(x.ID_Transacao))), accountsList) ??
      null;
    const resolved = pair?.complete ? pair : findInvoicePaymentPair(t, pool, accountsList);
    claimed.add(id);
    for (const leg of resolved?.legs ?? []) {
      const legId = String(leg.ID_Transacao);
      if (!isManual(leg)) continue;
      claimed.add(legId);
      chosen.set(legId, leg);
    }
  }
  const transactions = [...chosen.values()];
  return { transactions, addedIds: transactions.map((t) => String(t.ID_Transacao)).filter((id) => !selectedIds.has(id)) };
}
