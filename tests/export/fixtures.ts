import type { Account, Transaction } from '../../src/types';

/**
 * Dados 100% sintéticos para os testes de exportação (A902). Nada aqui vem de
 * conta real: nomes, valores e arquivos são inventados.
 */

export const ACCOUNTS: Pick<Account, 'id' | 'Nome_Conta' | 'Tipo_Conta'>[] = [
  { id: 'acc-cc', Nome_Conta: 'Conta Corrente Exemplo', Tipo_Conta: 'Conta Corrente' },
  { id: 'acc-card', Nome_Conta: 'Cartão Exemplo', Tipo_Conta: 'Cartão de Crédito' },
  { id: 'acc-vale', Nome_Conta: 'Vale Refeição Exemplo', Tipo_Conta: 'Cartão Alimentação' },
];

let sequence = 0;

/** Transação mínima válida; cada teste sobrescreve só o que importa para ele. */
export function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  sequence += 1;
  return {
    ID_Transacao: `tx-${sequence}`,
    ID_Conta: 'acc-cc',
    Data: new Date('2026-09-02T00:00:00Z'),
    Data_Pagamento: new Date('2026-09-02T00:00:00Z'),
    Descricao_Original: `DESCRICAO ORIGINAL ${sequence}`,
    Nome_Fantasia: `Descrição ${sequence}`,
    Valor: -10,
    Tipo: 'Despesa',
    Categoria: 'Mercado',
    Origem: 'manual',
    Fonte: 'Conta',
    ...overrides,
  };
}

/**
 * Conjunto com TOTAL CONHECIDO, calculado à mão:
 *
 *   -23,50  -412,37  +5432,10  -12,00  -10,00  -30,00  +800,00  -5,00  0,00  -1234,56
 *   = 4.504,67  →  450.467 centavos
 *
 * Cobre, de propósito: data de pagamento diferente da compra, portador, todas
 * as origens, parcela válida/legada/incompleta, marcador interno, acento,
 * aspas e vírgula, valor zero, transação sem conta.
 */
export const SYNTHETIC_TOTAL_CENTS = 450467;

export function syntheticSet(): Transaction[] {
  return [
    makeTx({ Nome_Fantasia: 'Padaria São João', Descricao_Original: 'PADARIA SAO JOAO LTDA', Valor: -23.5 }),
    makeTx({
      Nome_Fantasia: 'Geladeira',
      Descricao_Original: 'LOJA ELETRO 3/10',
      Valor: -412.37,
      Data: new Date('2026-08-15T00:00:00Z'),
      Data_Pagamento: new Date('2026-09-10T00:00:00Z'),
      ID_Conta: 'acc-card',
      Portador: 'TITULAR EXEMPLO',
      Parcela_Atual: 3,
      Total_Parcelas: 10,
      Origem: 'Fatura_Cartao_Fulano_Set_2026.csv',
      Categoria: 'Casa',
    }),
    makeTx({ Nome_Fantasia: 'Salário', Descricao_Original: 'CRED SALARIO', Valor: 5432.1, Tipo: 'Renda', Categoria: 'Salário' }),
    makeTx({ Nome_Fantasia: 'Café; bolo e "pão"', Descricao_Original: 'CAFE, BOLO E "PAO"', Valor: -12 }),
    makeTx({ Nome_Fantasia: 'Legado 0/0', Valor: -10, Parcela_Atual: 0, Total_Parcelas: 0 }),
    makeTx({ Nome_Fantasia: 'Par incompleto', Valor: -30, Parcela_Atual: 3, ID_Conta: 'acc-card' }),
    makeTx({
      Nome_Fantasia: 'Pagamento de Fatura',
      Descricao_Original: 'Pagamento de Fatura (2026-08) finelo_competence:2026-08',
      Valor: 800,
      Tipo: 'Renda',
      Categoria: 'Pagamento Cartão de Crédito',
      ID_Conta: 'acc-card',
    }),
    makeTx({ Nome_Fantasia: 'Sem conta', Valor: -5, ID_Conta: undefined, Origem: 'Open Finance' }),
    makeTx({ Nome_Fantasia: 'Valor zero', Valor: 0, Categoria: '-' }),
    makeTx({ Nome_Fantasia: 'Aluguel', Valor: -1234.56, Origem: 'Nubank', Data_Pagamento: undefined }),
  ];
}
