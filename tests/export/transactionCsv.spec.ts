import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import {
  CSV_BOM,
  formatCsvDate,
  formatCsvMoney,
  neutralizeSpreadsheetFormula,
  serializeTransactionsCsv,
} from '../../src/domain/export/transactionCsv';
import {
  buildTransactionExportRows,
  getTransactionExportColumns,
} from '../../src/domain/export/transactionExport';
import { ACCOUNTS, SYNTHETIC_TOTAL_CENTS, makeTx, syntheticSet } from './fixtures';

const exportar = (transactions = syntheticSet(), includeOwner = false) => {
  const columns = getTransactionExportColumns(includeOwner);
  const rows = buildTransactionExportRows(transactions, {
    accounts: ACCOUNTS,
    getOwnerLabel: includeOwner ? () => 'Maria' : undefined,
  });
  const csv = serializeTransactionsCsv(rows, columns);
  return { csv, columns, rows };
};

/** Faz o parse de volta, como uma ferramenta de planilha faria. */
const parse = (csv: string): string[][] => {
  const result = Papa.parse<string[]>(csv.replace(/^﻿/, ''), { skipEmptyLines: false });
  return result.data;
};

const col = (headers: string[], name: string) => headers.indexOf(name);

describe('CSV — estrutura', () => {
  it('começa com BOM UTF-8 (EF BB BF)', () => {
    const { csv } = exportar();
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const bytes = Buffer.from(csv, 'utf8');
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('o BOM aparece uma única vez', () => {
    const { csv } = exportar();
    expect(csv.split(CSV_BOM).length - 1).toBe(1);
  });

  it('cabeçalho, na ordem, é o das colunas do modelo', () => {
    const { csv, columns } = exportar();
    const [headers] = parse(csv);
    expect(headers).toEqual(columns.map((c) => c.header));
    expect(headers).toHaveLength(12);
  });

  it('uma linha de dados por transação, e todas com o mesmo número de colunas', () => {
    const set = syntheticSet();
    const { csv, columns } = exportar(set);
    const linhas = parse(csv);
    expect(linhas).toHaveLength(set.length + 1); // + cabeçalho
    for (const linha of linhas) expect(linha).toHaveLength(columns.length);
  });

  it('termina cada linha com CRLF, o padrão do CSV', () => {
    const { csv } = exportar();
    expect(csv).toContain('\r\n');
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('não tem Tags nem Observações', () => {
    const [headers] = parse(exportar().csv);
    expect(headers).not.toContain('Tags');
    expect(headers).not.toContain('Observações');
  });

  it('traz os campos que faltavam: Data de pagamento, Cartão, Portador e Origem', () => {
    const [headers] = parse(exportar().csv);
    for (const novo of ['Data de pagamento', 'Cartão', 'Portador', 'Origem']) {
      expect(headers).toContain(novo);
    }
  });

  it('acrescenta Responsável ao fim quando pedido', () => {
    const { csv } = exportar(syntheticSet(), true);
    const [headers, primeira] = parse(csv);
    expect(headers[headers.length - 1]).toBe('Responsável');
    expect(primeira[headers.length - 1]).toBe('Maria');
  });

  it('conjunto vazio gera só o cabeçalho', () => {
    const { csv } = exportar([]);
    const linhas = parse(csv).filter((l) => l.length > 1);
    expect(linhas).toHaveLength(1);
  });
});

describe('CSV — valores', () => {
  const valorDe = (v: number) => {
    const { csv } = exportar([makeTx({ Valor: v })]);
    const [headers, linha] = parse(csv);
    return linha[col(headers, 'Valor')];
  };

  it('usa ponto decimal e 2 casas, sem símbolo de moeda nem milhar', () => {
    expect(valorDe(-412.37)).toBe('-412.37');
    expect(valorDe(5432.1)).toBe('5432.10');
    expect(valorDe(1234567.8)).toBe('1234567.80');
    expect(valorDe(-23.5)).toBe('-23.50');
  });

  it('zero é "0.00" e nunca "-0.00"', () => {
    expect(valorDe(0)).toBe('0.00');
    expect(valorDe(-0)).toBe('0.00');
    expect(valorDe(-0.001)).toBe('0.00');
  });

  it('não deixa o erro de ponto flutuante virar centavo errado', () => {
    expect(formatCsvMoney(0.1 + 0.2)).toBe('0.30'); // 0.30000000000000004
    expect(formatCsvMoney(Array.from({ length: 10 }, () => 0.1).reduce((a, b) => a + b, 0))).toBe('1.00'); // 0.9999999999999999
    expect(formatCsvMoney(4.35)).toBe('4.35'); // 4.35 * 100 = 434.99999999999994
    expect(formatCsvMoney(19.99)).toBe('19.99'); // 19.99 * 100 = 1998.9999999999998
    expect(formatCsvMoney(-4.35)).toBe('-4.35');
  });

  it('valor negativo não é confundido com fórmula (não recebe apóstrofo)', () => {
    expect(valorDe(-412.37).startsWith("'")).toBe(false);
  });

  it('o valor não vira texto formatado', () => {
    expect(valorDe(1234.56)).not.toMatch(/R\$|,/);
  });

  it('valor ausente (não numérico) fica vazio, e não 0.00', () => {
    expect(formatCsvMoney(null)).toBe('');
  });
});

describe('CSV — datas', () => {
  it('Data e Data de pagamento em DD/MM/AAAA', () => {
    const { csv } = exportar([
      makeTx({
        Data: new Date('2026-08-15T00:00:00Z'),
        Data_Pagamento: new Date('2026-09-10T00:00:00Z'),
      }),
    ]);
    const [headers, linha] = parse(csv);
    expect(linha[col(headers, 'Data')]).toBe('15/08/2026');
    expect(linha[col(headers, 'Data de pagamento')]).toBe('10/09/2026');
  });

  it('sem data de pagamento a célula fica vazia', () => {
    const { csv } = exportar([makeTx({ Data_Pagamento: undefined })]);
    const [headers, linha] = parse(csv);
    expect(linha[col(headers, 'Data de pagamento')]).toBe('');
  });

  it('não desloca o dia nas bordas do mês e do ano', () => {
    expect(formatCsvDate(new Date('2026-01-01T00:00:00Z'))).toBe('01/01/2026');
    expect(formatCsvDate(new Date('2026-12-31T00:00:00Z'))).toBe('31/12/2026');
    expect(formatCsvDate(new Date('2028-02-29T00:00:00Z'))).toBe('29/02/2028');
  });

  it('data nula ou inválida vira vazio', () => {
    expect(formatCsvDate(null)).toBe('');
    expect(formatCsvDate(new Date('invalid'))).toBe('');
  });
});

describe('CSV — texto', () => {
  it('acentos sobrevivem ao parse, e os bytes em UTF-8 estão corretos', () => {
    const { csv } = exportar([makeTx({ Nome_Fantasia: 'Padaria São João — ação' })]);
    const [headers, linha] = parse(csv);
    expect(linha[col(headers, 'Descrição')]).toBe('Padaria São João — ação');
    expect(Buffer.from(csv, 'utf8').includes(Buffer.from('São João', 'utf8'))).toBe(true);
  });

  it('vírgula, aspas e ponto e vírgula na descrição não quebram as colunas', () => {
    const texto = 'Café; bolo e "pão", com ação';
    const { csv, columns } = exportar([makeTx({ Nome_Fantasia: texto, Descricao_Original: 'A,B,"C"' })]);
    const [headers, linha] = parse(csv);
    expect(linha).toHaveLength(columns.length);
    expect(linha[col(headers, 'Descrição')]).toBe(texto);
    expect(linha[col(headers, 'Descrição original')]).toBe('A,B,"C"');
  });

  it('quebra de linha dentro da descrição continua uma única célula', () => {
    const texto = 'linha 1\nlinha 2';
    const { csv, columns } = exportar([makeTx({ Nome_Fantasia: texto })]);
    const linhas = parse(csv);
    expect(linhas).toHaveLength(2);
    expect(linhas[1]).toHaveLength(columns.length);
    expect(linhas[1][col(linhas[0], 'Descrição')]).toBe(texto);
  });

  it('nenhuma célula contém marcador interno', () => {
    const { csv } = exportar();
    expect(csv.toLowerCase()).not.toContain('finelo_');
    for (const linha of parse(csv)) {
      for (const celula of linha) expect(celula.toLowerCase()).not.toContain('finelo_');
    }
  });

  it('a descrição legítima ao lado do marcador é preservada', () => {
    const [headers, ...linhas] = parse(exportar().csv);
    const idx = col(headers, 'Descrição original');
    expect(linhas.map((l) => l[idx])).toContain('Pagamento de Fatura (2026-08)');
  });

  it('a Origem exportada nunca é o nome do arquivo', () => {
    const { csv } = exportar();
    expect(csv).not.toMatch(/Fulano|Fatura_Cartao|\.csv/i);
    const [headers, ...linhas] = parse(csv);
    const idx = col(headers, 'Origem');
    expect(new Set(linhas.map((l) => l[idx]))).toEqual(
      new Set(['Manual', 'Importado', 'Open Finance'])
    );
  });

  it('Portador, Cartão e Parcela chegam corretos', () => {
    const [headers, ...linhas] = parse(exportar().csv);
    const geladeira = linhas.find((l) => l[col(headers, 'Descrição')] === 'Geladeira')!;
    expect(geladeira[col(headers, 'Portador')]).toBe('TITULAR EXEMPLO');
    expect(geladeira[col(headers, 'Cartão')]).toBe('Cartão Exemplo');
    expect(geladeira[col(headers, 'Parcela')]).toBe('3/10');
    expect(geladeira[col(headers, 'Data')]).toBe('15/08/2026');
    expect(geladeira[col(headers, 'Data de pagamento')]).toBe('10/09/2026');

    const legado = linhas.find((l) => l[col(headers, 'Descrição')] === 'Legado 0/0')!;
    expect(legado[col(headers, 'Parcela')]).toBe('');
    const incompleto = linhas.find((l) => l[col(headers, 'Descrição')] === 'Par incompleto')!;
    expect(incompleto[col(headers, 'Parcela')]).toBe('3/?');
  });

  it('o placeholder "-" de categoria não é corrompido', () => {
    const [headers, ...linhas] = parse(exportar().csv);
    const zero = linhas.find((l) => l[col(headers, 'Descrição')] === 'Valor zero')!;
    expect(zero[col(headers, 'Categoria')]).toBe('-');
  });
});

describe('CSV — proteção contra fórmula', () => {
  it('neutraliza texto que o Excel executaria como fórmula', () => {
    expect(neutralizeSpreadsheetFormula('=HYPERLINK("http://x","clique")')).toBe(
      `'=HYPERLINK("http://x","clique")`
    );
    expect(neutralizeSpreadsheetFormula('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(neutralizeSpreadsheetFormula('+1+cmd|calc')).toBe("'+1+cmd|calc");
    expect(neutralizeSpreadsheetFormula('-2+3+cmd|calc')).toBe("'-2+3+cmd|calc");
    expect(neutralizeSpreadsheetFormula('\tformula')).toBe("'\tformula");
    expect(neutralizeSpreadsheetFormula('\rformula')).toBe("'\rformula");
  });

  it('não toca em texto comum nem no "-" sozinho', () => {
    expect(neutralizeSpreadsheetFormula('-')).toBe('-');
    expect(neutralizeSpreadsheetFormula('Padaria = boa')).toBe('Padaria = boa');
    expect(neutralizeSpreadsheetFormula('Café 1+1')).toBe('Café 1+1');
    expect(neutralizeSpreadsheetFormula('')).toBe('');
  });

  it('aplica-se às colunas de texto do arquivo', () => {
    const { csv } = exportar([makeTx({ Nome_Fantasia: '=1+1', Categoria: '@x', Portador: '+55 11' })]);
    const [headers, linha] = parse(csv);
    expect(linha[col(headers, 'Descrição')]).toBe("'=1+1");
    expect(linha[col(headers, 'Categoria')]).toBe("'@x");
    expect(linha[col(headers, 'Portador')]).toBe("'+55 11");
  });

  it('não se aplica a valor e data, que saem como número e data', () => {
    const { csv } = exportar([makeTx({ Valor: -50 })]);
    const [headers, linha] = parse(csv);
    expect(linha[col(headers, 'Valor')]).toBe('-50.00');
    expect(linha[col(headers, 'Data')]).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe('CSV — conservação', () => {
  it('a soma da coluna Valor, em centavos, é o total conhecido do conjunto', () => {
    const { csv } = exportar();
    const [headers, ...linhas] = parse(csv);
    const idx = col(headers, 'Valor');
    const centavos = linhas.reduce((acc, l) => acc + Math.round(Number(l[idx]) * 100), 0);
    expect(centavos).toBe(SYNTHETIC_TOTAL_CENTS);
  });

  it('o número de linhas exportadas é o número de transações filtradas', () => {
    const set = syntheticSet();
    const { csv } = exportar(set);
    expect(parse(csv).length - 1).toBe(set.length);
  });

  it('ordem preservada', () => {
    const set = syntheticSet();
    const [headers, ...linhas] = parse(exportar(set).csv);
    const idx = col(headers, 'Descrição');
    // Nenhuma descrição do conjunto sintético começa com gatilho de fórmula,
    // então a ordem do arquivo tem que ser exatamente a da origem.
    expect(linhas.map((l) => l[idx])).toEqual(set.map((t) => t.Nome_Fantasia));
  });
});

describe('CSV — proteção de fórmula: só no CSV, e o arquivo continua parseável', () => {
  // Os casos mínimos do requisito, de ponta a ponta: modelo → CSV → parse.
  const gatilhos: Array<[string, string]> = [
    ['=SUM(A1:A2)', "'=SUM(A1:A2)"],
    ['@cmd', "'@cmd"],
    ['+texto', "'+texto"],
    ['-texto', "'-texto"],
    ['\ttexto', "'\ttexto"],
    ['\rtexto', "'\rtexto"],
  ];

  it.each(gatilhos)('descrição %j é neutralizada no CSV', (bruto, esperado) => {
    const { csv, columns } = exportar([makeTx({ Nome_Fantasia: bruto })]);
    const linhas = parse(csv);
    // continua parseável: cabeçalho + 1 linha, com todas as colunas
    expect(linhas).toHaveLength(2);
    expect(linhas[1]).toHaveLength(columns.length);
    expect(linhas[1][col(linhas[0], 'Descrição')]).toBe(esperado);
  });

  it('"-" isolado continua exatamente "-"', () => {
    const { csv } = exportar([makeTx({ Nome_Fantasia: '-', Categoria: '-' })]);
    const [headers, linha] = parse(csv);
    expect(linha[col(headers, 'Descrição')]).toBe('-');
    expect(linha[col(headers, 'Categoria')]).toBe('-');
  });

  it.each(['3x sem juros', '10% de desconto', '1+1 leve 2', '2026 Natal', 'Padaria = boa', 'x@y.com'])(
    'texto legítimo %j não é alterado',
    (texto) => {
      const { csv } = exportar([makeTx({ Nome_Fantasia: texto })]);
      const [headers, linha] = parse(csv);
      expect(linha[col(headers, 'Descrição')]).toBe(texto);
    }
  );

  it('o modelo canônico NÃO é alterado: a neutralização é só da serialização do CSV', () => {
    const transacoes = [makeTx({ Nome_Fantasia: '=SUM(A1:A2)' }), makeTx({ Nome_Fantasia: '@cmd' })];
    const { rows } = exportar(transacoes);
    const antes = JSON.stringify(rows);

    // o modelo guarda o texto ORIGINAL, sem apóstrofo
    expect(rows[0].descricao).toBe('=SUM(A1:A2)');
    expect(rows[1].descricao).toBe('@cmd');

    // serializar (CSV) não muda as linhas do modelo
    serializeTransactionsCsv(rows, getTransactionExportColumns(false));
    expect(JSON.stringify(rows)).toBe(antes);
  });

  it('numa mesma linha: texto perigoso é protegido e o valor negativo segue numérico', () => {
    const { csv } = exportar([makeTx({ Nome_Fantasia: '-2+3+cmd|calc', Valor: -99.9 })]);
    const [headers, linha] = parse(csv);
    expect(linha[col(headers, 'Descrição')]).toBe("'-2+3+cmd|calc");
    expect(linha[col(headers, 'Valor')]).toBe('-99.90');
  });
});
