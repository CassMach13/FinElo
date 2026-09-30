/**
 * Gera o XLSX de transações a partir do modelo exportável.
 *
 * Objetivo do chamado A902: "planilhas em Excel terem uma formatação estética".
 * O `json_to_sheet` anterior gravava a data como TEXTO, o valor sem formato e
 * nenhuma largura de coluna — abria, mas não servia para trabalhar. Aqui o
 * arquivo já abre utilizável:
 *
 *   - datas são células de DATA (ordenam e filtram como data);
 *   - valores são NÚMEROS com formato monetário BRL;
 *   - cabeçalho em destaque discreto, primeira linha congelada, autofiltro e
 *     largura de coluna definidos.
 *
 * Uma pasta de trabalho, uma planilha. Sem gráficos, sem abas extras, sem
 * linha de total: quem quer somar usa o filtro do próprio Excel.
 *
 * ===========================================================================
 * POR QUE `exceljs`, E POR QUE SÓ AQUI
 * ===========================================================================
 *
 * A biblioteca `xlsx` (SheetJS Community) usada na IMPORTAÇÃO não grava estilo
 * de célula — negrito, cor e fonte são recurso da versão paga. O `exceljs`
 * grava. Ele entra apenas para ESCREVER; a importação continua na `xlsx`, e
 * reavaliá-la (há alertas de segurança abertos contra a versão instalada) é
 * um trabalho separado.
 *
 * O `exceljs` pesa cerca de 1 MB no navegador. Por isso é carregado com
 * `import()` DENTRO da função, no clique de exportar: quem nunca exporta não
 * baixa a biblioteca, e o bundle inicial não muda.
 *
 * Texto que começa com `=` NÃO precisa de neutralização aqui: no XLSX uma
 * célula de texto é sempre texto; só vira fórmula se o valor for um objeto
 * `{ formula }`, o que este módulo nunca gera.
 */
import type {
  TransactionExportColumn,
  TransactionExportRow,
} from './transactionExport';

export const XLSX_SHEET_NAME = 'Transações';

/** Formato monetário BRL. O Excel exibe o separador conforme a localidade de quem abre. */
export const XLSX_CURRENCY_FORMAT = '"R$" #,##0.00;-"R$" #,##0.00';

/** Formato de data exibido; o valor gravado é uma data de verdade. */
export const XLSX_DATE_FORMAT = 'dd/mm/yyyy';

/** Cores do FinElo (tema escuro do app): fundo do cabeçalho e o realce teal. */
const HEADER_FILL = 'FF2D3748';
const HEADER_FONT = 'FFFFFFFF';
const ACCENT = 'FF38B2AC';

/** Letra da coluna do Excel (1 → A, 27 → AA). */
export function excelColumnLetter(index: number): string {
  let n = index;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

type ExcelJsModule = typeof import('exceljs');

/**
 * `exceljs` é CommonJS. Dependendo de quem resolve o `import()` (Vite no
 * navegador, Node nos testes), as classes vêm em `default` ou na raiz.
 */
async function loadExcelJs(): Promise<ExcelJsModule> {
  const mod = (await import('exceljs')) as ExcelJsModule & { default?: ExcelJsModule };
  return mod.default ?? mod;
}

/**
 * Monta o workbook em memória e devolve os bytes do arquivo `.xlsx`.
 * Não toca no DOM — quem baixa o arquivo é a camada de UI.
 */
export async function buildTransactionsXlsx(
  rows: ReadonlyArray<TransactionExportRow>,
  columns: ReadonlyArray<TransactionExportColumn>
): Promise<Uint8Array> {
  const ExcelJS = await loadExcelJs();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FinElo';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(XLSX_SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = columns.map((column) => ({
    key: column.key,
    header: column.header,
    width: column.width,
  }));

  // Cabeçalho: destaque discreto no tom escuro do app, com filete teal embaixo.
  const headerRow = sheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell, colNumber) => {
    const isMoney = columns[colNumber - 1]?.kind === 'currency';
    cell.font = { bold: true, color: { argb: HEADER_FONT } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.border = { bottom: { style: 'medium', color: { argb: ACCENT } } };
    cell.alignment = { vertical: 'middle', horizontal: isMoney ? 'right' : 'left' };
  });

  rows.forEach((row) => {
    const excelRow = sheet.addRow({});
    columns.forEach((column, index) => {
      const cell = excelRow.getCell(index + 1);
      const value = row[column.key];

      if (column.kind === 'date') {
        if (value instanceof Date) {
          cell.value = value;
          cell.numFmt = XLSX_DATE_FORMAT;
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        }
        return;
      }

      if (column.kind === 'currency') {
        if (typeof value === 'number') {
          cell.value = value;
          cell.numFmt = XLSX_CURRENCY_FORMAT;
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
        }
        return;
      }

      // Texto: célula vazia continua vazia, em vez de uma string "".
      if (typeof value === 'string' && value !== '') {
        cell.value = value;
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      }
    });
  });

  // Autofiltro sobre o intervalo inteiro (cabeçalho + dados), para que ordenar
  // e filtrar no Excel atinja todas as linhas.
  const lastRow = Math.max(1, rows.length + 1);
  sheet.autoFilter = `A1:${excelColumnLetter(columns.length)}${lastRow}`;

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
