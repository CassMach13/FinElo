/**
 * Uma fonte só para «saldo em aberto».
 *
 * O card e o Histórico mostravam obrigações diferentes para a mesma competência.
 * Não era arredondamento: eram DOIS cálculos. O card projeta pelos dois livros;
 * o histórico exibia o `openBalance` que `applySequentialCreditCarryForward`
 * produz — um carry legado que empurra excedente para os meses seguintes sem
 * perguntar procedência nem liquidação.
 *
 * Enquanto os dois abatiam, coincidiam por acaso. Quando a fronteira dos livros
 * passou a exigir liquidação observada, o card passou a dizer R$ 400,00 e o
 * histórico continuou dizendo R$ 200,00 sobre a mesma fatura.
 *
 * Este módulo não recalcula nada: ele toma a projeção econômica canônica — a
 * mesma que alimenta valor, limite, status e «A CONCILIAR» — e a usa como fonte
 * do que o histórico exibe. O algoritmo dos dois livros continua existindo em um
 * lugar só.
 *
 * O TOTAL da fatura não é tocado: continua sendo o statement, que é outra
 * pergunta («quanto o emissor cobrou») e não deve seguir a obrigação.
 *
 * A direção da dependência importa: a superfície consome a projeção, e a
 * projeção não conhece a superfície. `applySequentialCreditCarryForward` segue
 * intacta para quem ainda depende dela.
 */

import type { CompetenceHistoryCard } from '../../services/creditCardRebuildFromImportHistoryService';
import {
  centsToCurrency,
  projectCardTwoLedger,
} from '../../domain/credit-card/twoLedgerProjection';
import type { ReconciliationResolutionInput } from '../../domain/credit-card/twoLedgerBalance';

export interface EconomicSourceOptions {
  /** 'YYYY-MM-DD'. Só distingue vencida de a vencer; não muda saldo. */
  asOf?: string;
  /**
   * As MESMAS resoluções que o card projeta. Sem elas, resolver uma diferença
   * mudaria o card e não o histórico — a divergência voltaria por outra porta.
   */
  resolutionsByMonth?: Record<string, ReconciliationResolutionInput[]>;
}

/**
 * Devolve os cards do histórico com o saldo econômico vindo da projeção.
 *
 * Os quatro campos econômicos andam juntos de propósito: exibir o saldo novo ao
 * lado de um «abatimento com crédito da competência anterior» calculado pelo
 * carry legado mostraria, no mesmo painel, um desconto que não aconteceu.
 */
export function withCanonicalEconomicBalances(
  cards: CompetenceHistoryCard[],
  options: EconomicSourceOptions = {}
): CompetenceHistoryCard[] {
  if (cards.length === 0) return cards;

  const projecao = projectCardTwoLedger(cards, {
    asOf: options.asOf ?? new Date().toISOString().slice(0, 10),
    resolutionsByMonth: options.resolutionsByMonth,
  });
  const porMes = new Map(projecao.competences.map((c) => [c.referenceMonth, c]));

  return cards.map((card) => {
    const economico = porMes.get(card.referenceMonth);
    if (!economico) return card;

    return {
      ...card,
      openBalance: centsToCurrency(economico.economicOpenBalanceCents),
      // Déficit antes do crédito provado. É o que o painel compara para dizer se
      // houve abatimento — e agora compara contra o mesmo cálculo.
      openBalanceBeforeCarry: centsToCurrency(
        Math.max(0, economico.statementTotalCents - economico.recognizedPaymentsCents)
      ),
      priorCreditApplied: centsToCurrency(economico.priorCreditAppliedCents),
      creditCarriedForward: centsToCurrency(economico.economicCarryAfterCents),
    };
  });
}
