/**
 * Retenção de linhas recém-categorizadas.
 *
 * Com o filtro "Sem Categoria" ativo, categorizar uma linha a tira do resultado na hora e a lista
 * pula sob o cursor. A linha fica retida no lugar (só na exibição) até filtro/ordem/página mudarem,
 * até o usuário pedir para atualizar ou até a aba ir para segundo plano.
 *
 * Retidas só afetam a EXIBIÇÃO: contagens, totais, exportação e seleção usam o resultado real do filtro.
 */

/** id da transação → categoria que ela tinha antes de ser retida (congela a ordenação por categoria). */
export type RetainedRows = ReadonlyMap<string, string>;

/** A linha passa a sair do filtro de categoria ativo por causa da nova categoria? */
export function shouldRetainAfterCategoryChange(
  activeCategoryFilter: readonly string[],
  newCategory: unknown
): boolean {
  if (activeCategoryFilter.length === 0) return false;
  return !activeCategoryFilter.includes(String(newCategory ?? ''));
}

/** Retém a linha. Uma segunda recategorização preserva a categoria original (a posição não muda). */
export function addRetainedRow(
  retained: RetainedRows,
  id: string,
  categoryBeforeChange: unknown
): Map<string, string> {
  const next = new Map(retained);
  if (!next.has(id)) next.set(id, String(categoryBeforeChange ?? ''));
  return next;
}

/** Valor de ordenação da categoria: o congelado para linhas retidas, o atual para as demais. */
export function categorySortValue(
  row: { ID_Transacao?: string; Categoria?: unknown },
  retained: RetainedRows
): string {
  const frozen = row.ID_Transacao !== undefined ? retained.get(row.ID_Transacao) : undefined;
  return frozen ?? String(row.Categoria ?? '');
}

export interface RetentionResult<T> {
  /** Resultado real do filtro — base de contagens, totais, exportação e seleção. */
  matched: T[];
  /** O que se desenha: `matched` mais as linhas retidas, na posição de ordenação. */
  displayed: T[];
  /** Retidas que já não casam com o filtro (aparecem na tela, mas não contam). */
  staleIds: Set<string>;
}

export function partitionWithRetained<T extends { ID_Transacao?: string }>(
  rows: readonly T[],
  retained: RetainedRows,
  matches: (row: T) => boolean
): RetentionResult<T> {
  const matched: T[] = [];
  const displayed: T[] = [];
  const staleIds = new Set<string>();
  for (const row of rows) {
    if (matches(row)) {
      matched.push(row);
      displayed.push(row);
    } else if (row.ID_Transacao !== undefined && retained.has(row.ID_Transacao)) {
      displayed.push(row);
      staleIds.add(row.ID_Transacao);
    }
  }
  return { matched, displayed, staleIds };
}
