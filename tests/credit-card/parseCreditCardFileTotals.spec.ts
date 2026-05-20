import { describe, it, expect } from 'vitest';
import {
  parseCreditCardFileTotals,
  sumInvoicePaymentsFromClassifiedEntries,
} from '../../src/utils/parseCreditCardFileTotals';

describe('parseCreditCardFileTotals', () => {
  it('extrai total da fatura de linha de resumo', () => {
    const csv = [
      'Data;Estabelecimento;Portador;Valor;Parcela',
      '01/04/2026;LOJA;TITULAR;100,00;',
      'Total da fatura;6.217,87',
    ].join('\n');
    const t = parseCreditCardFileTotals(csv);
    expect(t.statementTotal).toBe(6217.87);
  });

  it('extrai pagamentos efetuados quando presente', () => {
    const csv = 'Pagamentos efetuados;10.854,95\nTotal da fatura;6.217,87';
    const t = parseCreditCardFileTotals(csv);
    expect(t.totalPayments).toBe(10854.95);
  });

  it('soma invoice_payment no lote', () => {
    const sum = sumInvoicePaymentsFromClassifiedEntries([
      { entryType: 'purchase', amount: -100 },
      { entryType: 'invoice_payment', amount: 500 },
      { entryType: 'invoice_payment', amount: 200.5 },
    ]);
    expect(sum).toBe(700.5);
  });
});
