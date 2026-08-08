import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeImportLedgerTotals } from '../src/domain/credit-card/importLedgerTotals';
import { ledgerClassificationTextFromTransaction } from '../src/services/creditCardDirectedPayment';
import { NATIVE_BANK_CONFIGS, parseNativeBankCSV } from '../src/services/parsers/nativeBankParsers';
import { resolveAutomaticCardReferenceMonth } from '../src/utils/cardImportReference';

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

    const julyLedger = computeImportLedgerTotals(
      july.parsed.newTransactions.map((transaction) => ({
        amount: transaction.Valor,
        description: ledgerClassificationTextFromTransaction(transaction),
        installmentTotal: transaction.Total_Parcelas,
        fineloTipo: transaction.Tipo,
      }))
    );
    const julyRefund = july.parsed.newTransactions.find((transaction) =>
      String(transaction.Descricao_Original).includes('ESTORNO CURSO')
    );
    const julyPayment = july.parsed.newTransactions.find((transaction) =>
      String(transaction.Descricao_Original).includes('Pagamentos Validos')
    );

    expect(july.parsed.newTransactions).toHaveLength(5);
    expect(july.income).toBeCloseTo(450, 2);
    expect(july.expenses).toBeCloseTo(449.9, 2);
    expect(julyRefund?.Nome_Fantasia).toBe('STG-QA ESTORNO CURSO');
    expect(julyRefund?.Categoria).not.toBe('Pagamento de Fatura');
    expect(julyPayment?.Nome_Fantasia).toBe('Pagamento de Fatura');
    expect(julyLedger.totalDebits).toBeCloseTo(449.9, 2);
    expect(julyLedger.totalRefunds).toBeCloseTo(50, 2);
    expect(julyLedger.statementTotal).toBeCloseTo(399.9, 2);
    expect(julyLedger.totalInvoicePayments).toBeCloseTo(400, 2);
    expect(resolveAutomaticCardReferenceMonth(july.parsed.newTransactions)).toBe('2026-07');
    expect(august.parsed.newTransactions).toHaveLength(4);
    expect(august.income).toBeCloseTo(399.9, 2);
    expect(august.expenses).toBeCloseTo(449.9, 2);
    expect(resolveAutomaticCardReferenceMonth(august.parsed.newTransactions)).toBe('2026-08');
  });

  it('valida o par sintético da Sprint 2B sem colapsar compras iguais', () => {
    const july = totals('20_xp_cartao_idempotencia_julho_2026.csv', xpCard);
    const august = totals('21_xp_cartao_idempotencia_agosto_2026.csv', xpCard);

    const repeatedPurchases = july.parsed.newTransactions.filter(
      (transaction) => transaction.Nome_Fantasia === 'STG-2B COMPRA REPETIDA'
    );
    const julyPayment = july.parsed.newTransactions.find(
      (transaction) => transaction.Nome_Fantasia === 'Pagamento de Fatura'
    );
    const augustPayment = august.parsed.newTransactions.find(
      (transaction) => transaction.Nome_Fantasia === 'Pagamento de Fatura'
    );

    expect(july.parsed.newTransactions).toHaveLength(4);
    expect(august.parsed.newTransactions).toHaveLength(2);
    expect(repeatedPurchases).toHaveLength(2);
    expect(julyPayment?.Valor).toBeCloseTo(190, 2);
    expect(augustPayment?.Valor).toBeCloseTo(190, 2);
    expect(resolveAutomaticCardReferenceMonth(july.parsed.newTransactions)).toBe('2026-07');
    expect(resolveAutomaticCardReferenceMonth(august.parsed.newTransactions)).toBe('2026-08');
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
