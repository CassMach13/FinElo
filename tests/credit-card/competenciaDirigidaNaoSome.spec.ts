import { describe, expect, it } from 'vitest';
import { creditCardRebuildFromImportHistoryService } from '../../src/services/creditCardRebuildFromImportHistoryService';
import type { Account, Transaction } from '../../src/types';

/**
 * O vão entre os dois caminhos do ledger.
 *
 * Um lançamento da conta é somado por `transactionsForFile` (linhas de arquivo)
 * ou por `appendManualCompetenceTotals` (lançamentos por fora). Os dois
 * filtros precisam COBRIR o conjunto, não apenas evitar sobreposição.
 *
 * `transactionsForFile` recusa duas classes: origem manual e marcador de
 * competência dirigida. A segunda recusa não tinha contrapartida — o caminho
 * manual exigia origem manual — e uma linha com marcador vinda de ARQUIVO caía
 * entre os dois e desaparecia sem ruído.
 *
 * Foi o caso real: `SHOPEE *DOLCEROSE … finelo_competence:2026-07`, estorno de
 * R$ 30,36, importado de CSV e dirigido pelo modal. A tabela legada o
 * registrava; o ledger novo, não. Nenhuma tela mostrava o valor sumido.
 *
 * Os quatro casos abaixo cobrem as combinações de marcador × origem, e o
 * último fixa o que nenhum dos outros prova sozinho: que a correção não passou
 * a contar a mesma linha duas vezes.
 */

const account: Account = {
  id: 'acc-xp',
  Nome_Conta: 'Cartão XP',
  Tipo_Conta: 'Cartão de Crédito',
  dia_vencimento: 10,
} as Account;

const ARQUIVO = 'Fatura_Cartao_XP_Ago_2026.csv';

const importLogs = [
  {
    id: 'log-ago',
    file_name: ARQUIVO,
    imported_details: [
      { ID_Conta: 'acc-xp', Card_Reference_Label: '2026-07', Card_Due_Date: '2026-08-10' },
    ],
  },
] as never[];

const tx = (over: Record<string, unknown>): Transaction =>
  ({ ID_Conta: 'acc-xp', ...over }) as unknown as Transaction;

/** A compra que forma a fatura de 2026-07. */
const compra = tx({
  ID_Transacao: 'compra',
  Origem: ARQUIVO,
  Data: '2026-07-02',
  Valor: -7288.44,
  Tipo: 'Despesa',
  Descricao_Original: 'Compras do ciclo',
});

function cardDe(transactions: Transaction[]) {
  const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
    accountId: account.id,
    account,
    accounts: [account],
    transactions,
    importLogs,
  });
  const card = cards.find((c) => c.referenceMonth === '2026-07');
  expect(card, 'competência 2026-07 não foi montada').toBeDefined();
  return card!;
}

describe('lançamento com competência dirigida não cai entre os dois caminhos', () => {
  /**
   * REGRESSÃO. Marcador + origem de ARQUIVO: recusado pelo caminho de arquivo,
   * antes ignorado pelo caminho manual. Sumia.
   */
  it('estorno dirigido vindo de arquivo é somado exatamente uma vez', () => {
    const card = cardDe([
      compra,
      tx({
        ID_Transacao: 'estorno-dirigido',
        Origem: ARQUIVO,
        Data: '2026-06-22',
        Valor: 30.36,
        Tipo: 'Renda',
        Categoria: 'Estornos/Reembolsos',
        Nome_Fantasia: 'SHOPEE *DOLCEROSE',
        Descricao_Original: 'SHOPEE *DOLCEROSE (2026-07) finelo_competence:2026-07',
      }),
    ]);

    expect(card.totalRefunds).toBeCloseTo(30.36, 2);
    expect(card.statementTotal).toBeCloseTo(7258.08, 2);
  });

  /** Marcador + origem manual: caminho que já funcionava, preservado. */
  it('estorno dirigido lançado por fora continua sendo somado uma vez', () => {
    const card = cardDe([
      compra,
      tx({
        ID_Transacao: 'estorno-manual',
        Origem: 'manual',
        Data: '2026-06-22',
        Valor: 30.36,
        Tipo: 'Renda',
        Categoria: 'Estornos/Reembolsos',
        Nome_Fantasia: 'Estorno loja',
        Descricao_Original: 'Estorno loja finelo_competence:2026-07',
      }),
    ]);

    expect(card.totalRefunds).toBeCloseTo(30.36, 2);
    expect(card.statementTotal).toBeCloseTo(7258.08, 2);
  });

  /** Sem marcador: continua pelo caminho de arquivo, sem passar pelo manual. */
  it('estorno sem marcador continua sendo somado uma vez pelo arquivo', () => {
    const card = cardDe([
      compra,
      tx({
        ID_Transacao: 'estorno-simples',
        Origem: ARQUIVO,
        Data: '2026-07-03',
        Valor: 30.36,
        Tipo: 'Renda',
        Categoria: 'Estornos/Reembolsos',
        Nome_Fantasia: 'Estorno loja',
        Descricao_Original: 'Estorno loja',
      }),
    ]);

    expect(card.totalRefunds).toBeCloseTo(30.36, 2);
    expect(card.statementTotal).toBeCloseTo(7258.08, 2);
  });

  /**
   * A trava que a correção exige. Se a linha dirigida passasse a ser aceita
   * pelos DOIS caminhos, o estorno viraria R$ 60,72 e a fatura encolheria o
   * dobro — trocar um sumiço por uma duplicação não é conserto.
   */
  it('nenhuma linha é contada pelos dois caminhos', () => {
    const dirigido = cardDe([
      compra,
      tx({
        ID_Transacao: 'estorno-dirigido',
        Origem: ARQUIVO,
        Data: '2026-06-22',
        Valor: 30.36,
        Tipo: 'Renda',
        Categoria: 'Estornos/Reembolsos',
        Nome_Fantasia: 'SHOPEE *DOLCEROSE',
        Descricao_Original: 'SHOPEE *DOLCEROSE finelo_competence:2026-07',
      }),
    ]);

    expect(dirigido.totalRefunds).not.toBeCloseTo(60.72, 2);
    expect(dirigido.totalRefunds).toBeCloseTo(30.36, 2);
  });

  /** Pagamento dirigido de arquivo abate a competência apontada, uma vez só. */
  it('pagamento dirigido vindo de arquivo abate a competência uma vez', () => {
    const card = cardDe([
      compra,
      tx({
        ID_Transacao: 'pagto-dirigido',
        Origem: ARQUIVO,
        Data: '2026-08-10',
        Valor: 1000,
        Tipo: 'Renda',
        Categoria: 'Pagamento de Fatura',
        Nome_Fantasia: 'Pagamento de fatura',
        Descricao_Original: 'Pagamento de fatura finelo_competence:2026-07',
      }),
    ]);

    expect(card.totalPayments).toBeCloseTo(1000, 2);
    expect(card.statementTotal).toBeCloseTo(7288.44, 2);
  });

  /** A conta sem nenhum lançamento dirigido não muda de comportamento. */
  it('conta sem marcador algum permanece intacta', () => {
    const card = cardDe([compra]);
    expect(card.statementTotal).toBeCloseTo(7288.44, 2);
    expect(card.totalRefunds).toBeCloseTo(0, 2);
  });
});
