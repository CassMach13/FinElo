import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../../src/types';

/**
 * Edição de transação IMPORTADA no store (`updateTransaction`).
 *
 * O modal de edição grava `Parcela_Atual: null`, `Total_Parcelas: null`, `Fonte: 'Manual'`,
 * `Descricao_Original` reescrita e `Data_Pagamento`/`Valor` derivados do formulário. No mobile esse
 * modal também abria para importadas. O store persistia o payload inteiro, então a numeração de
 * parcelas e a descrição original do banco se perdiam numa edição cosmética (chamado 20260905-9C10).
 *
 * O mock espelha o PostgREST: `undefined` some do JSON, `null` é gravado.
 */
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../../src/supabaseClient', () => ({ supabase: { from: mocks.from } }));

import { useAppStore } from '../../src/hooks/useAppStore';

type Row = Record<string, unknown>;
let stored: Row;
let sentPayloads: Row[];

const importedInstallment = (): Transaction =>
  ({
    ID_Transacao: 'tx-1',
    user_id: 'user-1',
    ID_Conta: 'card-1',
    Data: new Date('2026-08-10T00:00:00.000Z'),
    Data_Pagamento: new Date('2026-09-10T00:00:00.000Z'),
    Descricao_Original: 'LOJA XYZ PARC 02/06',
    Nome_Fantasia: 'Loja XYZ',
    Parcela_Atual: 2,
    Total_Parcelas: 6,
    Valor: -150.5,
    Tipo: 'Despesa',
    Categoria: 'Compras',
    Origem: 'fatura-agosto.csv',
    Fonte: 'Importação',
  }) as Transaction;

const manualTx = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    ID_Transacao: 'tx-m',
    user_id: 'user-1',
    ID_Conta: 'acc-1',
    Data: new Date('2026-09-01T00:00:00.000Z'),
    Descricao_Original: 'Mercado',
    Nome_Fantasia: 'Mercado',
    Valor: -80,
    Tipo: 'Despesa',
    Categoria: 'Alimentação',
    Origem: 'manual',
    Fonte: 'Manual',
    ...overrides,
  }) as Transaction;

/** Payload exatamente como o modal de edição o monta ao salvar uma importada. */
const modalPayload = (tx: Transaction, overrides: Partial<Transaction> = {}) => ({
  Data: new Date('2026-08-10T03:00:00.000Z'),
  ID_Conta: tx.ID_Conta,
  Data_Pagamento: tx.Data_Pagamento ?? tx.Data,
  Nome_Fantasia: tx.Nome_Fantasia,
  Categoria: tx.Categoria,
  Tipo: tx.Tipo,
  Valor: tx.Valor,
  Parcela_Atual: null,
  Total_Parcelas: null,
  Fonte: 'Manual',
  Descricao_Original: tx.Nome_Fantasia,
  linked_asset_id: undefined,
  ...overrides,
});

const seed = (tx: Transaction) => {
  stored = JSON.parse(JSON.stringify(tx));
  useAppStore.setState({ transactions: [tx], accounts: [], recalculateAssetBalance: vi.fn() } as never);
};

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState(useAppStore.getInitialState(), true);
  sentPayloads = [];
  mocks.from.mockImplementation((table: string) => {
    if (table !== 'transactions') throw new Error(`Tabela inesperada: ${table}`);
    return {
      update: (payload: Row) => ({
        eq: (column: string, id: string) => {
          expect(column).toBe('ID_Transacao');
          expect(id).toBe(stored.ID_Transacao);
          return {
            select: async () => {
              const wire = JSON.parse(JSON.stringify(payload));
              sentPayloads.push(wire);
              stored = { ...stored, ...wire };
              return { data: [stored], error: null };
            },
          };
        },
      }),
    };
  });
});

const update = (patch: Row) =>
  useAppStore.getState().updateTransaction({ ID_Transacao: 'tx-1', ...patch } as never);

describe('updateTransaction — importada: a edição cosmética não toca na estrutura', () => {
  it('A. categoria alterada pelo modal mantém a parcela 2/6 e todo o resto', async () => {
    const tx = importedInstallment();
    const before = JSON.parse(JSON.stringify(tx));
    seed(tx);

    await update(modalPayload(tx, { Categoria: 'Lazer' }));

    expect(stored.Categoria).toBe('Lazer');
    for (const field of [
      'Parcela_Atual', 'Total_Parcelas', 'Origem', 'Fonte', 'Descricao_Original',
      'Data', 'Data_Pagamento', 'ID_Conta', 'Valor', 'Tipo',
    ]) {
      expect(stored[field], field).toEqual(before[field]);
    }
  });

  it('B. nome alterado pelo modal mantém a metadata e a descrição original do banco', async () => {
    const tx = importedInstallment();
    seed(tx);

    await update(modalPayload(tx, { Nome_Fantasia: 'Loja XYZ (presente)', Descricao_Original: 'Loja XYZ (presente)' }));

    expect(stored.Nome_Fantasia).toBe('Loja XYZ (presente)');
    expect(stored.Descricao_Original).toBe('LOJA XYZ PARC 02/06');
    expect([stored.Parcela_Atual, stored.Total_Parcelas]).toEqual([2, 6]);
    expect(stored.Fonte).toBe('Importação');
  });

  it('C. vínculo com patrimônio é gravado e a metadata continua intacta', async () => {
    const tx = importedInstallment();
    seed(tx);

    await update(modalPayload(tx, { linked_asset_id: 'asset-9' }));

    expect(stored.linked_asset_id).toBe('asset-9');
    expect([stored.Parcela_Atual, stored.Total_Parcelas]).toEqual([2, 6]);
    expect(stored.Origem).toBe('fatura-agosto.csv');
  });

  it('D. campos estruturais vazios/undefined no payload não são persistidos sobre o registro', async () => {
    const tx = importedInstallment();
    seed(tx);

    await update({
      Nome_Fantasia: 'Novo nome',
      Parcela_Atual: undefined,
      Total_Parcelas: undefined,
      Descricao_Original: '',
      Fonte: undefined,
      Valor: undefined,
    });

    expect(Object.keys(sentPayloads[0])).toEqual(['Nome_Fantasia']);
    expect([stored.Parcela_Atual, stored.Total_Parcelas]).toEqual([2, 6]);
    expect(stored.Descricao_Original).toBe('LOJA XYZ PARC 02/06');
  });

  it('D2. edição inline (linha inteira + 1 campo) grava apenas o campo alterado', async () => {
    const tx = importedInstallment();
    seed(tx);

    await update({ ...tx, Categoria: 'Lazer', ID_Transacao: 'tx-1' });

    expect(Object.keys(sentPayloads[0])).toEqual(['Categoria']);
  });

  it('E. importada sem parcela continua sem parcela (não vira 1/1 nem null)', async () => {
    const tx = importedInstallment();
    delete (tx as Partial<Transaction>).Parcela_Atual;
    delete (tx as Partial<Transaction>).Total_Parcelas;
    seed(tx);

    await update(modalPayload(tx, { Categoria: 'Lazer' }));

    expect('Parcela_Atual' in stored).toBe(false);
    expect('Total_Parcelas' in stored).toBe(false);
    expect(sentPayloads[0]).not.toHaveProperty('Parcela_Atual');
  });

  it('G. nenhum campo estrutural viaja no payload de uma edição cosmética', async () => {
    const tx = importedInstallment();
    seed(tx);

    await update(modalPayload(tx, { Categoria: 'Lazer' }));

    const sent = Object.keys(sentPayloads[0]);
    for (const field of [
      'Origem', 'Fonte', 'Descricao_Original', 'Data', 'ID_Conta', 'Parcela_Atual', 'Total_Parcelas', 'Valor', 'Tipo',
    ]) {
      expect(sent, field).not.toContain(field);
    }
  });

  it('uma edição que não muda nada não escreve no banco', async () => {
    const tx = importedInstallment();
    seed(tx);

    await update(modalPayload(tx));

    expect(sentPayloads).toHaveLength(0);
  });

  it('id desconhecido é recusado sem escrever', async () => {
    seed(importedInstallment());

    await useAppStore.getState().updateTransaction({ ID_Transacao: 'nao-existe', Categoria: 'X' } as never);

    expect(sentPayloads).toHaveLength(0);
  });
});

describe('updateTransaction — manual: comportamento inalterado', () => {
  it('F. edição manual grava todos os campos enviados, inclusive valor, data e parcelas', async () => {
    const tx = manualTx();
    seed(tx);
    stored.ID_Transacao = 'tx-m';

    await useAppStore.getState().updateTransaction({
      ID_Transacao: 'tx-m',
      Nome_Fantasia: 'Mercado Central',
      Valor: -95.9,
      Data: new Date('2026-09-03T00:00:00.000Z'),
      Parcela_Atual: 1,
      Total_Parcelas: 3,
      Fonte: 'Manual',
    } as never);

    expect(Object.keys(sentPayloads[0]).sort()).toEqual(
      ['Data', 'Fonte', 'Nome_Fantasia', 'Parcela_Atual', 'Total_Parcelas', 'Valor']
    );
    expect(stored.Valor).toBe(-95.9);
    expect([stored.Parcela_Atual, stored.Total_Parcelas]).toEqual([1, 3]);
  });

  it('F2. registro sem Origem é tratado como manual (como no resto do app)', async () => {
    const tx = manualTx();
    delete (tx as Partial<Transaction>).Origem;
    seed(tx);
    stored.ID_Transacao = 'tx-m';

    await useAppStore.getState().updateTransaction({ ID_Transacao: 'tx-m', Valor: -10 } as never);

    expect(sentPayloads[0]).toEqual({ Valor: -10 });
  });

  it('F3. vínculo do Open Finance numa manual (campo extra) continua sendo gravado', async () => {
    const tx = manualTx();
    seed(tx);
    stored.ID_Transacao = 'tx-m';

    await useAppStore.getState().updateTransaction({
      ID_Transacao: 'tx-m',
      pluggy_transaction_id: 'pl-1',
      Categoria: 'Mercado',
    } as never);

    expect(sentPayloads[0]).toEqual({ pluggy_transaction_id: 'pl-1', Categoria: 'Mercado' });
  });
});
