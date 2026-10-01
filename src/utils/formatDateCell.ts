/**
 * Texto de uma célula de data da tabela de Transações.
 *
 * A célula fazia `new Date(value).toLocaleDateString(...)` direto. Com `Data_Pagamento` ausente
 * (`null`) isso vira `new Date(null)`, a época Unix, e a tabela mostrava 01/01/1970 — um dado que
 * não existe no banco. Ausente (`null`, `undefined`, vazio) ou inválido é "-", nunca uma data
 * inventada. Data válida mantém o formato de antes: pt-BR, dia civil em UTC.
 */
export function formatDateCell(value: Date | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}
