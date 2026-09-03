import { describe, expect, it } from 'vitest';
import { creditCardRebuildFromImportHistoryService } from '../../src/services/creditCardRebuildFromImportHistoryService';
import { projectCardTwoLedger } from '../../src/domain/credit-card/twoLedgerProjection';
import { diagnoseCreditCard } from '../../src/domain/credit-card/cardDiagnostics';
import type { Account, ImportLog, Transaction } from '../../src/types';

/**
 * Regressão de PIPELINE COMPLETO — um arquivo importado sem competência ainda
 * gravada (`imported_details` sem `Card_Reference_Label`), como acontece numa
 * importação nova, tem que chegar à competência certa.
 *
 * ===========================================================================
 * O BUG
 * ===========================================================================
 *
 * `resolveAutomaticCardReferenceMonth` escolhia o MÊS CIVIL da linha mais
 * recente do arquivo. Todo ciclo que fecha no meio do mês atravessa a virada
 * do mês civil por definição — não é uma exceção rara, é a regra para
 * qualquer fechamento que não seja no último dia do mês. Um arquivo cujas
 * compras vão de 11/mai a 09/jun (fechamento dia 11, ciclo de maio) era
 * etiquetado "junho" porque junho aparecia por último.
 *
 * Na conta real que revelou o bug, isso fez um pagamento de R$ 3.663,38 cair
 * numa competência fantasma sem fatura própria — descartada pelo filtro que
 * esconde competências «só pagamento» — enquanto a fatura anterior (a que
 * aquele pagamento deveria explicar) aparecia como «nenhum pagamento
 * encontrado» por R$ 5.163,37 que na verdade tinham sido pagos.
 *
 * Os valores abaixo são sintéticos — a ESTRUTURA (fechamento dia 11, ciclo
 * cruzando mai→jun, competência anterior cheia) é a mesma da conta real.
 */

const ACC = 'acc-ciclo';

const account: Account = {
  id: ACC,
  Nome_Conta: 'Cartão com fechamento no meio do mês',
  Tipo_Conta: 'Cartão de Crédito',
  dia_fechamento: 11,
  dia_vencimento: 18,
  limite_credito: 20000,
} as Account;

let seq = 0;
const tx = (over: Record<string, unknown>): Transaction => {
  seq += 1;
  return { ID_Transacao: `t-${seq}`, ID_Conta: ACC, ...over } as unknown as Transaction;
};

const compra = (data: string, valor: number, origem: string) =>
  tx({ Origem: origem, Data: data, Valor: -Math.abs(valor), Tipo: 'Despesa', Descricao_Original: 'Compra' });
const pagamento = (data: string, valor: number, origem: string) =>
  tx({
    Origem: origem,
    Data: data,
    Valor: Math.abs(valor),
    Tipo: 'Renda',
    Categoria: 'Pagamento de Fatura',
    Descricao_Original: 'Pagamento recebido',
  });

describe('importação sem competência gravada respeita o ciclo de fechamento', () => {
  /**
   * Reproduz a estrutura da conta real: um arquivo cujo conteúdo é o ciclo
   * de abril (fecha em maio) seguido de um arquivo cujo conteúdo é o ciclo
   * de maio (fecha em junho) — SEM Card_Reference_Label pré-gravado, como
   * numa importação nova. Nenhum dos dois nomes de arquivo declara vencimento
   * no nome: o teste força a passar pelo FALLBACK de conteúdo, não pela
   * leitura direta do nome.
   */
  const ARQ_ABRIL = 'extrato_A.csv';
  const ARQ_MAIO = 'extrato_B.csv';

  // `imported_details` espelha o snapshot por linha que o importador real
  // grava (Data/Valor de cada lançamento) — é dele que o fallback de
  // conteúdo lê as datas quando não há Card_Reference_Label ainda.
  const importLogs: ImportLog[] = [
    {
      id: 'log-a',
      file_name: ARQ_ABRIL,
      imported_details: [
        { ID_Conta: ACC, Data: '2026-04-13', Valor: -3000 },
        { ID_Conta: ACC, Data: '2026-05-10', Valor: -2163.37 },
      ],
    },
    {
      id: 'log-b',
      file_name: ARQ_MAIO,
      imported_details: [
        { ID_Conta: ACC, Data: '2026-05-11', Valor: -2000 },
        { ID_Conta: ACC, Data: '2026-06-09', Valor: -1751.2 },
      ],
    },
  ] as never[];

  const transactions: Transaction[] = [
    // Ciclo de abril: fecha 11/mai. Sem pagamento próprio neste arquivo —
    // quem paga esta fatura é o pagamento dentro do arquivo SEGUINTE.
    compra('2026-04-13', 3000, ARQ_ABRIL),
    compra('2026-05-10', 2163.37, ARQ_ABRIL),
    // Ciclo de maio: fecha 11/jun. Contém o pagamento que quita abril.
    compra('2026-05-11', 2000, ARQ_MAIO),
    compra('2026-06-09', 1751.2, ARQ_MAIO),
    pagamento('2026-05-18', 5163.37, ARQ_MAIO),
  ];

  const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
    accountId: ACC, account, accounts: [account], transactions, importLogs,
  });
  const porRef = new Map(cards.map((c) => [c.referenceMonth, c]));

  it('o arquivo de abril fica em 2026-04, não 2026-05', () => {
    const abril = porRef.get('2026-04');
    expect(abril, 'competência 2026-04 não foi montada').toBeDefined();
    expect(abril!.statementTotal).toBeCloseTo(5163.37, 2);
  });

  it('o arquivo de maio fica em 2026-05, não 2026-06', () => {
    const maio = porRef.get('2026-05');
    expect(maio, 'competência 2026-05 não foi montada — sinal do bug antigo').toBeDefined();
    expect(maio!.statementTotal).toBeCloseTo(3751.2, 2);
  });

  it('nenhuma competência fantasma nasce em 2026-06', () => {
    // Era exatamente aqui que o pagamento de maio se perdia: etiquetado
    // "2026-06" (mês da linha mais recente), sem fatura própria, descartado
    // pelo filtro de competência-fantasma.
    expect(porRef.has('2026-06')).toBe(false);
  });

  it('o pagamento de maio explica a fatura de abril — sem "sem pagamento"', () => {
    const p = projectCardTwoLedger(cards, { asOf: '2026-09-03' });
    const abril = p.competences.find((c) => c.referenceMonth === '2026-04')!;

    expect(abril.economicOpenBalanceCents).toBe(0);
    expect(abril.economicStatus).toBe('paid');

    const achados = diagnoseCreditCard({
      competences: p.competences,
      reconciliation: { pendente: p.reconciliationPending, referenceMonth: null },
    });
    expect(achados.some((a) => a.code === 'fatura_sem_pagamento_encontrado')).toBe(false);
  });
});

describe('vencimento no nome do arquivo (padrão Nubank) é autoritativo', () => {
  /**
   * `Cartao_2026-06-18.csv` — o próprio nome declara o vencimento. Isto tem
   * que resolver a competência CORRETA mesmo sem passar `dia_fechamento`
   * nenhum: não é um fallback de conteúdo, é leitura do que o arquivo disse.
   */
  const ARQUIVO = 'Cartao_2026-06-18.csv';
  const importLogs: ImportLog[] = [
    { id: 'log', file_name: ARQUIVO, imported_details: [{ ID_Conta: ACC }] },
  ] as never[];

  const transactions: Transaction[] = [
    compra('2026-05-11', 2000, ARQUIVO),
    compra('2026-06-09', 1751.2, ARQUIVO),
  ];

  it('resolve para 2026-05, não 2026-06, mesmo sem informar o fechamento', () => {
    // account sem dia_fechamento explícito — só o nome do arquivo decide.
    const contaSemFechamento = { ...account, dia_fechamento: undefined } as Account;
    const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: ACC, account: contaSemFechamento, accounts: [contaSemFechamento], transactions, importLogs,
    });
    const maio = cards.find((c) => c.referenceMonth === '2026-05');
    expect(maio, 'o nome do arquivo devia ter resolvido sozinho').toBeDefined();
    expect(cards.some((c) => c.referenceMonth === '2026-06')).toBe(false);
  });
});

describe('competência já gravada nunca é recalculada', () => {
  /**
   * Um arquivo com `Card_Reference_Label` já persistido (o caso de TODA
   * importação antiga, inclusive as que já saíram erradas) não passa pelo
   * conserto — ele lê o que já está gravado. A correção vale para
   * importações NOVAS; dados históricos exigem migração à parte (Fase 3).
   */
  const ARQUIVO = 'extrato_velho.csv';
  const importLogs: ImportLog[] = [
    {
      id: 'log',
      file_name: ARQUIVO,
      imported_details: [{ ID_Conta: ACC, Card_Reference_Label: '2026-06', Card_Due_Date: '2026-07-18' }],
    },
  ] as never[];
  const transactions: Transaction[] = [compra('2026-05-11', 2000, ARQUIVO)];

  it('mantém o rótulo gravado, mesmo sabendo o fechamento', () => {
    const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
      accountId: ACC, account, accounts: [account], transactions, importLogs,
    });
    expect(cards.some((c) => c.referenceMonth === '2026-06')).toBe(true);
    expect(cards.some((c) => c.referenceMonth === '2026-05')).toBe(false);
  });
});
