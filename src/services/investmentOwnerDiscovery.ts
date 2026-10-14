import type { FamilyMember } from '../types';
import { acceptedFamilyLinks, mapUserIdsToEmails, resolveOwnerDisplayLabel } from '../utils/familyOwnerContext';
import type { FamilyMemberNicknames } from '../utils/familyMemberNicknames';
import type { InvestmentOwnerOption } from '../domain/investments/ownerScope';

/**
 * Proprietários que a sessão pode consultar na tela de Investimentos (V2-B1B, D3). Não depende de contas nem de
 * transações: um familiar que só tem investimentos também aparece.
 *
 * Usa o MESMO contrato de `has_family_access` (vínculo `accepted`, bidirecional) e deixa a RLS decidir:
 *  - quem me convidou e foi aceito: o `owner_id` do vínculo é o proprietário (vem direto de `family_members`);
 *  - quem eu convidei: o vínculo só tem o e-mail, então o id vem das posições que a RLS me deixa ler.
 * Sem nenhum vínculo aceito, nada é consultado além de `family_members` e a única opção é a própria sessão.
 * Vínculo recusado, pendente ou revogado não gera opção: a RLS esconde as posições e o vínculo não é `accepted`.
 */
export interface OwnerDiscoveryDeps {
  listFamilyLinks(): Promise<FamilyMember[]>;
  /** Um `user_id` de posição visível pela RLS fora da lista `excluding`, ou null. */
  findVisibleInvestmentOwner(excluding: string[]): Promise<string | null>;
}

export async function discoverInvestmentOwners(
  deps: OwnerDiscoveryDeps,
  session: { userId: string; email: string },
  nicknames?: FamilyMemberNicknames
): Promise<InvestmentOwnerOption[]> {
  const self: InvestmentOwnerOption = { userId: session.userId, label: 'Você', isSelf: true };
  const familyMembers = await deps.listFamilyLinks();
  const links = acceptedFamilyLinks(familyMembers, session.userId, session.email);
  if (links.length === 0) return [self];

  const ids: string[] = [];
  for (const link of links) {
    if (link.owner_id !== session.userId && !ids.includes(link.owner_id)) ids.push(link.owner_id);
  }
  // Cada proprietário autorizado corresponde a um vínculo aceito: no máximo uma busca por vínculo, mais uma que
  // confirma que não há outro.
  for (let i = 0; i < links.length; i += 1) {
    const found = await deps.findVisibleInvestmentOwner([session.userId, ...ids]);
    if (!found) break;
    ids.push(found);
  }

  const emails = mapUserIdsToEmails([session.userId, ...ids], session.userId, session.email, familyMembers);
  const others = ids
    .map((userId, index) => {
      const email = emails.get(userId) ?? `membro-${index + 1}`;
      return { userId, label: resolveOwnerDisplayLabel(email, false, nicknames), isSelf: false };
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  return [self, ...others];
}
