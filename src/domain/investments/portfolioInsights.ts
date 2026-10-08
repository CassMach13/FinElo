/**
 * Investimentos V2-A2: alocação, concentração, vencimentos e leitura determinística.
 * Domínio PURO (sem React/Supabase/IA): recebe SOMENTE as posições já validadas do mês selecionado. Valores
 * monetários agregados em centavos inteiros. "Saldo registrado" nunca é rentabilidade nem valor futuro de resgate.
 */
import { formatCurrency } from '../../utils/formatters';
import { formatMonthLabel } from './portfolioOverview';

export interface InsightPosition {
  id?: string;
  institution?: string | null;
  product_type?: string | null;
  product_name?: string | null;
  balance: number | string;
  maturity_date?: string | null;
  reference_month?: string | null;
}

export const NOT_INFORMED_LABEL = 'Não informado';
export const MATURITY_WINDOW_DAYS = 90;

const toCents = (value: number | string): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

/**
 * Garantia de escopo: só as posições do mês selecionado. Posição sem `reference_month` (já filtrada por quem chama)
 * é mantida; posição de OUTRO mês nunca entra em alocação, concentração, vencimentos ou leitura.
 */
export function selectMonthPositions<T extends InsightPosition>(positions: readonly T[], monthKey: string): T[] {
  return positions.filter((p) => !p.reference_month || p.reference_month.slice(0, 10) === monthKey);
}

/** Mesma equivalência da V2-A1 (contador de instituições): apara as pontas e ignora maiúsculas/minúsculas. */
export const groupKeyOf = (raw: string | null | undefined): string => (raw ?? '').trim().toLowerCase();

// ---------------------------------------------------------------------------------------------------------------
// Alocação
// ---------------------------------------------------------------------------------------------------------------

export interface AllocationGroup {
  key: string;
  label: string;
  cents: number;
  balance: number;
  positionCount: number;
  /** null quando a distribuição percentual não é confiável. */
  percent: number | null;
}

export type AllocationIssue = 'zero_total' | 'negative_or_invalid';

export interface Allocation {
  totalCents: number;
  totalBalance: number;
  positionCount: number;
  groups: AllocationGroup[];
  /** true somente com total positivo e sem saldo negativo/inválido. */
  reliable: boolean;
  issue: AllocationIssue | null;
}

function buildAllocation(positions: readonly InsightPosition[], field: 'institution' | 'product_type'): Allocation {
  const acc = new Map<string, { cents: number; n: number; labels: Set<string> }>();
  let totalCents = 0;
  let hasNegativeOrInvalid = false;
  for (const p of positions) {
    const cents = toCents(p.balance);
    if (cents === null || cents < 0) hasNegativeOrInvalid = true;
    const safe = cents ?? 0;
    totalCents += safe;
    const raw = (p[field] ?? '').trim();
    const key = groupKeyOf(raw);
    const cur = acc.get(key) ?? { cents: 0, n: 0, labels: new Set<string>() };
    cur.cents += safe;
    cur.n += 1;
    if (raw) cur.labels.add(raw);
    acc.set(key, cur);
  }
  const reliable = totalCents > 0 && !hasNegativeOrInvalid;
  const issue: AllocationIssue | null = reliable ? null : hasNegativeOrInvalid ? 'negative_or_invalid' : 'zero_total';
  const groups: AllocationGroup[] = [...acc.entries()].map(([key, g]) => ({
    key,
    // rótulo legível determinístico: a menor grafia original (independe da ordem de entrada)
    label: key === '' ? NOT_INFORMED_LABEL : [...g.labels].sort()[0],
    cents: g.cents,
    balance: g.cents / 100,
    positionCount: g.n,
    percent: reliable ? (g.cents / totalCents) * 100 : null,
  }));
  groups.sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label, 'pt-BR') || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { totalCents, totalBalance: totalCents / 100, positionCount: positions.length, groups, reliable, issue };
}

export const buildInstitutionAllocation = (positions: readonly InsightPosition[]): Allocation => buildAllocation(positions, 'institution');
export const buildTypeAllocation = (positions: readonly InsightPosition[]): Allocation => buildAllocation(positions, 'product_type');

/** Percentual para exibição ("62,4%"); nunca "-0%", NaN ou Infinity. */
export function formatAllocationPercent(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return '—';
  const rounded = Math.max(0, Math.round(percent * 10) / 10);
  return `${rounded.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export interface TopGroup {
  label: string;
  percent: number;
  balance: number;
}

/** Maior participação; null se o denominador não é confiável (nada de concentração fabricada) ou não há grupos. */
export function topGroup(allocation: Allocation): TopGroup | null {
  if (!allocation.reliable || allocation.groups.length === 0) return null;
  const top = allocation.groups[0];
  return top.percent === null ? null : { label: top.label, percent: top.percent, balance: top.balance };
}

// ---------------------------------------------------------------------------------------------------------------
// Vencimentos (date-only)
// ---------------------------------------------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_DAY = 86_400_000;

/** YYYY-MM-DD estrito e existente → nº de dias desde 1970-01-01 (UTC, sem fuso). Qualquer outra coisa → null. */
export function parseDateOnlyDay(value: string | null | undefined): number | null {
  const m = DATE_RE.exec(String(value ?? ''));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const date = new Date(ms);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return Math.round(ms / MS_DAY);
}

export function dayToDateString(day: number): string {
  const d = new Date(day * MS_DAY);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Data LOCAL de hoje como YYYY-MM-DD. */
export function localDateString(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatDateBR(value: string): string {
  const m = DATE_RE.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

export type MaturityTemporal = 'current' | 'historical' | 'future';
export type MaturityState = 'no_positions' | 'no_dates' | 'none_in_window' | 'has_items';

export interface MaturityItem {
  id: string;
  name: string;
  institution: string;
  maturityDate: string;
  daysUntil: number;
  /** Saldo REGISTRADO (não é valor de resgate). */
  balance: number;
}

export interface MaturityAgenda {
  temporal: MaturityTemporal;
  /** Marco da janela (YYYY-MM-DD): hoje no mês corrente; dia 1 do mês de referência nos demais. */
  referenceDate: string;
  windowEnd: string;
  state: MaturityState;
  items: MaturityItem[];
  itemCount: number;
  totalBalance: number;
  coverage: { total: number; valid: number; missing: number; invalid: number };
}

/**
 * Agenda de vencimentos do mês selecionado. `today` (YYYY-MM-DD local) é injetável. Mês corrente: janela a partir de
 * hoje. Mês histórico ou futuro: a partir do dia 1 do mês de referência (marco convencional do registro).
 */
export function buildMaturityAgenda(positions: readonly InsightPosition[], selectedMonthKey: string, today: string): MaturityAgenda {
  const todayMonthKey = `${today.slice(0, 7)}-01`;
  const temporal: MaturityTemporal = selectedMonthKey === todayMonthKey ? 'current' : selectedMonthKey < todayMonthKey ? 'historical' : 'future';
  const referenceDate = temporal === 'current' ? today : selectedMonthKey;
  const refDay = parseDateOnlyDay(referenceDate) ?? 0;
  const endDay = refDay + MATURITY_WINDOW_DAYS;

  const coverage = { total: positions.length, valid: 0, missing: 0, invalid: 0 };
  const items: MaturityItem[] = [];
  positions.forEach((p, index) => {
    const raw = typeof p.maturity_date === 'string' ? p.maturity_date.trim() : '';
    if (!raw) {
      coverage.missing += 1;
      return;
    }
    const day = parseDateOnlyDay(raw);
    if (day === null) {
      coverage.invalid += 1;
      return;
    }
    coverage.valid += 1;
    if (day < refDay || day > endDay) return;
    items.push({
      id: p.id ?? `pos-${index}`,
      name: (p.product_name ?? '').trim() || (p.product_type ?? '').trim() || NOT_INFORMED_LABEL,
      institution: (p.institution ?? '').trim() || NOT_INFORMED_LABEL,
      maturityDate: raw,
      daysUntil: day - refDay,
      balance: (toCents(p.balance) ?? 0) / 100,
    });
  });
  items.sort((a, b) => a.daysUntil - b.daysUntil || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const totalCents = items.reduce((sum, i) => sum + Math.round(i.balance * 100), 0);
  const state: MaturityState =
    positions.length === 0 ? 'no_positions' : coverage.valid === 0 ? 'no_dates' : items.length === 0 ? 'none_in_window' : 'has_items';
  return {
    temporal,
    referenceDate,
    windowEnd: dayToDateString(endDay),
    state,
    items,
    itemCount: items.length,
    totalBalance: totalCents / 100,
    coverage,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Leitura do FinElo (determinística, sem IA)
// ---------------------------------------------------------------------------------------------------------------

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Até três observações factuais calculadas dos dados. Sem conselho de investimento, sem avaliação de risco,
 * sem rentabilidade. Afirmações de concentração só com denominador confiável; de vencimento só com datas válidas.
 */
export function buildPortfolioNarrative(input: {
  monthKey: string;
  positions: readonly InsightPosition[];
  institutions: Allocation;
  types: Allocation;
  maturities: MaturityAgenda;
}): string[] {
  const { monthKey, positions, institutions, types, maturities } = input;
  const month = formatMonthLabel(monthKey);
  if (positions.length === 0) return [`Não há posições registradas em ${month}.`];

  const lines: string[] = [];
  lines.push(
    `Em ${month}, sua carteira registrada totaliza ${formatCurrency(institutions.totalBalance)}, em ${plural(positions.length, 'posição', 'posições')} e ${plural(institutions.groups.length, 'instituição', 'instituições')}.`
  );

  const topInst = topGroup(institutions);
  const topType = topGroup(types);
  if (topInst || topType) {
    const parts: string[] = [];
    if (topInst) {
      parts.push(
        institutions.groups.length === 1
          ? `Todo o saldo registrado está em ${topInst.label}.`
          : `A maior participação por instituição está em ${topInst.label}, com ${formatAllocationPercent(topInst.percent)} do saldo registrado.`
      );
    }
    if (topType) {
      parts.push(
        types.groups.length === 1
          ? `Todo o saldo registrado está no tipo ${topType.label}.`
          : `Por tipo, ${topType.label} representa ${formatAllocationPercent(topType.percent)}.`
      );
    }
    lines.push(parts.join(' '));
  }

  const when = maturities.temporal === 'current' ? 'a partir de hoje' : `a partir de ${formatDateBR(maturities.referenceDate)} (marco da posição de ${month})`;
  if (maturities.state === 'has_items') {
    lines.push(
      `Há ${plural(maturities.itemCount, 'posição com vencimento informado', 'posições com vencimento informado')} na janela de ${MATURITY_WINDOW_DAYS} dias ${when}, correspondentes a ${formatCurrency(maturities.totalBalance)} em saldos registrados.`
    );
  } else if (maturities.state === 'none_in_window') {
    lines.push(
      `Nenhum vencimento informado na janela de ${MATURITY_WINDOW_DAYS} dias ${when}; datas válidas em ${maturities.coverage.valid} de ${maturities.coverage.total} posições.`
    );
  }
  return lines.slice(0, 3);
}
