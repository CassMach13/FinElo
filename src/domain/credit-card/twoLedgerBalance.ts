/**
 * Os dois livros do módulo de cartão.
 *
 *   LIVRO 1 — econômico
 *     Valores cuja natureza é conhecida: compras, pagamentos reconhecidos,
 *     dívida real, crédito real e o carry entre competências.
 *
 *   LIVRO 2 — reconciliação (suspense)
 *     Diferenças observadas cuja natureza NÃO está provada. Não são dívida nem
 *     crédito. Podem compensar diferenças posteriores dentro do próprio livro 2.
 *
 * O princípio que este módulo existe para garantir: os dois saldos são
 * conservados SEPARADAMENTE. Nada atravessa de um livro para o outro por
 * threshold ou por sinal — só por procedência (um total autoritativo) ou por uma
 * resolução explícita. Uma diferença sem natureza provada nunca vira, sozinha,
 * nem dívida vencida nem crédito gastável.
 *
 * Daí a invariante da FRONTEIRA, que vale enunciar sozinha: o suspense não é
 * pagamento, não é crédito econômico, não é limite disponível e não abate dívida
 * por si só. Havendo liquidação observada, ele pode explicar a DISTRIBUIÇÃO dela
 * entre ciclos — o mesmo dinheiro contado com folga num mês e em falta no
 * seguinte. Não havendo liquidação alguma, não existe nada a redistribuir, e a
 * obrigação em aberto é o valor cheio.
 *
 * O alcance da proveniência tem um limite que vale escrever: ela governa o
 * tratamento da INCERTEZA, não a existência econômica das transações. Compras,
 * tarifas e estornos importados são fatos econômicos como quaisquer outros e
 * entram integralmente na obrigação — uma fatura importada sem pagamento é
 * dívida de valor cheio. O que a proveniência decide é o destino do EXCEDENTE e
 * do resíduo que nenhuma evidência explica.
 *
 * Toda a aritmética é em CENTAVOS INTEIROS. Não há tolerância monetária neste
 * arquivo, e não deve haver: com inteiros exatos ela seria arbitrária por
 * definição. Converter na fronteira, nunca aqui.
 */

export type AuthoritativeSource = 'bank_app' | 'bank_pdf' | 'bank_api' | 'user_declared';

/** De onde veio o total usado no cálculo. Espelha a escada A do modelo. */
export type TotalSource = 'authoritative' | 'file' | 'lines' | 'manual' | 'mixed' | 'empty';

/** Livro 1. `settled_confirmed` pertence à confirmação FULL e não é produzido aqui. */
export type EconomicStatus = 'paid' | 'open' | 'overdue' | 'settled_confirmed';

/** Livro 2. Ortogonal a EconomicStatus: uma competência pode estar paga e não reconciliada. */
export type ReconciliationStatus = 'reconciled' | 'adjusted' | 'unreconciled' | 'resolved';

/**
 * As cinco formas de resolver uma diferença de reconciliação.
 *
 * `economic_credit` e `economic_debt` MOVEM valor entre os livros, conservando-o.
 * `bank_adjustment` e `reconciliation_write_off` encerram a diferença sem mover nada para o
 * livro econômico. `authoritative_total` não consome porção nenhuma: ele fornece
 * uma fonte superior e a competência inteira é recalculada a partir dela.
 */
export type ResolutionKind =
  | 'economic_credit'
  | 'economic_debt'
  | 'bank_adjustment'
  | 'authoritative_total'
  | 'reconciliation_write_off';

export interface ReconciliationResolutionInput {
  kind: ResolutionKind;
  /**
   * Porção ASSINADA da diferença classificada por este evento, em centavos.
   * Positiva para `economic_credit`, negativa para `economic_debt`. Ignorada em
   * `authoritative_total`. Resoluções parciais são somadas; o excedente sobre a
   * diferença disponível é descartado, nunca inventado.
   */
  resolvedAmountCents?: number;
  /** Só para `authoritative_total`, e só vale acompanhado da procedência. */
  authoritativeStatementTotalCents?: number;
  authoritativeSource?: AuthoritativeSource | null;
}

export interface CompetenceLedgerInput {
  /** 'YYYY-MM'. Define a ordem de processamento do carry e do suspense. */
  referenceMonth: string;
  /**
   * Resoluções explícitas registradas pelo usuário para esta competência.
   * Sem elas, uma diferença permanece inerte no livro 2 — a intenção nunca é
   * inferida da magnitude nem do sinal.
   */
  resolutions?: ReconciliationResolutionInput[];
  /** 'YYYY-MM-DD'. Só serve para distinguir `open` de `overdue`. */
  dueDate?: string | null;

  /** Soma das linhas atribuídas. Sempre presente — é o último degrau com valor. */
  computedLinesTotalCents: number;
  /**
   * Obrigação que o usuário registrou por fora do arquivo, na mesma competência.
   * Soma-se ao que o rodapé declara em vez de ser substituída por ele.
   */
  manualObligationCents?: number;
  /** Rodapé do arquivo. Declaração do arquivo, não autoridade sobre o emissor. */
  fileReportedTotalCents?: number | null;
  /** Valor oficial do emissor. Só vale acompanhado de `authoritativeSource`. */
  authoritativeStatementTotalCents?: number | null;
  authoritativeSource?: AuthoritativeSource | null;

  /** Pagamentos observados (transações do extrato ou lançados). */
  observedPaymentCents?: number;
  /** Confirmações `confirmation_type = 'amount'`: valor reconhecido como pago. */
  amountConfirmationCents?: number;

  /**
   * Resolução explícita de que o excedente desta competência é crédito econômico.
   * Alimentado a partir de `credit_card_reconciliation_resolutions` num PR
   * posterior; existe aqui para que a regra «carry só com procedência» possa ser
   * expressa e testada. Nunca é inferido da magnitude de nada.
   */
  explicitEconomicCreditResolution?: boolean;
}

export interface CompetenceLedgerResult {
  referenceMonth: string;
  totalSource: TotalSource;

  // ---- livro 1 ----
  statementTotalCents: number;
  recognizedPaymentsCents: number;
  priorCreditAppliedCents: number;
  economicOpenBalanceCents: number;
  economicStatus: EconomicStatus;

  // ---- livro 2 ----
  reconciliationAdjustmentCents: number;
  unresolvedReconciliationDeltaCents: number;
  suspenseInCents: number;
  suspenseOutCents: number;
  /** Movido para o livro 1 por resolucao explicita, conservando o valor. */
  resolvedToCarryCents: number;
  resolvedToDebtCents: number;
  /** Encerrado no livro 2 por `bank_adjustment` ou `reconciliation_write_off`. Sem efeito economico. */
  resolvedNonEconomicCents: number;
  reconciliationStatus: ReconciliationStatus;

  // ---- saldos correntes depois desta competência ----
  economicCarryCents: number;
  suspenseBalanceCents: number;
}

export interface TwoLedgerResult {
  competences: CompetenceLedgerResult[];
  /** Crédito econômico disponível ao fim da série. Livro 1. */
  economicCarryCents: number;
  /** Diferença não reconciliada acumulada ao fim da série. Livro 2. */
  suspenseBalanceCents: number;
  /**
   * Total encerrado no livro 2 por resolução sem efeito econômico. Não é dívida,
   * não é crédito, e não volta — mas precisa aparecer na conservação, senão o
   * valor encerrado pareceria ter evaporado.
   */
  resolvedNonEconomicCents: number;
}

export interface TwoLedgerOptions {
  /** 'YYYY-MM-DD'. Sem isto nada é classificado como `overdue`. */
  asOf?: string | null;
}

const int = (value: number | null | undefined): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/**
 * Um total autoritativo sem procedência registrada não é autoritativo — é um
 * palpite. A mesma regra que a check constraint aplica no banco.
 */
function resolveTotal(input: CompetenceLedgerInput): {
  totalCents: number;
  totalSource: TotalSource;
} {
  const authoritative = input.authoritativeStatementTotalCents;
  if (authoritative != null && input.authoritativeSource != null) {
    return { totalCents: int(authoritative), totalSource: 'authoritative' };
  }

  /**
   * O rodapé descreve APENAS o que veio dentro do arquivo. Obrigações que o
   * usuário registrou por fora somam por cima — deixá-lo substituir o total
   * inteiro faria um rodapé de R$ 5.000 engolir R$ 300 de lançamentos manuais da
   * mesma competência.
   *
   * Compras importadas, tarifas e estornos são fatos econômicos como quaisquer
   * outros: entram integralmente na obrigação. A proveniência governa o
   * tratamento da INCERTEZA — o excedente sem prova —, não a existência das
   * transações.
   */
  const manualCents = int(input.manualObligationCents);
  const importedCents =
    input.fileReportedTotalCents != null
      ? int(input.fileReportedTotalCents)
      : int(input.computedLinesTotalCents);
  const totalCents = manualCents + importedCents;

  let totalSource: TotalSource;
  if (manualCents > 0 && importedCents > 0) totalSource = 'mixed';
  else if (input.fileReportedTotalCents != null) totalSource = 'file';
  else if (manualCents > 0) totalSource = 'manual';
  else if (totalCents > 0) totalSource = 'lines';
  else totalSource = 'empty';

  return { totalCents, totalSource };
}

/**
 * As DUAS portas de entrada do carry econômico, e só elas:
 * um total autoritativo, ou uma resolução explícita do usuário.
 * A magnitude do excedente não participa desta decisão em ponto algum.
 */
function carryIsSupported(input: CompetenceLedgerInput, totalSource: TotalSource): boolean {
  if (totalSource === 'authoritative') return true;
  return input.explicitEconomicCreditResolution === true;
}

/**
 * `authoritative_total` não consome porção da diferença: ele entrega uma fonte
 * superior e a competência inteira é RECALCULADA a partir dela. Por isso a
 * resolução é dobrada na entrada antes de qualquer cálculo — saldo, carry e
 * diferença saem derivados do total novo, em vez de o delta antigo ser mascarado.
 *
 * A resolução vigente é a mais recente da lista; as anteriores continuam na
 * trilha de auditoria, fora do cálculo.
 */
function applyAuthoritativeResolution(input: CompetenceLedgerInput): CompetenceLedgerInput {
  const autoritativas = (input.resolutions ?? []).filter(
    (r) =>
      r.kind === 'authoritative_total' &&
      r.authoritativeStatementTotalCents != null &&
      r.authoritativeSource != null
  );
  const vigente = autoritativas[autoritativas.length - 1];
  if (!vigente) return input;

  return {
    ...input,
    authoritativeStatementTotalCents: int(vigente.authoritativeStatementTotalCents),
    authoritativeSource: vigente.authoritativeSource ?? null,
  };
}

export interface AppliedResolutions {
  /** Sai do livro 2 e entra como carry no livro 1. */
  paraCarryCents: number;
  /** Sai do livro 2 e entra como saldo em aberto no livro 1. */
  paraDividaCents: number;
  /** Encerrado no livro 2, sem efeito econômico algum. */
  naoEconomicoCents: number;
}

/**
 * Distribui as resoluções sobre a diferença disponível, respeitando o sinal.
 *
 * Duas travas que existem para impedir que uma classificação crie dinheiro:
 * o sinal precisa casar com o da diferença — `economic_credit` só resolve
 * diferença positiva e `economic_debt` só negativa —, e a soma das porções nunca
 * ultrapassa o disponível. Uma resolução repetida encontra o saldo já consumido
 * e não aplica nada, o que dá idempotência por construção.
 */
export function applyResolutions(
  resolutions: ReconciliationResolutionInput[],
  diferencaCents: number
): AppliedResolutions {
  let disponivel = diferencaCents;
  const out: AppliedResolutions = { paraCarryCents: 0, paraDividaCents: 0, naoEconomicoCents: 0 };

  for (const r of resolutions) {
    if (r.kind === 'authoritative_total') continue;

    const pedido = int(r.resolvedAmountCents);
    if (pedido === 0) continue;

    // Sinal incompatível: recusado, nunca convertido em silêncio.
    if (r.kind === 'economic_credit' && pedido < 0) continue;
    if (r.kind === 'economic_debt' && pedido > 0) continue;
    if (Math.sign(pedido) !== Math.sign(disponivel)) continue;

    const aplicado = Math.sign(pedido) * Math.min(Math.abs(pedido), Math.abs(disponivel));
    if (aplicado === 0) continue;

    disponivel -= aplicado;

    if (r.kind === 'economic_credit') out.paraCarryCents += aplicado;
    else if (r.kind === 'economic_debt') out.paraDividaCents += Math.abs(aplicado);
    else out.naoEconomicoCents += aplicado;
  }

  return out;
}

function compareReferenceMonth(a: CompetenceLedgerInput, b: CompetenceLedgerInput): number {
  return a.referenceMonth < b.referenceMonth ? -1 : a.referenceMonth > b.referenceMonth ? 1 : 0;
}

export function computeTwoLedgerBalances(
  inputs: CompetenceLedgerInput[],
  options: TwoLedgerOptions = {}
): TwoLedgerResult {
  const ordered = [...inputs].sort(compareReferenceMonth);
  const asOf = options.asOf ?? null;

  let economicCarryCents = 0;
  let suspenseBalanceCents = 0;
  let resolvedNonEconomicCents = 0;
  const competences: CompetenceLedgerResult[] = [];

  for (const bruto of ordered) {
    // `authoritative_total` entra ANTES do calculo: a competencia e recalculada
    // a partir da fonte superior, nao tem o delta mascarado depois.
    const input = applyAuthoritativeResolution(bruto);
    const { totalCents, totalSource } = resolveTotal(input);

    const recognizedPaymentsCents =
      int(input.observedPaymentCents) + int(input.amountConfirmationCents);

    // O crédito econômico é dinheiro provado: abate antes de qualquer suspense.
    const dueBeforeCredit = totalCents - recognizedPaymentsCents;
    const priorCreditAppliedCents = Math.max(0, Math.min(economicCarryCents, dueBeforeCredit));
    economicCarryCents -= priorCreditAppliedCents;

    const economicDueCents = dueBeforeCredit - priorCreditAppliedCents;

    // Livro 2: a distância entre o que o emissor cobrou e o que as linhas somam.
    // Registrada, nunca somada ao livro 1.
    const reconciliationAdjustmentCents =
      totalSource === 'authoritative'
        ? totalCents - (int(input.computedLinesTotalCents) + int(input.manualObligationCents))
        : 0;

    let economicOpenBalanceCents = 0;
    let suspenseInCents = 0;
    let suspenseOutCents = 0;

    if (economicDueCents < 0) {
      // Pagou mais do que devia. É crédito só se a procedência sustentar.
      const surplusCents = -economicDueCents;
      if (carryIsSupported(input, totalSource)) {
        economicCarryCents += surplusCents;
      } else {
        suspenseInCents = surplusCents;
      }
    } else if (economicDueCents > 0) {
      /**
       * Falta pagar — e aqui está a fronteira entre os dois livros.
       *
       * O suspense pode explicar a DISTRIBUIÇÃO de uma liquidação entre ciclos:
       * a convenção faz o arquivo do mês N+1 quitar o mês N, então um pagamento
       * atribuído com folga a um ciclo aparece em falta no seguinte, e os dois
       * lados são o MESMO dinheiro visto de dois lugares. Compensar isso não
       * atravessa livro nenhum: cancela uma diferença contra a outra dentro do
       * livro 2.
       *
       * Mas isso pressupõe que exista liquidação a redistribuir. Sem NENHUM
       * pagamento reconhecido, não há dinheiro que possa ter caído no ciclo
       * errado — há apenas uma fatura inteira em aberto. Deixar o suspense
       * abater aí seria o próprio ato que este módulo proíbe: uma diferença sem
       * natureza provada virando crédito gastável, reduzindo a obrigação
       * bancária real e o limite utilizado.
       *
       * A porta é CATEGÓRICA, não um threshold: pergunta se houve liquidação,
       * nunca quanto. E lê a mesma liquidação que o livro 1 já reconhece —
       * pagamentos observados e confirmação de valor —, sem inventar uma segunda
       * fonte de verdade.
       */
      const houveLiquidacaoObservada = recognizedPaymentsCents > 0;
      if (houveLiquidacaoObservada) {
        suspenseOutCents = Math.min(suspenseBalanceCents, economicDueCents);
      }
      economicOpenBalanceCents = economicDueCents - suspenseOutCents;
    }

    /**
     * As resolucoes agem sobre a diferenca que ESTA competencia colocou no livro
     * 2. `suspenseOut` e consumo de diferenca anterior, ja explicada, e por isso
     * fica fora: resolver de novo o que ja foi compensado criaria dinheiro.
     */
    const aplicadas = applyResolutions(input.resolutions ?? [], suspenseInCents);

    economicCarryCents += aplicadas.paraCarryCents;
    economicOpenBalanceCents += aplicadas.paraDividaCents;
    suspenseInCents -=
      aplicadas.paraCarryCents + aplicadas.naoEconomicoCents - aplicadas.paraDividaCents;
    resolvedNonEconomicCents += aplicadas.naoEconomicoCents;

    const resolvidaCents =
      aplicadas.paraCarryCents + aplicadas.paraDividaCents + aplicadas.naoEconomicoCents;

    suspenseBalanceCents += suspenseInCents - suspenseOutCents;

    const vencida = asOf != null && input.dueDate != null && input.dueDate < asOf;
    const economicStatus: EconomicStatus =
      economicOpenBalanceCents > 0 ? (vencida ? 'overdue' : 'open') : 'paid';

    const unresolvedReconciliationDeltaCents = suspenseInCents - suspenseOutCents;
    const reconciliationStatus: ReconciliationStatus =
      resolvidaCents !== 0
        ? 'resolved'
        : reconciliationAdjustmentCents !== 0
        ? 'adjusted'
        : suspenseInCents !== 0 || suspenseOutCents !== 0
          ? 'unreconciled'
          : 'reconciled';

    competences.push({
      referenceMonth: input.referenceMonth,
      totalSource,
      statementTotalCents: totalCents,
      recognizedPaymentsCents,
      priorCreditAppliedCents,
      economicOpenBalanceCents,
      economicStatus,
      reconciliationAdjustmentCents,
      unresolvedReconciliationDeltaCents,
      suspenseInCents,
      suspenseOutCents,
      resolvedToCarryCents: aplicadas.paraCarryCents,
      resolvedToDebtCents: aplicadas.paraDividaCents,
      resolvedNonEconomicCents: aplicadas.naoEconomicoCents,
      reconciliationStatus,
      economicCarryCents,
      suspenseBalanceCents,
    });
  }

  return { competences, economicCarryCents, suspenseBalanceCents, resolvedNonEconomicCents };
}

/**
 * Identidade de conservação dos dois livros, verificável de fora.
 *
 *   Σ total − Σ pagamentos reconhecidos
 *     = Σ saldo econômico em aberto − carry final − suspense final
 *
 * O lado esquerdo é o que a série cobrou menos o que reconheceu ter recebido. O
 * direito distribui essa diferença entre dívida (livro 1), crédito (livro 1) e
 * diferença não reconciliada (livro 2). Se algum valor vazasse de um livro para o
 * outro sem contrapartida, a igualdade quebraria.
 */
export function twoLedgerConservation(result: TwoLedgerResult): {
  cobrado: number;
  reconhecido: number;
  emAberto: number;
  carry: number;
  suspense: number;
  encerrado: number;
  conservado: boolean;
} {
  const cobrado = result.competences.reduce((a, c) => a + c.statementTotalCents, 0);
  const reconhecido = result.competences.reduce((a, c) => a + c.recognizedPaymentsCents, 0);
  const emAberto = result.competences.reduce((a, c) => a + c.economicOpenBalanceCents, 0);
  const encerrado = result.resolvedNonEconomicCents;
  return {
    cobrado,
    reconhecido,
    emAberto,
    carry: result.economicCarryCents,
    suspense: result.suspenseBalanceCents,
    encerrado,
    conservado:
      cobrado - reconhecido ===
      emAberto - result.economicCarryCents - result.suspenseBalanceCents - encerrado,
  };
}

/** Conservação isolada do livro 2: o saldo é exatamente o que entrou menos o que saiu. */
export function suspenseConservation(result: TwoLedgerResult): boolean {
  const entrou = result.competences.reduce((a, c) => a + c.suspenseInCents, 0);
  const saiu = result.competences.reduce((a, c) => a + c.suspenseOutCents, 0);
  return entrou - saiu === result.suspenseBalanceCents;
}
