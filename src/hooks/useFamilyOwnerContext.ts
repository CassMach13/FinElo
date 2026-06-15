import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import type { Account, FamilyMember, Transaction } from '../types';
import type { FamilyMemberNicknames } from '../utils/familyMemberNicknames';
import { buildFamilyOwnerContext, type FamilyOwnerContext } from '../utils/familyOwnerContext';

export function useFamilyOwnerContext(
  currentUserId?: string | null,
  currentUserEmail?: string | null,
  accounts: Account[] = [],
  transactions: Transaction[] = [],
  memberNicknames?: FamilyMemberNicknames
): FamilyOwnerContext {
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);

  useEffect(() => {
    if (!currentUserId) {
      setFamilyMembers([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      const { data, error } = await supabase.from('family_members').select('*');
      if (cancelled) return;
      if (error) {
        console.warn('[FamilyOwner] Falha ao carregar vínculos familiares:', error.message);
        setFamilyMembers([]);
        return;
      }
      setFamilyMembers((data as FamilyMember[]) || []);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  return useMemo(
    () =>
      buildFamilyOwnerContext({
        currentUserId,
        currentUserEmail,
        familyMembers,
        accounts,
        transactions,
        memberNicknames,
      }),
    [currentUserId, currentUserEmail, familyMembers, accounts, transactions, memberNicknames]
  );
}
