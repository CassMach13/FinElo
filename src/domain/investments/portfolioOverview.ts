/**
 * Visão da carteira (Investimentos V2-A1): helpers PUROS de resumo e série mensal.
 * Fonte única: linhas de `investments` (reference_month em YYYY-MM-01, date-only). Nada de transactions, assets
 * nem saldo de contas. O saldo registrado é a soma de `balance` das posições do mês; NÃO é rentabilidade.
 */

export interface PortfolioRow {
  id?: string;
  institution: string;
  balance: number | string;
  reference_month: string;
}

export interface MonthPoint {
  /** YYYY-MM-01 */
  key: string;
  year: number;
  /** 1–12 */
  month: number;
  positionCount: number;
  /** null = nenhuma posição registrada no mês (≠ saldo zero verdadeiro). */
  balance: number | null;
}

export interface BalanceDelta {
  /** `no_base` = mês anterior (ou atual) sem registros: nada a comparar. */
  status: 'no_base' | 'ok';
  absolute: number | null;
  /** Só com base anterior positiva; nunca NaN/Infinity. */
  percent: number | null;
}

export interface PortfolioSummary {
  monthKey: string;
  hasPositions: boolean;
  balance: number | null;
  positionCount: number;
  institutionCount: number;
  previousMonthKey: string;
  previousBalance: number | null;
  delta: BalanceDelta;
}

export const VARIATION_DISCLAIMER =
  'Compara os saldos registrados. Pode incluir aportes, resgates e oscilações; não representa rentabilidade.';
export const NO_COMPARABLE_BASE_LABEL = 'Sem base comparável';
export const NO_POSITION_LABEL = 'Sem posição registrada';

const MONTH_LONG = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const KEY_RE = /^(\d{4})-(\d{2})-\d{2}/;

/** Normaliza para YYYY-MM-01 sem passar por Date (sem deslocamento de timezone). Inválido → null. */
export function normalizeMonthKey(raw: string | null | undefined): string | null {
  const m = KEY_RE.exec(String(raw ?? ''));
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

export function monthKeyOf(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

/** Chave do mês de uma data LOCAL (o mês que o usuário vê). */
export function monthKeyFromDate(date: Date): string {
  return monthKeyOf(date.getFullYear(), date.getMonth() + 1);
}

export function parseMonthKey(key: string): { year: number; month: number } {
  const m = KEY_RE.exec(key);
  if (!m) throw new Error(`reference_month inválido: ${key}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

/** Date local no dia 1 do mês da chave (para APIs que recebem Date). */
export function dateFromMonthKey(key: string): Date {
  const { year, month } = parseMonthKey(key);
  return new Date(year, month - 1, 1);
}

/** Soma `delta` meses (aritmética de inteiros: vira o ano corretamente). */
export function shiftMonthKey(key: string, delta: number): string {
  const { year, month } = parseMonthKey(key);
  const index = year * 12 + (month - 1) + delta;
  return monthKeyOf(Math.floor(index / 12), (index % 12) + 1);
}

/** `count` chaves consecutivas terminando em `endKey` (ordem crescente). */
export function monthWindow(endKey: string, count = 12): string[] {
  return Array.from({ length: count }, (_, i) => shiftMonthKey(endKey, i - (count - 1)));
}

export function formatMonthLabel(key: string): string {
  const { year, month } = parseMonthKey(key);
  return `${MONTH_LONG[month - 1]} de ${year}`;
}

export function formatMonthShort(key: string): string {
  const { month } = parseMonthKey(key);
  return MONTH_SHORT[month - 1];
}

const toCents = (value: number | string): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/** Agrupa por mês e soma em centavos (sem deriva de ponto flutuante). Mês sem linhas = balance null. */
export function buildMonthlySeries(rows: readonly PortfolioRow[], endKey: string, count = 12): MonthPoint[] {
  const window = monthWindow(endKey, count);
  const acc = new Map<string, { cents: number; n: number }>();
  for (const row of rows) {
    const key = normalizeMonthKey(row.reference_month);
    if (!key) continue;
    const cur = acc.get(key) ?? { cents: 0, n: 0 };
    cur.cents += toCents(row.balance);
    cur.n += 1;
    acc.set(key, cur);
  }
  return window.map((key) => {
    const { year, month } = parseMonthKey(key);
    const hit = acc.get(key);
    return { key, year, month, positionCount: hit?.n ?? 0, balance: hit ? hit.cents / 100 : null };
  });
}

export function computeBalanceDelta(current: number | null, previous: number | null): BalanceDelta {
  if (previous === null || current === null) return { status: 'no_base', absolute: null, percent: null };
  const absolute = Math.round((current - previous) * 100) / 100;
  const percent = previous > 0 ? (absolute / previous) * 100 : null;
  return { status: 'ok', absolute, percent: percent !== null && Number.isFinite(percent) ? percent : null };
}

/** Resumo do mês selecionado usando SOMENTE as linhas dele; o anterior serve apenas à comparação. */
export function summarizePortfolio(rows: readonly PortfolioRow[], selectedKey: string): PortfolioSummary {
  const previousMonthKey = shiftMonthKey(selectedKey, -1);
  const series = buildMonthlySeries(rows, selectedKey, 2);
  const previous = series[0];
  const current = series[1];
  const institutions = new Set<string>();
  for (const row of rows) {
    if (normalizeMonthKey(row.reference_month) === selectedKey) institutions.add(row.institution.trim().toLowerCase());
  }
  return {
    monthKey: selectedKey,
    hasPositions: current.positionCount > 0,
    balance: current.balance,
    positionCount: current.positionCount,
    institutionCount: institutions.size,
    previousMonthKey,
    previousBalance: previous.balance,
    delta: computeBalanceDelta(current.balance, previous.balance),
  };
}

/** Maior mês com posições até `todayKey` (inclusive); null se nenhum. */
export function pickLatestMonthKey(keys: readonly string[], todayKey: string): string | null {
  let best: string | null = null;
  for (const raw of keys) {
    const key = normalizeMonthKey(raw);
    if (key && key <= todayKey && (best === null || key > best)) best = key;
  }
  return best;
}

export function formatSignedPercent(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  const text = Math.abs(rounded).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${text}%`;
}

export interface YScale {
  min: number;
  max: number;
  ticks: number[];
}

/**
 * Escala Y dinâmica a partir dos valores presentes. Parte de zero quando os valores variam muito; senão aproxima
 * a faixa (os rótulos do eixo deixam a escala explícita). Sempre contém todos os valores.
 */
export function computeYScale(values: readonly number[]): YScale {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { min: 0, max: 1, ticks: [0, 1] };
  const hi = Math.max(...finite);
  const lo = Math.min(...finite);
  let min: number;
  let max: number;
  if (lo >= 0 && (hi === 0 || lo / hi < 0.5)) {
    min = 0;
    max = hi;
  } else if (hi === lo) {
    const pad = Math.abs(hi) * 0.1 || 1;
    min = lo - pad;
    max = hi + pad;
  } else {
    const pad = (hi - lo) * 0.2;
    min = lo - pad;
    max = hi + pad;
  }
  if (max === min) max = min + 1;
  const span = max - min;
  const base = 10 ** Math.floor(Math.log10(span));
  const step = ([1, 2, 2.5, 5, 10].find((s) => s * base * 4 >= span) ?? 10) * base;
  const niceMin = min === 0 ? 0 : Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 1000; v += step) ticks.push(Math.round(v * 100) / 100);
  return { min: niceMin, max: niceMax, ticks };
}

/** Guarda de requisições: só a última requisição iniciada, da mesma sessão, pode gravar o resultado. */
export interface RequestToken {
  id: number;
  scope: string;
}

export function createRequestGuard() {
  let latest = 0;
  return {
    begin(scope: string): RequestToken {
      latest += 1;
      return { id: latest, scope };
    },
    isCurrent(token: RequestToken, liveScope: string): boolean {
      return token.id === latest && token.scope === liveScope;
    },
    /** Invalida tudo o que está em voo (troca de sessão). */
    invalidate(): void {
      latest += 1;
    },
  };
}
