/**
 * Se uma resolução foi revertida, segundo o vínculo embutido pelo PostgREST.
 *
 * Mora fora do `index.ts` porque o entrypoint executa `Deno.serve` na
 * importação e não pode ser carregado por um teste. Esta regra precisa de rede:
 * ela já falhou uma vez, em silêncio, do jeito mais caro possível.
 *
 * O formato do vínculo depende da CARDINALIDADE que o PostgREST infere, e ela
 * mudou debaixo de nós. O índice único sobre `resolution_id` — criado para
 * garantir que uma resolução só possa ser revertida uma vez — transformou a
 * relação em «para um», e o embed passou a chegar como objeto ou `null` em vez
 * de array.
 *
 * A primeira versão testava só `Array.isArray(...)`. Com o objeto, nenhuma
 * resolução era considerada revertida: o desfazer gravava a linha de reversão,
 * a trilha de auditoria ficava correta, e o número não mudava. O usuário via a
 * confirmação e continuava com o valor resolvido.
 *
 * Aceitar as duas formas tira a dependência de um detalhe de inferência que
 * pode mudar de novo.
 */
export function foiRevertida(vinculo: unknown): boolean {
  if (vinculo == null) return false;
  if (Array.isArray(vinculo)) return vinculo.length > 0;
  return typeof vinculo === 'object';
}
