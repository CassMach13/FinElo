import { describe, expect, it } from 'vitest';
import {
  parseDueFromReferenceMonth,
  pickFaturaAtualCompetenceCard,
  pickCurrentCompetenceCard,
  competenceFaturaAtualDisplayAmount,
} from '../../src/services/creditCardManualCompetence';
import type { CompetenceHistoryCard } from '../../src/services/creditCardRebuildFromImportHistoryService';

/**
 * CARACTERIZAÇÃO — descreve o que o código faz hoje, não o que deveria fazer.
 *
 * Investigação do campo «FATURA ATUAL» do card de cartão. Nenhuma regra de negócio foi
 * alterada: estes testes existem para tornar a regra atual visível e reproduzível antes
 * de qualquer decisão de produto.
 *
 * O cartão real que motivou a investigação (`STG-CLAUDE Cartao Manual`, vencimento dia 28)
 * exibia «FATURA ATUAL R$ 200» com hoje = 2026-08-31, sendo que R$ 200 é a competência
 * de **outubro** — dois ciclos à frente do ciclo corrente.
 */

const DIA_VENCIMENTO = 28;

function competencia(referenceMonth: string, statementTotal: number, openBalance: number): CompetenceHistoryCard {
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
  };
}

/** Exatamente o cartão STG-CLAUDE, como estava em staging. */
function cartaoDoCenarioReal(): CompetenceHistoryCard[] {
  return [
    competencia('2026-06', 300, 0),
    competencia('2026-07', 400, 200),
    competencia('2026-08', 350, 150),
    competencia('2026-09', 600, 0),
    competencia('2026-10', 200, 200),
  ];
}

describe('qual competência o card chama de «Fatura Atual»', () => {
  const HOJE = '2026-08-31';

  it('reproduz o caso observado: escolhe outubro, não o ciclo corrente', () => {
    const escolhida = pickFaturaAtualCompetenceCard(cartaoDoCenarioReal(), HOJE);

    expect(escolhida?.referenceMonth).toBe('2026-10');
    expect(competenceFaturaAtualDisplayAmount(escolhida!)).toBe(200);
  });

  it('a competência escolhida vence quase três meses depois de hoje', () => {
    const escolhida = pickFaturaAtualCompetenceCard(cartaoDoCenarioReal(), HOJE);

    // Competência 2026-10 vence em 28/11/2026, com hoje em 31/08/2026.
    expect(escolhida?.dueDate).toBe('2026-11-28');
    expect(escolhida!.dueDate > HOJE).toBe(true);
  });

  it('a regra é «a maior competência com saldo relevante», não «a que vence primeiro»', () => {
    const cards = cartaoDoCenarioReal();
    const escolhida = pickFaturaAtualCompetenceCard(cards, HOJE);

    const emAbertoAVencer = cards
      .filter((c) => c.openBalance > 0.005 && c.dueDate >= HOJE)
      .map((c) => c.referenceMonth)
      .sort();

    // Agosto e outubro estão em aberto e a vencer. A escolhida é a MAIOR.
    expect(emAbertoAVencer).toEqual(['2026-08', '2026-10']);
    expect(escolhida?.referenceMonth).toBe('2026-10');

    // A que vence primeiro seria agosto (28/09), e não é a escolhida.
    const queVenceAntes = cards
      .filter((c) => c.openBalance > 0.005 && c.dueDate >= HOJE)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    expect(queVenceAntes.referenceMonth).toBe('2026-08');
    expect(escolhida?.referenceMonth).not.toBe(queVenceAntes.referenceMonth);
  });

  it('competência quitada é ignorada mesmo sendo a maior', () => {
    // Setembro (600) está quitado; por isso outubro venceu a disputa, e não setembro.
    const cards = cartaoDoCenarioReal();
    expect(cards.find((c) => c.referenceMonth === '2026-09')!.openBalance).toBe(0);
    expect(pickFaturaAtualCompetenceCard(cards, HOJE)?.referenceMonth).toBe('2026-10');
  });
});

describe('efeito de lançamentos em meses futuros', () => {
  const HOJE = '2026-08-31';

  it('uma única compra futura desloca a «Fatura Atual» para o futuro distante', () => {
    const semFuturo = [competencia('2026-08', 350, 350)];
    expect(pickFaturaAtualCompetenceCard(semFuturo, HOJE)?.referenceMonth).toBe('2026-08');

    // Mesmo cartão, mais uma compra lançada para dezembro de 2027.
    const comFuturo = [...semFuturo, competencia('2027-12', 50, 50)];
    const escolhida = pickFaturaAtualCompetenceCard(comFuturo, HOJE);

    expect(escolhida?.referenceMonth).toBe('2027-12');
    expect(competenceFaturaAtualDisplayAmount(escolhida!)).toBe(50);
  });

  it('parcelamento longo faz a «Fatura Atual» apontar para a última parcela', () => {
    // Compra de 1.200 em 12x de 100, começando no ciclo corrente.
    const parcelas: CompetenceHistoryCard[] = [];
    for (let i = 0; i < 12; i++) {
      const mes = 8 + i;
      const ano = 2026 + Math.floor((mes - 1) / 12);
      const mm = String(((mes - 1) % 12) + 1).padStart(2, '0');
      parcelas.push(competencia(`${ano}-${mm}`, 100, 100));
    }

    const escolhida = pickFaturaAtualCompetenceCard(parcelas, HOJE);

    // Aponta para a 12ª parcela, não para a que está vencendo agora.
    expect(escolhida?.referenceMonth).toBe('2027-07');
    expect(competenceFaturaAtualDisplayAmount(escolhida!)).toBe(100);
    expect(parcelas[0].referenceMonth).toBe('2026-08');
  });
});

describe('as duas seletoras do módulo discordam entre si', () => {
  const HOJE = '2026-08-31';

  /**
   * `pickCurrentCompetenceCard` existe no mesmo arquivo, ordena por vencimento
   * ASCENDENTE e prioriza a vencida mais antiga. O comentário dela diz, literalmente,
   * que serve para «evitar que lançamentos manuais futuros (ex. 2027) ocultem extrato
   * importado vencido» — exatamente o efeito observado aqui.
   *
   * Ela NÃO é usada em lugar nenhum de `src/`. Quem alimenta o card é a outra.
   */
  it('pickCurrentCompetenceCard escolheria o ciclo corrente; a usada no card escolhe o futuro', () => {
    const cards = cartaoDoCenarioReal();

    const usadaNoCard = pickFaturaAtualCompetenceCard(cards, HOJE);
    const naoUsada = pickCurrentCompetenceCard(cards, HOJE);

    expect(usadaNoCard?.referenceMonth).toBe('2026-10');
    expect(naoUsada?.referenceMonth).toBe('2026-07');
    expect(usadaNoCard?.referenceMonth).not.toBe(naoUsada?.referenceMonth);
  });

  it('com fatura vencida em aberto, a discordância fica mais visível', () => {
    const cards = [
      competencia('2026-06', 500, 500), // venceu 28/07, ainda em aberto
      competencia('2027-03', 80, 80), // compra lançada para o futuro
    ];

    // A vencida e não paga é junho. A usada no card mostra a de 2027.
    expect(pickCurrentCompetenceCard(cards, HOJE)?.referenceMonth).toBe('2026-06');
    expect(pickFaturaAtualCompetenceCard(cards, HOJE)?.referenceMonth).toBe('2027-03');
  });
});

describe('«Fatura Atual» exibe o total bruto, não o saldo devedor', () => {
  it('mostra statementTotal mesmo quando parte já foi paga', () => {
    // Fatura de 400 com 200 já abatidos por crédito: devedor é 200.
    const card = competencia('2026-10', 400, 200);

    expect(competenceFaturaAtualDisplayAmount(card)).toBe(400);
    expect(card.openBalance).toBe(200);
  });

  it('cai para o saldo devedor apenas quando não há total de fatura', () => {
    const card = competencia('2026-10', 0, 150);
    expect(competenceFaturaAtualDisplayAmount(card)).toBe(150);
  });
});

describe('dependência da data de hoje', () => {
  it('a escolha muda conforme o dia, mesmo com os dados idênticos', () => {
    const cards = [
      competencia('2026-06', 300, 300), // vence 28/07
      competencia('2026-08', 350, 350), // vence 28/09
    ];

    // Antes de 28/07: ambas a vencer -> pega a maior competência.
    expect(pickFaturaAtualCompetenceCard(cards, '2026-07-01')?.referenceMonth).toBe('2026-08');

    // Depois de 28/09: ambas vencidas -> cai no ramo de vencidas, ainda pela maior.
    expect(pickFaturaAtualCompetenceCard(cards, '2026-10-01')?.referenceMonth).toBe('2026-08');

    // Entre as duas: junho já venceu, agosto ainda não. O ramo «a vencer» tem
    // prioridade sobre o de vencidas, então a vencida em aberto não é exibida.
    expect(pickFaturaAtualCompetenceCard(cards, '2026-08-15')?.referenceMonth).toBe('2026-08');
  });

  it('sem nenhuma competência em aberto, não há «Fatura Atual»', () => {
    const cards = [competencia('2026-06', 300, 0), competencia('2026-07', 400, 0)];
    expect(pickFaturaAtualCompetenceCard(cards, '2026-08-31')).toBeUndefined();
  });
});
