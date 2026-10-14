/**
 * Proprietário consultado na tela de Investimentos (V2-B1B, D3). Função pura.
 *
 * A tela mostra SEMPRE um único proprietário: nunca soma posições de donos diferentes, então nenhum investimento é
 * consolidado duas vezes. Sem seleção válida (ou com a flag desligada), o proprietário é a própria sessão — o
 * comportamento da V2-A. A RLS continua sendo quem autoriza; a lista de opções só evita oferecer donos sem vínculo.
 */

export interface InvestmentOwnerOption {
  userId: string;
  label: string;
  isSelf: boolean;
}

export function resolveViewOwner(
  sessionUserId: string | null | undefined,
  selectedOwnerId: string | null | undefined,
  options: readonly InvestmentOwnerOption[]
): string | null {
  if (!sessionUserId) return null;
  if (selectedOwnerId && selectedOwnerId !== sessionUserId && options.some((o) => o.userId === selectedOwnerId && !o.isSelf)) {
    return selectedOwnerId;
  }
  return sessionUserId;
}

/** Chave de escopo de uma busca: sessão + proprietário. Troca de qualquer um invalida respostas em voo. */
export const viewScopeKey = (sessionUserId: string, ownerUserId: string): string => `${sessionUserId}|${ownerUserId}`;

export function ownerLabelFor(ownerUserId: string | null | undefined, sessionUserId: string | null | undefined, options: readonly InvestmentOwnerOption[]): string {
  if (!ownerUserId || ownerUserId === sessionUserId) return 'Você';
  return options.find((o) => o.userId === ownerUserId)?.label ?? 'Familiar';
}
