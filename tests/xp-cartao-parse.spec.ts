import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { NATIVE_BANK_CONFIGS, parseNativeBankCSV } from '../src/services/parsers/nativeBankParsers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const xpCartao = NATIVE_BANK_CONFIGS.find((c) => c.id === 'cartao-xp')!;

const csvPath = join(__dirname, '../modelos de fatura/Cartao XP/Fatura_Cartao_XP_Cassio_Jan_2026.csv');

/**
 * A fatura real usada aqui vive em `modelos de fatura/`, que o `.gitignore` exclui
 * de propósito — é extrato de verdade, com dados pessoais, e não deve ser versionado.
 *
 * Sem esta guarda o teste falhava com ENOENT em toda execução de CI, deixando o gate
 * do projeto permanentemente vermelho e escondendo falhas reais no meio do ruído.
 * Na máquina de quem tem o arquivo, o teste roda normalmente.
 */
const temFixtureLocal = existsSync(csvPath);

describe.skipIf(!temFixtureLocal)('XP fatura CSV', () => {
  it('inclui linha Pagamentos Validos Normais e rotula Pagamento de Fatura', () => {
    const content = readFileSync(csvPath, 'utf8').trimEnd();
    const bodyLines = content.split(/\r?\n/).slice(1).filter((l) => l.trim().length > 0);
    expect(bodyLines.length).toBe(125);

    const r = parseNativeBankCSV(content, xpCartao, [], [], undefined, 'Fatura_Cartao_XP_Cassio_Jan_2026.csv');
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
