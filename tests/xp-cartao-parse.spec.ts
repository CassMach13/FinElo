import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { NATIVE_BANK_CONFIGS, parseNativeBankCSV } from '../src/services/parsers/nativeBankParsers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const xpCartao = NATIVE_BANK_CONFIGS.find((c) => c.id === 'cartao-xp')!;

describe('XP fatura CSV', () => {
  it('inclui linha Pagamentos Validos Normais e rotula Pagamento de Fatura', () => {
    const csvPath = join(__dirname, '../modelos de fatura/Cartao XP/Fatura_Cartao_XP_Cassio_Jan_2026.csv');
    const content = readFileSync(csvPath, 'utf8').trimEnd();
    const bodyLines = content.split(/\r?\n/).slice(1).filter((l) => l.trim().length > 0);
    expect(bodyLines.length).toBe(125);

    const r = parseNativeBankCSV(content, xpCartao, [], [], undefined, 'Fatura_Cartao_XP_Cassio_Jan_2026.csv');
    const paymentLine = bodyLines.find((l) => l.includes('Pagamentos Validos'));
    const paymentTx = r.newTransactions.find((t) =>
      String(t.Descricao_Original || '').includes('Pagamentos Validos')
    );

    expect(paymentTx).toBeDefined();
    expect(paymentTx!.Valor).toBeGreaterThan(0);
    expect(paymentTx!.Tipo).toBe('Renda');
    expect(paymentTx!.Nome_Fantasia).toBe('Pagamento de Fatura');
    expect(r.ignoredCount).toBe(0);
    expect(r.ignoredItems.length).toBe(0);
    expect(r.newTransactions.length).toBe(125);
  });
});
