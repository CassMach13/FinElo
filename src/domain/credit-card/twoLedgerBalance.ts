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

export interface CompetenceLedgerInput {
  /** 'YYYY-MM'. Define a ordem de processamento do carry e do suspense. */
  referenceMonth: string;
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
  const competences: CompetenceLedgerResult[] = [];

  for (const input of ordered) {
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
      // Falta pagar. A parte que uma diferença anterior explica é reconciliação,
      // não dívida — as duas se cancelam dentro do livro 2. O resto é dívida real.
      suspenseOutCents = Math.min(suspenseBalanceCents, economicDueCents);
      economicOpenBalanceCents = economicDueCents - suspenseOutCents;
    }

    suspenseBalanceCents += suspenseInCents - suspenseOutCents;

    const vencida = asOf != null && input.dueDate != null && input.dueDate < asOf;
    const economicStatus: EconomicStatus =
      economicOpenBalanceCents > 0 ? (vencida ? 'overdue' : 'open') : 'paid';

    const unresolvedReconciliationDeltaCents = suspenseInCents - suspenseOutCents;
    const reconciliationStatus: ReconciliationStatus =
      reconciliationAdjustmentCents !== 0
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
      reconciliationStatus,
      economicCarryCents,
      suspenseBalanceCents,
    });
  }

  return { competences, economicCarryCents, suspenseBalanceCents };
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
  conservado: boolean;
} {
  const cobrado = result.competences.reduce((a, c) => a + c.statementTotalCents, 0);
  const reconhecido = result.competences.reduce((a, c) => a + c.recognizedPaymentsCents, 0);
  const emAberto = result.competences.reduce((a, c) => a + c.economicOpenBalanceCents, 0);
  return {
    cobrado,
    reconhecido,
    emAberto,
    carry: result.economicCarryCents,
    suspense: result.suspenseBalanceCents,
    conservado:
      cobrado - reconhecido === emAberto - result.economicCarryCents - result.suspenseBalanceCents,
  };
}

/** Conservação isolada do livro 2: o saldo é exatamente o que entrou menos o que saiu. */
export function suspenseConservation(result: TwoLedgerResult): boolean {
  const entrou = result.competences.reduce((a, c) => a + c.suspenseInCents, 0);
  const saiu = result.competences.reduce((a, c) => a + c.suspenseOutCents, 0);
  return entrou - saiu === result.suspenseBalanceCents;
}
