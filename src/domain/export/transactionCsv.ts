/**
 * Serializa o modelo exportável (`transactionExport.ts`) em CSV.
 *
 * O CSV é a saída de DADOS: o usuário do chamado A902 disse que "o CSV já está
 * correto no formato só de dados". Por isso nada aqui embeleza — não há
 * símbolo de moeda, separador de milhar nem texto decorativo. O que mudou foi o
 * conteúdo (colunas completas, sem marcadores internos, sem parcela inventada)
 * e a abertura no Excel (BOM).
 *
 * ===========================================================================
 * DECISÕES DE FORMATO
 * ===========================================================================
 *
 * UTF-8 COM BOM. Sem BOM o Excel abre o arquivo como ANSI e "Descrição" vira
 * "DescriÃ§Ã£o". O BOM é inofensivo para Google Sheets, pandas e demais
 * ferramentas, que o descartam.
 *
 * Separador `,` e decimal `.` — o CSV padrão (RFC 4180), determinístico e
 * legível por qualquer ferramenta. Quem quer abrir no Excel pt-BR com duplo
 * clique usa o XLSX, que grava números e datas de verdade.
 *
 * Valor: SEMPRE 2 casas decimais, montado a partir de centavos inteiros —
 * "-412.37", "0.00", "5432.10". Nunca "R$ 1.234,56": isso transformaria o dado
 * em texto. Montar a partir de centavos também evita o "-0.00" que `toFixed`
 * produz para valores como -0.001.
 *
 * Data: `DD/MM/AAAA`, o mesmo formato que o arquivo já tinha, lido do mesmo dia
 * civil do modelo. Vazio quando não há data (`Data de pagamento`).
 *
 * ===========================================================================
 * PROTEÇÃO CONTRA FÓRMULA
 * ===========================================================================
 *
 * O Excel executa como fórmula uma célula de texto que começa com `=`, `@`, `+`
 * ou `-` — e a descrição de uma transação vem de terceiros (o estabelecimento
 * escolhe o nome que aparece no extrato). Um nome como `=HYPERLINK(...)` viraria
 * fórmula na máquina de quem abre o arquivo.
 *
 * Células de TEXTO que abririam como fórmula recebem um apóstrofo à frente
 * (a neutralização recomendada pela OWASP). A regra é deliberadamente estreita:
 *
 *   - `=`, `@`, TAB e CR: sempre;
 *   - `+` e `-`: só quando há mais texto depois. Um `-` sozinho não é fórmula, e
 *     é justamente o placeholder de "sem categoria" que o app grava em 179
 *     transações reais — prefixá-lo corromperia o dado.
 *
 * Colunas numéricas e de data não passam por aqui: o valor sai como número.
 * Na data desta implementação nenhuma descrição real começa com esses
 * caracteres; a proteção é contra entrada hostil futura, não contra dado atual.
 * O XLSX não precisa dela: célula de texto ali é sempre texto.
 */
import Papa from 'papaparse';
import type {
  TransactionExportColumn,
  TransactionExportRow,
} from './transactionExport';
import { exportValueToCents } from './transactionExport';

/** Byte order mark UTF-8; o `Blob` o grava como EF BB BF. */
export const CSV_BOM = '﻿';

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** `DD/MM/AAAA` a partir do dia civil (componentes UTC do modelo). */
export function formatCsvDate(value: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) return '';
  return `${pad2(value.getUTCDate())}/${pad2(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`;
}

/** Decimal com ponto e 2 casas, a partir de centavos inteiros. `null` → vazio. */
export function formatCsvMoney(value: number | null): string {
  if (value === null) return '';
  const cents = exportValueToCents(value);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${pad2(abs % 100)}`;
}

/** Ver "PROTEÇÃO CONTRA FÓRMULA" no cabeçalho do arquivo. */
export function neutralizeSpreadsheetFormula(text: string): string {
  if (!text) return text;
  const first = text[0];
  if (first === '=' || first === '@' || first === '\t' || first === '\r') return `'${text}`;
  if ((first === '+' || first === '-') && text.length > 1) return `'${text}`;
  return text;
}

function serializeCell(row: TransactionExportRow, column: TransactionExportColumn): string {
  const value = row[column.key];
  switch (column.kind) {
    case 'date':
      return formatCsvDate((value as Date | null | undefined) ?? null);
    case 'currency':
      return formatCsvMoney((value as number | null | undefined) ?? null);
    default:
      return neutralizeSpreadsheetFormula((value as string | undefined) ?? '');
  }
}

/**
 * CSV completo, já com BOM. `Papa.unparse` cuida de aspas, vírgulas e quebras de
 * linha dentro de uma célula; o cabeçalho vem das mesmas colunas do XLSX.
 */
export function serializeTransactionsCsv(
  rows: ReadonlyArray<TransactionExportRow>,
  columns: ReadonlyArray<TransactionExportColumn>
): string {
  const csv = Papa.unparse({
    fields: columns.map((column) => column.header),
    data: rows.map((row) => columns.map((column) => serializeCell(row, column))),
  });
  return `${CSV_BOM}${csv}`;
}
