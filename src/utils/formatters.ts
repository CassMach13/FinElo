/**
 * Utilitários de formatação para consistência visual em todo o app.
 */

/**
 * Formata um valor numérico para moeda BRL (R$).
 * Garante que o sinal de menos (-) fique colado ao simbolo R$ sem espaços extras,
 * resolvendo problemas de quebra de linha ou alinhamento em alguns navegadores.
 */
export const formatCurrency = (value: number): string => {
  const formatted = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);

  // O replace abaixo remove espaços (normais ou non-breaking) entre o sinal de menos e o R$
  // Alguns engines de JS inserem U+00A0 ou U+202F no locale pt-BR
  return formatted.replace(/-\s*R\$/, '-R$');
};

/**
 * Retorna a classe de cor baseada no valor (Positivo/Negativo)
 */
export const getCurrencyColorClass = (value: number, defaultColor = 'text-light'): string => {
  if (value < 0) return 'text-danger';
  if (value > 0) return 'text-accent';
  return defaultColor;
};

/**
 * Retorna a classe de fundo baseada no valor para o estilo glassmorphism
 */
export const getCurrencyBgClass = (value: number, defaultBg = 'bg-white/5'): string => {
  if (value < 0) return 'bg-danger/10';
  if (value > 0) return 'bg-accent/10';
  return defaultBg;
};
