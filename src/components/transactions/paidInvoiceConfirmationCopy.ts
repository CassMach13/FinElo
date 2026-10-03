import { formatCurrency } from '../../utils/formatters';

/** Copy only: the caller still confirms and persists the entire open balance. */
export function paidInvoiceConfirmationDialog(amount: number, competenceBR: string) {
  const value = formatCurrency(amount);
  return {
    title: 'Confirmar como pago',
    confirmText: `Confirmar ${value}`,
    message: [
      `Você está confirmando que o saldo em aberto inteiro de ${value} da fatura ${competenceBR} já foi pago fora do FinElo.`,
      'O saldo em aberto ficará R$ 0,00 e o limite do cartão poderá ser liberado.',
      'Isso não cria um lançamento e não movimenta nenhuma conta bancária. Confirme somente se esse valor já foi efetivamente quitado.',
      'Você pode usar Desfazer no Histórico. Para registrar de qual conta saiu o dinheiro, use Pagar.',
    ].join('\n\n'),
  };
}

export function undoPaidInvoiceConfirmationDialog(amount: number, competenceBR: string) {
  return {
    title: 'Desfazer confirmação',
    confirmText: 'Desfazer',
    message: [
      `A confirmação de ${formatCurrency(amount)} da fatura ${competenceBR} será removida. O saldo em aberto e o limite do cartão voltarão a ser calculados sem essa confirmação.`,
      'Isso não estorna um pagamento no banco nem cria ou remove lançamentos.',
    ].join('\n\n'),
  };
}
