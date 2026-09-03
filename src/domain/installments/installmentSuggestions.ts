/**
 * Sugestão de descrição/categoria para a parcela que chega pelo extrato.
 *
 * ===========================================================================
 * O PROBLEMA
 * ===========================================================================
 *
 * Cada linha importada é classificada isoladamente, por regra de texto
 * (`mappingRules`). Isso funciona para o mercado da esquina, cujo texto é
 * sempre igual, e falha para lojas onde a descrição muda a cada compra —
 * "AMAZON *LIVRO", "AMAZON *FONE". Nenhuma regra fixa cobre as duas, então a
 * parcela 2/12 chega sem categoria e o usuário reclassifica à mão o que já
 * havia classificado no mês anterior, uma vez por parcela.
 *
 * A informação que resolve isso já existe no banco: a parcela irmã, já
 * classificada, do mês passado.
 *
 * ===========================================================================
 * O QUE ESTE MÓDULO É — E O QUE NÃO É
 * ===========================================================================
 *
 * É uma CONSULTA. Devolve candidatos; não decide, não escreve, não cria
 * transação, não gera parcela futura, não grava regra de mapeamento
 * persistente ("AMAZON *LIVRO" não vira regra para toda a Amazon) e não
 * reescreve histórico. Quem decide é o usuário, antes da importação.
 *
 * ===========================================================================
 * POR QUE O CRITÉRIO É ESTREITO
 * ===========================================================================
 *
 * Casar só por «mesmo valor» não basta, e isso não é teoria: numa conta real
 * existem SEIS lançamentos que batem em (mesma conta, Total_Parcelas = 4,
 * valor = R$ 50,00) — mais linhas do que um plano de 4x comporta. São dois
 * planos diferentes que coincidem em valor e prazo. Um casamento ingênuo
 * juntaria os dois e sugeriria a categoria errada com cara de certeza.
 *
 * Por isso a continuidade `Parcela_Atual − 1` é exigida, e não «qualquer
 * parcela anterior do plano»: ela é o que separa dois planos concorrentes.
 */

import type { Transaction } from '../../types';

/** Confiança do casamento. Valor exato sempre vence o de centavo. */
export type ConfiancaCandidato = 'exata' | 'centavo';

export interface ParcelaCandidata {
  idTransacao: string;
  /** O nome que o USUÁRIO usa — é ele que a sugestão copia, não o texto cru do banco. */
  nomeFantasia: string;
  categoria: string;
  valor: number;
  parcelaAtual: number;
  totalParcelas: number;
  data: Date;
  confianca: ConfiancaCandidato;
}

/** Uma parcela do arquivo que tem irmã(s) candidata(s). */
export interface SugestaoDeParcela {
  /** Posição na lista de transações do arquivo — a chave para aplicar a escolha. */
  indice: number;
  descricaoImportada: string;
  valor: number;
  parcelaAtual: number;
  totalParcelas: number;
  data: Date;
  /** Exatas primeiro, depois as de centavo. Mais recente primeiro dentro de cada grupo. */
  candidatos: ParcelaCandidata[];
}

/** Forma mínima lida da transação que está sendo importada. */
export interface ParcelaImportada {
  Descricao_Original?: string;
  Nome_Fantasia?: string;
  Valor: number;
  Parcela_Atual?: number | null;
  Total_Parcelas?: number | null;
  Data: Date | string;
}

const emCentavos = (valor: number): number => Math.round(Math.abs(Number(valor) || 0) * 100);

const tempoDe = (data: Date | string | undefined): number => {
  if (!data) return Number.NaN;
  const d = data instanceof Date ? data : new Date(data);
  const t = d.getTime();
  return Number.isNaN(t) ? Number.NaN : t;
};

/**
 * As irmãs plausíveis de UMA parcela importada.
 *
 * Todas as condições valem junto — nenhuma é opcional:
 *
 *   1. a nova é 2/X ou posterior (1/X não tem irmã anterior por definição);
 *   2. mesma conta;
 *   3. mesmo `Total_Parcelas`;
 *   4. a candidata é exatamente a parcela ANTERIOR (`Parcela_Atual − 1`);
 *   5. a candidata é cronologicamente anterior à nova;
 *   6. valor igual em centavos («exata») ou distante 1 centavo («centavo»).
 *
 * A tolerância de 1 centavo é fixa e absoluta, nunca percentual: ela existe
 * para o arredondamento de um plano que não divide exato (R$ 100 em 3x =
 * 33,33 + 33,33 + 33,34), não para aproximar valores parecidos.
 */
export function encontrarCandidatosDeParcelaIrma(
  nova: ParcelaImportada,
  contaId: string | null | undefined,
  existentes: Transaction[]
): ParcelaCandidata[] {
  const parcelaAtual = Number(nova.Parcela_Atual ?? 0);
  const totalParcelas = Number(nova.Total_Parcelas ?? 0);

  // 1/X não roda: não existe parcela anterior para copiar.
  if (!Number.isFinite(parcelaAtual) || parcelaAtual < 2) return [];
  if (!Number.isFinite(totalParcelas) || totalParcelas < 2) return [];
  if (!contaId) return [];

  const centavosNova = emCentavos(nova.Valor);
  const tempoNova = tempoDe(nova.Data);

  const candidatos: ParcelaCandidata[] = [];

  for (const t of existentes) {
    if (t.ID_Conta !== contaId) continue;
    if (Number(t.Total_Parcelas ?? 0) !== totalParcelas) continue;
    if (Number(t.Parcela_Atual ?? 0) !== parcelaAtual - 1) continue;

    const tempoCandidata = tempoDe(t.Data);
    if (Number.isNaN(tempoCandidata) || Number.isNaN(tempoNova)) continue;
    if (tempoCandidata >= tempoNova) continue;

    const diferenca = Math.abs(emCentavos(t.Valor) - centavosNova);
    if (diferenca > 1) continue;

    candidatos.push({
      idTransacao: String(t.ID_Transacao ?? ''),
      nomeFantasia: String(t.Nome_Fantasia ?? ''),
      categoria: String(t.Categoria ?? ''),
      valor: Number(t.Valor),
      parcelaAtual: Number(t.Parcela_Atual),
      totalParcelas: Number(t.Total_Parcelas),
      data: t.Data instanceof Date ? t.Data : new Date(t.Data),
      confianca: diferenca === 0 ? 'exata' : 'centavo',
    });
  }

  // Exatas antes das de centavo; dentro do grupo, a mais recente primeiro.
  return candidatos.sort((a, b) => {
    if (a.confianca !== b.confianca) return a.confianca === 'exata' ? -1 : 1;
    return b.data.getTime() - a.data.getTime();
  });
}

/**
 * Percorre o lote importado e devolve só as parcelas que TÊM candidato.
 *
 * Uma lista vazia significa «nada a perguntar»: a importação segue exatamente
 * como sempre seguiu.
 */
export function construirSugestoesDeParcela(
  novas: ParcelaImportada[],
  contaId: string | null | undefined,
  existentes: Transaction[]
): SugestaoDeParcela[] {
  const sugestoes: SugestaoDeParcela[] = [];

  novas.forEach((nova, indice) => {
    const candidatos = encontrarCandidatosDeParcelaIrma(nova, contaId, existentes);
    if (candidatos.length === 0) return;

    sugestoes.push({
      indice,
      descricaoImportada: String(nova.Nome_Fantasia || nova.Descricao_Original || ''),
      valor: Number(nova.Valor),
      parcelaAtual: Number(nova.Parcela_Atual),
      totalParcelas: Number(nova.Total_Parcelas),
      data: nova.Data instanceof Date ? nova.Data : new Date(nova.Data),
      candidatos,
    });
  });

  return sugestoes;
}

/**
 * Pode pré-sugerir sozinho?
 *
 * Só com UM candidato. Dois ou mais — mesmo que um seja exato e o outro de
 * centavo — sempre vão para escolha explícita: preferir um automaticamente
 * seria escolher pelo usuário, que é justamente o que não se quer.
 */
export function podePreSugerir(sugestao: SugestaoDeParcela): boolean {
  return sugestao.candidatos.length === 1;
}

/**
 * Aplica o que o usuário escolheu, e SÓ isso.
 *
 * Dois campos mudam: `Nome_Fantasia` e `Categoria`. Valor, data,
 * `Parcela_Atual`, `Total_Parcelas`, competência, conta e origem vêm do
 * arquivo e continuam vindo do arquivo — nenhum número financeiro é tocado
 * aqui. As entradas não são mutadas: volta uma lista nova.
 *
 * @param escolhas `indice` da parcela no lote → id da irmã escolhida, ou
 *                 `null`/ausente para «importar como veio».
 */
export function aplicarEscolhasDeParcela<T extends ParcelaImportada>(
  novas: T[],
  sugestoes: SugestaoDeParcela[],
  escolhas: ReadonlyMap<number, string | null>
): T[] {
  const porIndice = new Map(sugestoes.map((s) => [s.indice, s]));

  return novas.map((nova, indice) => {
    const idEscolhido = escolhas.get(indice);
    if (!idEscolhido) return nova;

    const sugestao = porIndice.get(indice);
    const candidato = sugestao?.candidatos.find((c) => c.idTransacao === idEscolhido);
    if (!candidato) return nova;

    return { ...nova, Nome_Fantasia: candidato.nomeFantasia, Categoria: candidato.categoria } as T;
  });
}
