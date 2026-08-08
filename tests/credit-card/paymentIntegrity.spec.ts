import { describe, expect, it } from 'vitest';
import {
  assertUniqueImportedPaymentBatch,
  importedPaymentProvenanceKey,
  importedPaymentProvenanceKeyFromNotes,
  planImportedPaymentPersistence,
  type ExistingImportedPaymentIdentity,
} from '../../src/utils/creditCardPaymentIntegrity';

const fileName = '11_xp_cartao_fatura_agosto_2026.csv';
const notes = (hash: string, line: number) =>
  `${hash} · ${fileName} · linha ${line} · Pagamentos Validos`;
const existing = (
  id: string,
  transactionId: string | null,
  line: number,
  hash = 'hash'
): ExistingImportedPaymentIdentity => ({
  id,
  payment_transaction_id: transactionId,
  notes: notes(hash, line),
});

describe('credit card imported payment integrity', () => {
  it('normaliza a proveniência sem depender de extensão, acentos ou separadores', () => {
    expect(importedPaymentProvenanceKey('Fatura Cartão XP.csv', 4)).toBe(
      importedPaymentProvenanceKey('fatura_cartao_xp.XLSX', 4)
    );
    expect(importedPaymentProvenanceKeyFromNotes(notes('h123', 4))).toBe(
      importedPaymentProvenanceKey(fileName, 4)
    );
  });

  it('insere quando não existe identidade anterior', () => {
    expect(
      planImportedPaymentPersistence(
        { sourceFileName: fileName, sourceRowIndex: 4, transactionId: 'tx-new' },
        []
      )
    ).toEqual({ action: 'insert', transactionId: 'tx-new' });
  });

  it('bloqueia identidades repetidas dentro do próprio lote antes de gravar', () => {
    expect(() =>
      assertUniqueImportedPaymentBatch([
        { sourceFileName: fileName, sourceRowIndex: 4, transactionId: 'tx-repeated' },
        { sourceFileName: fileName, sourceRowIndex: 5, transactionId: 'tx-repeated' },
      ])
    ).toThrow(/mesmo lote; nenhuma linha foi alterada/);

    expect(() =>
      assertUniqueImportedPaymentBatch([
        { sourceFileName: fileName, sourceRowIndex: 4, transactionId: 'tx-a' },
        { sourceFileName: fileName, sourceRowIndex: 4, transactionId: 'tx-b' },
      ])
    ).toThrow(/arquivo e linha.*mesmo lote; nenhuma linha foi alterada/);
  });

  it('promove no mesmo registro a linha antiga sem transação', () => {
    expect(
      planImportedPaymentPersistence(
        { sourceFileName: fileName, sourceRowIndex: 4, transactionId: 'tx-linked' },
        [existing('legacy-row', null, 4, 'hold')]
      )
    ).toEqual({
      action: 'update',
      rowId: 'legacy-row',
      transactionId: 'tx-linked',
    });
  });

  it('reutiliza a transação vinculada quando um reprocessamento não traz o ID', () => {
    expect(
      planImportedPaymentPersistence(
        { sourceFileName: fileName, sourceRowIndex: 4 },
        [existing('linked-row', 'tx-linked', 4, 'hnew')]
      )
    ).toEqual({
      action: 'update',
      rowId: 'linked-row',
      transactionId: 'tx-linked',
    });
  });

  it('usa a identidade imutável da transação mesmo se o número da linha mudar', () => {
    expect(
      planImportedPaymentPersistence(
        { sourceFileName: fileName, sourceRowIndex: 5, transactionId: 'tx-linked' },
        [existing('linked-row', 'tx-linked', 4, 'hnew')]
      )
    ).toEqual({
      action: 'update',
      rowId: 'linked-row',
      transactionId: 'tx-linked',
    });
  });

  it('falha fechado quando o mesmo arquivo e linha apontam para outra transação', () => {
    expect(() =>
      planImportedPaymentPersistence(
        { sourceFileName: fileName, sourceRowIndex: 4, transactionId: 'tx-new' },
        [existing('linked-row', 'tx-other', 4)]
      )
    ).toThrow(/outra transação; nenhuma linha foi alterada/);
  });

  it('falha fechado diante do histórico duplicado real sem escolher por valor', () => {
    expect(() =>
      planImportedPaymentPersistence(
        { sourceFileName: fileName, sourceRowIndex: 4, transactionId: 'tx-linked' },
        [
          existing('legacy-row', null, 4, 'hold'),
          existing('linked-row', 'tx-linked', 4, 'hnew'),
        ]
      )
    ).toThrow(/2 projeções.*nenhuma linha foi alterada/);
  });

  it('não confunde pagamentos legítimos em linhas diferentes', () => {
    expect(
      planImportedPaymentPersistence(
        { sourceFileName: fileName, sourceRowIndex: 5, transactionId: 'tx-second' },
        [existing('first-payment', 'tx-first', 4)]
      )
    ).toEqual({ action: 'insert', transactionId: 'tx-second' });
  });
});
