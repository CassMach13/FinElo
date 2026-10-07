import type { Budget, BudgetMonth, Category, EconomicEventKind, Transaction } from '../../types';
import { classifyTransaction, isBudgetSpendEconomicTransaction } from '../economics/transactionSemantics';
import { getTransactionEffectiveDate } from '../../utils/dashboardMetrics';
import type { DateRange } from '../../utils/dashboardPeriod';

/**
 * Budget V2: orçamento mensal PESSOAL.
 *
 * - Limite efetivo de (dono, categoria, ano, mês): 1) `budget_months` do dono; 2) `budgets` anual do
 *   MESMO dono e ano; 3) nenhum. Nunca usa o orçamento de outro dono.
 * - Uma linha do Dashboard = dono + categoria. O gasto da linha é só o do dono (Despesa da categoria,
 *   data efetiva `Data_Pagamento || Data`, sem demo), e só nos meses em que há limite efetivo.
 * - Período maior que um mês: soma os limites efetivos de cada mês civil interceptado. Um mês
 *   interceptado só em parte conta o limite INTEIRO (sem prorrata por dia).
 * - Tudo em centavos inteiros; nada devolve NaN, Infinity ou -0.
 */

export type BudgetSource = 'monthly' | 'annual';

export interface EffectiveLimit {
  amount: number;
  source: BudgetSource;
  monthlyBudgetId?: string;
  legacyBudgetId?: string;
}

export interface CivilMonth {
  year: number;
  /** 1–12 */
  month: number;
}

const toCents = (v: number): number => (Number.isFinite(v) ? Math.round(v * 100) : 0);
const fromCents = (c: number): number => (c === 0 || !Number.isFinite(c) ? 0 : c / 100);

const keyOf = (owner: string, categoria: string, year: number, month?: number) =>
  month === undefined ? `${owner}\u0001${categoria}\u0001${year}` : `${owner}\u0001${categoria}\u0001${year}\u0001${month}`;

export interface BudgetIndex {
  monthly: Map<string, BudgetMonth>;
  annual: Map<string, Budget>;
}

/**
 * Indexa os orçamentos. Registro legado sem `user_id` (fixture antiga) cai no `currentUserId`; um
 * registro real de outro membro sempre traz o próprio `user_id`.
 */
export function buildBudgetIndex(
  budgets: Budget[],
  budgetMonths: BudgetMonth[],
  currentUserId?: string | null
): BudgetIndex {
  const monthly = new Map<string, BudgetMonth>();
  for (const m of budgetMonths) monthly.set(keyOf(m.user_id, m.Categoria, m.year, m.month), m);
  const annual = new Map<string, Budget>();
  for (const b of budgets) {
    const owner = b.user_id ?? currentUserId ?? '';
    annual.set(keyOf(owner, b.Categoria, b.ano), b);
  }
  return { monthly, annual };
}

export function resolveEffectiveLimit(
  index: BudgetIndex,
  ownerId: string,
  categoria: string,
  year: number,
  month: number
): EffectiveLimit | null {
  const m = index.monthly.get(keyOf(ownerId, categoria, year, month));
  if (m) return { amount: fromCents(toCents(m.amount)), source: 'monthly', monthlyBudgetId: m.id };
  const a = index.annual.get(keyOf(ownerId, categoria, year));
  if (a) return { amount: fromCents(toCents(a.Valor_Limite_Mensal)), source: 'annual', legacyBudgetId: a.id };
  return null;
}

/** Meses civis interceptados pelo período (inclusive o mês parcial das pontas). */
export function monthsInRange(range: DateRange): CivilMonth[] {
  const out: CivilMonth[] = [];
  if (Number.isNaN(range.start.getTime()) || Number.isNaN(range.end.getTime())) return out;
  let y = range.start.getFullYear();
  let m = range.start.getMonth() + 1;
  const endY = range.end.getFullYear();
  const endM = range.end.getMonth() + 1;
  while (y < endY || (y === endY && m <= endM)) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 600) break; // defesa contra intervalos absurdos
  }
  return out;
}

export interface BudgetLine {
  /** `${owner}|${Categoria}` */
  key: string;
  ownerUserId: string;
  Categoria: string;
  /** Soma dos limites efetivos dos meses do período. */
  limit: number;
  spent: number;
  /** Fração decorrida do período (indicador de ritmo; não decide o limite). */
  pacingRatio: number;
  /** Origem dos limites usados: mensal, anual ou mistura. */
  sources: BudgetSource[];
  /** `limit - spent` (negativo = acima do orçamento), em centavos exatos. */
  remaining: number;
  exceeded: boolean;
}

export interface BudgetTotals {
  spent: number;
  limit: number;
  pacingRatio: number;
  remaining: number;
  exceeded: boolean;
}

export function computePacingRatio(range: DateRange, referenceDate: Date): number {
  if (referenceDate >= range.start && referenceDate <= range.end) {
    const total = range.end.getTime() - range.start.getTime();
    const elapsed = referenceDate.getTime() - range.start.getTime();
    return total > 0 ? Math.max(0, Math.min(1, elapsed / total)) : 1;
  }
  return referenceDate < range.start ? 0 : 1;
}

/** "Restam" ou "acima", sempre positivo e sem -0. */
export function describeRemaining(spent: number, limit: number): { kind: 'remaining' | 'over'; amount: number } {
  const diff = toCents(limit) - toCents(spent);
  return diff >= 0 ? { kind: 'remaining', amount: fromCents(diff) } : { kind: 'over', amount: fromCents(-diff) };
}

export function computeBudgetLines(input: {
  budgets: Budget[];
  budgetMonths: BudgetMonth[];
  transactions: Transaction[];
  range: DateRange;
  currentUserId?: string | null;
  /** Resolve o dono de cada lançamento (mesma regra do contexto familiar). */
  getTransactionOwnerId: (tx: Transaction) => string | undefined;
  referenceDate?: Date;
  /** Eventos carregados (id → kind): despesa neutra não consome orçamento. */
  economicKindByEventId?: ReadonlyMap<string, EconomicEventKind>;
}): BudgetLine[] {
  const { budgets, budgetMonths, transactions, range, currentUserId, getTransactionOwnerId } = input;
  const referenceDate = input.referenceDate ?? new Date();
  const months = monthsInRange(range);
  if (months.length === 0) return [];
  const index = buildBudgetIndex(budgets, budgetMonths, currentUserId);
  const monthSet = new Set(months.map((m) => `${m.year}-${m.month}`));
  const years = new Set(months.map((m) => m.year));

  // Linhas candidatas: (dono, categoria) com algum orçamento nos anos/meses do período.
  const candidates = new Map<string, { owner: string; Categoria: string }>();
  for (const m of budgetMonths) {
    if (monthSet.has(`${m.year}-${m.month}`)) candidates.set(`${m.user_id}|${m.Categoria}`, { owner: m.user_id, Categoria: m.Categoria });
  }
  for (const b of budgets) {
    if (!years.has(b.ano)) continue;
    const owner = b.user_id ?? currentUserId ?? '';
    candidates.set(`${owner}|${b.Categoria}`, { owner, Categoria: b.Categoria });
  }

  // Limite por mês de cada linha.
  const limitCents = new Map<string, number>();
  const sources = new Map<string, Set<BudgetSource>>();
  const activeMonths = new Map<string, Set<string>>();
  for (const [key, { owner, Categoria }] of candidates) {
    for (const { year, month } of months) {
      const eff = resolveEffectiveLimit(index, owner, Categoria, year, month);
      if (!eff) continue;
      limitCents.set(key, (limitCents.get(key) ?? 0) + toCents(eff.amount));
      (sources.get(key) ?? sources.set(key, new Set()).get(key)!).add(eff.source);
      (activeMonths.get(key) ?? activeMonths.set(key, new Set()).get(key)!).add(`${year}-${month}`);
    }
  }

  // Gasto: uma passada pelas transações do período, atribuída ao dono e só em meses com limite.
  const startMs = range.start.getTime();
  const endMs = range.end.getTime();
  const spentCents = new Map<string, number>();
  for (const t of transactions) {
    if (!isBudgetSpendEconomicTransaction(classifyTransaction(t, { economicKindByEventId: input.economicKindByEventId }))) continue;
    const date = getTransactionEffectiveDate(t);
    const ms = date.getTime();
    if (Number.isNaN(ms) || ms < startMs || ms > endMs) continue;
    const owner = getTransactionOwnerId(t) ?? currentUserId ?? '';
    const key = `${owner}|${t.Categoria}`;
    const active = activeMonths.get(key);
    if (!active || !active.has(`${date.getFullYear()}-${date.getMonth() + 1}`)) continue;
    spentCents.set(key, (spentCents.get(key) ?? 0) + Math.abs(toCents(t.Valor)));
  }

  const pacingRatio = computePacingRatio(range, referenceDate);
  const lines: BudgetLine[] = [];
  for (const [key, { owner, Categoria }] of candidates) {
    if (!limitCents.has(key)) continue;
    const limit = limitCents.get(key) ?? 0;
    const spent = spentCents.get(key) ?? 0;
    lines.push({
      key,
      ownerUserId: owner,
      Categoria,
      limit: fromCents(limit),
      spent: fromCents(spent),
      pacingRatio,
      sources: [...(sources.get(key) ?? [])].sort(),
      remaining: fromCents(limit - spent),
      exceeded: spent > limit,
    });
  }

  const ratio = (l: BudgetLine) => (l.limit > 0 ? l.spent / l.limit : 0);
  return lines.sort(
    (a, b) =>
      ratio(b) - ratio(a) ||
      (a.Categoria < b.Categoria ? -1 : a.Categoria > b.Categoria ? 1 : 0) ||
      (a.ownerUserId < b.ownerUserId ? -1 : a.ownerUserId > b.ownerUserId ? 1 : 0)
  );
}

/** Total das categorias COM orçamento: soma dos limites e dos gastos de cada linha (sem dupla contagem). */
export function computeBudgetLineTotals(lines: BudgetLine[]): BudgetTotals {
  const limit = lines.reduce((acc, l) => acc + toCents(l.limit), 0);
  const spent = lines.reduce((acc, l) => acc + toCents(l.spent), 0);
  return {
    limit: fromCents(limit),
    spent: fromCents(spent),
    pacingRatio: lines.length > 0 ? lines[0].pacingRatio : 1,
    remaining: fromCents(limit - spent),
    exceeded: spent > limit,
  };
}

// ---------------------------------------------------------------------------
// Elegibilidade e Gerenciador
// ---------------------------------------------------------------------------

/** Nova criação mensal: só categoria de Despesa que não seja investimento (exclui Renda e Ambos). */
export const isEligibleBudgetCategory = (c: Pick<Category, 'Tipo' | 'is_investment'>): boolean =>
  c.Tipo === 'Despesa' && c.is_investment !== true;

export function previousMonth({ year, month }: CivilMonth): CivilMonth {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function nextMonth({ year, month }: CivilMonth): CivilMonth {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

const monthIndex = (m: CivilMonth) => m.year * 12 + (m.month - 1);

/** A UX da V2 vai até o próximo mês; o banco aceita qualquer mês. */
export function canNavigateToMonth(target: CivilMonth, current: CivilMonth): boolean {
  return monthIndex(target) <= monthIndex(nextMonth(current));
}

/** Mês em que o Gerenciador abre: passado e atual ficam; depois do próximo mês, volta ao próximo mês. */
export function clampManagerMonth(target: CivilMonth, current: CivilMonth): CivilMonth {
  return canNavigateToMonth(target, current) ? target : nextMonth(current);
}

export interface ManagerRow {
  Categoria: string;
  /** Pode criar valor mensal novo para esta categoria (elegível). */
  eligible: boolean;
  /** Valor efetivo hoje (mensal, anual ou nenhum). */
  effective: EffectiveLimit | null;
  monthly: BudgetMonth | null;
}

export function buildManagerRows(input: {
  ownerId: string;
  period: CivilMonth;
  categories: Category[];
  budgets: Budget[];
  budgetMonths: BudgetMonth[];
  currentUserId?: string | null;
}): ManagerRow[] {
  const { ownerId, period, categories, budgets, budgetMonths, currentUserId } = input;
  const index = buildBudgetIndex(budgets, budgetMonths, currentUserId);
  const rows = new Map<string, ManagerRow>();
  const row = (Categoria: string, eligible: boolean) => {
    const effective = resolveEffectiveLimit(index, ownerId, Categoria, period.year, period.month);
    const monthly = index.monthly.get(keyOf(ownerId, Categoria, period.year, period.month)) ?? null;
    return { Categoria, eligible, effective, monthly } as ManagerRow;
  };
  for (const c of categories) {
    if (isEligibleBudgetCategory(c)) rows.set(c.Nome_Categoria, row(c.Nome_Categoria, true));
  }
  // Legado/existente em categoria hoje inelegível: continua visível (não é apagado nem escondido).
  for (const m of budgetMonths) {
    if (m.user_id === ownerId && m.year === period.year && m.month === period.month && !rows.has(m.Categoria)) {
      rows.set(m.Categoria, row(m.Categoria, false));
    }
  }
  for (const b of budgets) {
    const owner = b.user_id ?? currentUserId ?? '';
    if (owner === ownerId && b.ano === period.year && !rows.has(b.Categoria)) rows.set(b.Categoria, row(b.Categoria, false));
  }
  return [...rows.values()].sort((a, b) => a.Categoria.localeCompare(b.Categoria, 'pt-BR', { sensitivity: 'base' }));
}

export interface CopyPlan {
  source: CivilMonth;
  target: CivilMonth;
  /** Linhas mensais a criar (sempre INSERT; nunca sobrescreve). */
  toCreate: Array<{ Categoria: string; amount: number }>;
  /** Já tinham linha mensal no destino. */
  skippedExisting: number;
  totalAmount: number;
}

/**
 * Copiar o mês anterior: os limites EFETIVOS da origem (mensal ou anual) viram linhas mensais do destino
 * só onde o destino NÃO tem linha mensal. Fallback anual no destino não conta como linha mensal.
 * Categorias sem valor na origem ou inelegíveis não são copiadas.
 */
export function planCopyFromPreviousMonth(input: {
  ownerId: string;
  target: CivilMonth;
  categories: Category[];
  budgets: Budget[];
  budgetMonths: BudgetMonth[];
  currentUserId?: string | null;
}): CopyPlan {
  const { ownerId, target, categories, budgets, budgetMonths, currentUserId } = input;
  const source = previousMonth(target);
  const index = buildBudgetIndex(budgets, budgetMonths, currentUserId);
  const toCreate: Array<{ Categoria: string; amount: number }> = [];
  let skippedExisting = 0;
  for (const c of categories) {
    if (!isEligibleBudgetCategory(c)) continue;
    const eff = resolveEffectiveLimit(index, ownerId, c.Nome_Categoria, source.year, source.month);
    if (!eff || !(eff.amount > 0)) continue;
    if (index.monthly.has(keyOf(ownerId, c.Nome_Categoria, target.year, target.month))) {
      skippedExisting += 1;
      continue;
    }
    toCreate.push({ Categoria: c.Nome_Categoria, amount: eff.amount });
  }
  toCreate.sort((a, b) => a.Categoria.localeCompare(b.Categoria, 'pt-BR', { sensitivity: 'base' }));
  return {
    source,
    target,
    toCreate,
    skippedExisting,
    totalAmount: fromCents(toCreate.reduce((s, r) => s + toCents(r.amount), 0)),
  };
}

export interface FamilyEditRights {
  canView: true;
  canCreate: boolean;
  canCopy: boolean;
  canEditExisting: boolean;
  canDeleteExisting: boolean;
}

/** Só o responsável cria/copia; um membro com acesso familiar edita valor e exclui linhas já existentes. */
export function editRightsFor(ownerId: string, currentUserId: string | null | undefined): FamilyEditRights {
  const own = !!currentUserId && ownerId === currentUserId;
  return { canView: true, canCreate: own, canCopy: own, canEditExisting: true, canDeleteExisting: true };
}

// ---------------------------------------------------------------------------
// Salvar em lote no Gerenciador
// ---------------------------------------------------------------------------

export interface SavePlan {
  creates: Array<{ Categoria: string; year: number; month: number; amount: number }>;
  updates: Array<{ id: string; amount: number }>;
  /** Mensagens por categoria quando o valor digitado é inválido. */
  errors: Record<string, string>;
}

/**
 * Compara o que foi digitado com o estado atual. Sem upsert: valor novo = INSERT (só para o próprio dono
 * e categoria elegível), valor alterado em linha mensal existente = UPDATE de `amount`, igual = nada.
 * Campo vazio numa linha mensal NÃO apaga (remover é uma ação explícita). Nunca grava 0.
 */
export function planManagerSave(input: {
  rows: ManagerRow[];
  /** Texto digitado por categoria; ausente = não mexeu. */
  drafts: Record<string, string>;
  period: CivilMonth;
  rights: FamilyEditRights;
  parse: (raw: string) => number | null;
}): SavePlan {
  const { rows, drafts, period, rights, parse } = input;
  const plan: SavePlan = { creates: [], updates: [], errors: {} };
  for (const row of rows) {
    const raw = drafts[row.Categoria];
    if (raw === undefined) continue;
    const text = raw.trim();
    if (text === '') continue;
    const value = parse(text);
    if (value === null || !(value > 0)) {
      plan.errors[row.Categoria] = 'Informe um valor maior que zero.';
      continue;
    }
    if (row.monthly) {
      if (rights.canEditExisting && toCents(value) !== toCents(row.monthly.amount)) {
        plan.updates.push({ id: row.monthly.id, amount: fromCents(toCents(value)) });
      }
    } else if (rights.canCreate && row.eligible) {
      plan.creates.push({ Categoria: row.Categoria, year: period.year, month: period.month, amount: fromCents(toCents(value)) });
    }
  }
  return plan;
}
