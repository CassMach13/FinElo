export type DateOnlyValue = string | Date | null | undefined;

const DATE_ONLY_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})/;

const pad2 = (value: number): string => String(value).padStart(2, '0');

const isValidParts = (year: number, month: number, day: number): boolean => {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const probe = new Date(year, month - 1, day, 12, 0, 0, 0);
  return (
    probe.getFullYear() === year &&
    probe.getMonth() === month - 1 &&
    probe.getDate() === day
  );
};

/**
 * Normaliza uma data civil sem converter strings `YYYY-MM-DD` para UTC.
 * Datas vindas do Supabase permanecem no mesmo dia; objetos Date criados a
 * partir de input ISO (meia-noite UTC) preservam seus componentes UTC.
 */
export function toDateOnlyIso(value: DateOnlyValue): string {
  if (!value) return '';

  if (typeof value === 'string') {
    const match = DATE_ONLY_PREFIX_RE.exec(value.trim());
    if (!match) return '';
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return isValidParts(year, month, day) ? `${match[1]}-${match[2]}-${match[3]}` : '';
  }

  if (Number.isNaN(value.getTime())) return '';
  const isExactUtcMidnight =
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0;

  if (isExactUtcMidnight) {
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
  }

  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

/** Date local ao meio-dia, evitando virada de dia por UTC e bordas de DST. */
export function parseDateOnlyLocal(value: DateOnlyValue): Date | null {
  const iso = toDateOnlyIso(value);
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function formatDateOnlyPtBr(value: DateOnlyValue, fallback = '—'): string {
  const iso = toDateOnlyIso(value);
  if (!iso) return fallback;
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

export function localTodayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Soma meses em calendário civil; dias inexistentes caem no último dia do mês. */
export function addMonthsToDateOnly(value: DateOnlyValue, monthsToAdd: number): string {
  const iso = toDateOnlyIso(value);
  if (!iso || !Number.isInteger(monthsToAdd)) return '';
  const [year, month, day] = iso.split('-').map(Number);
  const targetMonthStart = new Date(year, month - 1 + monthsToAdd, 1, 12, 0, 0, 0);
  const targetYear = targetMonthStart.getFullYear();
  const targetMonth = targetMonthStart.getMonth();
  const lastDay = new Date(targetYear, targetMonth + 1, 0, 12, 0, 0, 0).getDate();
  return `${targetYear}-${pad2(targetMonth + 1)}-${pad2(Math.min(day, lastDay))}`;
}
