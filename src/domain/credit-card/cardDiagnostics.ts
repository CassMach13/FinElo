import type { CompetenceProjection } from './twoLedgerProjection.ts';

/**
 * Por que o cartão não está batendo.
 *
 * ===========================================================================
 * O QUE ESTA CAMADA É, E O QUE ELA NÃO É
 * ===========================================================================
 *
 * Uma leitura do que o motor JÁ calculou. Não recalcula fatura, pagamento nem
 * limite, e não toca no objeto que recebe — se algum número aqui divergisse do
 * número da tela, o diagnóstico viraria mais uma fonte de confusão em vez de
 * explicação.
 *
 * O usuário não precisa saber o que é competência, carry, suspense ou livro 2.
 * Ele precisa saber o que encontramos, quanto vale, em qual fatura, e o que
 * pode revisar. E precisa não ser acusado: a informação pode estar incompleta
 * do lado dele, mas «não encontramos o pagamento» é o que sabemos — «você não
 * pagou» é o que não sabemos.
 *
 * ===========================================================================
 * TRÊS TRAVAS CONTRA FALSO POSITIVO
 * ===========================================================================
 *
 * As três nasceram de rodar as regras contra contas reais, e cada uma matou um
 * alerta que parecia certo e não era:
 *
 *   1. EXCEDENTE TRANSITÓRIO. A convenção de pagamento faz o mês N+1 quitar o
 *      mês N, então um excedente aparece numa competência e a seguinte o
 *      consome sozinha. Numa conta real isso gerava «R$ 138,10 pagos a mais»
 *      sobre valores que já tinham se resolvido. Só entra o que SOBREVIVE.
 *
 *   2. FATURA CORRENTE. Que a conta do mês ainda não foi paga o usuário sabe.
 *      A fatura mais recente fica de fora.
 *
 *   3. CONTA QUE NÃO REGISTRA PAGAMENTO. Numa conta onde nenhuma fatura jamais
 *      recebeu pagamento, o cartão é um diário de compras. A regra dispararia
 *      em TODAS as faturas de uma vez, acusando de erro um jeito legítimo de
 *      usar o app.
 *
 * Errar para menos é a política: um alerta a menos custa uma descoberta; um
 * alerta falso custa confiança.
 */

export type CardDiagnosticSeverity = 'atencao' | 'revisar';

export type CardDiagnosticCode =
  | 'fatura_sem_pagamento_encontrado'
  | 'pagamento_acima_da_fatura'
  | 'pagamento_sem_fatura'
  | 'diferenca_a_conciliar';

export type CardDiagnosticAction = 'abrir_historico' | 'abrir_fatura' | 'ver_diferenca';

export interface CardDiagnostic {
  severity: CardDiagnosticSeverity;
  code: CardDiagnosticCode;
  /** Título curto, já em linguagem de usuário. */
  title: string;
  /** O que encontramos, quanto vale e o que pode ter acontecido. */
  message: string;
  /** Rótulo humano das competências envolvidas («janeiro e março de 2026»). */
  competenceLabel: string;
  /** As competências cruas, para a ação saber onde levar. */
  competences: string[];
  amountCents: number;
  action: CardDiagnosticAction;
}

export interface CardDiagnosticsInput {
  competences: ReadonlyArray<CompetenceProjection>;
  /**
   * O MESMO estado que desenha o selo «A CONCILIAR», já passado pelo gate da
   * flag. Vem de fora justamente para não haver duas contas de centavos: se o
   * selo diz que há diferença, o diagnóstico não pode dizer que está tudo
   * certo, e o valor tem de ser o mesmo.
   */
  reconciliation?: { pendente: boolean; referenceMonth: string | null } | null;
}

/** Abaixo disto a diferença é ruído de arredondamento, não erro. */
const RUIDO_CENTS = 100;

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const brl = (cents: number): string =>
  (Math.abs(cents) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const mesDe = (ref: string): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(ref.trim());
  if (!m) return ref;
  return `${MESES[Number(m[2]) - 1]} de ${m[1]}`;
};

/** «janeiro, fevereiro e março de 2026» — sem repetir o ano quando é o mesmo. */
function rotularCompetencias(refs: string[]): string {
  if (refs.length === 0) return '';
  if (refs.length === 1) return mesDe(refs[0]);

  const anos = new Set(refs.map((r) => r.slice(0, 4)));
  const nomes =
    anos.size === 1
      ? refs.map((r) => MESES[Number(r.slice(5, 7)) - 1])
      : refs.map(mesDe);
  const ano = anos.size === 1 ? ` de ${refs[0].slice(0, 4)}` : '';

  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}${ano}`;
}

interface Alvo {
  ref: string;
  valor: number;
}

/**
 * Quais excedentes ainda existem no estado atual.
 *
 * Percorre a série somando as diferenças. Toda vez que o acumulado zera, tudo
 * que entrou até ali já foi devolvido e deixa de ser acionável — é o caso dos
 * `+60,30` seguidos de `−60,52`, que apareciam e sumiam sozinhos.
 */
function excedentesQueSobrevivem(ordenadas: ReadonlyArray<CompetenceProjection>): Alvo[] {
  const vivas = new Set<string>();
  let acumulado = 0;

  for (const c of ordenadas) {
    acumulado += c.unresolvedReconciliationDeltaCents;
    if (c.unresolvedReconciliationDeltaCents > 0) vivas.add(c.referenceMonth);
    if (acumulado <= 0) {
      vivas.clear();
      acumulado = 0;
    }
  }

  return ordenadas
    .filter((c) => vivas.has(c.referenceMonth))
    .map((c) => ({ ref: c.referenceMonth, valor: c.unresolvedReconciliationDeltaCents }));
}

export function diagnoseCreditCard(input: CardDiagnosticsInput): CardDiagnostic[] {
  const achados: CardDiagnostic[] = [];
  const ordenadas = [...input.competences].sort((a, b) =>
    a.referenceMonth < b.referenceMonth ? -1 : a.referenceMonth > b.referenceMonth ? 1 : 0
  );
  if (ordenadas.length === 0) return achados;

  const registrar = (
    severity: CardDiagnosticSeverity,
    code: CardDiagnosticCode,
    alvos: Alvo[],
    um: (a: Alvo) => { title: string; message: string },
    varios: (n: number, total: number) => { title: string; message: string },
    action: CardDiagnosticAction
  ) => {
    if (alvos.length === 0) return;
    const total = alvos.reduce((s, a) => s + a.valor, 0);
    const refs = alvos.map((a) => a.ref);
    const texto = alvos.length === 1 ? um(alvos[0]) : varios(alvos.length, total);
    achados.push({
      severity,
      code,
      title: texto.title,
      message: texto.message,
      competenceLabel: rotularCompetencias(refs),
      competences: refs,
      amountCents: total,
      action,
    });
  };

  /**
   * COERÊNCIA COM O SELO. Enquanto «A CONCILIAR» estiver aceso, o cartão não
   * pode ser declarado consistente. O valor sai da mesma competência que o selo
   * aponta — não há segunda regra de centavos aqui.
   */
  const conciliadas = new Set<string>();
  const recon = input.reconciliation;
  if (recon?.pendente) {
    const alvo =
      ordenadas.find((c) => c.referenceMonth === recon.referenceMonth) ??
      ordenadas.find((c) => c.unresolvedReconciliationDeltaCents !== 0);

    if (alvo && alvo.unresolvedReconciliationDeltaCents !== 0) {
      const valor = Math.abs(alvo.unresolvedReconciliationDeltaCents);
      conciliadas.add(alvo.referenceMonth);
      registrar(
        valor < RUIDO_CENTS ? 'revisar' : 'atencao',
        'diferenca_a_conciliar',
        [{ ref: alvo.referenceMonth, valor }],
        (a) => ({
          title: `Fatura de ${mesDe(a.ref)}`,
          message:
            `Encontramos uma diferença de R$ ${brl(a.valor)} entre o valor desta fatura e os ` +
            `pagamentos registrados. Vale conferir de onde ela vem antes de classificá-la.`,
        }),
        (n, total) => ({
          title: `${n} faturas com diferença`,
          message: `Encontramos R$ ${brl(total)} de diferença em ${n} faturas.`,
        }),
        'ver_diferenca'
      );
    }
  }

  // ---- pagamentos acima do valor da fatura, e que ainda estão em aberto ----
  const excedentes = excedentesQueSobrevivem(ordenadas).filter((e) => !conciliadas.has(e.ref));

  for (const sev of ['atencao', 'revisar'] as const) {
    const grupo = excedentes.filter((e) =>
      sev === 'atencao' ? e.valor >= RUIDO_CENTS : e.valor < RUIDO_CENTS
    );
    registrar(
      sev,
      'pagamento_acima_da_fatura',
      grupo,
      (a) => ({
        title: `Fatura de ${mesDe(a.ref)}`,
        message:
          `Os pagamentos registrados nesta fatura somam R$ ${brl(a.valor)} a mais que o valor ` +
          `dela. Pode ser um pagamento associado a outra fatura, um pagamento adiantado ou uma ` +
          `diferença de centavos.`,
      }),
      (n, total) =>
        sev === 'atencao'
          ? {
              title: `${n} faturas com pagamentos acima do valor`,
              message:
                `Em ${n} faturas os pagamentos registrados somam R$ ${brl(total)} a mais que o ` +
                `valor delas. Isso costuma acontecer quando um pagamento fica associado à fatura errada.`,
            }
          : {
              title: `${n} faturas com pequenas diferenças`,
              message:
                `Em ${n} faturas os pagamentos registrados somam R$ ${brl(total)} a mais que o ` +
                `valor delas. São diferenças de centavos, normalmente de arredondamento.`,
            },
      'abrir_fatura'
    );
  }

  // ---- faturas em aberto sem nenhum pagamento associado ----
  const maisRecente = ordenadas[ordenadas.length - 1].referenceMonth;
  const usaRegistroDePagamento = ordenadas.some((c) => c.recognizedPaymentsCents > 0);

  const semPagamento = (usaRegistroDePagamento ? ordenadas : [])
    .filter(
      (c) =>
        c.referenceMonth !== maisRecente &&
        c.economicStatus === 'overdue' &&
        c.recognizedPaymentsCents === 0 &&
        c.statementTotalCents > 0 &&
        c.economicOpenBalanceCents > 0
    )
    .map((c) => ({ ref: c.referenceMonth, valor: c.economicOpenBalanceCents }));

  registrar(
    'atencao',
    'fatura_sem_pagamento_encontrado',
    semPagamento,
    (a) => ({
      title: `Fatura de ${mesDe(a.ref)}`,
      message:
        `Esta fatura ainda aparece com R$ ${brl(a.valor)} em aberto e não encontramos pagamentos ` +
        `associados a ela. Se você já pagou, o pagamento pode não ter sido registrado ou pode ` +
        `precisar de revisão.`,
    }),
    (n, total) => ({
      title: `${n} faturas em aberto sem pagamento encontrado`,
      message:
        `${n} faturas somam R$ ${brl(total)} em aberto e não encontramos pagamentos associados a ` +
        `elas. Se você já pagou essas faturas, os pagamentos podem não ter sido registrados ou ` +
        `podem precisar de revisão.`,
    }),
    'abrir_historico'
  );

  // ---- pagamento que não encontrou fatura ----
  const orfaos = ordenadas
    .filter((c) => c.statementTotalCents === 0 && c.recognizedPaymentsCents > 0)
    .map((c) => ({ ref: c.referenceMonth, valor: c.recognizedPaymentsCents }));

  registrar(
    'atencao',
    'pagamento_sem_fatura',
    orfaos,
    (a) => ({
      title: 'Pagamento sem fatura',
      message:
        `Há um pagamento de R$ ${brl(a.valor)} nesta conta que precisa ser associado a uma fatura.`,
    }),
    (n, total) => ({
      title: `${n} pagamentos sem fatura`,
      message:
        `Há ${n} pagamentos somando R$ ${brl(total)} nesta conta que precisam ser associados a ` +
        `uma fatura.`,
    }),
    'abrir_historico'
  );

  // Quem pode explicar um número errado vem primeiro; entre iguais, o maior.
  return achados.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'atencao' ? -1 : 1;
    return b.amountCents - a.amountCents;
  });
}

/** Resumo para o card: quantos itens, e se algum pede atenção. */
export function summarizeCardDiagnostics(achados: ReadonlyArray<CardDiagnostic>): {
  total: number;
  precisaAtencao: boolean;
  label: string;
} {
  const total = achados.length;
  return {
    total,
    precisaAtencao: achados.some((a) => a.severity === 'atencao'),
    label:
      total === 0
        ? 'Cartão consistente'
        : total === 1
        ? '1 item para revisar'
        : `${total} itens para revisar`,
  };
}
