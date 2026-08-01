import { describe, expect, it, vi } from 'vitest';
import { collectPaginatedRows } from '../src/utils/paginatedFetch';

describe('collectPaginatedRows', () => {
  it('coleta todas as páginas sem truncar no limite do Supabase', async () => {
    const fetchPage = vi.fn(async (from: number) => ({
      data: from === 0 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }],
      error: null,
    }));

    await expect(collectPaginatedRows(fetchPage, 2)).resolves.toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('rejeita a leitura inteira quando uma página falha', async () => {
    const fetchPage = vi.fn(async (from: number) =>
      from === 0
        ? { data: [{ id: 1 }, { id: 2 }], error: null }
        : { data: null, error: { message: 'rede indisponível' } }
    );

    await expect(collectPaginatedRows(fetchPage, 2)).rejects.toThrow('rede indisponível');
  });
});
