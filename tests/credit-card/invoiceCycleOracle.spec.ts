import { describe, expect, it } from 'vitest';
import {
  referenceMonthFromTransaction,
  parseDueFromReferenceMonth,
  MANUAL_COMPETENCE_FILE_LABEL,
} from '../../src/services/creditCardManualCompetence';
import {
  applySequentialCreditCarryForward,
  MICRO_SURPLUS_CARRY_MAX,
} from '../../src/services/creditCardRebuildFromImportHistoryService';
import type { CompetenceHistoryCard } from '../../src/services/creditCardRebuildFromImportHistoryService';
import type { Account, Transaction } from '../../src/types';

const round2 = (v: number) => Math.round(v * 100) / 100;

function makeCard(over: Partial<Account> = {}): Account {
  return {
    id: 'card-1',
    user_id: 'u1',
    Nome_Conta: 'Cartão Teste',
    Tipo_Conta: 'Cartão de Crédito',
    Saldo_Inicial: 0,
    Data_Saldo_Inicial: new Date('2026-01-01'),
    limite_credito: 10000,
    dia_fechamento: 25,
    dia_vencimento: 5,
    ...over,
  } as Account;
}

function compra(dataIso: string, valor = 100): Transaction {
  return {
    ID_Transacao: `tx-${dataIso}-${valor}`,
    ID_Conta: 'card-1',
    Data: new Date(`${dataIso}T12:00:00`),
    Descricao_Original: 'Compra teste',
    Nome_Fantasia: 'Loja',
    Valor: -Math.abs(valor),
    Tipo: 'Despesa',
    Categoria: 'Compras',
    Origem: 'manual',
    Fonte: 'manual',
  } as Transaction;
}

/**
 * Regra documentada em docs/cartao-v2-prd-implantacao.md:
 *
 *   "a data de fechamento varia mês a mês e a data de vencimento é fixa. Portanto,
 *    o cálculo não pode depender de fechamento fixo no cadastro da conta."
 *
 * Ou seja, a competência de um lançamento manual é o mês-calendário da compra, de
 * propósito. O `dia_fechamento` cadastrado é informativo (exibido como "Fecha dia N")
 * e deliberadamente NÃO reposiciona lançamentos entre faturas — quem define o recorte
 * real de uma fatura fechada é o arquivo importado.
 *
 * Estes testes fixam essa decisão para que ninguém a reverta por engano ao "corrigir"
 * o ciclo: mudar isso reescreveria retroativamente a fatura de todo lançamento manual
 * já registrado.
 */
describe('competência de lançamento manual segue o mês da compra, por decisão de produto', () => {
  const card = makeCard({ dia_fechamento: 25, dia_vencimento: 5 });

  ['2026-07-01', '2026-07-10', '2026-07-24', '2026-07-25', '2026-07-26', '2026-07-31'].forEach(
    (data) => {
      it(`compra em ${data} cai na competência 2026-07 independentemente do fechamento`, () => {
        expect(referenceMonthFromTransaction(compra(data), card)).toBe('2026-07');
      });
    }
  );

  it('o dia de fechamento cadastrado não altera a competência', () => {
    const fecha3 = makeCard({ dia_fechamento: 3 });
    const fecha28 = makeCard({ dia_fechamento: 28 });
    const mesma = compra('2026-07-15');
    expect(referenceMonthFromTransaction(mesma, fecha3)).toBe(
      referenceMonthFromTransaction(mesma, fecha28)
    );
  });

  it('a virada de ano não desloca a competência', () => {
    expect(referenceMonthFromTransaction(compra('2027-01-05'), card)).toBe('2027-01');
  });
});

describe('vencimento derivado da competência', () => {
  it('competência M vence em M+1', () => {
    expect(parseDueFromReferenceMonth('2026-07', 10)).toBe('2026-08-10');
  });

  it('dezembro vira janeiro do ano seguinte', () => {
    expect(parseDueFromReferenceMonth('2026-12', 10)).toBe('2027-01-10');
  });

  it('vencimento no dia 30 não é truncado', () => {
    expect(parseDueFromReferenceMonth('2026-07', 30)).toBe('2026-08-30');
  });

  it('fevereiro ajusta para o último dia existente', () => {
    expect(parseDueFromReferenceMonth('2027-01', 30)).toBe('2027-02-28');
  });

  it('fevereiro bissexto aceita o dia 29', () => {
    expect(parseDueFromReferenceMonth('2028-01', 30)).toBe('2028-02-29');
  });
});

// ---------------------------------------------------------------------------

let refSeq = 0;
function competencia(over: Partial<CompetenceHistoryCard> = {}): CompetenceHistoryCard {
  refSeq += 1;
  const referenceMonth = over.referenceMonth || `2026-${String(refSeq).padStart(2, '0')}`;
  return {
    referenceMonth,
    competenceBR: referenceMonth,
    dueDate: parseDueFromReferenceMonth(referenceMonth, 10),
    vencimentoBR: '',
    dueYear: Number(referenceMonth.slice(0, 4)),
    dueMonth: Number(referenceMonth.slice(5, 7)),
    files: [
      {
        fileName: 'fatura_importada.csv',
        transactionCount: 1,
        statementTotal: over.statementTotal ?? 0,
        totalPayments: over.totalPayments ?? 0,
      },
    ],
    totalDebits: over.statementTotal ?? 0,
    totalRefunds: 0,
    statementTotal: 0,
    totalPayments: 0,
    openBalanceBeforeCarry: 0,
    priorCreditApplied: 0,
    openBalance: 0,
    creditCarriedForward: 0,
    ...over,
  };
}

/** Mesma competência, porém sem nenhum arquivo importado (só lançamentos manuais). */
function competenciaManual(over: Partial<CompetenceHistoryCard> = {}): CompetenceHistoryCard {
  const base = competencia(over);
  return {
    ...base,
    files: [
      {
        fileName: MANUAL_COMPETENCE_FILE_LABEL,
        transactionCount: 1,
        statementTotal: base.statementTotal,
        totalPayments: base.totalPayments,
      },
    ],
  };
}

describe('oráculo: crédito de pagamento a maior entre competências', () => {
  it('excesso pago numa fatura importada abate a competência seguinte', () => {
    const cards = [
      competencia({ referenceMonth: '2026-06', statementTotal: 300, totalPayments: 500 }),
      competencia({ referenceMonth: '2026-07', statementTotal: 400, totalPayments: 0 }),
    ];

    applySequentialCreditCarryForward(cards);

    // Oráculo: gastou 300+400=700, pagou 500, logo deve 200.
    const jun = cards[0];
    const jul = cards[1];
    expect(jun.openBalance).toBe(0);
    expect(jul.priorCreditApplied).toBe(200);
    expect(jul.openBalance).toBe(200);

    const somaEmAberto = round2(jun.openBalance + jul.openBalance);
    expect(somaEmAberto).toBe(200);
  });

  it('excesso menor que o limiar de ruído não vira crédito', () => {
    const cards = [
      competencia({ referenceMonth: '2026-06', statementTotal: 300, totalPayments: 300.5 }),
      competencia({ referenceMonth: '2026-07', statementTotal: 400, totalPayments: 0 }),
    ];

    applySequentialCreditCarryForward(cards);

    // 0,50 < MICRO_SURPLUS_CARRY_MAX: diferença de arredondamento, não crédito real.
    expect(MICRO_SURPLUS_CARRY_MAX).toBe(1);
    expect(cards[1].priorCreditApplied).toBe(0);
    expect(cards[1].openBalance).toBe(400);
  });

  it('crédito atravessa mais de uma competência até se esgotar', () => {
    const cards = [
      competencia({ referenceMonth: '2026-06', statementTotal: 100, totalPayments: 600 }),
      competencia({ referenceMonth: '2026-07', statementTotal: 200, totalPayments: 0 }),
      competencia({ referenceMonth: '2026-08', statementTotal: 400, totalPayments: 0 }),
    ];

    applySequentialCreditCarryForward(cards);

    // Oráculo: crédito de 500. Julho consome 200, sobra 300. Agosto consome 300 dos 400.
    expect(cards[1].priorCreditApplied).toBe(200);
    expect(cards[1].openBalance).toBe(0);
    expect(cards[2].priorCreditApplied).toBe(300);
    expect(cards[2].openBalance).toBe(100);

    // Total devido = 700 gastos - 600 pagos = 100.
    const somaEmAberto = round2(
      cards.reduce((acc, c) => acc + Math.max(c.openBalance, 0), 0)
    );
    expect(somaEmAberto).toBe(100);
  });

  it('cartão só com lançamentos manuais também precisa preservar o excesso pago', () => {
    const cards = [
      competenciaManual({ referenceMonth: '2026-06', statementTotal: 300, totalPayments: 500 }),
      competenciaManual({ referenceMonth: '2026-07', statementTotal: 400, totalPayments: 0 }),
    ];

    applySequentialCreditCarryForward(cards);

    // Oráculo: gastou 700, pagou 500, deve 200. O fato de não haver CSV importado
    // não faz o dinheiro pago desaparecer.
    const somaEmAberto = round2(
      cards.reduce((acc, c) => acc + Math.max(c.openBalance, 0), 0)
    );
    expect(somaEmAberto).toBe(200);
  });

  it('pagamento numa competência sem fatura não inventa crédito', () => {
    // Proteção original: pagamento redirecionado para um mês sem fatura nenhuma.
    const cards = [
      competenciaManual({ referenceMonth: '2026-06', statementTotal: 0, totalPayments: 500 }),
      competenciaManual({ referenceMonth: '2026-07', statementTotal: 400, totalPayments: 0 }),
    ];

    applySequentialCreditCarryForward(cards);

    expect(cards[1].priorCreditApplied).toBe(0);
    expect(cards[1].openBalance).toBe(400);
  });
});
