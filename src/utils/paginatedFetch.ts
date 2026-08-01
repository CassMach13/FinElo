export interface PaginatedFetchError {
  message: string;
}

export interface PaginatedFetchResult<T> {
  data: T[] | null;
  error: PaginatedFetchError | null;
}

/**
 * Coleta todas as páginas antes de devolver qualquer linha. Se uma página
 * falhar, lança erro e impede que o chamador publique um conjunto parcial.
 * A consulta fornecida deve usar uma ordenação determinística e única.
 */
export async function collectPaginatedRows<T>(
  fetchPage: (from: number, to: number) => Promise<PaginatedFetchResult<T>>,
  pageSize = 1000
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error('Tamanho de página inválido.');
  }

  const rows: T[] = [];
  let page = 0;

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw new Error(error.message || `Falha ao carregar página ${page + 1}.`);

    const pageRows = data || [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return rows;
    page += 1;
  }
}
