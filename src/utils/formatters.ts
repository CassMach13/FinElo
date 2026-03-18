/**
 * Utilitários de formatação para consistência visual em todo o app.
 */

/**
 * Formata um valor numérico para moeda BRL (R$).
 * Garante que o sinal de menos (-) fique colado ao simbolo R$ sem espaços extras,
 * resolvendo problemas de quebra de linha ou alinhamento em alguns navegadores.
 */
export const formatCurrency = (value: number): string => {
  const isNegative = value < 0;
  // Usamos o valor absoluto para a formatação do Intl, e adicionamos o sinal manualmente
  // para garantir que não haja espaços entre o '-' e o 'R$' em nenhum navegador.
  const formatted = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Math.abs(value));

  return isNegative ? `-${formatted}` : formatted;
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
