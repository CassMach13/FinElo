import { describe, expect, it } from 'vitest';
import { encontrarCandidatosDeParcelaIrma } from '../../src/domain/installments/installmentSuggestions';
import type { Transaction } from '../../src/types';

const compra = new Date(2026, 0, 5, 12);
const conta = 'xp';
const anterior: Transaction = {
  ID_Transacao: 'anterior', ID_Conta: conta, import_log_id: 'lote',
  Data: compra, Valor: -100, Parcela_Atual: 1, Total_Parcelas: 3,
  Nome_Fantasia: 'Compra', Categoria: 'Casa', Descricao_Original: 'LOJA',
  Tipo: 'Despesa', Fonte: 'XP', Origem: 'primeira.csv',
};
const nova = { Data: compra, Valor: -100, Parcela_Atual: 2, Total_Parcelas: 3, Descricao_Original: 'LOJA' };
const xp = { contaEhCartao: true, repeteDataDeCompra: true };

describe('ordem das faturas XP com a data de compra repetida', () => {
  it('rejeita um vencimento futuro mesmo sem metadados do lote histórico', () => {
    const recebida = { ...nova, Data_Pagamento: new Date(2026, 2, 10, 12) };
    const futura = { ...anterior, Data_Pagamento: new Date(2026, 3, 10, 12) };
    const passada = { ...anterior, Data_Pagamento: new Date(2026, 1, 10, 12) };
    expect(encontrarCandidatosDeParcelaIrma(recebida, conta, [futura], xp)).toEqual([]);
    expect(encontrarCandidatosDeParcelaIrma(recebida, conta, [passada], xp)).toHaveLength(1);
  });

  it('sem ciclo nem vencimento, a data de compra igual não prova anterioridade', () => {
    expect(encontrarCandidatosDeParcelaIrma(nova, conta, [anterior], xp)).toEqual([]);
  });

  it('compara referências quando somente um lote tem vencimento', () => {
    const cicloDaFatura = { referenceLabel: '2026-02' };
    const ciclosPorLote = new Map([['lote', { referenceLabel: '2026-01', dueDate: '2026-02-10' }]]);
    expect(encontrarCandidatosDeParcelaIrma(nova, conta, [anterior], {
      ...xp, cicloDaFatura, ciclosPorLote,
    })).toHaveLength(1);
  });

  it('não compara a referência de um lote com o vencimento do outro', () => {
    const cicloDaFatura = { dueDate: '2026-03-10' };
    const ciclosPorLote = new Map([['lote', { referenceLabel: '2026-02' }]]);
    expect(encontrarCandidatosDeParcelaIrma(nova, conta, [anterior], {
      ...xp, cicloDaFatura, ciclosPorLote,
    })).toEqual([]);
  });

  it('prioriza vencimentos quando há dois, mesmo com referência preenchida', () => {
    const cicloDaFatura = { referenceLabel: '2026-02', dueDate: '2026-03-10' };
    const ciclosPorLote = new Map([['lote', { referenceLabel: '2026-01', dueDate: '2026-04-10' }]]);
    expect(encontrarCandidatosDeParcelaIrma(nova, conta, [anterior], {
      ...xp, cicloDaFatura, ciclosPorLote,
    })).toEqual([]);
  });
});
