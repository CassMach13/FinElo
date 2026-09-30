import Papa from 'papaparse';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from '../../src/types';
import { serializeTransactionsCsv } from '../../src/domain/export/transactionCsv';
import {
  buildTransactionExportRows,
  getTransactionExportColumns,
} from '../../src/domain/export/transactionExport';
import { buildTransactionsXlsx } from '../../src/domain/export/transactionXlsx';
import { ACCOUNTS, SYNTHETIC_TOTAL_CENTS, makeTx, syntheticSet } from './fixtures';

/**
 * Conservação entre FONTE, CSV e XLSX: a mesma quantidade de linhas e a mesma
 * soma monetária, comparadas em CENTAVOS INTEIROS. Igualdade de floats não é
 * critério financeiro: 0,1 + 0,2 !== 0,3.
 */

async function loadExcelJs(): Promise<typeof import('exceljs')> {
  const mod = (await import('exceljs')) as typeof import('exceljs') & { default?: typeof import('exceljs') };
  return mod.default ?? mod;
}

// Cold start do exceljs: ver o comentário em transactionXlsx.spec.ts.
beforeAll(async () => {
  await loadExcelJs();
}, 60_000);

/** "-412.37" → -41237, sem passar por Number/float. */
function csvMoneyToCents(text: string): number {
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(text);
  if (!m) throw new Error(`valor CSV fora do formato esperado: ${JSON.stringify(text)}`);
  const cents = Number(m[2]) * 100 + Number(m[3]);
  return m[1] === '-' ? -cents : cents;
}

/**
 * Conjunto determinístico com centavos que costumam quebrar soma em float.
 * Gerador congruencial linear com semente fixa: o mesmo conjunto em qualquer máquina.
 */
function largeSet(size: number): { transactions: Transaction[]; totalCents: number } {
  let seed = 20260930;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed;
  };
  const transactions: Transaction[] = [];
  let totalCents = 0;
  for (let i = 0; i < size; i += 1) {
    const magnitude = next() % 2_000_000; // até 19.999,99
    const cents = (next() % 2 === 0 ? -1 : 1) * magnitude;
    totalCents += cents;
    transactions.push(makeTx({ Valor: cents / 100, Nome_Fantasia: `Linha ${i + 1}` }));
  }
  return { transactions, totalCents };
}

async function exportarNosDoisFormatos(transactions: Transaction[]) {
  const columns = getTransactionExportColumns(false);
  const rows = buildTransactionExportRows(transactions, { accounts: ACCOUNTS });

  const csv = serializeTransactionsCsv(rows, columns);
  const csvRows = Papa.parse<string[]>(csv.replace(/^﻿/, '')).data.filter((l) => l.length > 1);
  const valorCsv = columns.findIndex((c) => c.key === 'valor');
  const linhasCsv = csvRows.slice(1);
  const centavosCsv = linhasCsv.reduce((acc, l) => acc + csvMoneyToCents(l[valorCsv]), 0);

  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await buildTransactionsXlsx(rows, columns)) as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  const valorXlsx = valorCsv + 1;
  let centavosXlsx = 0;
  let linhasXlsx = 0;
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    linhasXlsx += 1;
    centavosXlsx += Math.round(Number(row.getCell(valorXlsx).value) * 100);
  });

  return { linhasCsv: linhasCsv.length, linhasXlsx, centavosCsv, centavosXlsx };
}

describe('conservação fonte = CSV = XLSX', () => {
  it('conjunto sintético de total conhecido: linhas e centavos idênticos nos três', async () => {
    const fonte = syntheticSet();
    const centavosFonte = fonte.reduce((acc, t) => acc + Math.round(t.Valor * 100), 0);
    expect(centavosFonte).toBe(SYNTHETIC_TOTAL_CENTS); // 450.467 = R$ 4.504,67

    const r = await exportarNosDoisFormatos(fonte);
    expect(r.linhasCsv).toBe(fonte.length);
    expect(r.linhasXlsx).toBe(fonte.length);
    expect(r.linhasCsv).toBe(r.linhasXlsx);

    expect(r.centavosCsv).toBe(SYNTHETIC_TOTAL_CENTS);
    expect(r.centavosXlsx).toBe(SYNTHETIC_TOTAL_CENTS);
    expect(r.centavosCsv).toBe(r.centavosXlsx);
  });

  it('500 linhas com centavos incômodos: nenhum centavo se perde entre fonte, CSV e XLSX', async () => {
    const { transactions, totalCents } = largeSet(500);
    expect(transactions).toHaveLength(500);

    const r = await exportarNosDoisFormatos(transactions);
    expect(r.linhasCsv).toBe(500);
    expect(r.linhasXlsx).toBe(500);
    expect(r.centavosCsv).toBe(totalCents);
    expect(r.centavosXlsx).toBe(totalCents);
  });

  it('o critério em centavos é mesmo necessário: em float a soma da fonte diverge', () => {
    // Garante que o teste acima não é trivial: com este conjunto, somar em float
    // dá um resultado diferente da soma exata em centavos.
    const { transactions, totalCents } = largeSet(500);
    const emFloat = transactions.reduce((acc, t) => acc + t.Valor, 0);
    expect(Math.round(emFloat * 100)).toBe(totalCents); // arredondado ao centavo, bate…
    expect(emFloat).not.toBe(totalCents / 100); // …mas a igualdade ingênua de floats não
  });

  it('conjunto vazio: zero linhas e zero centavos nos dois formatos', async () => {
    const r = await exportarNosDoisFormatos([]);
    expect(r).toEqual({ linhasCsv: 0, linhasXlsx: 0, centavosCsv: 0, centavosXlsx: 0 });
  });

  it('uma única transação, positiva e negativa', async () => {
    for (const valor of [1234.56, -1234.56, 0.01, -0.01]) {
      const r = await exportarNosDoisFormatos([makeTx({ Valor: valor })]);
      const esperado = Math.round(valor * 100);
      expect(r.centavosCsv).toBe(esperado);
      expect(r.centavosXlsx).toBe(esperado);
    }
  });
});
