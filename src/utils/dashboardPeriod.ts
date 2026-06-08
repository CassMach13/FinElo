export type DashboardViewMode = 'monthly' | 'quarterly' | 'semiannual' | 'yearly' | 'custom';

export type ComparePreset = 'previous' | 'year_over_year' | 'custom';

export interface DateRange {
  start: Date;
  end: Date;
}

export interface DashboardPeriodInput {
  viewMode: DashboardViewMode;
  selectedDate: Date;
  customDateRange?: { start: string; end: string };
}

/** Evita deslocamento de dia ao parsear `YYYY-MM-DD` como UTC. */
export function parseLocalIsoDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function getDashboardDateRange(input: DashboardPeriodInput): DateRange {
  const { viewMode, selectedDate, customDateRange } = input;

  if (viewMode === 'custom' && customDateRange) {
    const start = parseLocalIsoDate(customDateRange.start);
    start.setHours(0, 0, 0, 0);
    const end = parseLocalIsoDate(customDateRange.end);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  const start = new Date(selectedDate);
  const end = new Date(selectedDate);
  start.setDate(1);
  end.setDate(1);

  if (viewMode === 'monthly') {
    end.setMonth(start.getMonth() + 1);
    end.setDate(0);
  } else if (viewMode === 'quarterly') {
    const quarter = Math.floor(start.getMonth() / 3);
    start.setMonth(quarter * 3);
    end.setMonth(start.getMonth() + 3);
    end.setDate(0);
  } else if (viewMode === 'semiannual') {
    const semester = Math.floor(start.getMonth() / 6);
    start.setMonth(semester * 6);
    end.setMonth(start.getMonth() + 6);
    end.setDate(0);
  } else if (viewMode === 'yearly') {
    start.setMonth(0);
    end.setMonth(11);
    end.setDate(31);
  }

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

export function shiftAnchorBack(date: Date, viewMode: DashboardViewMode): Date {
  const next = new Date(date);
  if (viewMode === 'monthly') next.setMonth(next.getMonth() - 1);
  else if (viewMode === 'quarterly') next.setMonth(next.getMonth() - 3);
  else if (viewMode === 'semiannual') next.setMonth(next.getMonth() - 6);
  else if (viewMode === 'yearly') next.setFullYear(next.getFullYear() - 1);
  return next;
}

export function shiftAnchorForward(date: Date, viewMode: DashboardViewMode): Date {
  const next = new Date(date);
  if (viewMode === 'monthly') next.setMonth(next.getMonth() + 1);
  else if (viewMode === 'quarterly') next.setMonth(next.getMonth() + 3);
  else if (viewMode === 'semiannual') next.setMonth(next.getMonth() + 6);
  else if (viewMode === 'yearly') next.setFullYear(next.getFullYear() + 1);
  return next;
}

function previousCustomRange(primary: DateRange): DateRange {
  const durationMs = primary.end.getTime() - primary.start.getTime();
  const end = new Date(primary.start.getTime() - 1);
  end.setHours(23, 59, 59, 999);
  const start = new Date(end.getTime() - durationMs);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function yearOverYearRange(primary: DateRange): DateRange {
  const start = new Date(primary.start);
  const end = new Date(primary.end);
  start.setFullYear(start.getFullYear() - 1);
  end.setFullYear(end.getFullYear() - 1);
  return { start, end };
}

export function getCompareDateRange(
  primaryRange: DateRange,
  viewMode: DashboardViewMode,
  preset: ComparePreset,
  compareAnchor: Date,
  compareCustomRange?: { start: string; end: string }
): DateRange {
  if (preset === 'year_over_year') {
    return yearOverYearRange(primaryRange);
  }

  if (preset === 'previous') {
    if (viewMode === 'custom') return previousCustomRange(primaryRange);
    return getDashboardDateRange({
      viewMode,
      selectedDate: compareAnchor,
    });
  }

  return getDashboardDateRange({
    viewMode,
    selectedDate: compareAnchor,
    customDateRange: viewMode === 'custom' ? compareCustomRange : undefined,
  });
}

function isFullCalendarYear(range: DateRange): boolean {
  return (
    range.start.getMonth() === 0 &&
    range.start.getDate() === 1 &&
    range.end.getMonth() === 11 &&
    range.end.getDate() === 31 &&
    range.start.getFullYear() === range.end.getFullYear()
  );
}

function isFullCalendarMonth(range: DateRange): boolean {
  const lastDay = new Date(
    range.start.getFullYear(),
    range.start.getMonth() + 1,
    0
  ).getDate();
  return (
    range.start.getDate() === 1 &&
    range.end.getDate() === lastDay &&
    range.start.getMonth() === range.end.getMonth() &&
    range.start.getFullYear() === range.end.getFullYear()
  );
}

/** Rótulo explícito a partir das datas — ideal para períodos personalizados e comparações. */
export function formatCustomRangeLabel(range: DateRange): string {
  if (isFullCalendarYear(range)) {
    return String(range.start.getFullYear());
  }

  if (isFullCalendarMonth(range)) {
    return range.start.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }

  const sameYear = range.start.getFullYear() === range.end.getFullYear();
  if (sameYear) {
    const startPart = range.start.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
    });
    const endPart = range.end.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    return `${startPart} – ${endPart}`;
  }

  const startPart = range.start.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const endPart = range.end.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  return `${startPart} – ${endPart}`;
}

/** Rótulo legível do intervalo; usa viewMode como dica quando o range coincide com a granularidade. */
export function formatPeriodRangeLabel(
  range: DateRange,
  viewMode?: DashboardViewMode
): string {
  if (viewMode === 'yearly' && isFullCalendarYear(range)) {
    return String(range.start.getFullYear());
  }

  if (viewMode === 'monthly' && isFullCalendarMonth(range)) {
    return range.start.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }

  if (viewMode === 'quarterly' || viewMode === 'semiannual') {
    const startStr = range.start.toLocaleDateString('pt-BR', {
      month: 'short',
      year: 'numeric',
    });
    const endStr = range.end.toLocaleDateString('pt-BR', {
      month: 'short',
      year: 'numeric',
    });
    return `${startStr} – ${endStr}`;
  }

  return formatCustomRangeLabel(range);
}

export function formatDashboardPeriodLabel(
  viewMode: DashboardViewMode,
  range: DateRange
): string {
  return formatPeriodRangeLabel(range, viewMode);
}

const MONTH_SHORT_PT = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
];

/** Rótulo curto para gráficos, cards e linhas de comparação inline. */
export function formatCompactPeriodLabel(range: DateRange): string {
  if (isFullCalendarYear(range)) {
    return String(range.start.getFullYear());
  }

  if (isFullCalendarMonth(range)) {
    const y = range.start.getFullYear() % 100;
    return `${MONTH_SHORT_PT[range.start.getMonth()]}/${String(y).padStart(2, '0')}`;
  }

  const sy = range.start.getFullYear() % 100;
  const ey = range.end.getFullYear() % 100;
  const sm = MONTH_SHORT_PT[range.start.getMonth()];
  const em = MONTH_SHORT_PT[range.end.getMonth()];

  if (range.start.getFullYear() === range.end.getFullYear()) {
    if (range.start.getMonth() === range.end.getMonth()) {
      return `${sm}/${String(sy).padStart(2, '0')}`;
    }
    return `${sm}–${em}/${String(sy).padStart(2, '0')}`;
  }

  return `${sm}/${String(sy).padStart(2, '0')}–${em}/${String(ey).padStart(2, '0')}`;
}

/** viewMode efetivo para rotular o período comparado. */
export function comparePeriodLabelMode(
  viewMode: DashboardViewMode,
  preset: ComparePreset
): DashboardViewMode | undefined {
  if (viewMode === 'custom') return 'custom';
  if (preset === 'year_over_year' || preset === 'previous') return viewMode;
  return viewMode;
}

export function defaultComparePreset(viewMode: DashboardViewMode): ComparePreset {
  return viewMode === 'yearly' ? 'year_over_year' : 'previous';
}
