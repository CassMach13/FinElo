/**
 * Nome dos arquivos de exportação de transações, derivado do PERÍODO do filtro.
 *
 * Antes: `transacoes_filtradas_<data de hoje>` — dizia quando o arquivo foi
 * baixado, não o que ele contém. Depois:
 *
 *   mês inteiro ............ finelo-transacoes-2026-09.csv
 *   intervalo livre ........ finelo-transacoes-2026-08-15_a_2026-09-10.csv
 *   um único dia ........... finelo-transacoes-2026-09-10.csv
 *   só início / só fim ..... finelo-transacoes-a-partir-de-2026-08-15.csv
 *                            finelo-transacoes-ate-2026-09-10.csv
 *   todo o histórico ....... finelo-transacoes-todo-o-historico.csv
 *
 * "Todo o histórico" nunca finge ser um único mês. O nome só usa dígitos, letras
 * minúsculas e hífens/sublinhados: seguro em qualquer sistema de arquivos, e
 * sem nome de usuário, conta ou qualquer texto digitado.
 *
 * O nome reflete o PERÍODO do filtro, não os demais filtros (conta, busca,
 * categoria) — o conteúdo do arquivo continua sendo o conjunto filtrado inteiro.
 */
import { toDateOnlyIso } from '../../utils/dateOnly';
import {
  shouldApplyDateFilter,
  type TransactionFiltersState,
} from '../../utils/transactionPeriodFilters';

export type TransactionExportExtension = 'csv' | 'xlsx';

type PeriodFilters = Pick<
  TransactionFiltersState,
  'startDate' | 'endDate' | 'periodPreset' | 'viewScope'
>;

const BASE_NAME = 'finelo-transacoes';

const pad2 = (value: number): string => String(value).padStart(2, '0');

const lastDayOfMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Descreve o período como sufixo do nome, ou `null` quando não há período. */
function describePeriod(filters: PeriodFilters): string | null {
  if (!shouldApplyDateFilter(filters as TransactionFiltersState)) return null;

  const start = toDateOnlyIso(filters.startDate);
  const end = toDateOnlyIso(filters.endDate);
  if (!start && !end) return null;
  if (start && !end) return `a-partir-de-${start}`;
  if (!start && end) return `ate-${end}`;

  if (start === end) return start;

  const [startYear, startMonth, startDay] = start.split('-').map(Number);
  const [endYear, endMonth, endDay] = end.split('-').map(Number);
  const isWholeMonth =
    startYear === endYear &&
    startMonth === endMonth &&
    startDay === 1 &&
    endDay === lastDayOfMonth(endYear, endMonth);

  return isWholeMonth ? `${startYear}-${pad2(startMonth)}` : `${start}_a_${end}`;
}

export function buildTransactionExportFileName(
  filters: PeriodFilters,
  extension: TransactionExportExtension
): string {
  const period = describePeriod(filters) ?? 'todo-o-historico';
  return `${BASE_NAME}-${period}.${extension}`;
}
