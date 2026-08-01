import { describe, expect, it } from 'vitest';
import {
  buildFileImportFingerprint,
  buildStructuredImportFingerprint,
  isSha256Fingerprint,
} from '../src/utils/importBatchIntegrity';
import type { Transaction } from '../src/types';

describe('importBatchIntegrity', () => {
  it('não muda com o nome do arquivo, apenas conteúdo e conta', async () => {
    const content = new TextEncoder().encode('Data,Valor\n01/08/2026,-10').buffer;
    const fileA = { arrayBuffer: async () => content };
    const fileB = { arrayBuffer: async () => content.slice(0) };

    const a = await buildFileImportFingerprint(fileA, 'account-a');
    const b = await buildFileImportFingerprint(fileB, 'account-a');
    const anotherAccount = await buildFileImportFingerprint(fileB, 'account-b');

    expect(a).toBe(b);
    expect(anotherAccount).not.toBe(a);
    expect(isSha256Fingerprint(a)).toBe(true);
  });

  it('gera fallback estável para fluxos sem File', async () => {
    const rows = [
      {
        Data: new Date('2026-08-01T12:00:00.000Z'),
        Data_Pagamento: new Date('2026-08-02T12:00:00.000Z'),
        Nome_Fantasia: 'Café',
        Descricao_Original: 'CAFE',
        Categoria: 'Alimentação',
        Tipo: 'Despesa',
        Valor: -35,
        Origem: 'demo.csv',
        Fonte: 'Demo',
      },
    ] as Array<Omit<Transaction, 'ID_Transacao' | 'user_id'>>;

    expect(await buildStructuredImportFingerprint(rows, 'account-a')).toBe(
      await buildStructuredImportFingerprint(rows, 'account-a')
    );
  });
});
