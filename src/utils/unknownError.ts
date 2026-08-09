type ErrorLike = {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
};

const textField = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/**
 * Converte erros nativos e objetos retornados pelo PostgREST em texto útil.
 * Evita que a interface mostre apenas "[object Object]".
 */
export function unknownErrorMessage(
  error: unknown,
  fallback = 'Ocorreu um erro inesperado.'
): string {
  if (error instanceof Error) return error.message.trim() || fallback;
  if (typeof error === 'string') return error.trim() || fallback;

  if (error && typeof error === 'object') {
    const candidate = error as ErrorLike;
    const message = textField(candidate.message);
    const details = textField(candidate.details);
    const hint = textField(candidate.hint);
    const code = textField(candidate.code);
    const parts = [
      message,
      details && details !== message ? `Detalhes: ${details}` : '',
      hint ? `Sugestão: ${hint}` : '',
      code ? `Código: ${code}` : '',
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // O fallback abaixo também cobre objetos circulares.
    }
  }

  return fallback;
}
