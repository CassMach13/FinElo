import type { FamilyMember } from '../types';
import { acceptedFamilyLinks, resolveOwnerDisplayLabel } from '../utils/familyOwnerContext';
import { getOtherFamilyMemberEmail, normalizeFamilyMemberEmail, type FamilyMemberNicknames } from '../utils/familyMemberNicknames';
import type { InvestmentOwnerOption } from '../domain/investments/ownerScope';

export interface OwnerDiscoveryDeps {
  listFamilyLinks(): Promise<FamilyMember[]>;
  /** Investimentos permite consultar um titular direto do vínculo aceito mesmo sem posições: estado vazio. */
  allowEmptyLinkedOwners?: boolean;
  /** Um user_id visível pela RLS fora da lista excluding, ou null. */
  findVisibleInvestmentOwner(excluding: string[]): Promise<string | null>;
}

export interface OwnerDiscoveryResult {
  options: InvestmentOwnerOption[];
  linkedFamilyCount: number;
  unavailableFamilyCount: number;
  unresolvedFamilyCount: number;
  status: 'loading' | 'ready' | 'error';
}

export const selfOwnerDiscovery = (userId: string, status: OwnerDiscoveryResult['status']): OwnerDiscoveryResult => ({
  options: [{ userId, label: 'Você', isSelf: true }],
  linkedFamilyCount: 0,
  unavailableFamilyCount: 0,
  unresolvedFamilyCount: 0,
  status,
});

/**
 * Vínculo aceito e proprietário financeiro são fatos distintos. Contamos familiares pelo contrato familiar,
 * sem exigir dados. As opções exigem identidade não ambígua no vínculo e respeitam a RLS. Investimentos também permite o estado vazio de um titular direto autorizado.
 * Nunca associamos vários IDs a e-mails pela ordem em que as consultas os devolvem.
 */
export async function discoverOwnerContext(
  deps: OwnerDiscoveryDeps,
  session: { userId: string; email: string },
  nicknames?: FamilyMemberNicknames,
  knownOwners: ReadonlyArray<{ userId: string; label: string }> = []
): Promise<OwnerDiscoveryResult> {
  const result = selfOwnerDiscovery(session.userId, 'ready');
  if (!session.userId || !session.email.trim()) return result;
  const familyMembers = await deps.listFamilyLinks();
  const links = acceptedFamilyLinks(familyMembers, session.userId, session.email);
  const me = normalizeFamilyMemberEmail(session.email);
  const peers = new Map<string, { email: string; ids: Set<string> }>();
  for (const link of links) {
    const email = getOtherFamilyMemberEmail({ member: link, currentUserId: session.userId, currentUserEmail: session.email }) ?? '';
    if (email === me) continue;
    const peerKey = email || `unresolved:${link.owner_id === session.userId ? link.id : link.owner_id}`;
    const peer = peers.get(peerKey) ?? { email, ids: new Set<string>() };
    if (link.owner_id !== session.userId && normalizeFamilyMemberEmail(link.member_email) === me) {
      peer.ids.add(link.owner_id);
    }
    peers.set(peerKey, peer); // convite e recíproco contam a mesma pessoa uma única vez
  }
  result.linkedFamilyCount = peers.size;
  if (peers.size === 0) return result;

  const linkedIds = new Set([...peers.values()].flatMap((peer) => [...peer.ids]));
  const visibleIds = new Set(knownOwners.map((o) => o.userId).filter((id) => id && id !== session.userId && linkedIds.has(id)));
  // Limite pelo número de familiares, sem varrer o banco. Cada retorno é uma leitura sob a RLS da sessão.
  for (let i = 0; i < peers.size; i += 1) {
    const found = await deps.findVisibleInvestmentOwner([session.userId, ...visibleIds]);
    if (!found || found === session.userId || visibleIds.has(found)) break;
    visibleIds.add(found);
  }

  const idCounts = new Map<string, number>();
  for (const peer of peers.values()) for (const id of peer.ids) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  const identities = new Map<string, string>();
  for (const peer of peers.values()) {
    const [id] = [...peer.ids];
    if (peer.email && peer.ids.size === 1 && idCounts.get(id) === 1) identities.set(peer.email, id);
  }
  const unidentifiedPeers = [...peers.values()].filter((peer) => peer.email && peer.ids.size === 0);
  const unidentifiedIds = [...visibleIds].filter((id) => !idCounts.has(id));
  // Convite só com e-mail: inferência única, sob o contrato accepted + RLS. Duas possibilidades nunca são pareadas.
  if (unidentifiedPeers.length === 1 && unidentifiedIds.length === 1) {
    identities.set(unidentifiedPeers[0].email, unidentifiedIds[0]);
  }

  const others: InvestmentOwnerOption[] = [];
  let availableFamilyCount = 0;
  for (const peer of peers.values()) {
    const id = identities.get(peer.email);
    if (id && visibleIds.has(id)) availableFamilyCount += 1;
    if (id && (visibleIds.has(id) || (deps.allowEmptyLinkedOwners && peer.ids.has(id)))) {
      others.push({ userId: id, label: resolveOwnerDisplayLabel(peer.email, false, nicknames), isSelf: false });
    }
  }
  others.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  result.options.push(...others);
  result.unavailableFamilyCount = peers.size - availableFamilyCount;
  result.unresolvedFamilyCount = peers.size - identities.size;
  return result;
}

/** Compatibilidade para consumidores que só precisam das opções. */
export async function discoverInvestmentOwners(
  deps: OwnerDiscoveryDeps,
  session: { userId: string; email: string },
  nicknames?: FamilyMemberNicknames
): Promise<InvestmentOwnerOption[]> {
  return (await discoverOwnerContext(deps, session, nicknames)).options;
}

/** Falha fecha as opções; cleanup invalida inclusive A → logout → A e componentes desmontados. */
export function createOwnerOptionsLoader(
  deps: OwnerDiscoveryDeps,
  onOptions: (sessionUserId: string, options: InvestmentOwnerOption[], context: OwnerDiscoveryResult) => void
) {
  let latest = 0;
  const load = async (
    session: { userId: string; email: string },
    nicknames?: FamilyMemberNicknames,
    knownOwners?: ReadonlyArray<{ userId: string; label: string }>
  ) => {
    const request = ++latest;
    let context: OwnerDiscoveryResult;
    try {
      context = await discoverOwnerContext(deps, session, nicknames, knownOwners);
    } catch (error) {
      console.warn('[OwnerScope] Falha ao verificar familiares:', error);
      context = selfOwnerDiscovery(session.userId, 'error');
    }
    if (request === latest) onOptions(session.userId, context.options, context);
  };
  load.invalidate = () => { latest += 1; };
  return load;
}
