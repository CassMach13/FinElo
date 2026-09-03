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
} from './twoLedgerBalance.ts';

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
  /** Crédito PROVADO de competências anteriores aplicado aqui. */
  priorCreditAppliedCents: number;
  economicOpenBalanceCents: number;
  economicStatus: EconomicStatus;
  /** Crédito econômico disponível DEPOIS desta competência. */
  economicCarryAfterCents: number;

  // ---- livro 2 ----
  reconciliationStatus: ReconciliationStatus;
  unresolvedReconciliationDeltaCents: number;
  reconciliationAdjustmentCents: number;
  /**
   * Esta competência tem diferença que o usuário PRECISA resolver.
   *
   * Não é o mesmo que «tem diferença». A convenção de pagamento faz o mês N+1
   * quitar o mês N, então uma diferença nasce numa competência e a seguinte a
   * consome — ela some sozinha, sem ninguém decidir nada. Convidar o usuário a
   * classificar isso é pedir uma decisão que não existe: foi assim que R$ 60,30
   * e R$ 77,80 viraram «crédito econômico» numa conta real, sendo que a própria
   * cadeia os devolveria.
   *
   * Só entra o excedente que SOBREVIVE até o fim da série.
   */
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

/** Forma mínima que a regra de acionabilidade precisa ler. */
export interface DiferencaPorCompetencia {
  referenceMonth: string;
  unresolvedReconciliationDeltaCents: number;
}

/**
 * Quanto de cada diferença ainda existe no estado atual — o que é acionável.
 *
 * ESTA É A ÚNICA DEFINIÇÃO DE «PRECISA DE DECISÃO» no módulo de cartão. O selo
 * «A CONCILIAR» e o diagnóstico leem daqui; ter duas contas de centavos foi
 * exatamente o que produziu uma tela dizendo «Cartão consistente» ao lado de
 * outra pedindo para resolver a mesma diferença.
 *
 * O percurso é uma FILA: o que entrou primeiro é devolvido primeiro. Uma
 * competência que consome suspense paga a dívida mais antiga do livro 2, e o
 * que sobra na fila no fim da série é o que de fato ainda existe — com o valor
 * REMANESCENTE, não o original. Oferecer os R$ 77,80 inteiros quando só R$ 0,94
 * sobreviveram convidaria a classificar dinheiro que já foi devolvido.
 *
 * Sem threshold: quem decide é a cadeia inteira, não a magnitude.
 */
export function competenciasComDiferencaAcionavel(
  competences: ReadonlyArray<DiferencaPorCompetencia>
): Map<string, number> {
  const ordenadas = [...competences].sort((a, b) =>
    a.referenceMonth < b.referenceMonth ? -1 : a.referenceMonth > b.referenceMonth ? 1 : 0
  );

  /** Fila do que entrou e ainda não foi devolvido, na ordem em que entrou. */
  const fila: Array<{ ref: string; resta: number }> = [];

  for (const c of ordenadas) {
    const delta = c.unresolvedReconciliationDeltaCents;

    if (delta > 0) {
      fila.push({ ref: c.referenceMonth, resta: delta });
      continue;
    }

    // Competência que consome: devolve o que entrou primeiro.
    let aDevolver = -delta;
    while (aDevolver > 0 && fila.length > 0) {
      const frente = fila[0];
      const usado = Math.min(frente.resta, aDevolver);
      frente.resta -= usado;
      aDevolver -= usado;
      if (frente.resta === 0) fila.shift();
    }
  }

  return new Map(fila.filter((f) => f.resta > 0).map((f) => [f.ref, f.resta]));
}

/**
 * Quanto ESTA competência ainda tem de diferença que precisa de decisão.
 *
 * A pergunta que o modal de conciliação faz. Ele oferecia o delta BRUTO da
 * competência — e na conta piloto isso convidava a classificar R$ 77,80 quando
 * a cadeia já havia devolvido tudo menos R$ 0,94. Resolver o bruto move dinheiro
 * que não existe mais.
 *
 * Não há regra nova aqui: é a mesma fila que decide o selo «A CONCILIAR» e o
 * diagnóstico, consultada pela competência. Ter uma segunda conta de centavos
 * foi exatamente o que pôs três telas dizendo três números.
 *
 * Zero significa «nada a resolver», e é resposta legítima: uma competência que
 * apenas CONSUMIU diferença anterior não tem o que classificar.
 */
export function valorAcionavelDaCompetencia(
  competences: ReadonlyArray<DiferencaPorCompetencia>,
  referenceMonth: string
): number {
  return competenciasComDiferencaAcionavel(competences).get(referenceMonth) ?? 0;
}

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
  const acionaveis = competenciasComDiferencaAcionavel(ledger.competences);

  const competences: CompetenceProjection[] = ledger.competences.map((c) => {
    const origem = rotulos.get(c.referenceMonth);
    return {
      referenceMonth: c.referenceMonth,
      competenceBR: origem?.competenceBR || c.referenceMonth,
      dueDate: origem?.dueDate ?? null,
      statementTotalCents: c.statementTotalCents,
      recognizedPaymentsCents: c.recognizedPaymentsCents,
      priorCreditAppliedCents: c.priorCreditAppliedCents,
      economicOpenBalanceCents: c.economicOpenBalanceCents,
      economicStatus: c.economicStatus,
      economicCarryAfterCents: c.economicCarryCents,
      reconciliationStatus: c.reconciliationStatus,
      unresolvedReconciliationDeltaCents: c.unresolvedReconciliationDeltaCents,
      reconciliationAdjustmentCents: c.reconciliationAdjustmentCents,
      hasPendingReconciliation: acionaveis.has(c.referenceMonth),
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
    /**
     * O selo só acende por diferença que ainda existe. O saldo final do livro 2
     * deixou de entrar nesta conta: ele é consequência das mesmas diferenças, e
     * somá-lo aqui reacendia o selo por resíduo que a cadeia já devolveu.
     */
    reconciliationPending: competences.some((c) => c.hasPendingReconciliation),
    current: pickCurrent(competences),
  };
}
