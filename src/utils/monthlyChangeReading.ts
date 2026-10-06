/**
 * Leitura do FinElo para "O que mudou no seu mês?". Determinística, sem IA, sempre em termos de
 * valores/lançamentos REGISTRADOS (contrato operacional da Dashboard, não fluxo econômico real).
 *
 * Limiares (percentual não arredondado): estável = |variação| < 5% nos dois lados; ritmo
 * semelhante = diferença < 2 p.p.; um lado "aumentou/diminuiu" a partir de ±5%.
 */

export const STABLE_BAND_PERCENT = 5;
export const SIMILAR_PACE_POINTS = 2;

export type MonthlyChangeReadingKind =
  | 'unavailable'
  | 'stable'
  | 'similar'
  | 'income_faster'
  | 'expense_faster'
  | 'mixed';

export interface MonthlyChangeReading {
  kind: MonthlyChangeReadingKind;
  text: string;
}

type Side = 'up' | 'down' | 'flat';
const sideOf = (rate: number): Side =>
  rate >= STABLE_BAND_PERCENT ? 'up' : rate <= -STABLE_BAND_PERCENT ? 'down' : 'flat';

const valid = (n: number | null): n is number => n !== null && Number.isFinite(n);

export function buildMonthlyChangeReading(
  incomePercent: number | null,
  expensePercent: number | null,
  labels: { current: string; previous: string }
): MonthlyChangeReading {
  const m = labels.current;
  const inc = valid(incomePercent) ? incomePercent : null;
  const exp = valid(expensePercent) ? expensePercent : null;

  if (inc === null && exp === null) {
    return {
      kind: 'unavailable',
      text: 'Sem base de comparação no mês anterior para uma leitura dos valores registrados.',
    };
  }

  // Só um dos lados tem percentual válido.
  if (inc === null || exp === null) {
    const name = inc !== null ? 'entradas' : 'saídas';
    const rate = (inc ?? exp) as number;
    const side = sideOf(rate);
    if (side === 'flat') {
      return { kind: 'stable', text: `As ${name} registradas ficaram próximas às de ${labels.previous}.` };
    }
    return {
      kind: 'mixed',
      text: `As ${name} registradas ${side === 'up' ? 'aumentaram' : 'diminuíram'} em ${m}.`,
    };
  }

  if (Math.abs(inc) < STABLE_BAND_PERCENT && Math.abs(exp) < STABLE_BAND_PERCENT) {
    return { kind: 'stable', text: `Os valores registrados ficaram próximos aos de ${labels.previous}.` };
  }

  if (Math.abs(inc - exp) < SIMILAR_PACE_POINTS) {
    const verb = inc > 0 && exp > 0 ? 'cresceram' : inc < 0 && exp < 0 ? 'diminuíram' : 'variaram';
    return { kind: 'similar', text: `Entradas e saídas registradas ${verb} em ritmo semelhante.` };
  }

  const i = sideOf(inc);
  const e = sideOf(exp);
  const incomeHigher = inc > exp;

  if (i === 'up' && e === 'up') {
    return incomeHigher
      ? { kind: 'income_faster', text: `As entradas registradas cresceram mais que as saídas em ${m}.` }
      : { kind: 'expense_faster', text: `As saídas registradas cresceram mais que as entradas em ${m}.` };
  }
  if (i === 'down' && e === 'down') {
    return incomeHigher
      ? { kind: 'expense_faster', text: `As saídas registradas diminuíram mais que as entradas em ${m}.` }
      : { kind: 'income_faster', text: `As entradas registradas diminuíram mais que as saídas em ${m}.` };
  }
  if (i === 'up' && e === 'down') {
    return { kind: 'mixed', text: `As entradas registradas aumentaram e as saídas registradas diminuíram em ${m}.` };
  }
  if (i === 'down' && e === 'up') {
    return { kind: 'mixed', text: `As saídas registradas aumentaram e as entradas registradas diminuíram em ${m}.` };
  }
  const stable = (name: 'entradas' | 'saídas') => `enquanto as ${name} registradas ficaram relativamente estáveis`;
  if (i === 'up') {
    return { kind: 'income_faster', text: `As entradas registradas aumentaram em ${m}, ${stable('saídas')}.` };
  }
  if (i === 'down') {
    return { kind: 'mixed', text: `As entradas registradas diminuíram em ${m}, ${stable('saídas')}.` };
  }
  if (e === 'up') {
    return { kind: 'expense_faster', text: `As saídas registradas aumentaram em ${m}, ${stable('entradas')}.` };
  }
  return { kind: 'mixed', text: `As saídas registradas diminuíram em ${m}, ${stable('entradas')}.` };
}
