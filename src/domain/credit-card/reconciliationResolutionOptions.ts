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

const ajuste = (deltaCents: number): ResolutionOption => ({
  kind: 'bank_adjustment',
  label: 'É ajuste ou diferença do banco',
  consequence: `Encerra ${money(deltaCents)} de diferença. Não vira crédito nem dívida, e o limite disponível não muda.`,
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
  kind: 'written_off',
  label: 'Encerrar sem classificar',
  consequence: `Encerra ${money(deltaCents)} de diferença sem afirmar que é crédito, dívida ou valor oficial. O limite disponível não muda.`,
  movesEconomicLedger: false,
  requiresAuthoritativeTotal: false,
});

/**
 * As opções válidas para uma diferença assinada, em centavos.
 *
 * Diferença zero devolve lista vazia: não há o que resolver, e oferecer ações
 * sobre nada só produziria eventos vazios na trilha de auditoria.
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
