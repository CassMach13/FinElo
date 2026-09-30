/**
 * Modelo exportável de transações — a ÚNICA fonte da semântica dos arquivos
 * CSV e XLSX (chamado 20260905-A902).
 *
 * ===========================================================================
 * POR QUE ISTO EXISTE
 * ===========================================================================
 *
 * Antes, a tela de Transações montava as linhas do arquivo dentro do próprio
 * componente e cada formato as consumia como veio. Isso deixou sete problemas
 * que o chamado apontava como "não renderizado corretamente":
 *
 *   - `Data_Pagamento`, `Portador` e `Origem` existiam no modelo e não saíam;
 *   - `Tags` e `Observações` saíam SEMPRE vazias (não existem como coluna em
 *     nenhuma tabela);
 *   - o marcador interno `finelo_competence:AAAA-MM` vazava na descrição
 *     original (47 transações em produção na data da análise);
 *   - um par de parcela incompleto virava "3/1" (`Total_Parcelas || 1`), o mesmo
 *     fallback enganoso corrigido na tela pelo 9C10;
 *   - a data era um TEXTO "DD/MM/AAAA", então o Excel não ordenava por data;
 *   - o valor não tinha formato de moeda;
 *   - `Origem` seria o nome bruto do arquivo importado, que pode conter o nome
 *     de uma pessoa.
 *
 * Este módulo resolve tudo isso UMA vez. CSV e XLSX só serializam o resultado;
 * nenhum dos dois reimplementa regra de dado.
 *
 * Não depende de React, do DOM nem de biblioteca de planilha, para poder ser
 * testado com transações sintéticas e conservação em centavos.
 *
 * ===========================================================================
 * O QUE ESTE MÓDULO NÃO FAZ
 * ===========================================================================
 *
 * Não filtra (recebe o conjunto que a tela já filtrou, inteiro, não a página),
 * não ordena, não corrige nem grava dado algum. Só representa.
 */
import type { Account, Transaction } from '../../types';
import { toDateOnlyIso, type DateOnlyValue } from '../../utils/dateOnly';
import {
  COMPETENCE_PAYMENT_OBS_PREFIX,
  FUNDING_ACCOUNT_OBS_PREFIX,
} from '../../services/creditCardDirectedPayment';
import { SEM_PARCELAMENTO, formatInstallmentCell } from '../installments/installmentDisplay';

export type TransactionExportColumnKey =
  | 'data'
  | 'dataPagamento'
  | 'descricao'
  | 'descricaoOriginal'
  | 'valor'
  | 'tipo'
  | 'categoria'
  | 'conta'
  | 'cartao'
  | 'portador'
  | 'origem'
  | 'parcela'
  | 'responsavel';

/** Como o valor deve ser gravado: célula de data, número monetário ou texto. */
export type TransactionExportColumnKind = 'date' | 'currency' | 'text';

export interface TransactionExportColumn {
  key: TransactionExportColumnKey;
  /** Cabeçalho voltado ao usuário — nunca o nome técnico do campo. */
  header: string;
  kind: TransactionExportColumnKind;
  /** Largura sugerida, em caracteres (usada pelo XLSX). */
  width: number;
}

/**
 * Uma linha do arquivo. Datas são `Date` de verdade (meia-noite UTC do dia
 * civil) e o valor é número — quem serializa decide o texto, não este modelo.
 */
export interface TransactionExportRow {
  data: Date | null;
  dataPagamento: Date | null;
  descricao: string;
  descricaoOriginal: string;
  /** `null` só se o valor de origem não for um número finito. Nunca vira 0. */
  valor: number | null;
  tipo: string;
  categoria: string;
  conta: string;
  cartao: string;
  portador: string;
  origem: string;
  parcela: string;
  /** Só existe quando o conjunto tem mais de um responsável (plano família). */
  responsavel?: string;
}

export interface TransactionExportContext {
  accounts: ReadonlyArray<Pick<Account, 'id' | 'Nome_Conta' | 'Tipo_Conta'>>;
  /**
   * Presente ⇒ a coluna "Responsável" entra no arquivo. A tela só a mostra
   * quando há mais de um dono no conjunto; o arquivo segue a mesma regra.
   */
  getOwnerLabel?: (transaction: Transaction) => string | undefined;
}

const BASE_COLUMNS: ReadonlyArray<TransactionExportColumn> = [
  { key: 'data', header: 'Data', kind: 'date', width: 12 },
  { key: 'dataPagamento', header: 'Data de pagamento', kind: 'date', width: 18 },
  { key: 'descricao', header: 'Descrição', kind: 'text', width: 38 },
  { key: 'descricaoOriginal', header: 'Descrição original', kind: 'text', width: 44 },
  { key: 'valor', header: 'Valor', kind: 'currency', width: 16 },
  { key: 'tipo', header: 'Tipo', kind: 'text', width: 10 },
  { key: 'categoria', header: 'Categoria', kind: 'text', width: 22 },
  { key: 'conta', header: 'Conta', kind: 'text', width: 26 },
  { key: 'cartao', header: 'Cartão', kind: 'text', width: 26 },
  { key: 'portador', header: 'Portador', kind: 'text', width: 24 },
  { key: 'origem', header: 'Origem', kind: 'text', width: 14 },
  { key: 'parcela', header: 'Parcela', kind: 'text', width: 10 },
];

const OWNER_COLUMN: TransactionExportColumn = {
  key: 'responsavel',
  header: 'Responsável',
  kind: 'text',
  width: 20,
};

/**
 * Colunas do arquivo, na ordem de leitura. Sem `Tags`, sem `Observações`, sem
 * identificadores: nenhum deles tem valor para quem abre a planilha.
 */
export function getTransactionExportColumns(
  includeOwner: boolean
): ReadonlyArray<TransactionExportColumn> {
  return includeOwner ? [...BASE_COLUMNS, OWNER_COLUMN] : BASE_COLUMNS;
}

// ---------------------------------------------------------------------------
// Marcadores internos
// ---------------------------------------------------------------------------

/**
 * O app grava metadado técnico DENTRO do texto da transação porque `transactions`
 * não tem coluna de observação (ver `creditCardDirectedPayment.ts`). Hoje há
 * dois marcadores, ambos com o formato `finelo_<nome>:<valor sem espaço>`:
 *
 *   finelo_competence:AAAA-MM        (competência de pagamento de fatura)
 *   finelo_funding_account:<uuid>    (conta de onde saiu o dinheiro)
 *
 * O segundo carregaria um UUID interno para a planilha. As constantes de
 * prefixo vêm do módulo que ESCREVE os marcadores, para o export acompanhar se
 * um prefixo mudar; o padrão genérico cobre marcadores futuros da mesma família.
 *
 * Só o token e o espaço que o precede saem. O resto do texto — inclusive
 * espaços duplos que o usuário digitou — fica exatamente como estava, e um
 * texto sem marcador é devolvido sem nenhuma alteração.
 */
const INTERNAL_MARKER_RE = new RegExp(
  `\\s*(?:${escapeRegExp(COMPETENCE_PAYMENT_OBS_PREFIX)}|${escapeRegExp(FUNDING_ACCOUNT_OBS_PREFIX)}|finelo_[a-z0-9_]+:)\\S*`,
  'gi'
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stripInternalMarkers(text: string | null | undefined): string {
  const original = text ?? '';
  if (!original.toLowerCase().includes('finelo_')) return original;
  const stripped = original.replace(INTERNAL_MARKER_RE, '');
  // Nenhum marcador casou (ex.: "finelo_" solto, sem `:`) → texto intacto, até nos espaços.
  return stripped === original ? original : stripped.trim();
}

// ---------------------------------------------------------------------------
// Origem
// ---------------------------------------------------------------------------

export const ORIGEM_MANUAL = 'Manual';
export const ORIGEM_OPEN_FINANCE = 'Open Finance';
export const ORIGEM_IMPORTADO = 'Importado';

/**
 * Categoria segura da origem — NUNCA o nome do arquivo.
 *
 * `Transaction.Origem` guarda `'manual'`, o literal `'Open Finance'` ou o nome
 * do arquivo importado (ou o do banco, quando o parser não tem arquivo). Nome
 * de arquivo pode conter nome de gente ("Fatura_Cartao_<pessoa>_Jan_2026.csv"),
 * então só a CLASSE vai para o arquivo exportado.
 *
 * As três classes são as que os dados reais sustentam (produção, 6.115
 * transações: 1.067 manuais, 5.044 de arquivo, 4 Open Finance). Não existe
 * classe "Sistema" porque nenhuma origem gravada a representa.
 */
export function describeExportOrigin(origem: string | null | undefined): string {
  const raw = (origem ?? '').trim();
  if (!raw) return '';
  const normalized = raw.toLowerCase();
  if (normalized === 'manual') return ORIGEM_MANUAL;
  if (normalized === 'open finance') return ORIGEM_OPEN_FINANCE;
  return ORIGEM_IMPORTADO;
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

/**
 * Dia civil como `Date` à meia-noite UTC. É o que o Excel espera para mostrar o
 * dia certo: o serial da planilha vem do instante UTC, então usar meia-noite
 * local deslocaria a data em fusos a oeste de UTC.
 */
export function toExportDate(value: DateOnlyValue): Date | null {
  const iso = toDateOnlyIso(value);
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

// ---------------------------------------------------------------------------
// Linhas
// ---------------------------------------------------------------------------

const CARD_ACCOUNT_TYPE = 'Cartão de Crédito';

const finiteOrNull = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * Parcela para o arquivo. Reaproveita `formatInstallmentCell` (9C10) — nenhuma
 * regra duplicada — e só troca o rótulo de "sem parcelamento" por célula vazia:
 * numa planilha, vazio é o jeito de dizer "não se aplica".
 */
const exportInstallment = (
  current: number | null | undefined,
  total: number | null | undefined
): string => {
  const label = formatInstallmentCell(current, total);
  return label === SEM_PARCELAMENTO ? '' : label;
};

/**
 * Transforma o conjunto já filtrado em linhas exportáveis. Uma linha por
 * transação, na mesma ordem: sem perda e sem duplicação.
 */
export function buildTransactionExportRows(
  transactions: ReadonlyArray<Transaction>,
  context: TransactionExportContext
): TransactionExportRow[] {
  const accountsById = new Map(context.accounts.map((account) => [account.id, account] as const));

  return transactions.map((transaction) => {
    const account = transaction.ID_Conta ? accountsById.get(transaction.ID_Conta) : undefined;
    const isCard = account?.Tipo_Conta === CARD_ACCOUNT_TYPE;

    const row: TransactionExportRow = {
      data: toExportDate(transaction.Data),
      dataPagamento: toExportDate(transaction.Data_Pagamento),
      descricao: stripInternalMarkers(transaction.Nome_Fantasia),
      descricaoOriginal: stripInternalMarkers(transaction.Descricao_Original),
      valor: finiteOrNull(transaction.Valor),
      tipo: transaction.Tipo || '',
      categoria: transaction.Categoria || '',
      conta: transaction.ID_Conta ? account?.Nome_Conta || 'Conta desconhecida' : 'Sem conta',
      cartao: isCard ? account?.Nome_Conta || '' : '',
      portador: (transaction.Portador ?? '').trim(),
      origem: describeExportOrigin(transaction.Origem),
      parcela: exportInstallment(transaction.Parcela_Atual, transaction.Total_Parcelas),
    };

    if (context.getOwnerLabel) {
      row.responsavel = context.getOwnerLabel(transaction) || '';
    }
    return row;
  });
}

/** Valor em centavos inteiros, para conservar somas sem erro de ponto flutuante. */
export function exportValueToCents(value: number | null): number {
  return value === null ? 0 : Math.round(value * 100);
}
