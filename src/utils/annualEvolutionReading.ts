/**
 * "Leitura do FinElo" da Evolução anual: frase determinística a partir das duas variações.
 *
 * Sem IA, rede ou conclusão financeira. A frase sempre fala em lançamentos REGISTRADOS: o contrato
 * é o operacional da Dashboard, não o fluxo econômico real.
 *
 * Limiares (aplicados ao percentual não arredondado):
 * - Estável: variação absoluta MENOR que 5% nos dois lados.
 * - Ritmo semelhante: diferença MENOR que 2 pontos percentuais entre as variações.
 * - Direção de um lado: ≥ +5% "aumentou", ≤ −5% "diminuiu"; entre os dois, "relativamente estável".
 */

export const STABLE_BAND_PERCENT = 5;
export const SIMILAR_PACE_POINTS = 2;

export type AnnualEvolutionReadingKind =
  | 'unavailable'
  | 'stable'
  | 'similar'
  | 'income_faster'
  | 'expense_faster'
  | 'mixed';

export interface AnnualEvolutionReading {
  kind: AnnualEvolutionReadingKind;
  text: string;
}

const PREFIX = 'Nos seus lançamentos registrados,';

type Side = 'up' | 'down' | 'flat';

const sideOf = (rate: number): Side =>
  rate >= STABLE_BAND_PERCENT ? 'up' : rate <= -STABLE_BAND_PERCENT ? 'down' : 'flat';

export function buildAnnualEvolutionReading(
  incomeChangePercent: number | null,
  expenseChangePercent: number | null
): AnnualEvolutionReading {
  if (
    incomeChangePercent === null ||
    expenseChangePercent === null ||
    !Number.isFinite(incomeChangePercent) ||
    !Number.isFinite(expenseChangePercent)
  ) {
    return {
      kind: 'unavailable',
      text: 'Sem base de comparação no ano anterior para uma leitura dos lançamentos registrados.',
    };
  }

  const income = incomeChangePercent;
  const expense = expenseChangePercent;

  if (Math.abs(income) < STABLE_BAND_PERCENT && Math.abs(expense) < STABLE_BAND_PERCENT) {
    return { kind: 'stable', text: 'Os valores registrados permaneceram relativamente estáveis.' };
  }

  if (Math.abs(income - expense) < SIMILAR_PACE_POINTS) {
    const verb = income > 0 && expense > 0 ? 'cresceram' : income < 0 && expense < 0 ? 'diminuíram' : 'variaram';
    return { kind: 'similar', text: `Entradas e saídas registradas ${verb} em ritmo semelhante.` };
  }

  const incomeSide = sideOf(income);
  const expenseSide = sideOf(expense);
  const incomeHigher = income > expense;

  if (incomeSide === 'up' && expenseSide === 'up') {
    return incomeHigher
      ? { kind: 'income_faster', text: `${PREFIX} as entradas cresceram mais que as saídas.` }
      : { kind: 'expense_faster', text: `${PREFIX} as saídas cresceram mais rápido que as entradas.` };
  }
  if (incomeSide === 'down' && expenseSide === 'down') {
    return incomeHigher
      ? { kind: 'expense_faster', text: `${PREFIX} as saídas diminuíram mais que as entradas.` }
      : { kind: 'income_faster', text: `${PREFIX} as entradas diminuíram mais que as saídas.` };
  }
  if (incomeSide === 'up' && expenseSide === 'down') {
    return { kind: 'mixed', text: `${PREFIX} as entradas aumentaram e as saídas diminuíram.` };
  }
  if (incomeSide === 'down' && expenseSide === 'up') {
    return { kind: 'mixed', text: `${PREFIX} as saídas aumentaram e as entradas diminuíram.` };
  }
  if (incomeSide === 'up') {
    return {
      kind: 'income_faster',
      text: `${PREFIX} as entradas aumentaram enquanto as saídas ficaram relativamente estáveis.`,
    };
  }
  if (incomeSide === 'down') {
    return {
      kind: 'mixed',
      text: `${PREFIX} as entradas diminuíram enquanto as saídas ficaram relativamente estáveis.`,
    };
  }
  if (expenseSide === 'up') {
    return {
      kind: 'expense_faster',
      text: `${PREFIX} as saídas aumentaram enquanto as entradas ficaram relativamente estáveis.`,
    };
  }
  return {
    kind: 'mixed',
    text: `${PREFIX} as saídas diminuíram enquanto as entradas ficaram relativamente estáveis.`,
  };
}
