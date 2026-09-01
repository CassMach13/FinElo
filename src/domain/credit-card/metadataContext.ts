/**
 * O token das palavras-chave de classificação.
 *
 * `cardPaymentKeywords` e `cardCreditKeywords` decidem se uma linha importada é
 * pagamento, estorno ou compra — e portanto mudam o total da competência. São
 * entrada financeira como qualquer outra, e um snapshot calculado com um
 * conjunto de palavras e validado com outro estaria mentindo.
 *
 * As duas moram em `auth.users`, schema gerenciado, onde não instalamos gatilho.
 * Em vez de contador, um TOKEN: a Edge Function lê o estado ATUAL da tabela e
 * calcula o hash na hora da verificação.
 *
 * O token nunca vem do JWT. Um JWT é emitido uma vez e carregado por horas; ele
 * prova o que o usuário tinha quando entrou, não o que tem agora.
 *
 * Este módulo não importa nada. É o mesmo código no navegador e na Edge, e é a
 * única definição da regra — o cliente delega para ela em vez de manter uma
 * cópia que possa divergir.
 */

/** Prefixo de versão da normalização. Muda a regra, muda o token, tudo fica stale. */
const VERSAO = 'v1';

/**
 * As palavras utilizáveis de um valor qualquer.
 *
 *   não-array              -> lista vazia
 *   elemento não-string    -> descartado
 *   string                 -> `trim`
 *   string vazia após trim -> descartada
 *   duplicatas             -> preservadas
 *
 * A ORDEM é preservada. O classificador provavelmente não depende dela, mas
 * preservar ordem só pode causar invalidação a mais; normalizar a ordem poderia
 * esconder uma mudança real. Na dúvida, o erro cai para o lado seguro.
 */
export function normalizeClassifierKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
}

/**
 * A forma canônica das duas listas.
 *
 * Cada palavra vai escapada como string JSON, então uma palavra que contenha
 * `","` não consegue fingir ser duas. As duas listas ficam em posições
 * distintas: trocá-las de lugar muda o token.
 */
export function metadataCanonical(metadata: unknown): string {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const lista = (chave: string) =>
    normalizeClassifierKeywords(meta[chave]).map((k) => JSON.stringify(k)).join(',');

  return `${VERSAO}|p:[${lista('cardPaymentKeywords')}]|c:[${lista('cardCreditKeywords')}]`;
}

/**
 * O token propriamente dito: sha256 da forma canônica, em hexadecimal.
 *
 * Devolve um hash e nunca as palavras — quem compara não precisa saber o
 * conteúdo, só se mudou.
 */
export async function metadataContextToken(metadata: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(metadataCanonical(metadata));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
