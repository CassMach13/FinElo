/**
 * Percentuais do Método 50-30-20 sobre a renda do período.
 *
 * O widget evitava a divisão por zero usando uma base artificial de R$ 1,00 (`income > 0 ? income : 1`).
 * Num mês sem renda e com gastos isso dividia os gastos por 1 e mostrava coisas como 495863,0% da
 * Renda, ao lado do aviso de que não havia renda. Sem renda positiva não existe proporção: o
 * percentual é indisponível (`null`), nunca um número fabricado. Com renda positiva o cálculo é o
 * mesmo de sempre.
 */
export const hasValidIncomeBase = (income: number | null | undefined): income is number =>
  typeof income === 'number' && Number.isFinite(income) && income > 0;

export function percentOfIncome(amount: number, income: number | null | undefined): number | null {
  if (!hasValidIncomeBase(income) || !Number.isFinite(amount)) return null;
  return (amount / income) * 100;
}

export const formatPercentOfIncome = (pct: number | null): string =>
  pct === null ? '—' : `${pct.toFixed(1)}% da Renda`;
