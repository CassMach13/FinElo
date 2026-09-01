/**
 * Projeção dos dois livros para as superfícies do cartão.
 *
 * Traduz as competências reconstruídas do histórico para o domínio de dois livros
 * e devolve o que limite, fatura atual, status e histórico precisam — mantendo as
 * duas grandezas separadas em todo o caminho.
 *
 * A regra de apresentação que este módulo existe para sustentar: uma diferença de
 * reconciliação NUNCA é apresentada como dívida vencida, pagamento, crédito
 * disponível ou carry econômico. Ela aparece, quando aparece, como indicação
 * secundária de conciliação pendente.
 */

import {
  computeTwoLedgerBalances,
  type CompetenceLedgerInput,
  type EconomicStatus,
  type ReconciliationResolutionInput,
  type ReconciliationStatus,
} from './twoLedgerBalance';

/** Forma mínima consumida do histórico reconstruído, para não acoplar ao serviço. */
export interface CompetenceHistoryLike {
  referenceMonth: string;
  competenceBR?: string;
  dueDate?: string | null;
  statementTotal: number;
  totalPayments: number;
}

export interface CompetenceProjection {
  referenceMonth: string;
  competenceBR: string;
  dueDate: string | null;

  // ---- livro 1 ----
  statementTotalCents: number;
  recognizedPaymentsCents: number;
  economicOpenBalanceCents: number;
  economicStatus: EconomicStatus;

  // ---- livro 2 ----
  reconciliationStatus: ReconciliationStatus;
  unresolvedReconciliationDeltaCents: number;
  reconciliationAdjustmentCents: number;
  /** Verdadeiro quando a competência participou de alguma diferença não reconciliada. */
  hasPendingReconciliation: boolean;
}

export interface CardTwoLedgerProjection {
  competences: CompetenceProjection[];
  /** Limite consumido. Livro 1 apenas — o suspense não entra aqui. */
  economicUsedCents: number;
  /** Crédito econômico disponível ao fim da série. */
  economicCarryCents: number;
  /** Saldo do livro 2 ao fim da série. Não é dívida nem crédito. */
  suspenseBalanceCents: number;
  /** Há conciliação pendente em algum ponto da série. Indicação secundária. */
  reconciliationPending: boolean;
  /** A competência que o card deve destacar, escolhida por obrigação econômica. */
  current: CompetenceProjection | undefined;
}

const toCents = (value: number | null | undefined): number =>
  Math.round((Number(value ?? 0) + Number.EPSILON) * 100);

export const centsToCurrency = (cents: number): number => Math.round(cents) / 100;

function toLedgerInput(
  card: CompetenceHistoryLike,
  resolutions: ReconciliationResolutionInput[] | undefined
): CompetenceLedgerInput {
  return {
    referenceMonth: card.referenceMonth,
    dueDate: card.dueDate ?? null,
    // O histórico reconstruído soma as linhas atribuídas; não conhece rodapé de
    // arquivo nem total oficial, então a escada do total para aqui.
    computedLinesTotalCents: toCents(card.statementTotal),
    // `totalPayments` já traz somadas as confirmações de valor — ambas são
    // pagamento reconhecido no livro 1, e a distinção não muda nenhum resultado.
    observedPaymentCents: toCents(card.totalPayments),
    // Sem isto, resolver uma divergência não a faria sumir da tela: o usuário
    // classificaria os R$ 0,22, o banco gravaria a resolução, e «A CONCILIAR»
    // continuaria exibindo o mesmo valor. O snapshot que o servidor grava
    // também ficaria bruto, e a mesma diferença poderia ser resolvida de novo.
    resolutions,
  };
}

/**
 * Escolhe a fatura em destaque pela OBRIGAÇÃO ECONÔMICA, nunca por reconciliação.
 *
 *   1. a vencida mais antiga que ainda tem saldo econômico;
 *   2. senão, a próxima a vencer que tem saldo econômico;
 *   3. senão, o ciclo mais próximo a vencer, ainda que quitado.
 *
 * Uma competência com saldo econômico zero jamais alcança os passos 1 ou 2, por
 * mais que tenha diferença de reconciliação pendente.
 */
function pickCurrent(
  competences: CompetenceProjection[]
): CompetenceProjection | undefined {
  const comDivida = competences.filter((c) => c.economicOpenBalanceCents > 0);

  const vencidas = comDivida.filter((c) => c.economicStatus === 'overdue');
  if (vencidas.length > 0) return vencidas[0];

  if (comDivida.length > 0) return comDivida[0];

  return competences[0];
}

export function projectCardTwoLedger(
  cards: CompetenceHistoryLike[],
  options: {
    asOf: string;
    /**
     * Resoluções já gravadas e NÃO revertidas, por competência. Omitir equivale
     * a não haver nenhuma — que era o comportamento anterior, quando a projeção
     * simplesmente não as conhecia.
     */
    resolutionsByMonth?: Record<string, ReconciliationResolutionInput[]>;
  }
): CardTwoLedgerProjection {
  const porMes = options.resolutionsByMonth ?? {};
  const ledger = computeTwoLedgerBalances(
    cards.map((c) => toLedgerInput(c, porMes[c.referenceMonth])),
    { asOf: options.asOf }
  );

  const rotulos = new Map(cards.map((c) => [c.referenceMonth, c] as const));

  const competences: CompetenceProjection[] = ledger.competences.map((c) => {
    const origem = rotulos.get(c.referenceMonth);
    return {
      referenceMonth: c.referenceMonth,
      competenceBR: origem?.competenceBR || c.referenceMonth,
      dueDate: origem?.dueDate ?? null,
      statementTotalCents: c.statementTotalCents,
      recognizedPaymentsCents: c.recognizedPaymentsCents,
      economicOpenBalanceCents: c.economicOpenBalanceCents,
      economicStatus: c.economicStatus,
      reconciliationStatus: c.reconciliationStatus,
      unresolvedReconciliationDeltaCents: c.unresolvedReconciliationDeltaCents,
      reconciliationAdjustmentCents: c.reconciliationAdjustmentCents,
      hasPendingReconciliation: c.reconciliationStatus === 'unreconciled',
    };
  });

  /**
   * Limite utilizado = soma dos saldos econômicos em aberto, inclusive de
   * competências futuras. O suspense fica de fora por construção: enquanto não
   * houver resolução econômica ele não é nem dívida nem crédito, e portanto não
   * pode mover nem o utilizado nem o disponível.
   */
  const economicUsedCents = competences.reduce((a, c) => a + c.economicOpenBalanceCents, 0);

  return {
    competences,
    economicUsedCents,
    economicCarryCents: ledger.economicCarryCents,
    suspenseBalanceCents: ledger.suspenseBalanceCents,
    reconciliationPending:
      ledger.suspenseBalanceCents !== 0 || competences.some((c) => c.hasPendingReconciliation),
    current: pickCurrent(competences),
  };
}
