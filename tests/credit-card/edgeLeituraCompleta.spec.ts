import { describe, expect, it } from 'vitest';
import {
  lerColecaoCompleta,
  TAMANHO_PAGINA,
} from '../../supabase/functions/card-reconciliation/leituraCompleta.ts';
import { creditCardRebuildFromImportHistoryService } from '../../src/services/creditCardRebuildFromImportHistoryService';
import { projectCardTwoLedger } from '../../src/domain/credit-card/twoLedgerProjection';
import type { Account, Transaction } from '../../src/types';

/**
 * A leitura do lado confiável, e o corte silencioso que ela sofria.
 *
 * O PostgREST corta a resposta em `max-rows` e devolve 200 OK com um
 * `Content-Range` truncado. A Edge lia `.select('*')` cru e tratava isso como
 * conjunto completo — em produção, 1.000 de 3.768 transações. O cliente, que
 * sempre paginou, lia todas: o MESMO núcleo produzia números diferentes nas
 * duas superfícies, e o do servidor era o que virava snapshot.
 *
 * Estes testes fixam as duas metades da correção: paginar, e PROVAR que
 * paginou. A segunda metade importa tanto quanto a primeira — um laço que
 * confia no tamanho da página volta a truncar em silêncio se `max-rows` for
 * menor que a página.
 */

/**
 * Um PostgREST de mentira, fiel no que interessa: aplica o range pedido e
 * depois corta em `maxRows`, sempre com 200 e sempre com a contagem exata.
 */
function postgrestFalso<T>(linhas: T[], maxRows: number) {
  return (from: number, to: number) => {
    const fim = Math.min(to, from + maxRows - 1);
    return Promise.resolve({
      data: linhas.slice(from, fim + 1),
      error: null as { message: string } | null,
      count: linhas.length,
    });
  };
}

const linhasNumeradas = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

describe('lerColecaoCompleta', () => {
  it('coleta todas as páginas quando a coleção passa de uma página', async () => {
    const linhas = linhasNumeradas(TAMANHO_PAGINA * 2 + 137);
    const lidas = await lerColecaoCompleta('t', postgrestFalso(linhas, TAMANHO_PAGINA));

    expect(lidas).toHaveLength(linhas.length);
    expect(lidas[0]).toEqual({ i: 0 });
    expect(lidas[lidas.length - 1]).toEqual({ i: linhas.length - 1 });
  });

  it('devolve a coleção inteira quando ela cabe em uma página', async () => {
    const linhas = linhasNumeradas(3);
    await expect(lerColecaoCompleta('t', postgrestFalso(linhas, TAMANHO_PAGINA))).resolves.toHaveLength(3);
  });

  /**
   * REGRESSÃO PRINCIPAL. O corte de produção: 3.768 linhas, `max-rows` 1.000.
   * Sob o código antigo isso devolvia 1.000 linhas e seguia adiante.
   */
  it('recusa a leitura quando max-rows é menor que a coleção e a página não fecha', async () => {
    const linhas = linhasNumeradas(3768);
    // max-rows menor que a página: a primeira página volta curta e um laço
    // ingênuo concluiria «acabou».
    await expect(lerColecaoCompleta('transactions', postgrestFalso(linhas, 500))).rejects.toThrow(
      /transactions: leitura incompleta \(500 de 3768 linhas\)/
    );
  });

  it('recusa a leitura sem contagem exata — completude não verificável', async () => {
    const pagina = () => Promise.resolve({ data: [{ i: 0 }], error: null, count: null });
    await expect(lerColecaoCompleta('contas', pagina)).rejects.toThrow(/sem contagem exata/);
  });

  it('propaga erro de página em vez de devolver conjunto parcial', async () => {
    const pagina = () =>
      Promise.resolve({ data: null, error: { message: 'timeout' }, count: null });
    await expect(lerColecaoCompleta('import_logs', pagina)).rejects.toThrow(/timeout/);
  });

  /** A mensagem precisa dizer o que faltou: é ela que aparece no 500. */
  it('a recusa nomeia a coleção e o tamanho do buraco', async () => {
    await expect(
      lerColecaoCompleta('resolucoes', postgrestFalso(linhasNumeradas(10), 4))
    ).rejects.toThrow(/resolucoes: leitura incompleta \(4 de 10 linhas\)/);
  });
});

// ---------------------------------------------------------------------------

const account: Account = {
  id: 'acc-xp',
  Nome_Conta: 'Cartão XP',
  Tipo_Conta: 'Cartão de Crédito',
  dia_vencimento: 10,
} as Account;

const JAN = 'Fatura_Cartao_XP_Jan_2025.csv';
const FEV = 'Fatura_Cartao_XP_Fev_2025.csv';

/**
 * O caso de produção reproduzido linha a linha, com mais de uma página de
 * transações e a compra de R$ 49,76 posicionada DEPOIS do corte.
 *
 * A ordem importa: os pagamentos ficam antes da linha 1.000 (sobrevivem ao
 * corte, como sobreviveram em produção) e a compra fica depois. É o que faz o
 * total encolher sem que os pagamentos encolham junto — e é daí que sai a
 * diferença de +R$ 49,98 no lugar de +R$ 0,22.
 */
function datasetReal(): Transaction[] {
  const tx = (over: Record<string, unknown>, i: number) =>
    ({
      ID_Transacao: `t-${String(i).padStart(5, '0')}`,
      ID_Conta: 'acc-xp',
      ...over,
    }) as unknown as Transaction;

  const linhas: Transaction[] = [];

  linhas.push(
    tx(
      { Origem: JAN, Data: '2024-12-01', Valor: -6002.87, Tipo: 'Despesa', Descricao_Original: 'Compras do ciclo' },
      0
    )
  );
  linhas.push(
    tx(
      { Origem: FEV, Data: '2025-01-05', Valor: 5836.38, Tipo: 'Renda', Descricao_Original: 'Pagamentos Validos Normais' },
      1
    )
  );
  linhas.push(
    tx(
      { Origem: FEV, Data: '2025-01-06', Valor: 216.47, Tipo: 'Renda', Descricao_Original: 'Pagamento de fatura' },
      2
    )
  );

  // Enchimento de OUTRA conta, só para empurrar a compra para além do corte.
  for (let i = 3; i < TAMANHO_PAGINA; i += 1) {
    linhas.push(
      tx(
        { ID_Conta: 'acc-outra', Origem: 'outra.csv', Data: '2025-01-01', Valor: -1, Tipo: 'Despesa', Descricao_Original: 'ruido' },
        i
      )
    );
  }

  // A linha que o corte engolia em produção.
  linhas.push(
    tx(
      { Origem: JAN, Data: '2024-11-04', Valor: -49.76, Tipo: 'Despesa', Total_Parcelas: 2, Descricao_Original: 'Compras Ione' },
      TAMANHO_PAGINA
    )
  );

  return linhas;
}

const importLogs = [
  {
    id: 'log-jan',
    file_name: JAN,
    imported_details: [
      { ID_Conta: 'acc-xp', Card_Reference_Label: '2024-12', Card_Due_Date: '2025-01-10' },
    ],
  },
  {
    id: 'log-fev',
    file_name: FEV,
    imported_details: [
      { ID_Conta: 'acc-xp', Card_Reference_Label: '2025-01', Card_Due_Date: '2025-02-10' },
    ],
  },
] as never[];

/** O caminho inteiro, do jeito que as duas superfícies o percorrem. */
function deltaDe(transactions: Transaction[]): number {
  const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
    accountId: account.id,
    account,
    accounts: [account],
    transactions,
    importLogs,
  });
  const p = projectCardTwoLedger(cards, { asOf: '2026-09-02' });
  const dez = p.competences.find((c) => c.referenceMonth === '2024-12');
  expect(dez, 'competência 2024-12 não foi projetada').toBeDefined();
  return dez!.unresolvedReconciliationDeltaCents;
}

describe('Edge e cliente sobre o mesmo conjunto lógico', () => {
  it('a leitura paginada devolve exatamente o conjunto que o cliente enxerga', async () => {
    const completo = datasetReal();
    const lido = await lerColecaoCompleta<Transaction>(
      'transactions',
      postgrestFalso(completo, TAMANHO_PAGINA)
    );

    expect(lido).toHaveLength(completo.length);
    expect(deltaDe(lido)).toBe(deltaDe(completo));
  });

  it('a competência 2024-12 fecha em +R$ 0,22 com o conjunto completo', () => {
    expect(deltaDe(datasetReal())).toBe(22);
  });

  /**
   * A prova de que o teste não é vazio: com o conjunto cortado o número muda,
   * e muda para exatamente o que produção mostrava.
   */
  it('o conjunto truncado produz os +R$ 49,98 do incidente', () => {
    const truncado = datasetReal().slice(0, TAMANHO_PAGINA);
    expect(deltaDe(truncado)).toBe(4998);
  });

  it('truncar muda o número — por isso a leitura precisa ser completa', () => {
    const completo = datasetReal();
    expect(deltaDe(completo.slice(0, TAMANHO_PAGINA))).not.toBe(deltaDe(completo));
  });
});
