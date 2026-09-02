/**
 * A INTENÇÃO de resolver uma diferença, e o que fazer com cada resposta.
 *
 * Isto mora fora do componente de propósito. A regra que impede uma resolução
 * duplicada não é visual — é sobre quando a chave de idempotência nasce, quando
 * ela é reaproveitada e quando pode ser descartada — e precisa ser testável sem
 * renderizar nada.
 *
 * O caso que a criou foi medido, não imaginado: na validação do 4B1, duas
 * resoluções concorrentes sobre a mesma competência fizeram uma delas responder
 * em 3 segundos e a outra levar mais de dois minutos, devolvendo timeout ao
 * cliente DEPOIS de ter gravado. O retry com a mesma chave devolveu
 * `idempotent_replay: true` apontando para a linha já criada.
 *
 * Daí as três regras:
 *
 *   1. UMA chave por intenção. Não por tentativa, não por clique.
 *   2. Resposta perdida NÃO descarta a chave — é justamente quando ela importa.
 *   3. Só a confirmação encerra a intenção.
 */

/** O que o servidor respondeu a uma tentativa de gravar. */
export type ResultadoTentativa =
  | { status: 'confirmada'; replay: boolean }
  | { status: 'recusada'; motivo: string }
  | { status: 'indeterminada'; motivo: string };

export interface Intencao {
  /** A chave enviada em toda tentativa desta intenção. */
  readonly idempotencyKey: string;
  /** Uma gravação está em voo. Enquanto for verdade, nenhum novo envio. */
  readonly enviando: boolean;
  /** Recado a mostrar ao usuário, se houver. */
  readonly aviso: string | null;
  /** A intenção terminou e não deve ser reenviada. */
  readonly concluida: boolean;
}

export function abrirIntencao(novaChave: () => string): Intencao {
  return { idempotencyKey: novaChave(), enviando: false, aviso: null, concluida: false };
}

/**
 * Se um novo envio é permitido agora.
 *
 * Bloqueia enquanto há um envio em voo — o clique repetido durante a espera é o
 * caminho mais provável para uma duplicação — e depois de concluída.
 */
export function podeEnviar(i: Intencao): boolean {
  return !i.enviando && !i.concluida;
}

/** Marca o início de um envio. A chave NÃO muda. */
export function iniciarEnvio(i: Intencao): Intencao {
  return { ...i, enviando: true, aviso: null };
}

/**
 * O que a resposta faz com a intenção.
 *
 * `recusada` mantém a chave: a intenção é a mesma, o usuário pode corrigir algo
 * e tentar de novo, e reenviar com a mesma chave continua sendo o certo.
 *
 * `indeterminada` mantém a chave pelo mesmo motivo, com uma diferença
 * importante: aqui a operação PODE ter sido gravada, então quem chama precisa
 * recarregar o estado antes de qualquer coisa — é o que `precisaRecarregar`
 * sinaliza.
 */
export function aplicarResultado(i: Intencao, r: ResultadoTentativa): Intencao {
  if (r.status === 'confirmada') {
    return {
      ...i,
      enviando: false,
      concluida: true,
      aviso: r.replay
        ? 'Esta resolução já estava registrada. Nada foi duplicado.'
        : 'Resolução registrada.',
    };
  }
  return { ...i, enviando: false, aviso: r.motivo };
}

/** Só a resposta perdida obriga a reconferir o estado no servidor. */
export function precisaRecarregar(r: ResultadoTentativa): boolean {
  return r.status === 'indeterminada';
}
