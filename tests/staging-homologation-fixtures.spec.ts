import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NATIVE_BANK_CONFIGS, parseNativeBankCSV } from '../src/services/parsers/nativeBankParsers';

const currentDir = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(currentDir, '../docs/homologacao/staging-2026-07-30/arquivos');
const nubankAccount = NATIVE_BANK_CONFIGS.find((config) => config.id === 'nubank-conta')!;
const xpCard = NATIVE_BANK_CONFIGS.find((config) => config.id === 'cartao-xp')!;

function readFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8');
}

function totals(name: string, bankConfig: typeof nubankAccount) {
  const parsed = parseNativeBankCSV(readFixture(name), bankConfig, [], [], undefined, name);
  const income = parsed.newTransactions
    .filter((transaction) => transaction.Valor > 0)
    .reduce((sum, transaction) => sum + transaction.Valor, 0);
  const expenses = parsed.newTransactions
    .filter((transaction) => transaction.Valor < 0)
    .reduce((sum, transaction) => sum + Math.abs(transaction.Valor), 0);
  return { parsed, income, expenses };
}

describe('pacote de homologação do staging', () => {
  it('reconcilia o extrato base da conta Nubank', () => {
    const result = totals('01_nubank_conta_base_julho_2026.csv', nubankAccount);

    expect(result.parsed.newTransactions).toHaveLength(10);
    expect(result.income).toBeCloseTo(5450, 2);
    expect(result.expenses).toBeCloseTo(2044.6, 2);
  });

  it('preserva valores iguais em transações legítimas distintas', () => {
    const result = totals('02_nubank_conta_mesmos_valores_agosto_2026.csv', nubankAccount);

    expect(result.parsed.newTransactions).toHaveLength(5);
    expect(result.income).toBeCloseTo(250, 2);
    expect(result.expenses).toBeCloseTo(339.8, 2);
  });

  it('mantém a cópia renomeada byte a byte idêntica ao arquivo base', () => {
    expect(readFixture('03_nubank_conta_base_julho_2026_RENOMEADO.csv')).toBe(
      readFixture('01_nubank_conta_base_julho_2026.csv')
    );
  });

  it('reconcilia as duas competências sintéticas do cartão XP', () => {
    const july = totals('10_xp_cartao_fatura_julho_2026.csv', xpCard);
    const august = totals('11_xp_cartao_fatura_agosto_2026.csv', xpCard);

    expect(july.parsed.newTransactions).toHaveLength(5);
    expect(july.income).toBeCloseTo(450, 2);
    expect(july.expenses).toBeCloseTo(449.9, 2);
    expect(august.parsed.newTransactions).toHaveLength(4);
    expect(august.income).toBeCloseTo(399.9, 2);
    expect(august.expenses).toBeCloseTo(449.9, 2);
  });

  it('processa as 1.000 linhas do arquivo de estresse sem colapsar repetições legítimas', () => {
    const result = totals('90_nubank_conta_stress_1000_linhas.csv', nubankAccount);

    expect(result.parsed.newTransactions).toHaveLength(1000);
    expect(result.income).toBeCloseTo(100000, 2);
    expect(result.expenses).toBeCloseTo(9000, 2);
  });

  it.fails('rejeita valor textual inválido em vez de gerar NaN (defeito conhecido da baseline)', () => {
    const result = totals('91_nubank_conta_linhas_invalidas.csv', nubankAccount);

    expect(result.parsed.newTransactions).toHaveLength(2);
    expect(result.parsed.ignoredCount).toBe(3);
    expect(result.parsed.newTransactions.every((transaction) => Number.isFinite(transaction.Valor))).toBe(true);
    expect(result.income).toBeCloseTo(15, 2);
    expect(result.expenses).toBeCloseTo(10, 2);
  });
});
