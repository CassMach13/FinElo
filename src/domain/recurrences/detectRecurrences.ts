import type { Account, Category, Transaction } from '../../types';
import { buildCategorySets, classifyTransaction, isRecurrenceBaseEligibleTransaction } from '../economics/transactionSemantics';
import { localTodayIso, toDateOnlyIso } from '../../utils/dateOnly';
import type { TransactionFiltersState } from '../../utils/transactionPeriodFilters';

/**
 * Possíveis gastos recorrentes (V1-A: detecção somente leitura).
 *
 * O detector encontra PADRÕES no histórico; não afirma assinatura, despesa fixa nem cobrança
 * futura, não cria lançamentos e não persiste nada. Regras:
 *
 * - só Despesa, mensal; 12 meses civis COMPLETOS antes do mês atual (o mês atual não entra);
 * - data = `Transaction.Data` (data da compra/cobrança), NUNCA `Data_Pagamento` (no cartão o
 *   vencimento cria regularidade falsa);
 * - chave = dono + nome normalizado (trim, minúsculas, sem acento, espaços colapsados);
 *   sem remover dígitos, sem fuzzy; conta e categoria ficam fora da chave;
 * - EXATAMENTE no máximo 1 lançamento por mês: um mês com 2+ desqualifica o grupo inteiro;
 * - mínimo de 3 meses distintos; última ocorrência em um dos 2 últimos meses completos;
 * - valor típico = mediana; estável = todos dentro de ±20% da mediana;
 * - dia provável só como contexto (amplitude ≤ 7 dias), não decide se é candidato;
 * - exclui demo, categorias Ambos/investimento, pernas do Pagar e parcelas.
 */

export const RECURRENCE_WINDOW_MONTHS = 12;
export const RECURRENCE_MIN_MONTHS = 3;
export const RECURRENCE_ACTIVE_RECENT_MONTHS = 2;
export const RECURRENCE_STABLE_TOLERANCE = 0.2;
export const RECURRENCE_MAX_DAY_SPAN = 7;

export type UsualDay = { kind: 'exact'; day: number } | { kind: 'range'; from: number; to: number } | null;

export interface RecurrenceCandidate {
  ownerUserId: string;
  normalizedName: string;
  displayName: string;
  occurrenceCount: number;
  monthCount: number;
  typicalAmount: number;
  minAmount: number;
  maxAmount: number;
  amountPattern: 'stable' | 'variable';
  firstOccurrenceDate: string;
  lastOccurrenceDate: string;
  usualDay: UsualDay;
  accountCount: number;
  /** Existe lançamento FUTURO (pela `Data`) com a mesma chave, já registrado. */
  hasFutureRegistered: boolean;
  transactionIds: string[];
}

export interface RecurrenceWindow {
  /** Primeiro dia do primeiro mês da janela (AAAA-MM-DD). */
  startDate: string;
  /** Último dia do último mês completo (AAAA-MM-DD). */
  endDate: string;
  /** Os 12 meses 'AAAA-MM', do mais antigo ao mais recente. */
  months: string[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const monthKey = (y: number, m1: number) => `${y}-${pad2(m1)}`;

/** Janela de 12 meses completos imediatamente anteriores ao mês de `today`, em calendário civil. */
export function getRecurrenceWindow(today: string = localTodayIso()): RecurrenceWindow {
  const [y, m] = today.split('-').map(Number);
  const months: string[] = [];
  for (let back = RECURRENCE_WINDOW_MONTHS; back >= 1; back -= 1) {
    const d = new Date(y, m - 1 - back, 1, 12, 0, 0, 0);
    months.push(monthKey(d.getFullYear(), d.getMonth() + 1));
  }
  const [ly, lm] = months[months.length - 1].split('-').map(Number);
  const lastDay = new Date(ly, lm, 0, 12, 0, 0, 0).getDate();
  return { startDate: `${months[0]}-01`, endDate: `${months[months.length - 1]}-${pad2(lastDay)}`, months };
}

/** trim, minúsculas, sem acento, espaços colapsados. Não remove dígitos nem tokens. */
export function normalizeRecurrenceName(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nome curado primeiro; sem ele, a descrição original; sem nenhum, não participa. */
const identityOf = (t: Transaction): { normalized: string; display: string } | null => {
  const curated = String(t.Nome_Fantasia ?? '').trim();
  const raw = String(t.Descricao_Original ?? '').trim();
  const display = curated || raw;
  if (!display) return null;
  return { normalized: normalizeRecurrenceName(display), display };
};

interface Eligible {
  tx: Transaction;
  id: string;
  ownerId: string;
  normalized: string;
  display: string;
  date: string; // AAAA-MM-DD (Data)
  cents: number; // magnitude
}

const toCents = (v: number) => Math.round(Math.abs(v) * 100);
const fromCents = (c: number) => (c === 0 ? 0 : c / 100);

function median(sortedCents: number[]): number {
  const n = sortedCents.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sortedCents[mid] : Math.round((sortedCents[mid - 1] + sortedCents[mid]) / 2);
}

function usualDayOf(days: number[]): UsualDay {
  const min = Math.min(...days);
  const max = Math.max(...days);
  if (max - min > RECURRENCE_MAX_DAY_SPAN) return null;
  return min === max ? { kind: 'exact', day: min } : { kind: 'range', from: min, to: max };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function detectRecurrences(input: {
  transactions: Transaction[];
  categories: Category[];
  accounts?: Account[];
  today?: string;
  /** Resolve o dono de cada lançamento (padrão: `user_id`). */
  getOwnerId?: (tx: Transaction) => string | undefined;
}): RecurrenceCandidate[] {
  const today = input.today ? toDateOnlyIso(input.today) : localTodayIso();
  if (!today) return [];
  const window = getRecurrenceWindow(today);
  const windowMonths = new Set(window.months);
  const lastTwo = new Set(window.months.slice(-RECURRENCE_ACTIVE_RECENT_MONTHS));
  const categorySets = buildCategorySets(input.categories);
  const getOwner = input.getOwnerId ?? ((t: Transaction) => t.user_id);

  // Única passada: elegibilidade estrutural → grupos históricos e conjunto de chaves futuras.
  const groups = new Map<string, Eligible[]>();
  const futureKeys = new Set<string>();

  input.transactions.forEach((tx, index) => {
    if (!isRecurrenceBaseEligibleTransaction(classifyTransaction(tx, { categorySets }))) return;
    const identity = identityOf(tx);
    if (!identity) return;
    const date = toDateOnlyIso(tx.Data);
    if (!date) return;

    const ownerId = String(getOwner(tx) ?? '');
    const key = `${ownerId}\u0000${identity.normalized}`;

    if (date > today) {
      futureKeys.add(key);
      return;
    }
    if (!windowMonths.has(date.slice(0, 7))) return;

    const cents = toCents(tx.Valor);
    if (cents === 0) return;
    const entry: Eligible = {
      tx,
      id: String(tx.ID_Transacao ?? `idx-${index}`),
      ownerId,
      normalized: identity.normalized,
      display: identity.display,
      date,
      cents,
    };
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  });

  const candidates: RecurrenceCandidate[] = [];

  for (const [key, list] of groups) {
    // Um mês com mais de um lançamento desqualifica o grupo inteiro.
    const byMonth = new Map<string, Eligible>();
    let duplicated = false;
    for (const e of list) {
      const m = e.date.slice(0, 7);
      if (byMonth.has(m)) {
        duplicated = true;
        break;
      }
      byMonth.set(m, e);
    }
    if (duplicated) continue;
    if (byMonth.size < RECURRENCE_MIN_MONTHS) continue;

    const ordered = [...byMonth.values()].sort((a, b) => cmp(a.date, b.date) || cmp(a.id, b.id));
    const last = ordered[ordered.length - 1];
    if (!lastTwo.has(last.date.slice(0, 7))) continue;

    const sortedCents = ordered.map((e) => e.cents).sort((a, b) => a - b);
    const medianCents = median(sortedCents);
    const lowerBound = medianCents * (1 - RECURRENCE_STABLE_TOLERANCE);
    const upperBound = medianCents * (1 + RECURRENCE_STABLE_TOLERANCE);
    const minCents = sortedCents[0];
    const maxCents = sortedCents[sortedCents.length - 1];
    const stable = minCents >= lowerBound - 1e-9 && maxCents <= upperBound + 1e-9;

    const accountIds = new Set(ordered.map((e) => e.tx.ID_Conta ?? ''));
    const newest = ordered[ordered.length - 1];

    candidates.push({
      ownerUserId: last.ownerId,
      normalizedName: last.normalized,
      displayName: newest.display,
      occurrenceCount: ordered.length,
      monthCount: byMonth.size,
      typicalAmount: fromCents(medianCents),
      minAmount: fromCents(minCents),
      maxAmount: fromCents(maxCents),
      amountPattern: stable ? 'stable' : 'variable',
      firstOccurrenceDate: ordered[0].date,
      lastOccurrenceDate: last.date,
      usualDay: usualDayOf(ordered.map((e) => Number(e.date.slice(8, 10)))),
      accountCount: accountIds.size,
      hasFutureRegistered: futureKeys.has(key),
      transactionIds: ordered.map((e) => e.id),
    });
  }

  return candidates.sort(
    (a, b) =>
      b.monthCount - a.monthCount ||
      b.typicalAmount - a.typicalAmount ||
      a.displayName.localeCompare(b.displayName, 'pt-BR', { sensitivity: 'base' }) ||
      cmp(a.ownerUserId, b.ownerUserId) ||
      cmp(a.normalizedName, b.normalizedName)
  );
}

/**
 * Filtros de Transações para "Ver lançamentos": Despesa, por `Data` (nunca Pagamento), nos mesmos
 * 12 meses do detector, com o texto do nome exibido. A busca por texto pode trazer lançamentos de
 * nome parecido além dos exatos: serve para inspecionar, não é um filtro por id.
 */
export function buildRecurrenceFilterPatch(
  candidate: Pick<RecurrenceCandidate, 'displayName' | 'ownerUserId'>,
  window: Pick<RecurrenceWindow, 'startDate' | 'endDate'>,
  options: { filterByOwner: boolean }
): Pick<
  TransactionFiltersState,
  | 'text' | 'type' | 'dateField' | 'periodPreset' | 'viewScope' | 'startDate' | 'endDate'
  | 'category' | 'accountId' | 'sourceScope' | 'ownerUserId'
> {
  return {
    text: candidate.displayName,
    type: 'Despesa',
    dateField: 'Data',
    periodPreset: 'custom',
    viewScope: 'operation',
    startDate: window.startDate,
    endDate: window.endDate,
    category: [],
    accountId: [],
    sourceScope: 'all',
    ownerUserId: options.filterByOwner ? candidate.ownerUserId : '',
  };
}
