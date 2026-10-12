import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addRetainedRow,
  categorySortValue,
  partitionWithRetained,
  shouldRetainAfterCategoryChange,
  type RetainedRows,
} from '../../src/utils/transactionCategoryRetention';
import {
  getShowAllTransactionFilters,
  matchesTransactionFilters,
} from '../../src/utils/transactionPeriodFilters';

const view = readFileSync(resolve('src/components/views/TransactionsView.tsx'), 'utf8').replaceAll('\r\n', '\n');

type Row = { ID_Transacao: string; Categoria: string; Valor: number; Tipo: string; Data: string; ID_Conta: string; Origem: string };
const mk = (id: string, Categoria: string, Valor: number): Row => ({
  ID_Transacao: id,
  Categoria,
  Valor,
  Tipo: 'Despesa',
  Data: '2026-10-01',
  ID_Conta: 'c1',
  Origem: 'manual',
});

const ctx = {
  getTransactionOwnerId: () => 'u',
  getAccountName: () => 'Conta',
  isCreditCardAccount: () => false,
};
const uncategorizedFilter = { ...getShowAllTransactionFilters(), category: ['-'] };
const matchesUncategorized = (r: Row) => matchesTransactionFilters(r as never, uncategorizedFilter, ctx as never);

/** Reproduz o que a tela faz: ordena (com categoria congelada), particiona e pagina. */
function screen(rows: Row[], retained: RetainedRows, sortByCategory: boolean, page = 1, perPage = 50) {
  const sorted = [...rows];
  if (sortByCategory) {
    sorted.sort((a, b) => categorySortValue(a, retained).localeCompare(categorySortValue(b, retained)));
  }
  const { matched, displayed, staleIds } = partitionWithRetained(sorted, retained, matchesUncategorized);
  const start = (page - 1) * perPage;
  const display = displayed.slice(start, start + perPage);
  const counted = display.filter((r) => !staleIds.has(r.ID_Transacao));
  return {
    displayIds: display.map((r) => r.ID_Transacao),
    totalRecords: matched.length,
    visibleCount: counted.length,
    visibleSum: counted.reduce((acc, r) => acc + r.Valor, 0),
    staleCount: staleIds.size,
  };
}

/** Categoriza uma linha como a tela: troca a categoria e retém quando ela sai do filtro. */
function categorize(rows: Row[], retained: RetainedRows, id: string, category: string) {
  const row = rows.find((r) => r.ID_Transacao === id)!;
  const nextRetained = shouldRetainAfterCategoryChange(uncategorizedFilter.category, category)
    ? addRetainedRow(retained, id, row.Categoria)
    : retained;
  return {
    rows: rows.map((r) => (r.ID_Transacao === id ? { ...r, Categoria: category } : r)),
    retained: nextRetained,
  };
}

const base = () => ['a', 'b', 'c', 'd', 'e'].map((id, i) => mk(id, '-', -(i + 1) * 10));

describe('shouldRetainAfterCategoryChange', () => {
  it('retém quando a nova categoria sai do filtro "Sem Categoria"', () => {
    expect(shouldRetainAfterCategoryChange(['-'], 'Mercado')).toBe(true);
  });
  it('não retém sem filtro de categoria ou se a nova categoria continua no filtro', () => {
    expect(shouldRetainAfterCategoryChange([], 'Mercado')).toBe(false);
    expect(shouldRetainAfterCategoryChange(['Mercado', 'Lazer'], 'Lazer')).toBe(false);
    expect(shouldRetainAfterCategoryChange(['-'], '-')).toBe(false);
  });
});

describe('categorização consecutiva com o filtro "Sem Categoria"', () => {
  it('cada linha fica no lugar; a próxima não se move', () => {
    let state = { rows: base(), retained: new Map() as RetainedRows };
    const positions: string[][] = [screen(state.rows, state.retained, false).displayIds];

    for (const id of ['a', 'b', 'c']) {
      state = categorize(state.rows, state.retained, id, 'Mercado');
      positions.push(screen(state.rows, state.retained, false).displayIds);
    }

    for (const ids of positions) expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('contagem e totais ignoram as retidas e coincidem com o filtro real', () => {
    let state = { rows: base(), retained: new Map() as RetainedRows };
    state = categorize(state.rows, state.retained, 'a', 'Mercado'); // -10
    state = categorize(state.rows, state.retained, 'b', 'Lazer'); // -20

    const s = screen(state.rows, state.retained, false);
    expect(s.displayIds).toHaveLength(5); // desenhadas
    expect(s.staleCount).toBe(2);
    expect(s.totalRecords).toBe(3); // c, d, e
    expect(s.visibleCount).toBe(3);
    expect(s.visibleSum).toBe(-30 - 40 - 50);
  });

  it('ordenar por categoria não move a linha recém-categorizada', () => {
    let state = { rows: base(), retained: new Map() as RetainedRows };
    const before = screen(state.rows, state.retained, true).displayIds;

    state = categorize(state.rows, state.retained, 'a', 'Zebra'); // sem congelar iria para o fim
    state = categorize(state.rows, state.retained, 'b', 'Alfa'); // sem congelar iria para o início
    const after = screen(state.rows, state.retained, true).displayIds;

    expect(after).toEqual(before);
  });

  it('liberar a retenção (filtro/ordem/página/atualizar) remove as categorizadas de fato', () => {
    let state = { rows: base(), retained: new Map() as RetainedRows };
    state = categorize(state.rows, state.retained, 'a', 'Mercado');
    state = categorize(state.rows, state.retained, 'c', 'Mercado');

    const released = screen(state.rows, new Map(), false);
    expect(released.displayIds).toEqual(['b', 'd', 'e']);
    expect(released.staleCount).toBe(0);
    expect(released.totalRecords).toBe(3);
  });

  it('não acumula: no máximo as linhas da página corrente, e a página nunca fica órfã', () => {
    const rows = Array.from({ length: 60 }, (_, i) => mk(`t${i}`, '-', -1));
    let state = { rows, retained: new Map() as RetainedRows };
    for (let i = 0; i < 50; i++) state = categorize(state.rows, state.retained, `t${i}`, 'Mercado');

    const s = screen(state.rows, state.retained, false, 1, 50);
    expect(s.staleCount).toBeLessThanOrEqual(50);
    expect(s.totalRecords).toBe(10);

    // Ao liberar (mudança de página/filtro) sobra 1 página: o clamp da tela leva a página 2 → 1.
    const released = screen(state.rows, new Map(), false, 1, 50);
    expect(released.displayIds).toHaveLength(10);
    expect(Math.max(1, Math.ceil(released.totalRecords / 50))).toBe(1);
  });

  it('recategorizar duas vezes preserva a posição original', () => {
    let state = { rows: base(), retained: new Map() as RetainedRows };
    state = categorize(state.rows, state.retained, 'a', 'Mercado');
    state = categorize(state.rows, state.retained, 'a', 'Lazer');
    expect(state.retained.get('a')).toBe('-');
  });

  it('linha excluída não reaparece pela retenção', () => {
    const retained: RetainedRows = new Map([['zzz', '-']]);
    expect(screen(base(), retained, false).displayIds).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('fiação em TransactionsView', () => {
  it('edição inline e modal retêm a linha, passando a transação (categoria anterior) inteira', () => {
    expect(view).toContain("if (field === 'Categoria') retainIfLeavingCategoryFilter(transaction, value);");
    expect(view).toContain('retainIfLeavingCategoryFilter(editingTransaction, newTransactions[0].Categoria);');
  });

  it('contagens, totais, exportação e seleção usam o resultado real; só a lista desenha as retidas', () => {
    expect(view).toContain('totalRecords={filteredTransactions.length}');
    expect(view).toContain('visibleCount={filteredTransactions.length}');
    expect(view).toContain('paginatedDisplayTransactions.filter((t) => !staleRetainedIds.has(t.ID_Transacao))');
    expect(view).toContain('flattenGroupedTransactionListItems(paginatedDisplayTransactions)');
    expect(view).toContain('buildTransactionExportRows(filteredTransactions,');
    expect(view).toContain('Somando {paginatedTransactions.length} itens visíveis');
  });

  it('a ordenação por categoria usa a categoria congelada', () => {
    expect(view).toContain('categorySortValue(a, retainedRows)');
    expect(view).toContain('categorySortValue(b, retainedRows)');
  });

  it('filtro, ordem, página e itens por página liberam; aba em segundo plano também', () => {
    expect(view).toContain(
      '}, [transactionFilters, sortConfig, currentPage, itemsPerPage, releaseRetainedRows]);'
    );
    expect(view).toContain("document.addEventListener('visibilitychange', onVisibility);");
    expect(view).toContain('Atualizar lista');
  });

  it('a página é limitada ao total após a lista encolher', () => {
    expect(view).toContain('if (currentPage > totalPages) setCurrentPage(totalPages);');
  });

  it('linhas retidas não podem ser selecionadas individualmente para exclusão em lote', () => {
    // O toggle recusa ids retidos (desktop checkbox, mobile checkbox e toque no cartão passam por ele).
    expect(view).toMatch(
      /const toggleManualSelection = useCallback\(\s*\(transactionId: string\) => \{\s*if \(staleRetainedIds\.has\(transactionId\)\) return;/
    );
    // Controles desabilitados e cartão sem ação para retidas, nas duas superfícies.
    expect(view).toContain('const selectable = manual && !staleRetainedIds.has(t.ID_Transacao);');
    expect(view.match(/disabled=\{!selectable\}/g)).toHaveLength(2);
    expect(view).toContain('onClick={selectable ? () => toggleManualSelection(t.ID_Transacao) : undefined}');
    // Mesmo que já estivesse marcada antes de ser categorizada, a exclusão em lote a ignora.
    expect(view).toContain('const idsToDelete = [...effectiveSelectedManualIds];');
    expect(view).toContain('await deleteManualTransactions(idsToDelete);');
    expect(view).not.toContain('deleteManualTransactions([...selectedManualIds])');
    expect(view).toContain('const selectedManualCount = effectiveSelectedManualIds.size;');
  });

  it('a exclusão individual (deslizar/excluir) continua usando `manual`, não `selectable`', () => {
    expect(view).toContain("if (await appConfirm('Excluir este lançamento manual?'");
    expect(view).toMatch(/onClick: async \(\) => \{\s*if \(manual\) \{/);
  });

  it('a gravação não muda: updateTransaction recebe o mesmo objeto de antes', () => {
    expect(view).toContain('updateTransaction(updatedTransaction);');
  });
});
