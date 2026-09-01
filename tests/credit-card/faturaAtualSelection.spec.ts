import { describe, expect, it } from 'vitest';
import {
  parseDueFromReferenceMonth,
  pickCurrentCompetenceCard,
  pickFaturaAtualCompetenceCard,
  competenceFaturaAtualDisplayAmount,
  competenceAmountDue,
} from '../../src/services/creditCardManualCompetence';
import type { CompetenceHistoryCard } from '../../src/services/creditCardRebuildFromImportHistoryService';

/**
 * Regra de produto da «Fatura Atual» do card de cartão:
 *
 *   1. se houver fatura vencida ainda em aberto, ela tem prioridade;
 *   2. caso contrário, mostra a próxima fatura em aberto a vencer;
 *   3. lançamentos, parcelas ou compromissos de competências futuras NÃO devem
 *      fazer o campo pular para meses futuros.
 *
 * «Fatura Atual» e «Uso do Limite» respondem perguntas diferentes e, de propósito,
 * não cobrem o mesmo conjunto de competências: o limite soma tudo que está em aberto,
 * inclusive o futuro; a fatura atual mostra só a que importa agora.
 */

const DIA_VENCIMENTO = 28;
const HOJE = '2026-08-31';

function competencia(
  referenceMonth: string,
  statementTotal: number,
  openBalance: number,
  over: Partial<CompetenceHistoryCard> = {}
): CompetenceHistoryCard {
  return {
    referenceMonth,
    competenceBR: referenceMonth,
    dueDate: parseDueFromReferenceMonth(referenceMonth, DIA_VENCIMENTO),
    vencimentoBR: '',
    dueYear: Number(referenceMonth.slice(0, 4)),
    dueMonth: Number(referenceMonth.slice(5, 7)),
    files: [{ fileName: 'Lançamentos manuais', transactionCount: 1, statementTotal, totalPayments: 0 }],
    totalDebits: statementTotal,
    totalRefunds: 0,
    statementTotal,
    totalPayments: Math.max(0, statementTotal - openBalance),
    openBalanceBeforeCarry: openBalance,
    priorCreditApplied: 0,
    openBalance,
    creditCarriedForward: 0,
    ...over,
  };
}

const importada = (ref: string, total: number, aberto: number) =>
  competencia(ref, total, aberto, {
    files: [{ fileName: `fatura_${ref}.csv`, transactionCount: 3, statementTotal: total, totalPayments: 0 }],
  });

const mista = (ref: string, total: number, aberto: number) =>
  competencia(ref, total, aberto, {
    files: [
      { fileName: `fatura_${ref}.csv`, transactionCount: 3, statementTotal: total * 0.8, totalPayments: 0 },
      { fileName: 'Lançamentos manuais', transactionCount: 1, statementTotal: total * 0.2, totalPayments: 0 },
    ],
  });

/** O cartão STG-CLAUDE de staging, como estava quando a inconsistência foi observada. */
function cenarioReal(): CompetenceHistoryCard[] {
  return [
    competencia('2026-06', 300, 0),
    competencia('2026-07', 400, 200),
    competencia('2026-08', 350, 150),
    competencia('2026-09', 600, 0),
    competencia('2026-10', 200, 200),
  ];
}

describe('regra nova: fatura operacionalmente relevante', () => {
  it('o cenário real deixa de apontar para outubro', () => {
    const escolhida = pickCurrentCompetenceCard(cenarioReal(), HOJE);

    expect(escolhida?.referenceMonth).not.toBe('2026-10');
    // Julho venceu em 28/08 e ainda tem 200 em aberto: é a vencida mais antiga.
    expect(escolhida?.referenceMonth).toBe('2026-07');
    expect(escolhida?.dueDate).toBe('2026-08-28');
  });

  it('o pagamento parcial já feito aparece no saldo da fatura escolhida', () => {
    const escolhida = pickCurrentCompetenceCard(cenarioReal(), HOJE)!;

    // Julho: fatura de 400, 200 já abatidos, restam 200.
    expect(escolhida.statementTotal).toBe(400);
    expect(competenceAmountDue(escolhida)).toBe(200);
  });

  it('a regra antiga e a nova discordam exatamente neste ponto', () => {
    const cards = cenarioReal();
    expect(pickFaturaAtualCompetenceCard(cards, HOJE)?.referenceMonth).toBe('2026-10');
    expect(pickCurrentCompetenceCard(cards, HOJE)?.referenceMonth).toBe('2026-07');
  });
});

describe('cenário: fatura vencida e não paga + compras futuras', () => {
  it('a vencida tem prioridade sobre qualquer compromisso futuro', () => {
    const cards = [
      competencia('2026-06', 500, 500), // venceu 28/07, em aberto
      competencia('2027-03', 80, 80), // compra lançada para o futuro
      competencia('2027-12', 40, 40), // outra, mais distante ainda
    ];

    expect(pickCurrentCompetenceCard(cards, HOJE)?.referenceMonth).toBe('2026-06');
  });

  it('havendo várias vencidas em aberto, mostra a mais antiga', () => {
    const cards = [
      competencia('2026-05', 100, 100), // venceu 28/06
      competencia('2026-06', 500, 500), // venceu 28/07
      competencia('2026-07', 250, 250), // venceu 28/08
    ];

    expect(pickCurrentCompetenceCard(cards, HOJE)?.referenceMonth).toBe('2026-05');
  });
});

describe('cenário: fatura corrente parcialmente paga + parcelas futuras', () => {
  it('parcelamento de 12x não desloca o campo para a última parcela', () => {
    const parcelas: CompetenceHistoryCard[] = [];
    for (let i = 0; i < 12; i++) {
      const mes = 8 + i;
      const ano = 2026 + Math.floor((mes - 1) / 12);
      const mm = String(((mes - 1) % 12) + 1).padStart(2, '0');
      // A primeira parcela está parcialmente paga (100 de fatura, 60 em aberto).
      parcelas.push(competencia(`${ano}-${mm}`, 100, i === 0 ? 60 : 100));
    }

    const escolhida = pickCurrentCompetenceCard(parcelas, HOJE)!;

    expect(escolhida.referenceMonth).toBe('2026-08');
    expect(competenceAmountDue(escolhida)).toBe(60);

    // A regra antiga apontaria para a 12ª parcela.
    expect(pickFaturaAtualCompetenceCard(parcelas, HOJE)?.referenceMonth).toBe('2027-07');
  });
});

describe('cenário: fatura corrente quitada + próxima com compras', () => {
  it('pula a quitada e mostra a próxima em aberto', () => {
    const cards = [
      competencia('2026-08', 350, 0), // vence 28/09, quitada
      competencia('2026-09', 600, 600), // vence 28/10, em aberto
    ];

    expect(pickCurrentCompetenceCard(cards, HOJE)?.referenceMonth).toBe('2026-09');
  });

  it('com tudo quitado, ainda mostra o ciclo corrente em vez de nada', () => {
    const cards = [
      competencia('2026-08', 350, 0),
      competencia('2026-09', 600, 0),
    ];

    // Nenhuma em aberto: cai no ciclo mais próximo a vencer.
    const escolhida = pickCurrentCompetenceCard(cards, HOJE);
    expect(escolhida?.referenceMonth).toBe('2026-08');
    expect(competenceAmountDue(escolhida!)).toBe(0);
  });
});

describe('cenário: várias competências futuras', () => {
  it('nenhuma delas assume o campo enquanto houver fatura corrente em aberto', () => {
    const cards = [
      competencia('2026-08', 350, 350), // vence 28/09 — a corrente
      competencia('2026-11', 90, 90),
      competencia('2027-01', 120, 120),
      competencia('2027-06', 45, 45),
      competencia('2028-02', 10, 10),
    ];

    expect(pickCurrentCompetenceCard(cards, HOJE)?.referenceMonth).toBe('2026-08');
  });

  it('só com competências futuras, mostra a que vence primeiro', () => {
    const cards = [
      competencia('2027-06', 45, 45),
      competencia('2026-11', 90, 90),
      competencia('2028-02', 10, 10),
    ];

    expect(pickCurrentCompetenceCard(cards, HOJE)?.referenceMonth).toBe('2026-11');
  });
});

describe('a regra não depende da origem dos lançamentos', () => {
  it('cartão 100% manual', () => {
    const cards = [competencia('2026-07', 400, 200), competencia('2026-12', 90, 90)];
    expect(pickCurrentCompetenceCard(cards, HOJE)?.referenceMonth).toBe('2026-07');
  });

  it('cartão com fatura importada', () => {
    const cards = [importada('2026-07', 400, 200), importada('2026-12', 90, 90)];
    expect(pickCurrentCompetenceCard(cards, HOJE)?.referenceMonth).toBe('2026-07');
  });

  it('cartão misto manual + importado', () => {
    const cards = [mista('2026-07', 400, 200), mista('2026-12', 90, 90)];
    const escolhida = pickCurrentCompetenceCard(cards, HOJE)!;
    expect(escolhida.referenceMonth).toBe('2026-07');
    expect(escolhida.files.map((f) => f.fileName)).toEqual([
      'fatura_2026-07.csv',
      'Lançamentos manuais',
    ]);
  });
});

describe('«Fatura Atual» e «Uso do Limite» respondem perguntas diferentes', () => {
  it('o futuro fica fora da fatura atual mas dentro do limite utilizado', () => {
    const cards = cenarioReal();

    const faturaAtual = pickCurrentCompetenceCard(cards, HOJE)!;
    const limiteUtilizado = cards.reduce((soma, c) => soma + Math.max(c.openBalance, 0), 0);

    // Fatura atual: só julho, 200 em aberto de uma fatura de 400.
    expect(faturaAtual.referenceMonth).toBe('2026-07');
    expect(competenceFaturaAtualDisplayAmount(faturaAtual)).toBe(400);

    // Limite utilizado: julho 200 + agosto 150 + outubro 200 = 550.
    expect(Math.round(limiteUtilizado * 100) / 100).toBe(550);
    expect(limiteUtilizado).toBeGreaterThan(competenceAmountDue(faturaAtual));
  });
});

describe('dependência da data', () => {
  it('conforme o tempo passa, a corrente vira vencida e depois cede lugar à seguinte', () => {
    const cards = [
      competencia('2026-08', 350, 350), // vence 28/09
      competencia('2026-09', 600, 600), // vence 28/10
    ];

    // Antes de 28/09: nenhuma vencida, mostra a que vence primeiro.
    expect(pickCurrentCompetenceCard(cards, '2026-09-01')?.referenceMonth).toBe('2026-08');
    // Depois de 28/09: agosto virou vencida em aberto e tem prioridade.
    expect(pickCurrentCompetenceCard(cards, '2026-10-01')?.referenceMonth).toBe('2026-08');
    // Quitando agosto, setembro assume.
    const quitada = [competencia('2026-08', 350, 0), cards[1]];
    expect(pickCurrentCompetenceCard(quitada, '2026-10-01')?.referenceMonth).toBe('2026-09');
  });

  it('sem competência nenhuma, não há fatura atual', () => {
    expect(pickCurrentCompetenceCard([], HOJE)).toBeUndefined();
  });
});
