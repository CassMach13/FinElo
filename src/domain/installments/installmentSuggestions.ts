/** Sugestão de nome e categoria a partir da parcela imediatamente anterior. */

import type { CardImportCycleInput, Transaction } from '../../types';
import { resolveCardImportCycleCoordinates } from '../../utils/cardImportReference';
import { parseDateOnlyLocal, toDateOnlyIso } from '../../utils/dateOnly';
import { extractInstallments } from './installmentMarker';

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
  /** Uma opção por transação candidata. Melhor evidência primeiro. */
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
  Data_Pagamento?: Date | string | null;
}

export interface OpcoesDeSugestao {
  /**
   * O destino é cartão de crédito: quando o histórico não tem a parcela nos
   * campos próprios, aceita lê-la do texto original do banco ("... 2/6").
   * Fora de cartão o mesmo `X/Y` no fim do texto costuma ser data.
   */
  contaEhCartao?: boolean;
  /** O formato da fatura usa a data da compra em todas as parcelas. */
  repeteDataDeCompra?: boolean;
  cicloDaFatura?: CardImportCycleInput;
  ciclosPorLote?: ReadonlyMap<string, CardImportCycleInput>;
}

const emCentavos = (valor: number): number => Math.sign(valor) * Math.round(Math.abs(valor) * 100);

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
  ciclo?: CoordenadasDaFatura;
}

interface CoordenadasDaFatura {
  mesVencimento?: string;
  referencia?: string;
}

function coordenadasDaFatura(
  ciclo: CardImportCycleInput | undefined,
  dataPagamento: ParcelaImportada['Data_Pagamento'],
  diaCompra: string
): CoordenadasDaFatura {
  const { dueDate, purchaseReferenceLabel } = resolveCardImportCycleCoordinates(ciclo);
  const pagamento = toDateOnlyIso(dataPagamento);
  // Os parsers usam a própria data da compra quando não recebem vencimento.
  const vencimento = dueDate ?? (pagamento > diaCompra ? pagamento : undefined);
  return { mesVencimento: vencimento?.slice(0, 7), referencia: purchaseReferenceLabel };
}

function compararCiclos(anterior?: CoordenadasDaFatura, atual?: CoordenadasDaFatura): number | undefined {
  if (anterior?.mesVencimento && atual?.mesVencimento) {
    return anterior.mesVencimento.localeCompare(atual.mesVencimento);
  }
  if (anterior?.referencia && atual?.referencia) return anterior.referencia.localeCompare(atual.referencia);
}

/** Só o que pode servir de sugestão: mesma conta, com data válida e já classificado. */
function prepararHistorico(
  contaId: string | null | undefined,
  existentes: Transaction[],
  opcoes: OpcoesDeSugestao
): ExistenteAvaliada[] {
  const conta = contaDe(contaId);
  if (!conta) return [];
  const avaliadas: ExistenteAvaliada[] = [];
  for (const t of existentes) {
    if (contaDe(t.ID_Conta) !== conta) continue;
    const dia = toDateOnlyIso(t.Data);
    if (!dia) continue;
    const centavos = emCentavos(t.Valor);
    if (!Number.isFinite(centavos)) continue;
    const lote = t.import_log_id ? opcoes.ciclosPorLote?.get(t.import_log_id) : undefined;
    const ciclo = opcoes.contaEhCartao ? coordenadasDaFatura(lote, t.Data_Pagamento, dia) : undefined;
    avaliadas.push({ transacao: t, parcela: parcelaDaExistente(t, opcoes), centavos, dia, ciclo });
  }
  return avaliadas;
}

const montarCandidato = (
  h: ExistenteAvaliada,
  parcela: ParcelaLida,
  diferenca: number,
  mesmaDataDeCompra: boolean,
  descricaoSemelhante: boolean
): ParcelaCandidata => ({
  idTransacao: String(h.transacao.ID_Transacao ?? ''),
  nomeFantasia: String(h.transacao.Nome_Fantasia ?? ''),
  categoria: String(h.transacao.Categoria ?? ''),
  valor: Number(h.transacao.Valor),
  parcelaAtual: parcela.atual,
  totalParcelas: parcela.total,
  data: parseDateOnlyLocal(h.transacao.Data) ?? new Date(Number.NaN),
  confianca: diferenca === 0 ? 'exata' : 'centavo',
  mesmaDataDeCompra,
  descricaoSemelhante,
  parcelaLidaDoTexto: parcela.lidaDoTexto,
});

/** Valor exato primeiro; depois a melhor evidência; depois a parcela mais próxima e a mais recente. */
const ordenar = (candidatos: ParcelaCandidata[]): ParcelaCandidata[] =>
  candidatos.sort((a, b) => {
    if (a.confianca !== b.confianca) return a.confianca === 'exata' ? -1 : 1;
    if (a.mesmaDataDeCompra !== b.mesmaDataDeCompra) return a.mesmaDataDeCompra ? -1 : 1;
    if (a.descricaoSemelhante !== b.descricaoSemelhante) return a.descricaoSemelhante ? -1 : 1;
    return b.data.getTime() - a.data.getTime();
  });

interface NovaAvaliada {
  parcelaAtual: number;
  totalParcelas: number;
  centavos: number;
  dia: string;
  descricao: string | undefined;
  ciclo?: CoordenadasDaFatura;
}

function avaliarNova(nova: ParcelaImportada, opcoes: OpcoesDeSugestao): NovaAvaliada | null {
  const parcelaAtual = Number(nova.Parcela_Atual ?? 0);
  const totalParcelas = Number(nova.Total_Parcelas ?? 0);
  // 1/X não roda: não existe parcela anterior para copiar.
  if (!Number.isInteger(parcelaAtual) || parcelaAtual < 2) return null;
  if (!Number.isInteger(totalParcelas) || totalParcelas < parcelaAtual) return null;
  const dia = toDateOnlyIso(nova.Data);
  if (!dia) return null;
  const centavos = emCentavos(nova.Valor);
  if (!Number.isFinite(centavos)) return null;
  const ciclo = opcoes.contaEhCartao ? coordenadasDaFatura(opcoes.cicloDaFatura, nova.Data_Pagamento, dia) : undefined;
  return { parcelaAtual, totalParcelas, centavos, dia, descricao: nova.Descricao_Original, ciclo };
}

/** Parcelas do mesmo plano, com evidência de anterioridade. */
function candidatosReconhecidos(
  nova: NovaAvaliada,
  historico: ExistenteAvaliada[],
  opcoes: OpcoesDeSugestao
): ParcelaCandidata[] {
  const candidatos: ParcelaCandidata[] = [];

  for (const h of historico) {
    if (!h.parcela) continue;
    if (h.parcela.total !== nova.totalParcelas) continue;
    if (h.parcela.atual !== nova.parcelaAtual - 1) continue;
    if (h.dia > nova.dia) continue;

    const mesmaDataDeCompra = h.dia === nova.dia;
    const ordemDoCiclo = compararCiclos(h.ciclo, nova.ciclo);
    // Uma data de compra repetida precisa de um ciclo comparável para comprovar a ordem.
    if (ordemDoCiclo === undefined ? mesmaDataDeCompra : ordemDoCiclo >= 0) continue;
    const diferenca = Math.abs(h.centavos - nova.centavos);
    if (diferenca > 1) continue;
    if (!temClassificacao(h.transacao.Categoria)) continue;

    if (!mesmaDataDeCompra && opcoes.repeteDataDeCompra) continue;

    const semelhante = descricoesSemelhantes(h.transacao.Descricao_Original, nova.descricao);
    candidatos.push(montarCandidato(h, h.parcela, diferenca, mesmaDataDeCompra, semelhante));
  }

  return ordenar(candidatos);
}

/** Candidatos da parcela imediatamente anterior, dentro de um centavo. */
export function encontrarCandidatosDeParcelaIrma(
  nova: ParcelaImportada,
  contaId: string | null | undefined,
  existentes: Transaction[],
  opcoes: OpcoesDeSugestao = {}
): ParcelaCandidata[] {
  const avaliada = avaliarNova(nova, opcoes);
  if (!avaliada) return [];
  const historico = prepararHistorico(contaId, existentes, opcoes);
  return candidatosReconhecidos(avaliada, historico, opcoes);
}

const chaveDeClassificacao = (nome: unknown, categoria: unknown): string =>
  `${String(nome ?? '').trim().toLowerCase()}|${String(categoria ?? '').trim().toLowerCase()}`;

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

  const sugestoes: SugestaoDeParcela[] = [];

  novas.forEach((nova, indice) => {
    const avaliada = avaliarNova(nova, opcoes);
    if (!avaliada) return;

    const candidatos = candidatosReconhecidos(avaliada, historico, opcoes);
    const jaClassificada = chaveDeClassificacao(nova.Nome_Fantasia, nova.Categoria);
    if (candidatos.every((c) => chaveDeClassificacao(c.nomeFantasia, c.categoria) === jaClassificada)) return;

    sugestoes.push({
      indice,
      descricaoImportada: String(nova.Nome_Fantasia || nova.Descricao_Original || ''),
      valor: Number(nova.Valor),
      parcelaAtual: avaliada.parcelaAtual,
      totalParcelas: avaliada.totalParcelas,
      data: parseDateOnlyLocal(nova.Data) ?? new Date(Number.NaN),
      candidatos,
    });
  });

  return sugestoes;
}

/** Uma única transação candidata permite pré-seleção. */
export function podePreSugerir(sugestao: SugestaoDeParcela): boolean {
  return sugestao.candidatos.length === 1;
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
