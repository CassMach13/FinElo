/**
 * Texto do cabeçalho que só existe na IMPRESSÃO da Dashboard ("Exportar PDF").
 *
 * O "PDF" é a impressão do navegador (`window.print()`), e o bloco que mostra o
 * período na tela — "Período selecionado" — fica dentro do cabeçalho `no-print`,
 * enquanto o seletor interativo é `print:hidden`. Resultado: o documento saía
 * com os números e sem dizer de quando eles eram (chamado 20260905-A902).
 *
 * Aqui só se MONTA o texto. Os rótulos vêm dos formatadores que a tela já usa
 * (`formatDashboardPeriodLabel`), sem segunda lógica de período; a única
 * formatação nova é o intervalo exato em `dd/mm/aaaa`, para que o PDF nunca dependa
 * do rótulo abreviado ("set. de 2026") para ser inequívoco.
 *
 * A Dashboard não tem modo "todo o histórico": os modos são mensal, trimestral,
 * semestral, anual e personalizado, e o intervalo é sempre real. Por isso não há
 * ramo que invente datas.
 */
import type { DateRange } from './dashboardPeriod';

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** `dd/mm/aaaa` no dia civil LOCAL, o mesmo em que os intervalos do dashboard são montados. */
export function formatPrintDate(date: Date): string {
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** `01/09/2026 a 30/09/2026`. */
export function formatPrintRange(range: DateRange): string {
  return `${formatPrintDate(range.start)} a ${formatPrintDate(range.end)}`;
}

export interface DashboardPrintPeriod {
  /** Rótulo legível já calculado pela tela (ex.: "setembro de 2026"). */
  label: string;
  range: DateRange;
}

export interface DashboardPrintHeaderLines {
  title: string;
  period: string;
  /** Só existe quando a comparação de períodos está ligada. */
  compare?: string;
}

export const DASHBOARD_PRINT_TITLE = 'FinElo · Dashboard financeiro';

const describe = (period: DashboardPrintPeriod): string =>
  `${period.label} (${formatPrintRange(period.range)})`;

/**
 * Linhas do cabeçalho de impressão. `compare` só é passado com a comparação ligada
 * e com um intervalo comparado válido — sem ele, a linha simplesmente não existe.
 */
export function buildDashboardPrintHeader(
  current: DashboardPrintPeriod,
  compare?: DashboardPrintPeriod | null
): DashboardPrintHeaderLines {
  const lines: DashboardPrintHeaderLines = {
    title: DASHBOARD_PRINT_TITLE,
    period: `Período: ${describe(current)}`,
  };
  if (compare) lines.compare = `Comparado com: ${describe(compare)}`;
  return lines;
}
