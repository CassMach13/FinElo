import type { CreditCardStatementV2 } from '../types';

const round2 = (n: number): number => Math.round(n * 100) / 100;

export type StatementTotalsSource = 'manual' | 'file' | 'ledger' | 'motor';

export interface StatementDisplayTotals {
  statementTotal: number;
  totalPayments: number;
  openBalance: number;
  source: StatementTotalsSource;
}

export interface LedgerTotalsOverride {
  statementTotal: number;
  totalPayments: number;
}

/** Chave estável para casar fatura (due_year + due_month do motor). */
export function statementDueMonthKey(dueYear: number, dueMonth: number): string {
  return `${dueYear}-${dueMonth}`;
}

/**
 * Totais para exibição no histórico de faturas.
 * Prioridade: conferência manual > colunas do extrato no banco > prévia por arquivo (ledger) > motor.
 */
export function resolveStatementDisplayTotals(
  row: CreditCardStatementV2,
  ledgerOverride?: LedgerTotalsOverride | null
): StatementDisplayTotals {
  const manual = row.manual_totals;
  const motorSt = round2(Number(row.statement_total ?? 0));
  const motorPay = round2(Number(row.total_payments ?? 0));
  const priorAbate = round2(Number(manual?.prior_credit_abatement ?? 0));

  if (manual?.use_manual) {
    const st =
      manual.statement_total != null && Number.isFinite(manual.statement_total)
        ? round2(Number(manual.statement_total))
        : motorSt;
    let pay =
      manual.total_payments != null && Number.isFinite(manual.total_payments)
        ? round2(Number(manual.total_payments))
        : motorPay;
    pay = round2(pay + priorAbate);
    return {
      statementTotal: st,
      totalPayments: pay,
      openBalance: round2(Math.max(0, st - pay)),
      source: 'manual',
    };
  }

  const fromFileSt = row.statement_total_from_file;
  if (fromFileSt != null && Number.isFinite(fromFileSt) && fromFileSt > 0) {
    const st = round2(Number(fromFileSt));
    const pay = round2(
      row.total_payments_from_file != null && Number.isFinite(row.total_payments_from_file)
        ? Number(row.total_payments_from_file)
        : motorPay
    );
    return {
      statementTotal: st,
      totalPayments: round2(pay + priorAbate),
      openBalance: round2(Math.max(0, st - round2(pay + priorAbate))),
      source: 'file',
    };
  }

  if (ledgerOverride && ledgerOverride.statementTotal > 0) {
    const st = round2(ledgerOverride.statementTotal);
    const pay = round2(ledgerOverride.totalPayments + priorAbate);
    return {
      statementTotal: st,
      totalPayments: pay,
      openBalance: round2(Math.max(0, st - pay)),
      source: 'ledger',
    };
  }

  const pay = round2(motorPay + priorAbate);
  return {
    statementTotal: motorSt,
    totalPayments: pay,
    openBalance: round2(Math.max(0, motorSt - pay)),
    source: 'motor',
  };
}

export function displayTotalsSourceLabel(source: StatementTotalsSource): string {
  switch (source) {
    case 'manual':
      return 'conferência manual';
    case 'file':
      return 'extrato importado';
    case 'ledger':
      return 'soma das linhas do arquivo';
    default:
      return 'motor';
  }
}
