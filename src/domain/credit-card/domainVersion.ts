/**
 * A versão do domínio financeiro do cartão.
 *
 * Entra no snapshot junto com os contadores de revisão. Os contadores dizem «as
 * ENTRADAS mudaram»; esta versão diz «a REGRA mudou». As duas coisas invalidam
 * um snapshot, e nenhuma delas detecta a outra: recalcular com uma fórmula nova
 * sobre os mesmos dados dá outro número, e nenhum contador se moveu.
 *
 * Suba a versão sempre que mudar o cálculo — inclusive quando a mudança for
 * «uma correção óbvia». Snapshots gravados pela regra antiga passam a ser
 * tratados como stale e são recalculados, que é exatamente o que se quer.
 */
export const CARD_DOMAIN_VERSION = 'card-two-ledger@1';
