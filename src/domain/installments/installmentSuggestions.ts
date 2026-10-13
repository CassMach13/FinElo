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
 * POR QUE A PRIMEIRA VERSÃO NÃO ATENDIA O USO MENSAL
 * ===========================================================================
 *
 * A primeira versão exigia que a irmã tivesse data ESTRITAMENTE anterior à da
 * parcela nova. Só que a fatura de cartão repete, em toda parcela, a data da
 * COMPRA: a 1/6 e a 2/6 chegam com o mesmo dia. Medido no histórico real, de
 * 277 parcelas com irmã anterior classificável, 241 tinham a irmã na MESMA
 * data — e todas eram descartadas. A sugestão aparecia em 1 de cada 10 casos.
 *
 * A data igual não é um problema a tolerar: é a melhor evidência disponível
 * de que as duas linhas são a mesma compra.
 *
 * ===========================================================================
 * DOIS NÍVEIS
 * ===========================================================================
 *
 *   A. «reconhecida» — os metadados confirmam a continuação da compra.
 *   B. «historico»   — a nova é parcela, não há irmã confirmada, mas existe
 *                      compra anterior plausível. Nunca vem pré-marcada.
 *
 * ===========================================================================
 * POR QUE O CRITÉRIO CONTINUA ESTREITO
 * ===========================================================================
 *
 * Casar só por «mesmo valor» não basta, e isso não é teoria: numa conta real
 * existem SEIS lançamentos que batem em (mesma conta, Total_Parcelas = 4,
 * valor = R$ 50,00) — mais linhas do que um plano de 4x comporta. São dois
 * planos diferentes que coincidem em valor e prazo. Um casamento ingênuo
 * juntaria os dois e sugeriria a categoria errada com cara de certeza.
 *
 * O que separa dois planos concorrentes é a data da compra (quando o emissor
 * a repete) ou a continuidade `Parcela_Atual − 1`. Valor igual, sozinho,
 * nunca é candidato — nem no nível B.
 */

import type { Transaction } from '../../types';
import { parseDateOnlyLocal, toDateOnlyIso } from '../../utils/dateOnly';
import { extractInstallments } from './installmentMarker';

/** Confiança do casamento. Valor exato sempre vence o de centavo. */
export type ConfiancaCandidato = 'exata' | 'centavo';

/** «reconhecida»: metadados confirmam a compra. «historico»: plausível, a conferir. */
export type NivelDeSugestao = 'reconhecida' | 'historico';

export interface ParcelaCandidata {
  idTransacao: string;
  /** O nome que o USUÁRIO usa — é ele que a sugestão copia, não o texto cru do banco. */
  nomeFantasia: string;
  categoria: string;
  valor: number;
  /** `null` quando a compra anterior não tem parcela registrada (só no nível «historico»). */
  parcelaAtual: number | null;
  totalParcelas: number | null;
  data: Date;
  confianca: ConfiancaCandidato;
  nivel: NivelDeSugestao;
  /** Mesmo dia da parcela nova: a fatura repete a data da compra em toda parcela. */
  mesmaDataDeCompra: boolean;
  /** Texto do banco equivalente, descontado o marcador de parcela. */
  descricaoSemelhante: boolean;
  /** A parcela não estava nos campos próprios e foi lida do texto original do banco. */
  parcelaLidaDoTexto: boolean;
}

/** Uma parcela do arquivo que tem candidata(s). */
export interface SugestaoDeParcela {
  /** Posição na lista de transações do arquivo — a chave para aplicar a escolha. */
  indice: number;
  descricaoImportada: string;
  valor: number;
  parcelaAtual: number;
  totalParcelas: number;
  data: Date;
  nivel: NivelDeSugestao;
  /** A importação não tem conta de destino: comparou-se só com lançamentos também sem conta. */
  contaIndefinida: boolean;
  /** Uma opção por classificação distinta. Melhor evidência primeiro. */
  candidatos: ParcelaCandidata[];
}

/** Forma mínima lida da transação que está sendo importada. */
export interface ParcelaImportada {
  Descricao_Original?: string;
  Nome_Fantasia?: string;
  Categoria?: string;
  Valor: number;
  Parcela_Atual?: number | null;
  Total_Parcelas?: number | null;
  Data: Date | string;
}

export interface OpcoesDeSugestao {
  /**
   * O destino é cartão de crédito: quando o histórico não tem a parcela nos
   * campos próprios, aceita lê-la do texto original do banco ("... 2/6").
   * Fora de cartão o mesmo `X/Y` no fim do texto costuma ser data.
   */
  contaEhCartao?: boolean;
}

/** Teto de opções por parcela: o modal é para decidir rápido, não para pesquisar. */
const MAXIMO_DE_OPCOES = 3;

const emCentavos = (valor: number): number => Math.round(Math.abs(Number(valor) || 0) * 100);

const contaDe = (conta: string | null | undefined): string => String(conta ?? '').trim();

const temClassificacao = (categoria: unknown): boolean => {
  const texto = String(categoria ?? '').trim();
  return texto !== '' && texto !== '-';
};

/** Texto do banco sem acento, sem marcador de parcela e sem pontuação. */
const normalizarDescricao = (texto: string | undefined): string =>
  extractInstallments(String(texto ?? '').trim())
    .cleanedDescription.normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\bPARC(?:ELA|ELADO|ELAMENTO)?\b\.?/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

/**
 * Duas descrições do banco falam do mesmo estabelecimento?
 *
 * Igualdade depois de normalizar, uma ser prefixo longo da outra (o banco
 * trunca o texto de um mês para o outro) ou a maioria das palavras em comum.
 * Uma palavra curta em comum ("LOJA", "PAG") não basta.
 */
export function descricoesSemelhantes(a: string | undefined, b: string | undefined): boolean {
  const na = normalizarDescricao(a);
  const nb = normalizarDescricao(b);
  if (na.length < 4 || nb.length < 4) return false;
  if (na === nb) return true;

  const [curta, longa] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (curta.length >= 8 && longa.startsWith(curta)) return true;

  const palavras = (s: string) => new Set(s.split(' ').filter((p) => p.length >= 3));
  const pa = palavras(na);
  const pb = palavras(nb);
  if (pa.size === 0 || pb.size === 0) return false;
  let comuns = 0;
  let comumLonga = false;
  for (const p of pa) {
    if (!pb.has(p)) continue;
    comuns += 1;
    if (p.length >= 4) comumLonga = true;
  }
  const uniao = pa.size + pb.size - comuns;
  return comumLonga && comuns / uniao >= 0.6;
}

interface ParcelaLida {
  atual: number;
  total: number;
  lidaDoTexto: boolean;
}

/**
 * A parcela de um lançamento do histórico.
 *
 * Vale o campo próprio. Só quando ele falta — lançamentos antigos perderam a
 * numeração ao serem editados — e o destino é cartão, lê-se o marcador do
 * texto original do banco, com as mesmas guardas da importação (fim do texto,
 * `atual <= total`, não coincidir com dia/mês da própria transação).
 */
function parcelaDaExistente(t: Transaction, opcoes: OpcoesDeSugestao): ParcelaLida | null {
  const atual = Number(t.Parcela_Atual ?? 0);
  const total = Number(t.Total_Parcelas ?? 0);
  if (Number.isFinite(atual) && Number.isFinite(total) && atual >= 1 && total >= 2) {
    return { atual, total, lidaDoTexto: false };
  }
  if (!opcoes.contaEhCartao) return null;

  const marcador = extractInstallments(
    String(t.Descricao_Original ?? ''),
    parseDateOnlyLocal(t.Data) ?? undefined
  );
  if (marcador.current === undefined || marcador.total === undefined || marcador.total < 2) return null;
  return { atual: marcador.current, total: marcador.total, lidaDoTexto: true };
}

interface ExistenteAvaliada {
  transacao: Transaction;
  parcela: ParcelaLida | null;
  centavos: number;
  dia: string;
}

/** Só o que pode servir de sugestão: mesma conta, com data válida e já classificado. */
function prepararHistorico(
  contaId: string | null | undefined,
  existentes: Transaction[],
  opcoes: OpcoesDeSugestao
): ExistenteAvaliada[] {
  const conta = contaDe(contaId);
  const avaliadas: ExistenteAvaliada[] = [];
  for (const t of existentes) {
    if (contaDe(t.ID_Conta) !== conta) continue;
    const dia = toDateOnlyIso(t.Data);
    if (!dia) continue;
    avaliadas.push({ transacao: t, parcela: parcelaDaExistente(t, opcoes), centavos: emCentavos(t.Valor), dia });
  }
  return avaliadas;
}

/**
 * Esta conta recebe faturas que repetem a data da COMPRA em toda parcela?
 *
 * Sim quando o próprio histórico mostra duas parcelas diferentes do mesmo
 * plano (mesmo total, mesmo valor) no mesmo dia. Nessas contas a irmã de uma
 * parcela tem, por construção, a mesma data — e uma parcela anterior com
 * outra data é outra compra.
 */
function contaRepeteDataDeCompra(historico: ExistenteAvaliada[]): boolean {
  const vistas = new Map<string, number>();
  for (const h of historico) {
    if (!h.parcela) continue;
    const chave = `${h.parcela.total}|${h.centavos}|${h.dia}`;
    const anterior = vistas.get(chave);
    if (anterior !== undefined && anterior !== h.parcela.atual) return true;
    vistas.set(chave, h.parcela.atual);
  }
  return false;
}

const montarCandidato = (
  h: ExistenteAvaliada,
  nivel: NivelDeSugestao,
  diferenca: number,
  mesmaDataDeCompra: boolean,
  descricaoSemelhante: boolean
): ParcelaCandidata => ({
  idTransacao: String(h.transacao.ID_Transacao ?? ''),
  nomeFantasia: String(h.transacao.Nome_Fantasia ?? ''),
  categoria: String(h.transacao.Categoria ?? ''),
  valor: Number(h.transacao.Valor),
  parcelaAtual: h.parcela ? h.parcela.atual : null,
  totalParcelas: h.parcela ? h.parcela.total : null,
  data: parseDateOnlyLocal(h.transacao.Data) ?? new Date(Number.NaN),
  confianca: diferenca === 0 ? 'exata' : 'centavo',
  nivel,
  mesmaDataDeCompra,
  descricaoSemelhante,
  parcelaLidaDoTexto: Boolean(h.parcela?.lidaDoTexto),
});

/** Valor exato primeiro; depois a melhor evidência; depois a parcela mais próxima e a mais recente. */
const ordenar = (candidatos: ParcelaCandidata[]): ParcelaCandidata[] =>
  candidatos.sort((a, b) => {
    if (a.confianca !== b.confianca) return a.confianca === 'exata' ? -1 : 1;
    if (a.mesmaDataDeCompra !== b.mesmaDataDeCompra) return a.mesmaDataDeCompra ? -1 : 1;
    if (a.descricaoSemelhante !== b.descricaoSemelhante) return a.descricaoSemelhante ? -1 : 1;
    const parcelaA = a.parcelaAtual ?? 0;
    const parcelaB = b.parcelaAtual ?? 0;
    if (parcelaA !== parcelaB) return parcelaB - parcelaA;
    return b.data.getTime() - a.data.getTime();
  });

interface NovaAvaliada {
  parcelaAtual: number;
  totalParcelas: number;
  centavos: number;
  dia: string;
  descricao: string | undefined;
}

function avaliarNova(nova: ParcelaImportada): NovaAvaliada | null {
  const parcelaAtual = Number(nova.Parcela_Atual ?? 0);
  const totalParcelas = Number(nova.Total_Parcelas ?? 0);
  // 1/X não roda: não existe parcela anterior para copiar.
  if (!Number.isFinite(parcelaAtual) || parcelaAtual < 2) return null;
  if (!Number.isFinite(totalParcelas) || totalParcelas < 2) return null;
  const dia = toDateOnlyIso(nova.Data);
  if (!dia) return null;
  return { parcelaAtual, totalParcelas, centavos: emCentavos(nova.Valor), dia, descricao: nova.Descricao_Original };
}

/** Nível A: parcelas anteriores do MESMO plano, com evidência de que é a mesma compra. */
function candidatosReconhecidos(
  nova: NovaAvaliada,
  historico: ExistenteAvaliada[],
  repeteDataDeCompra: boolean
): ParcelaCandidata[] {
  let candidatos: ParcelaCandidata[] = [];

  for (const h of historico) {
    if (!h.parcela) continue;
    if (h.parcela.total !== nova.totalParcelas) continue;
    if (h.parcela.atual >= nova.parcelaAtual) continue;
    // Do futuro não vem sugestão. Mesmo dia vale: é a data da compra repetida.
    if (h.dia > nova.dia) continue;
    const diferenca = Math.abs(h.centavos - nova.centavos);
    if (diferenca > 1) continue;
    if (!temClassificacao(h.transacao.Categoria)) continue;

    const mesmaDataDeCompra = h.dia === nova.dia;
    const semelhante = descricoesSemelhantes(h.transacao.Descricao_Original, nova.descricao);
    const parcelaAnterior = h.parcela.atual === nova.parcelaAtual - 1;

    // Numa conta cuja fatura repete a data da compra, parcela anterior com
    // OUTRA data é outra compra — a continuidade sozinha deixa de valer.
    const continuidadeVale = parcelaAnterior && !repeteDataDeCompra;
    if (!mesmaDataDeCompra && !continuidadeVale) continue;

    candidatos.push(montarCandidato(h, 'reconhecida', diferenca, mesmaDataDeCompra, semelhante));
  }

  // Havendo irmã na mesma data, as de outra data são de outro plano.
  if (candidatos.some((c) => c.mesmaDataDeCompra)) {
    candidatos = candidatos.filter((c) => c.mesmaDataDeCompra);
  }

  return ordenar(candidatos);
}

/**
 * Nível B: a nova é parcela, não há irmã confirmada — compras anteriores plausíveis.
 *
 * Valor igual nunca basta. Além de conta, valor e cronologia, exige-se UMA
 * corroboração:
 *
 *   - o mesmo estabelecimento no texto do banco; ou
 *   - a mesma data de compra (o lançamento antigo perdeu a numeração da
 *     parcela, mas é do mesmo dia e do mesmo valor); ou
 *   - ser parcela anterior de um plano com o mesmo total, em conta cuja
 *     fatura NÃO repete a data da compra.
 *
 * Um plano de total diferente é outra compra e fica de fora.
 */
function candidatosPeloHistorico(
  nova: NovaAvaliada,
  historico: ExistenteAvaliada[],
  repeteDataDeCompra: boolean
): ParcelaCandidata[] {
  const candidatos: ParcelaCandidata[] = [];

  for (const h of historico) {
    if (h.dia > nova.dia) continue;
    const diferenca = Math.abs(h.centavos - nova.centavos);
    if (diferenca > 1) continue;
    if (!temClassificacao(h.transacao.Categoria)) continue;

    if (h.parcela && h.parcela.total !== nova.totalParcelas) continue;
    if (h.parcela && h.parcela.atual >= nova.parcelaAtual) continue;

    const mesmaDataDeCompra = h.dia === nova.dia;
    const semelhante = descricoesSemelhantes(h.transacao.Descricao_Original, nova.descricao);
    const parcelaAnteriorDoPlano = Boolean(h.parcela) && !repeteDataDeCompra;
    if (!semelhante && !mesmaDataDeCompra && !parcelaAnteriorDoPlano) continue;

    candidatos.push(montarCandidato(h, 'historico', diferenca, mesmaDataDeCompra, semelhante));
  }

  return ordenar(candidatos);
}

/**
 * As irmãs confirmadas de UMA parcela importada (nível «reconhecida»).
 *
 * Todas as condições valem junto:
 *
 *   1. a nova é 2/X ou posterior (1/X não tem irmã anterior por definição);
 *   2. mesma conta (sem conta de destino, só lançamentos também sem conta);
 *   3. mesmo `Total_Parcelas`;
 *   4. a candidata é uma parcela ANTERIOR do plano e não é posterior no tempo;
 *   5. valor igual em centavos («exata») ou distante 1 centavo («centavo»);
 *   6. a candidata já foi classificada pelo usuário;
 *   7. é a mesma compra: mesma data de compra, ou — em conta cuja fatura não
 *      repete a data — exatamente a parcela `Parcela_Atual − 1`.
 *
 * A tolerância de 1 centavo é fixa e absoluta, nunca percentual: ela existe
 * para o arredondamento de um plano que não divide exato (R$ 100 em 3x =
 * 33,33 + 33,33 + 33,34), não para aproximar valores parecidos.
 */
export function encontrarCandidatosDeParcelaIrma(
  nova: ParcelaImportada,
  contaId: string | null | undefined,
  existentes: Transaction[],
  opcoes: OpcoesDeSugestao = {}
): ParcelaCandidata[] {
  const avaliada = avaliarNova(nova);
  if (!avaliada) return [];
  const historico = prepararHistorico(contaId, existentes, opcoes);
  return candidatosReconhecidos(avaliada, historico, contaRepeteDataDeCompra(historico));
}

const chaveDeClassificacao = (nome: unknown, categoria: unknown): string =>
  `${String(nome ?? '').trim().toLowerCase()}|${String(categoria ?? '').trim().toLowerCase()}`;

/** Uma opção por classificação distinta: três parcelas do mesmo plano são UMA sugestão. */
function umaPorClassificacao(candidatos: ParcelaCandidata[]): ParcelaCandidata[] {
  const vistas = new Set<string>();
  return candidatos.filter((c) => {
    const chave = chaveDeClassificacao(c.nomeFantasia, c.categoria);
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
}

/**
 * Percorre o lote importado e devolve só as parcelas que TÊM candidato.
 *
 * Uma lista vazia significa «nada a perguntar»: a importação segue exatamente
 * como sempre seguiu. Também não se pergunta quando a parcela já chegou com a
 * mesma descrição e categoria da candidata — não haveria o que mudar.
 */
export function construirSugestoesDeParcela(
  novas: ParcelaImportada[],
  contaId: string | null | undefined,
  existentes: Transaction[],
  opcoes: OpcoesDeSugestao = {}
): SugestaoDeParcela[] {
  const historico = prepararHistorico(contaId, existentes, opcoes);
  if (historico.length === 0) return [];
  const repeteDataDeCompra = contaRepeteDataDeCompra(historico);
  const contaIndefinida = contaDe(contaId) === '';

  const sugestoes: SugestaoDeParcela[] = [];

  novas.forEach((nova, indice) => {
    const avaliada = avaliarNova(nova);
    if (!avaliada) return;

    let nivel: NivelDeSugestao = 'reconhecida';
    let encontrados = candidatosReconhecidos(avaliada, historico, repeteDataDeCompra);
    if (encontrados.length === 0) {
      nivel = 'historico';
      encontrados = candidatosPeloHistorico(avaliada, historico, repeteDataDeCompra);
    }

    const jaClassificada = chaveDeClassificacao(nova.Nome_Fantasia, nova.Categoria);
    const candidatos = umaPorClassificacao(encontrados)
      .filter((c) => chaveDeClassificacao(c.nomeFantasia, c.categoria) !== jaClassificada)
      .slice(0, MAXIMO_DE_OPCOES);
    if (candidatos.length === 0) return;

    sugestoes.push({
      indice,
      descricaoImportada: String(nova.Nome_Fantasia || nova.Descricao_Original || ''),
      valor: Number(nova.Valor),
      parcelaAtual: avaliada.parcelaAtual,
      totalParcelas: avaliada.totalParcelas,
      data: parseDateOnlyLocal(nova.Data) ?? new Date(Number.NaN),
      nivel,
      contaIndefinida,
      candidatos,
    });
  });

  return sugestoes;
}

/**
 * Pode pré-sugerir sozinho?
 *
 * Só quando a compra foi RECONHECIDA, há UMA classificação possível e a conta
 * de destino é conhecida. Duas ou mais sempre vão para escolha explícita:
 * preferir uma seria escolher pelo usuário. Candidato «pelo histórico» nunca
 * vem marcado — ele é plausível, não confirmado.
 */
export function podePreSugerir(sugestao: SugestaoDeParcela): boolean {
  return sugestao.nivel === 'reconhecida' && !sugestao.contaIndefinida && sugestao.candidatos.length === 1;
}

/**
 * O estado inicial do modal: `indice` do lote → id pré-marcado, ou `null`.
 *
 * Só o que `podePreSugerir` autoriza vem marcado, e o usuário ainda pode
 * desmarcar. Todo o resto começa SEM escolha.
 */
export function escolhasIniciaisDeParcela(sugestoes: SugestaoDeParcela[]): Map<number, string | null> {
  const inicial = new Map<number, string | null>();
  for (const sugestao of sugestoes) {
    inicial.set(sugestao.indice, podePreSugerir(sugestao) ? sugestao.candidatos[0].idTransacao : null);
  }
  return inicial;
}

/** Por que este lançamento anterior está sendo oferecido — em palavras do usuário. */
export function evidenciasDoCandidato(candidato: ParcelaCandidata): string[] {
  const evidencias: string[] = [];
  if (candidato.parcelaAtual !== null && candidato.totalParcelas !== null) {
    evidencias.push(`parcela ${candidato.parcelaAtual}/${candidato.totalParcelas}`);
  }
  if (candidato.mesmaDataDeCompra) evidencias.push('mesma data de compra');
  if (candidato.descricaoSemelhante) evidencias.push('mesmo estabelecimento');
  if (candidato.confianca === 'centavo') evidencias.push('difere em R$ 0,01');
  return evidencias;
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
