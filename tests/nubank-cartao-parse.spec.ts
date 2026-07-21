import { describe, expect, it } from 'vitest';
import { NATIVE_BANK_CONFIGS, parseNativeBankCSV } from '../src/services/parsers/nativeBankParsers';

const nubankCartao = NATIVE_BANK_CONFIGS.find((c) => c.id === 'nubank-cartao')!;

const SAMPLE_CSV = `date,title,amount
2026-01-16,Dl*Google Deezer,"24,90"
2026-01-16,A Barbearia,"100,00"
2026-01-20,Casa e Tinta Lj,"580,00"
2026-02-09,Pagamento recebido,"- 669,86"
`;

describe('Nubank fatura CSV', () => {
  it('interpreta valores com vírgula decimal no padrão brasileiro', () => {
    const r = parseNativeBankCSV(SAMPLE_CSV, nubankCartao, [], [], undefined, 'Nubank_2026-02-18.csv');

    const deezer = r.newTransactions.find((t) => t.Descricao_Original.includes('Deezer'));
    const barbearia = r.newTransactions.find((t) => t.Descricao_Original.includes('Barbearia'));
    const casa = r.newTransactions.find((t) => t.Descricao_Original.includes('Casa e Tinta'));
    const pagamento = r.newTransactions.find((t) => t.Descricao_Original.includes('Pagamento recebido'));

    expect(deezer?.Valor).toBe(-24.9);
    expect(barbearia?.Valor).toBe(-100);
    expect(casa?.Valor).toBe(-580);
    expect(pagamento?.Valor).toBe(669.86);
    expect(r.newTransactions.length).toBe(4);
  });
});
