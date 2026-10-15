import { useEffect, useMemo, useState } from 'react';
import { createOwnerOptionsLoader, selfOwnerDiscovery, type OwnerDiscoveryDeps, type OwnerDiscoveryResult } from '../services/investmentOwnerDiscovery';
import { parseFamilyMemberNicknames } from '../utils/familyMemberNicknames';

const NO_KNOWN_OWNERS: ReadonlyArray<{ userId: string; label: string }> = [];

/** Estado de apresentação isolado por sessão e entrada; sem qualquer escrita remota. */
export function useOwnerDiscovery(
  user: { id: string; email?: string; user_metadata?: unknown } | null,
  deps: OwnerDiscoveryDeps,
  knownOwners = NO_KNOWN_OWNERS
): OwnerDiscoveryResult {
  const requestKey = JSON.stringify([user?.id, user?.email, parseFamilyMemberNicknames(user?.user_metadata), knownOwners]);
  const [state, setState] = useState<{ requestKey: string; context: OwnerDiscoveryResult } | null>(null);
  useEffect(() => {
    setState(null); // uma sessão intermediária também descarta o snapshot de A antes de A relogar
    if (!user?.id) return;
    const load = createOwnerOptionsLoader(deps, (_id, _options, context) => setState({ requestKey, context }));
    void load({ userId: user.id, email: user.email ?? '' }, parseFamilyMemberNicknames(user.user_metadata), knownOwners);
    return () => load.invalidate();
  }, [requestKey, deps]);

  return useMemo(
    () => state?.requestKey === requestKey ? state.context : selfOwnerDiscovery(user?.id ?? '', 'loading'),
    [state, requestKey, user?.id]
  );
}
