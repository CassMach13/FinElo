import { CreditCardStatementV2 } from '../types';

/**
 * Escolhe a fatura que recebe um pagamento rápido (ex.: atalho em Transações):
 * aberta/parcial → com saldo em aberto → mais recente na lista (já ordenada por vencimento desc).
 */
export function pickPrimaryStatementForPayment(
  statements: CreditCardStatementV2[]
): CreditCardStatementV2 | null {
  if (!statements.length) return null;
  const partial = statements.find((s) => s.status === 'open' || s.status === 'partial');
  if (partial) return partial;
  const withOpen = statements.find((s) => Number(s.open_balance ?? 0) > 0.009);
  if (withOpen) return withOpen;
  return statements[0];
}
