import { localTodayIso } from '../../utils/dateOnly';

/**
 * Objetivos financeiros V1: toda a matemática e as regras de validação ficam aqui.
 *
 * Objetivo é PLANEJAMENTO: `current_amount` é informado à mão e não tem vínculo com
 * transações, contas ou investimentos. Tudo é calculado em CENTAVOS inteiros para não
 * acumular erro de ponto flutuante; nada devolve NaN, Infinity ou -0.
 */

export const GOAL_NAME_MAX_LENGTH = 80;

export interface GoalAmounts {
  target_amount: number;
  current_amount: number;
  target_date?: string | null;
  archived_at?: string | null;
}

export interface GoalProgress {
  remainingAmount: number;
  /** Base do texto. Antes de atingir, arredondado PARA BAIXO em 1 casa (99,96 → 99,9). Pode passar de 100. */
  progressPercent: number;
  /** Largura da barra: sempre entre 0 e 100. */
  progressBarPercent: number;
  isReached: boolean;
  isArchived: boolean;
  /** Prazo em mês anterior ao atual e objetivo ainda não alcançado. */
  isExpired: boolean;
  /** Valor acima do alvo (0 quando não passou). */
  exceededAmount: number;
  hasDeadline: boolean;
  /** AAAA-MM do prazo, ou null. */
  deadlineMonth: string | null;
  /**
   * Meses civis do PRÓXIMO mês até o mês do prazo, inclusive (o mês atual não entra).
   * 0 = prazo neste mês; negativo = prazo vencido; null = sem prazo.
   */
  monthsRemaining: number | null;
  /** Só existe com valor faltando e monthsRemaining > 0. Arredondado PARA CIMA no centavo. */
  monthlyNeeded: number | null;
}

const toCents = (value: number): number => (Number.isFinite(value) ? Math.round(value * 100) : 0);
const fromCents = (cents: number): number => (cents === 0 || !Number.isFinite(cents) ? 0 : cents / 100);

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])/;

/** 'AAAA-MM' de uma data 'AAAA-MM-DD…'; null se inválida. */
export function monthOf(dateIso: string | null | undefined): string | null {
  const m = MONTH_RE.exec(String(dateIso ?? '').trim());
  return m ? `${m[1]}-${m[2]}` : null;
}

const monthIndex = (ym: string): number => {
  const [y, m] = ym.split('-').map(Number);
  return y * 12 + (m - 1);
};

export function computeGoalProgress(goal: GoalAmounts, today: string = localTodayIso()): GoalProgress {
  const targetCents = toCents(goal.target_amount);
  const currentCents = Math.max(0, toCents(goal.current_amount));
  const validTarget = targetCents > 0;

  const isReached = validTarget && currentCents >= targetCents;
  const remainingCents = validTarget ? Math.max(0, targetCents - currentCents) : 0;
  const exceededCents = validTarget ? Math.max(0, currentCents - targetCents) : 0;

  let progressTenths = 0;
  if (validTarget) {
    // BigInt: exato mesmo com 14 dígitos (centavos × 1000 estoura 2^53).
    progressTenths = Number((BigInt(currentCents) * BigInt(1000)) / BigInt(targetCents));
  }
  const progressPercent = progressTenths / 10;
  const progressBarPercent = Math.min(100, progressPercent);

  const deadlineMonth = monthOf(goal.target_date);
  const todayMonth = monthOf(today);
  const monthsRemaining =
    deadlineMonth && todayMonth ? monthIndex(deadlineMonth) - monthIndex(todayMonth) : null;

  const isExpired = !isReached && monthsRemaining !== null && monthsRemaining < 0;

  let monthlyNeeded: number | null = null;
  if (remainingCents > 0 && monthsRemaining !== null && monthsRemaining > 0) {
    monthlyNeeded = fromCents(Math.floor((remainingCents + monthsRemaining - 1) / monthsRemaining));
  }

  return {
    remainingAmount: fromCents(remainingCents),
    progressPercent,
    progressBarPercent,
    isReached,
    isArchived: goal.archived_at != null,
    isExpired,
    exceededAmount: fromCents(exceededCents),
    hasDeadline: deadlineMonth !== null,
    deadlineMonth,
    monthsRemaining,
    monthlyNeeded,
  };
}

// ---------------------------------------------------------------------------
// Prazo (mês + ano na UI, último dia do mês no banco)
// ---------------------------------------------------------------------------

/** '2027-12' → '2027-12-31' (considera ano bissexto); '' / inválido → null. */
export function deadlineFromMonth(ym: string | null | undefined): string | null {
  const month = monthOf(ym);
  if (!month) return null;
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0, 12, 0, 0, 0).getDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

/** '2027-12-31' → 'dez/2027'. */
export function formatDeadlineLabel(dateIso: string | null | undefined): string {
  const month = monthOf(dateIso);
  if (!month) return '';
  const [y, m] = month.split('-').map(Number);
  const names = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${names[m - 1]}/${y}`;
}

// ---------------------------------------------------------------------------
// Valor digitado
// ---------------------------------------------------------------------------

/**
 * Aceita "1234", "1234.56", "1234,56", "1.234,56", "R$ 1.234,56". `null` quando não é número
 * válido. O resultado é normalizado para centavos.
 */
export function parseMoneyInput(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? fromCents(toCents(raw)) : null;
  let s = String(raw ?? '').replace(/R\$/gi, '').replace(/\s/g, '');
  if (!s || !/^-?[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // O último separador é o decimal.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = s.replace(/,/g, (_m, offset) => (offset === lastComma ? '.' : ''));
  } else if (lastDot >= 0) {
    // "1.234" (milhar) vs "12.5" (decimal): 3 dígitos após o único ponto = milhar.
    const parts = s.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length >= 1 && parts[0].length <= 3)) {
      s = parts.join('');
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? fromCents(toCents(n)) : null;
}

// ---------------------------------------------------------------------------
// Validação do formulário
// ---------------------------------------------------------------------------

export interface GoalFormInput {
  name: string;
  target: string | number;
  /** Só na criação. */
  current?: string | number;
  /** 'AAAA-MM' ou ''. */
  month: string;
}

export interface GoalFormErrors {
  name?: string;
  target?: string;
  current?: string;
  month?: string;
}

export interface GoalFormResult {
  errors: GoalFormErrors;
  /** Presente só sem erros. */
  value?: { name: string; target_amount: number; current_amount?: number; target_date: string | null };
}

export function validateGoalForm(
  input: GoalFormInput,
  opts: { mode: 'create' | 'edit'; today?: string; existingTargetDate?: string | null }
): GoalFormResult {
  const today = opts.today ?? localTodayIso();
  const errors: GoalFormErrors = {};

  const name = input.name.trim();
  if (!name) errors.name = 'Dê um nome ao objetivo.';
  else if (name.length > GOAL_NAME_MAX_LENGTH) {
    errors.name = `Use no máximo ${GOAL_NAME_MAX_LENGTH} caracteres.`;
  }

  const target = parseMoneyInput(input.target);
  if (target === null || target <= 0) errors.target = 'Informe um valor desejado maior que zero.';

  let current: number | undefined;
  if (opts.mode === 'create') {
    const raw = input.current;
    if (raw === undefined || String(raw).trim() === '') current = 0;
    else {
      const parsed = parseMoneyInput(raw);
      if (parsed === null || parsed < 0) errors.current = 'Informe um valor igual ou maior que zero.';
      else current = parsed;
    }
  }

  let targetDate: string | null = null;
  const monthRaw = input.month.trim();
  if (monthRaw) {
    const deadline = deadlineFromMonth(monthRaw);
    if (!deadline) errors.month = 'Escolha um mês e ano válidos.';
    else {
      targetDate = deadline;
      // Só bloqueia mês passado quando o prazo é novo: um prazo vencido já gravado continua editável.
      const unchanged = opts.mode === 'edit' && monthOf(opts.existingTargetDate) === monthOf(deadline);
      const todayMonth = monthOf(today);
      if (!unchanged && todayMonth && monthIndex(monthOf(deadline)!) < monthIndex(todayMonth)) {
        errors.month = 'Escolha o mês atual ou um mês futuro.';
      }
    }
  }

  if (Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    value: {
      name,
      target_amount: target as number,
      ...(opts.mode === 'create' ? { current_amount: current as number } : {}),
      target_date: targetDate,
    },
  };
}

// ---------------------------------------------------------------------------
// Ordenação e separação
// ---------------------------------------------------------------------------

export interface SortableGoal extends GoalAmounts {
  id: string;
  name: string;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byName = (a: SortableGoal, b: SortableGoal) =>
  a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }) || cmp(a.id, b.id);

/**
 * Lista principal: ativos primeiro (prazo mais próximo → sem prazo; depois nome e id), alcançados
 * depois. Arquivados à parte, do arquivamento mais recente para o mais antigo.
 */
export function splitAndSortGoals<T extends SortableGoal & { updated_at?: string }>(goals: T[]): {
  main: T[];
  archived: T[];
} {
  const archived = goals
    .filter((g) => g.archived_at != null)
    .sort(
      (a, b) =>
        cmp(String(b.archived_at ?? ''), String(a.archived_at ?? '')) || byName(a, b)
    );

  const deadlineKey = (g: T) => monthOf(g.target_date) ?? '9999-99';
  const main = goals
    .filter((g) => g.archived_at == null)
    .sort((a, b) => {
      const ra = computeGoalProgress(a).isReached ? 1 : 0;
      const rb = computeGoalProgress(b).isReached ? 1 : 0;
      return ra - rb || cmp(deadlineKey(a), deadlineKey(b)) || byName(a, b);
    });

  return { main, archived };
}
