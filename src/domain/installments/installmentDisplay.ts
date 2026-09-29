/**
 * Como a coluna "Parc." da tabela de Transações apresenta o par
 * (`Parcela_Atual`, `Total_Parcelas`).
 *
 * ===========================================================================
 * POR QUE ISTO EXISTE
 * ===========================================================================
 *
 * A célula montava o texto assim:
 *
 *     `${transaction.Parcela_Atual || 1}/${transaction.Total_Parcelas || 1}`
 *
 * O `|| 1` inventava uma parcela onde não havia nenhuma: toda transação sem
 * parcelamento aparecia como **1/1**. Na base real isso não é um canto raro —
 * são 6.109 transações, das quais apenas 481 têm `Total_Parcelas > 1`, ou seja
 * cerca de 5.600 linhas afirmando "1/1" sobre um campo vazio. Foi o que
 * originou o chamado 20260905-9C10, em que o usuário relatou ver "1/3, 1/1 e
 * 3/3" e suspeitou dos próprios dados.
 *
 * A mesma tela já se contradizia: o input de edição da célula mostra vazio
 * quando não há parcela, e o badge da visão em cartões só aparece quando
 * `Total_Parcelas > 1`.
 *
 * ===========================================================================
 * O QUE É "AUSENTE" — E POR QUE 0 CONTA COMO AUSENTE
 * ===========================================================================
 *
 * Isto não é escolha nova: é a semântica que a própria gravação já usa. Ao
 * salvar a célula, `handleSave` faz `parseInt(...) || undefined`, então `0` e
 * texto vazio viram `undefined`. O extrator de marcador
 * (`extractInstallments`) recusa `current === 0 || total === 0`. Logo `0` nunca
 * é um valor gravado de propósito — em produção os 80 casos de `0/0` vêm todos
 * da seed `demo.csv`.
 *
 * Presente = inteiro finito >= 1. Qualquer outra coisa (null, undefined, 0,
 * negativo, NaN, fracionário) é ausente.
 *
 * ===========================================================================
 * POR QUE 1/1 CONTINUA SENDO EXIBIDO
 * ===========================================================================
 *
 * `1/1` gravado é dado, não artefato do fallback. O fluxo manual não consegue
 * produzi-lo (o número de parcelas é validado com `count < 2` → erro), mas
 * `extractInstallments` produz `1/1` quando a descrição termina literalmente em
 * "(1/1)". Esconder um par que o banco realmente tem seria decidir que "1/1
 * não é parcelamento" — uma mudança de semântica, e as superfícies do produto
 * não são unânimes quanto a isso (o badge esconde, a linha de detalhe e a
 * exportação mostram).
 *
 * O escopo aqui é parar de **inventar** parcela onde não há, não passar a
 * ocultar parcela onde há. Uma decisão sobre `1/1` exige evidência própria.
 *
 * ===========================================================================
 * POR QUE PAR INCOMPLETO NÃO VIRA PARCELA VÁLIDA
 * ===========================================================================
 *
 * Com um lado só — `Parcela_Atual = 3` e `Total_Parcelas` vazio — o antigo
 * fallback exibia "3/1", que é pior do que não informar: parece um plano de uma
 * parcela. A exportação ainda faz isso hoje (`Total_Parcelas || 1`).
 *
 * Aqui o lado desconhecido é marcado com `?` ("3/?", "?/10"): não se parece com
 * parcela válida, não se parece com campo vazio, e não esconde a inconsistência
 * de quem estiver olhando. Em produção não há nenhum caso (0 registros com um
 * campo sem o outro) — é guarda, não conserto.
 *
 * Esta função é somente apresentação: não normaliza, não grava e não corrige
 * dado algum.
 */

/** Rótulo de "não há parcelamento", igual ao que a tabela já usa para campo vazio. */
export const SEM_PARCELAMENTO = '-';

/** Marca o lado ausente de um par incompleto. */
export const PARCELA_DESCONHECIDA = '?';

const presente = (valor: number | null | undefined): valor is number =>
  typeof valor === 'number' && Number.isInteger(valor) && valor >= 1;

/**
 * Texto da coluna "Parc." para um par (atual, total).
 *
 * - ambos ausentes            → `-`
 * - ambos presentes           → `3/10` (inclusive `1/1`, e inclusive pares
 *                               estranhos como `5/3`, exibidos como estão em
 *                               vez de silenciosamente "arrumados")
 * - apenas um dos dois        → `3/?` ou `?/10`
 */
export const formatInstallmentCell = (
  current: number | null | undefined,
  total: number | null | undefined
): string => {
  const temAtual = presente(current);
  const temTotal = presente(total);

  if (!temAtual && !temTotal) return SEM_PARCELAMENTO;
  if (temAtual && temTotal) return `${current}/${total}`;

  return temAtual
    ? `${current}/${PARCELA_DESCONHECIDA}`
    : `${PARCELA_DESCONHECIDA}/${total}`;
};
