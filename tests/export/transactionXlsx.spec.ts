import { beforeAll, describe, expect, it } from 'vitest';
import {
  XLSX_CURRENCY_FORMAT,
  XLSX_DATE_FORMAT,
  XLSX_SHEET_NAME,
  buildTransactionsXlsx,
  excelColumnLetter,
} from '../../src/domain/export/transactionXlsx';
import {
  buildTransactionExportRows,
  exportValueToCents,
  getTransactionExportColumns,
} from '../../src/domain/export/transactionExport';
import { ACCOUNTS, SYNTHETIC_TOTAL_CENTS, makeTx, syntheticSet } from './fixtures';

/** `exceljs` é CommonJS: as classes vêm em `default` ou na raiz, conforme quem resolve. */
type ExcelJsModule = typeof import('exceljs');
async function loadExcelJs(): Promise<ExcelJsModule> {
  const mod = (await import('exceljs')) as ExcelJsModule & { default?: ExcelJsModule };
  return mod.default ?? mod;
}

/** Gera o arquivo e o reabre, como o Excel faria — não compara binário. */
async function gerarEReler(transactions = syntheticSet(), includeOwner = false) {
  const ExcelJS = await loadExcelJs();
  const columns = getTransactionExportColumns(includeOwner);
  const rows = buildTransactionExportRows(transactions, {
    accounts: ACCOUNTS,
    getOwnerLabel: includeOwner ? () => 'Maria' : undefined,
  });
  const bytes = await buildTransactionsXlsx(rows, columns);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  return { ExcelJS, workbook, sheet: workbook.worksheets[0], columns, rows, bytes };
}

/** Workbook do conjunto sintético padrão: gerado UMA vez e apenas LIDO pelos testes. */
let padraoEmCache: ReturnType<typeof gerarEReler> | undefined;
const padrao = () => (padraoEmCache ??= gerarEReler());

/**
 * O primeiro `import('exceljs')` paga o cold start da biblioteca, que carrega
 * centenas de módulos. Na primeira execução depois de um `npm install` esse hook
 * estourou os 10 s padrão numa pasta do OneDrive (provável leitura a frio de
 * arquivos recém-instalados; não reproduzível depois, com o cache aquecido). Medido
 * já aquecido: o import leva ~2 s e cada geração seguinte ~30 ms — o custo está no
 * carregamento da biblioteca, não no código de exportação.
 *
 * Por isso o aquecimento acontece UMA vez, aqui, com prazo maior SÓ para este hook;
 * nenhum teste individual paga o cold start e o timeout global da suíte não muda.
 */
beforeAll(async () => {
  await loadExcelJs();
}, 60_000);

const colIndex = (columns: ReadonlyArray<{ header: string }>, header: string) =>
  columns.findIndex((c) => c.header === header) + 1;

describe('XLSX — arquivo', () => {
  let ctx: Awaited<ReturnType<typeof gerarEReler>>;
  beforeAll(async () => {
    ctx = await padrao();
  });

  it('é um arquivo .xlsx de verdade (zip com a assinatura PK)', () => {
    expect([ctx.bytes[0], ctx.bytes[1]]).toEqual([0x50, 0x4b]);
    expect(ctx.bytes.length).toBeGreaterThan(1000);
  });

  it('tem uma única planilha, com o nome esperado', () => {
    expect(ctx.workbook.worksheets).toHaveLength(1);
    expect(ctx.sheet.name).toBe(XLSX_SHEET_NAME);
    expect(XLSX_SHEET_NAME).toBe('Transações');
  });

  it('identifica o FinElo como autor', () => {
    expect(ctx.workbook.creator).toBe('FinElo');
  });

  it('os cabeçalhos são os das colunas do modelo, na ordem', () => {
    const headers = ctx.columns.map((_, i) => ctx.sheet.getRow(1).getCell(i + 1).value);
    expect(headers).toEqual(ctx.columns.map((c) => c.header));
  });

  it('há uma linha por transação mais o cabeçalho, sem linhas extras', () => {
    expect(ctx.sheet.rowCount).toBe(syntheticSet().length + 1);
    expect(ctx.sheet.columnCount).toBe(ctx.columns.length);
  });
});

describe('XLSX — formatação utilizável', () => {
  let ctx: Awaited<ReturnType<typeof gerarEReler>>;
  beforeAll(async () => {
    ctx = await padrao();
  });

  it('cabeçalho em negrito, com fundo escuro e texto claro', () => {
    for (let i = 1; i <= ctx.columns.length; i += 1) {
      const cell = ctx.sheet.getRow(1).getCell(i);
      expect(cell.font?.bold).toBe(true);
      expect(cell.font?.color?.argb).toBe('FFFFFFFF');
      expect(cell.fill).toMatchObject({ type: 'pattern', pattern: 'solid' });
      expect((cell.fill as { fgColor?: { argb?: string } }).fgColor?.argb).toBe('FF2D3748');
    }
  });

  it('a primeira linha fica congelada', () => {
    const view = ctx.sheet.views[0];
    expect(view.state).toBe('frozen');
    expect((view as { ySplit?: number }).ySplit).toBe(1);
  });

  it('tem autofiltro cobrindo cabeçalho e todos os dados', () => {
    const ultimaColuna = excelColumnLetter(ctx.columns.length);
    const ultimaLinha = syntheticSet().length + 1;
    const filtro = ctx.sheet.autoFilter as unknown;
    const texto =
      typeof filtro === 'string'
        ? filtro
        : `${excelColumnLetter((filtro as { from: { column: number } }).from.column)}${(filtro as { from: { row: number } }).from.row}:${excelColumnLetter((filtro as { to: { column: number } }).to.column)}${(filtro as { to: { row: number } }).to.row}`;
    expect(texto).toBe(`A1:${ultimaColuna}${ultimaLinha}`);
  });

  it('cada coluna tem a largura definida pelo modelo', () => {
    ctx.columns.forEach((column, i) => {
      expect(ctx.sheet.getColumn(i + 1).width).toBeCloseTo(column.width, 0);
    });
  });

  it('as colunas de texto longo são mais largas que as curtas', () => {
    const largura = (h: string) => ctx.sheet.getColumn(colIndex(ctx.columns, h)).width ?? 0;
    expect(largura('Descrição original')).toBeGreaterThan(largura('Tipo'));
    expect(largura('Descrição')).toBeGreaterThan(largura('Parcela'));
  });
});

describe('XLSX — datas são datas', () => {
  it('Data e Data de pagamento são células de data, no dia certo', async () => {
    const { sheet, columns, ExcelJS } = await gerarEReler([
      makeTx({
        Data: new Date('2026-08-15T00:00:00Z'),
        Data_Pagamento: new Date('2026-09-10T00:00:00Z'),
      }),
    ]);
    const data = sheet.getRow(2).getCell(colIndex(columns, 'Data'));
    const pagamento = sheet.getRow(2).getCell(colIndex(columns, 'Data de pagamento'));

    expect(data.type).toBe(ExcelJS.ValueType.Date);
    expect(pagamento.type).toBe(ExcelJS.ValueType.Date);
    expect(data.value).toBeInstanceOf(Date);
    expect((data.value as Date).toISOString().slice(0, 10)).toBe('2026-08-15');
    expect((pagamento.value as Date).toISOString().slice(0, 10)).toBe('2026-09-10');
  });

  it('usa formato de data dd/mm/aaaa, e não texto', async () => {
    const { sheet, columns } = await gerarEReler([makeTx()]);
    const cell = sheet.getRow(2).getCell(colIndex(columns, 'Data'));
    expect(cell.numFmt).toBe(XLSX_DATE_FORMAT);
    expect(XLSX_DATE_FORMAT).toBe('dd/mm/yyyy');
    expect(typeof cell.value).not.toBe('string');
  });

  it('ordenar por data ordena cronologicamente (os valores são comparáveis como data)', async () => {
    const { sheet, columns } = await gerarEReler([
      makeTx({ Data: new Date('2026-12-31T00:00:00Z') }),
      makeTx({ Data: new Date('2026-01-01T00:00:00Z') }),
      makeTx({ Data: new Date('2026-06-15T00:00:00Z') }),
    ]);
    const idx = colIndex(columns, 'Data');
    const tempos = [2, 3, 4].map((r) => (sheet.getRow(r).getCell(idx).value as Date).getTime());
    const ordenado = [...tempos].sort((a, b) => a - b);
    expect(ordenado.map((t) => new Date(t).toISOString().slice(0, 10))).toEqual([
      '2026-01-01',
      '2026-06-15',
      '2026-12-31',
    ]);
  });

  it('não desloca o dia nas bordas do mês e do ano', async () => {
    const { sheet, columns } = await gerarEReler([
      makeTx({ Data: new Date('2026-01-01T00:00:00Z') }),
      makeTx({ Data: new Date('2026-12-31T00:00:00Z') }),
      makeTx({ Data: new Date('2028-02-29T00:00:00Z') }),
    ]);
    const idx = colIndex(columns, 'Data');
    expect([2, 3, 4].map((r) => (sheet.getRow(r).getCell(idx).value as Date).toISOString().slice(0, 10))).toEqual([
      '2026-01-01',
      '2026-12-31',
      '2028-02-29',
    ]);
  });

  it('sem data de pagamento a célula fica realmente vazia', async () => {
    const { sheet, columns } = await gerarEReler([makeTx({ Data_Pagamento: undefined })]);
    expect(sheet.getRow(2).getCell(colIndex(columns, 'Data de pagamento')).value).toBeNull();
  });
});

describe('XLSX — valores são números com formato monetário', () => {
  it('Valor é número, com formato BRL', async () => {
    const { sheet, columns, ExcelJS } = await gerarEReler([makeTx({ Valor: -412.37 })]);
    const cell = sheet.getRow(2).getCell(colIndex(columns, 'Valor'));
    expect(cell.type).toBe(ExcelJS.ValueType.Number);
    expect(typeof cell.value).toBe('number');
    expect(cell.value).toBe(-412.37);
    expect(cell.numFmt).toBe(XLSX_CURRENCY_FORMAT);
    expect(cell.numFmt).toContain('R$');
    expect(cell.numFmt).toContain('#,##0.00');
  });

  it('positivo, negativo e zero são numéricos (zero não some)', async () => {
    const { sheet, columns } = await gerarEReler([
      makeTx({ Valor: 5432.1 }),
      makeTx({ Valor: -23.5 }),
      makeTx({ Valor: 0 }),
    ]);
    const idx = colIndex(columns, 'Valor');
    expect([2, 3, 4].map((r) => sheet.getRow(r).getCell(idx).value)).toEqual([5432.1, -23.5, 0]);
  });

  it('valor não numérico deixa a célula vazia — e não vira 0', async () => {
    const { sheet, columns } = await gerarEReler([makeTx({ Valor: Number.NaN })]);
    expect(sheet.getRow(2).getCell(colIndex(columns, 'Valor')).value).toBeNull();
  });

  it('a coluna Valor tem alinhamento à direita', async () => {
    const { sheet, columns } = await gerarEReler([makeTx()]);
    const idx = colIndex(columns, 'Valor');
    expect(sheet.getRow(2).getCell(idx).alignment?.horizontal).toBe('right');
    expect(sheet.getRow(1).getCell(idx).alignment?.horizontal).toBe('right');
  });
});

describe('XLSX — texto', () => {
  it('acentos, aspas e vírgulas sobrevivem', async () => {
    const texto = 'Café; bolo e "pão", ação';
    const { sheet, columns } = await gerarEReler([makeTx({ Nome_Fantasia: texto })]);
    expect(sheet.getRow(2).getCell(colIndex(columns, 'Descrição')).value).toBe(texto);
  });

  it('texto que começaria com = permanece TEXTO (não vira fórmula)', async () => {
    const { sheet, columns, ExcelJS } = await gerarEReler([
      makeTx({ Nome_Fantasia: '=1+1', Descricao_Original: '=HYPERLINK("http://x","y")', Categoria: '@x' }),
    ]);
    const cell = sheet.getRow(2).getCell(colIndex(columns, 'Descrição'));
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.value).toBe('=1+1');
    expect(sheet.getRow(2).getCell(colIndex(columns, 'Descrição original')).type).toBe(
      ExcelJS.ValueType.String
    );
    expect(sheet.getRow(2).getCell(colIndex(columns, 'Categoria')).value).toBe('@x');
  });

  it('não grava o apóstrofo de proteção do CSV — no XLSX o texto fica exato', async () => {
    const { sheet, columns } = await gerarEReler([makeTx({ Nome_Fantasia: '-Pix enviado' })]);
    expect(sheet.getRow(2).getCell(colIndex(columns, 'Descrição')).value).toBe('-Pix enviado');
  });

  it('célula de texto vazia continua vazia, não uma string ""', async () => {
    const { sheet, columns } = await gerarEReler([makeTx({ Portador: undefined, Origem: '' })]);
    expect(sheet.getRow(2).getCell(colIndex(columns, 'Portador')).value).toBeNull();
    expect(sheet.getRow(2).getCell(colIndex(columns, 'Origem')).value).toBeNull();
  });

  it('nenhuma célula contém marcador interno', async () => {
    const { sheet } = await padrao();
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === 'string') expect(cell.value.toLowerCase()).not.toContain('finelo_');
      });
    });
  });

  it('Origem nunca é o nome do arquivo', async () => {
    const { sheet, columns } = await padrao();
    const idx = colIndex(columns, 'Origem');
    const origens = new Set<unknown>();
    sheet.eachRow((row, n) => {
      if (n > 1) origens.add(row.getCell(idx).value);
    });
    expect(origens.has(null) || origens.size > 0).toBe(true);
    for (const o of origens) {
      if (o !== null) expect(['Manual', 'Importado', 'Open Finance']).toContain(o);
    }
  });

  it('não tem Tags nem Observações', async () => {
    const { sheet, columns } = await padrao();
    const headers = columns.map((_, i) => String(sheet.getRow(1).getCell(i + 1).value));
    expect(headers).not.toContain('Tags');
    expect(headers).not.toContain('Observações');
  });

  it('Responsável entra por último quando pedido', async () => {
    const { sheet, columns } = await gerarEReler(syntheticSet(), true);
    expect(columns[columns.length - 1].header).toBe('Responsável');
    expect(sheet.getRow(2).getCell(columns.length).value).toBe('Maria');
  });
});

describe('XLSX — bate com o modelo exportável', () => {
  it('cada célula corresponde à linha do modelo', async () => {
    const { sheet, rows, columns } = await padrao();
    rows.forEach((row, r) => {
      columns.forEach((column, c) => {
        const cell = sheet.getRow(r + 2).getCell(c + 1);
        const esperado = row[column.key];
        if (column.kind === 'date') {
          if (esperado instanceof Date) expect((cell.value as Date).getTime()).toBe(esperado.getTime());
          else expect(cell.value).toBeNull();
        } else if (column.kind === 'currency') {
          expect(cell.value).toBe(esperado);
        } else {
          expect(cell.value ?? '').toBe(esperado ?? '');
        }
      });
    });
  });

  it('parcelas seguem a semântica do 9C10', async () => {
    const { sheet, columns } = await padrao();
    const idx = colIndex(columns, 'Parcela');
    const desc = colIndex(columns, 'Descrição');
    const por: Record<string, unknown> = {};
    sheet.eachRow((row, n) => {
      if (n > 1) por[String(row.getCell(desc).value)] = row.getCell(idx).value;
    });
    expect(por['Geladeira']).toBe('3/10');
    expect(por['Legado 0/0']).toBeNull();
    expect(por['Par incompleto']).toBe('3/?');
    expect(por['Padaria São João']).toBeNull();
  });
});

describe('XLSX — conservação', () => {
  it('a soma dos valores, em centavos, é o total conhecido do conjunto', async () => {
    const { sheet, columns } = await padrao();
    const idx = colIndex(columns, 'Valor');
    let centavos = 0;
    sheet.eachRow((row, n) => {
      if (n > 1) centavos += Math.round(Number(row.getCell(idx).value ?? 0) * 100);
    });
    expect(centavos).toBe(SYNTHETIC_TOTAL_CENTS);
  });

  it('o mesmo total do modelo, sem perda e sem duplicação', async () => {
    const { sheet, rows } = await padrao();
    expect(sheet.rowCount - 1).toBe(rows.length);
    const doModelo = rows.reduce((acc, r) => acc + exportValueToCents(r.valor), 0);
    expect(doModelo).toBe(SYNTHETIC_TOTAL_CENTS);
  });

  it('conjunto vazio gera só o cabeçalho, com filtro consistente', async () => {
    const { sheet, columns } = await gerarEReler([]);
    expect(sheet.rowCount).toBe(1);
    const filtro = sheet.autoFilter as unknown;
    const texto =
      typeof filtro === 'string'
        ? filtro
        : `A${(filtro as { from: { row: number } }).from.row}:${excelColumnLetter((filtro as { to: { column: number } }).to.column)}${(filtro as { to: { row: number } }).to.row}`;
    expect(texto).toBe(`A1:${excelColumnLetter(columns.length)}1`);
  });
});

describe('letra da coluna do Excel', () => {
  it('converte índices em letras', () => {
    expect(excelColumnLetter(1)).toBe('A');
    expect(excelColumnLetter(12)).toBe('L');
    expect(excelColumnLetter(13)).toBe('M');
    expect(excelColumnLetter(26)).toBe('Z');
    expect(excelColumnLetter(27)).toBe('AA');
    expect(excelColumnLetter(52)).toBe('AZ');
    expect(excelColumnLetter(53)).toBe('BA');
  });
});
