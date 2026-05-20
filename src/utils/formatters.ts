/**
 * Utilitários de formatação para consistência visual em todo o app.
 */

const moneyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/**
 * Normaliza valores monetários: arredonda em centavos e trata -0 como zero.
 */
export function normalizeMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0 || Object.is(rounded, -0)) return 0;
  return rounded;
}

/**
 * Formata um valor numérico para moeda BRL (R$).
 * Zero nunca exibe sinal negativo (inclui -0 e resíduos de ponto flutuante).
 */
export const formatCurrency = (value: number): string => {
  const n = normalizeMoney(value);
  const isNegative = n < 0;
  const formatted = moneyFormatter.format(Math.abs(n));
  return isNegative ? `-${formatted}` : formatted;
};

/**
 * Formata com sinal explícito (+/-). Zero retorna R$ 0,00 sem prefixo.
 */
export const formatCurrencySigned = (
  value: number,
  options?: { showPlusForPositive?: boolean }
): string => {
  const n = normalizeMoney(value);
  if (n === 0) return formatCurrency(0);
  const formatted = moneyFormatter.format(Math.abs(n));
  if (n > 0) return options?.showPlusForPositive ? `+${formatted}` : formatted;
  return `-${formatted}`;
};

/**
 * Retorna a classe de cor baseada no valor (Positivo/Negativo)
 */
export const getCurrencyColorClass = (value: number, defaultColor = 'text-light'): string => {
  const n = normalizeMoney(value);
  if (n < 0) return 'text-danger';
  if (n > 0) return 'text-accent';
  return defaultColor;
};

/**
 * Retorna a classe de fundo baseada no valor para o estilo glassmorphism
 */
export const getCurrencyBgClass = (value: number, defaultBg = 'bg-white/5'): string => {
  const n = normalizeMoney(value);
  if (n < 0) return 'bg-danger/10';
  if (n > 0) return 'bg-accent/10';
  return defaultBg;
};
