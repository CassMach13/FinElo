import { collectPaginatedRows } from '../../../src/utils/paginatedFetch.ts';

/**
 * Leitura COMPLETA de uma coleção, ou nenhuma leitura.
 *
 * ===========================================================================
 * POR QUE ESTE ARQUIVO EXISTE
 * ===========================================================================
 *
 * A Edge lia `transactions` com `.select('*')` cru. O PostgREST corta a
 * resposta em `max-rows` e devolve **200 OK** — sem erro, sem aviso, só um
 * `Content-Range: 0-999/*` que ninguém olhava. Em produção isso significou
 * calcular o snapshot financeiro da conta piloto sobre 1.000 de 3.768 linhas.
 *
 * O efeito foi exatamente uma linha de compra sumir da competência 2024-12
 * («Compras Ione», R$ 49,76), e a diferença de reconciliação ir de +R$ 0,22
 * para +R$ 49,98 — um valor que o usuário seria convidado a classificar como
 * crédito econômico que nunca existiu.
 *
 * O cliente nunca teve esse problema: ele pagina desde sempre
 * (`collectPaginatedRows`). Era a Edge, o lado CONFIÁVEL, que lia menos.
 *
 * ===========================================================================
 * FAIL CLOSED
 * ===========================================================================
 *
 * Paginar não basta. Se `max-rows` for MENOR que o tamanho da página, a
 * primeira página volta curta e um laço ingênuo conclui «acabou» — de novo
 * truncado, de novo em silêncio.
 *
 * Por isso a contagem exata é obrigatória e conferida no fim: sem prova de que
 * todas as páginas vieram, esta função LANÇA em vez de devolver um conjunto
 * parcial. Um snapshot financeiro derivado de leitura não verificada é pior do
 * que snapshot nenhum, porque parece certo.
 *
 * O laço de paginação em si é o do cliente, reaproveitado — não há um segundo
 * algoritmo aqui, só a verificação que faltava.
 */

/** Mesma página do cliente. Manter igual mantém as duas superfícies simétricas. */
export const TAMANHO_PAGINA = 1000;

export interface PaginaLida<T> {
  data: T[] | null;
  error: { message: string } | null;
  /** `count: 'exact'` do PostgREST. Sem ele não há prova de completude. */
  count: number | null;
}

/**
 * Coleta todas as páginas e só devolve se a contagem bater.
 *
 * @param nome  Nome da coleção, para a mensagem de erro dizer o que faltou.
 * @param pagina Busca uma página. DEVE pedir `count: 'exact'` e ordenar por
 *               coluna única — sem ordem determinística, páginas se sobrepõem
 *               e a contagem bateria com o conjunto errado.
 */
export async function lerColecaoCompleta<T>(
  nome: string,
  pagina: (from: number, to: number) => PromiseLike<PaginaLida<T>>
): Promise<T[]> {
  let total: number | null = null;

  const linhas = await collectPaginatedRows<T>(async (from, to) => {
    const { data, error, count } = await pagina(from, to);
    if (error) return { data: null, error };
    if (count != null) total = count;
    return { data: data ?? [], error: null };
  }, TAMANHO_PAGINA);

  if (total == null) {
    throw new Error(
      `${nome}: leitura sem contagem exata — completude não verificável, nada é materializado`
    );
  }
  if (linhas.length !== total) {
    throw new Error(
      `${nome}: leitura incompleta (${linhas.length} de ${total} linhas) — ` +
        'provável corte por max-rows; nada é materializado'
    );
  }

  return linhas;
}
