/**
 * Quais resoluções fazem sentido para uma diferença, e o que cada uma provoca.
 *
 * Este módulo existe para que a regra de oferta seja testável sem renderizar
 * nada. Ele decide DUAS coisas, e as duas por sinal:
 *
 *   — nunca oferecer `economic_credit` para diferença negativa;
 *   — nunca oferecer `economic_debt` para diferença positiva.
 *
 * Oferecer o inverso convidaria o usuário a afirmar algo que o banco recusaria
 * por constraint. A UI não deve levar ninguém a um beco.
 *
 * Cada opção carrega a CONSEQUÊNCIA em texto, para ser mostrada antes de
 * confirmar. Uma classificação que move dinheiro entre livros não pode ser
 * escolhida às cegas.
 */

import type { ResolutionKind } from './twoLedgerBalance';

export interface ResolutionOption {
  kind: ResolutionKind;
  label: string;
  /** O que acontece se esta opção for confirmada. Mostrado antes da confirmação. */
  consequence: string;
  /** Verdadeiro quando a escolha move valor para o livro econômico. */
  movesEconomicLedger: boolean;
  /** `authoritative_total` precisa de valor e procedência antes de poder ser gravada. */
  requiresAuthoritativeTotal: boolean;
}

const money = (cents: number): string =>
  (Math.abs(cents) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

/**
 * A consequência precisa dizer a verdade inteira.
 *
 * Estas duas opções retiram o valor do bolso de reconciliação. Quando esse
 * valor estava compensando o déficit de uma competência posterior — como os
 * R$ 0,22 de 2024-12 cobriam parte de 2025-03 na cadeia real — a compensação
 * some junto, e o déficit descoberto vira obrigação econômica.
 *
 * O texto antigo prometia que «o limite disponível não muda». Não era verdade
 * nesse caso, e prometer isso levaria o usuário a clicar esperando o oposto do
 * que aconteceria. O que se pode afirmar sem ressalva é que nenhuma das duas
 * vira CRÉDITO — e é exatamente isso que as separa de `economic_credit`.
 */
const ajuste = (deltaCents: number): ResolutionOption => ({
  kind: 'bank_adjustment',
  label: 'É ajuste ou diferença do banco',
  consequence: `Encerra ${money(deltaCents)} de diferença. Não vira crédito para as próximas faturas. Se este valor estava cobrindo a diferença de outro mês, aquela diferença reaparece.`,
  movesEconomicLedger: false,
  requiresAuthoritativeTotal: false,
});

const oficial = (): ResolutionOption => ({
  kind: 'authoritative_total',
  label: 'Informar o valor oficial da fatura',
  consequence:
    'A competência é recalculada a partir do valor oficial. Saldo, crédito e diferença são derivados de novo — a diferença atual pode aumentar, diminuir ou desaparecer.',
  movesEconomicLedger: true,
  requiresAuthoritativeTotal: true,
});

const encerrar = (deltaCents: number): ResolutionOption => ({
  kind: 'reconciliation_write_off',
  label: 'Encerrar sem classificar',
  consequence: `Encerra ${money(deltaCents)} de diferença sem afirmar que é crédito, dívida ou valor oficial. Não vira crédito para as próximas faturas. Se este valor estava cobrindo a diferença de outro mês, aquela diferença reaparece.`,
  movesEconomicLedger: false,
  requiresAuthoritativeTotal: false,
});

/**
 * As classificações que a interface oferece hoje.
 *
 * `economic_debt` e `reconciliation_write_off` continuam existindo no domínio e
 * no schema — o banco os aceita, o núcleo os aplica, e as resoluções gravadas
 * com eles seguem valendo. Fora da tela por decisão de produto:
 *
 *   — `economic_debt` não tem estado alcançável no modelo atual: a projeção não
 *     produz diferença negativa que o usuário possa classificar assim;
 *   — `reconciliation_write_off` faria, na prática, o mesmo que
 *     `bank_adjustment` para quem olha, e explicar a diferença entre «encerrar
 *     sem classificar» e «é ajuste do banco» custaria mais do que vale antes de
 *     o produto ser validado.
 *
 * Tirar da UI não é remover do domínio. Se um deles voltar a ser necessário,
 * volta para esta lista.
 */
const KINDS_NA_INTERFACE: ResolutionKind[] = [
  'economic_credit',
  'bank_adjustment',
  'authoritative_total',
];

/** As opções que a interface deve mostrar para esta diferença. */
export function visibleResolutionOptionsForDelta(deltaCents: number): ResolutionOption[] {
  return resolutionOptionsForDelta(deltaCents).filter((o) => KINDS_NA_INTERFACE.includes(o.kind));
}

/**
 * As opções válidas para uma diferença assinada, em centavos.
 *
 * Diferença zero devolve lista vazia: não há o que resolver, e oferecer ações
 * sobre nada só produziria eventos vazios na trilha de auditoria.
 *
 * Esta é a lista COMPLETA do domínio. Para a interface, use
 * `visibleResolutionOptionsForDelta`.
 */
export function resolutionOptionsForDelta(deltaCents: number): ResolutionOption[] {
  const delta = Math.trunc(Number(deltaCents) || 0);
  if (delta === 0) return [];

  if (delta > 0) {
    return [
      {
        kind: 'economic_credit',
        label: 'É crédito para as próximas faturas',
        consequence: `${money(delta)} viram crédito e abatem as próximas faturas. O limite disponível aumenta.`,
        movesEconomicLedger: true,
        requiresAuthoritativeTotal: false,
      },
      ajuste(delta),
      oficial(),
      encerrar(delta),
    ];
  }

  return [
    {
      kind: 'economic_debt',
      label: 'É uma cobrança real',
      consequence: `${money(delta)} viram saldo em aberto nesta competência. O limite disponível diminui.`,
      movesEconomicLedger: true,
      requiresAuthoritativeTotal: false,
    },
    ajuste(delta),
    oficial(),
    encerrar(delta),
  ];
}

/** Texto do sinal, para a UI não precisar reinterpretar o número. */
export function describeDelta(deltaCents: number): {
  sinal: 'positiva' | 'negativa' | 'nenhuma';
  valorFormatado: string;
  resumo: string;
} {
  const delta = Math.trunc(Number(deltaCents) || 0);
  if (delta === 0) {
    return { sinal: 'nenhuma', valorFormatado: money(0), resumo: 'Nada a conciliar nesta competência.' };
  }
  if (delta > 0) {
    return {
      sinal: 'positiva',
      valorFormatado: money(delta),
      resumo: `Foi pago ${money(delta)} a mais do que esta competência pedia, e ainda não sabemos por quê.`,
    };
  }
  return {
    sinal: 'negativa',
    valorFormatado: money(delta),
    resumo: `Faltam ${money(delta)} nesta competência que nenhuma evidência explica.`,
  };
}
