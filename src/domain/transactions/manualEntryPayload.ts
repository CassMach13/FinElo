import type { Transaction } from '../../types.ts';
import { parseDirectedCompetenceFromPayment } from '../../services/creditCardDirectedPayment.ts';

/**
 * O que um lançamento manual NOVO leva para o banco, a partir do que o modal entrega.
 *
 * Existia em dobro (TransactionsView e DashboardView), cada cópia com o mesmo mapeamento
 * inline. Aqui é um lugar só, e testável sem montar componente.
 */
export type ManualEntryInput = Omit<Transaction, 'ID_Transacao' | 'Origem'>;

/**
 * A descrição original gravada é o nome digitado, como sempre foi, com UMA exceção: quando o
 * modal mandou a competência escolhida pelo usuário (`finelo_competence:AAAA-MM`, montado por
 * `buildDirectedRefundDescription`/`buildDirectedPurchaseDescription`).
 *
 * Sem essa exceção o marcador sumia na gravação e a fatura voltava a ser deduzida pela data: um
 * estorno de 02/10 destinado à fatura 09/2026 caía em 10/2026. O marcador é a escolha do
 * usuário; a dedução pela data é só o plano B para quando ela não existe.
 */
function persistedDescricaoOriginal(t: ManualEntryInput): string {
  const explicit = parseDirectedCompetenceFromPayment({ Descricao_Original: t.Descricao_Original } as Transaction);
  return explicit ? t.Descricao_Original : t.Nome_Fantasia;
}

export function buildManualEntryPayload(t: ManualEntryInput) {
  return {
    Data: t.Data,
    ID_Conta: t.ID_Conta,
    Data_Pagamento: t.Data_Pagamento,
    Nome_Fantasia: t.Nome_Fantasia,
    Categoria: t.Categoria,
    Tipo: t.Tipo,
    Valor: t.Valor,
    Parcela_Atual: t.Parcela_Atual,
    Total_Parcelas: t.Total_Parcelas,
    Fonte: t.Fonte,
    Origem: 'manual' as const,
    Descricao_Original: persistedDescricaoOriginal(t),
  };
}
