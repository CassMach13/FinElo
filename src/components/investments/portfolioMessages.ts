import { InvestmentStructureError } from '../../services/investmentStructureService';

/** Textos da V2-B1B que dependem de dados (testados em separado da apresentação). */

export const positionsLabel = (n: number): string => (n === 1 ? '1 posição' : `${n} posições`);

export function archiveConfirmation(name: string, positionsThisMonth: number, monthLabel: string): string {
  const lines = [`A carteira "${name}" deixará de receber novas classificações e poderá ser desarquivada quando quiser.`];
  if (positionsThisMonth > 0) {
    lines.push(
      `${positionsLabel(positionsThisMonth)} de ${monthLabel} ${positionsThisMonth === 1 ? 'continua' : 'continuam'} nela, assim como as dos outros meses: nenhuma classificação, saldo ou total é alterado.`
    );
  } else {
    lines.push('As classificações de outros meses, se houver, são preservadas.');
  }
  return lines.join('\n\n');
}

export function unclassifyConfirmation(productLabel: string, portfolioName: string): string {
  return `"${productLabel}" sairá da carteira "${portfolioName}" e voltará para Sem carteira. O saldo não muda e o registro de quem fez a alteração é mantido.`;
}

/** Mensagem segura para o usuário: códigos conhecidos têm texto próprio; o resto nunca vaza detalhes do banco. */
export function structureErrorMessage(error: unknown): string {
  if (error instanceof InvestmentStructureError) return error.message;
  return 'Não foi possível concluir a operação agora. Tente novamente.';
}

/** Resumo da D1 depois de "Copiar do mês anterior"; nulo quando nenhuma posição de origem tinha carteira. */
export function copyClassificationNotice(result: { copied: number; classified: number; leftUnclassified: number }): string | null {
  if (result.classified === 0 && result.leftUnclassified === 0) return null;
  const parts = [`${positionsLabel(result.copied)} ${result.copied === 1 ? 'copiada' : 'copiadas'} do mês anterior.`];
  if (result.classified > 0) parts.push(`${result.classified} ${result.classified === 1 ? 'manteve a carteira' : 'mantiveram a carteira'}.`);
  if (result.leftUnclassified > 0) {
    parts.push(`${result.leftUnclassified} ${result.leftUnclassified === 1 ? 'ficou' : 'ficaram'} em Sem carteira (carteira arquivada ou indisponível).`);
  }
  return parts.join(' ');
}
