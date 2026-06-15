import type { Account, FamilyMember, Transaction } from '../types';
import { resolveFamilyMemberNickname, type FamilyMemberNicknames } from './familyMemberNicknames';

export type FamilyOwnerProfile = {
  userId: string;
  label: string;
  email: string;
  isSelf: boolean;
  chipClass: string;
  dotClass: string;
};

export type FamilyOwnerContext = {
  isActive: boolean;
  hasMultipleOwners: boolean;
  showAttribution: boolean;
  owners: FamilyOwnerProfile[];
  byUserId: Map<string, FamilyOwnerProfile>;
  getProfile: (userId?: string | null) => FamilyOwnerProfile | undefined;
  getTransactionOwnerId: (tx: Transaction) => string | undefined;
  getAccountOwnerId: (account: Account) => string | undefined;
};

const OWNER_COLOR_PALETTE = [
  { chip: 'bg-accent/15 text-accent border-accent/35', dot: 'bg-accent' },
  { chip: 'bg-violet-500/15 text-violet-300 border-violet-500/35', dot: 'bg-violet-400' },
  { chip: 'bg-amber-500/15 text-amber-300 border-amber-500/35', dot: 'bg-amber-400' },
  { chip: 'bg-sky-500/15 text-sky-300 border-sky-500/35', dot: 'bg-sky-400' },
  { chip: 'bg-rose-500/15 text-rose-300 border-rose-500/35', dot: 'bg-rose-400' },
] as const;

const normalizeEmail = (email?: string | null) => (email || '').trim().toLowerCase();

export function emailToDisplayLabel(email: string, isSelf = false): string {
  if (isSelf) return 'Você';
  const local = email.split('@')[0] || email;
  const cleaned = local.replace(/[._-]+/g, ' ').trim();
  if (!cleaned) return email;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function resolveOwnerDisplayLabel(
  email: string,
  isSelf: boolean,
  nicknames?: FamilyMemberNicknames
): string {
  if (isSelf) return 'Você';
  const nickname = resolveFamilyMemberNickname(email, nicknames);
  if (nickname) return nickname;
  return emailToDisplayLabel(email, false);
}

function acceptedFamilyLinks(
  familyMembers: FamilyMember[],
  currentUserId: string,
  currentEmail: string
): FamilyMember[] {
  const me = normalizeEmail(currentEmail);
  return familyMembers.filter(
    (m) =>
      m.status === 'accepted' &&
      (m.owner_id === currentUserId || normalizeEmail(m.member_email) === me)
  );
}

function mapUserIdsToEmails(
  userIds: string[],
  currentUserId: string,
  currentEmail: string,
  familyMembers: FamilyMember[]
): Map<string, string> {
  const map = new Map<string, string>();
  map.set(currentUserId, currentEmail);

  const links = acceptedFamilyLinks(familyMembers, currentUserId, currentEmail);
  const pendingIds = new Set(userIds.filter((id) => id !== currentUserId));

  for (const uid of [...pendingIds]) {
    const asOwner = familyMembers.find((m) => m.status === 'accepted' && m.owner_id === uid);
    if (asOwner?.owner_email) {
      map.set(uid, normalizeEmail(asOwner.owner_email));
      pendingIds.delete(uid);
    }
  }

  for (const uid of [...pendingIds]) {
    const invitedMe = links.find(
      (m) => m.owner_id === uid && normalizeEmail(m.member_email) === normalizeEmail(currentEmail)
    );
    if (invitedMe?.owner_email) {
      map.set(uid, normalizeEmail(invitedMe.owner_email));
      pendingIds.delete(uid);
    }
  }

  const invitedByMe = links.filter((m) => m.owner_id === currentUserId);
  if (invitedByMe.length === 1 && pendingIds.size === 1) {
    const [uid] = pendingIds;
    map.set(uid, normalizeEmail(invitedByMe[0].member_email));
    pendingIds.delete(uid);
  } else if (invitedByMe.length > 0 && pendingIds.size > 0) {
    const usedEmails = new Set([...map.values()]);
    for (const uid of pendingIds) {
      const candidate = invitedByMe.find(
        (m) => !usedEmails.has(normalizeEmail(m.member_email))
      );
      if (candidate) {
        const email = normalizeEmail(candidate.member_email);
        map.set(uid, email);
        usedEmails.add(email);
      }
    }
  }

  return map;
}

export function buildFamilyOwnerContext(params: {
  currentUserId?: string | null;
  currentUserEmail?: string | null;
  familyMembers: FamilyMember[];
  accounts: Account[];
  transactions: Transaction[];
  memberNicknames?: FamilyMemberNicknames;
}): FamilyOwnerContext {
  const {
    currentUserId,
    currentUserEmail,
    familyMembers,
    accounts,
    transactions,
    memberNicknames,
  } = params;

  const resolveTransactionOwnerId = (tx: Transaction) =>
    tx.user_id || accounts.find((a) => a.id === tx.ID_Conta)?.user_id;

  const empty: FamilyOwnerContext = {
    isActive: false,
    hasMultipleOwners: false,
    showAttribution: false,
    owners: [],
    byUserId: new Map(),
    getProfile: () => undefined,
    getTransactionOwnerId: resolveTransactionOwnerId,
    getAccountOwnerId: (account) => account.user_id,
  };

  if (!currentUserId || !currentUserEmail) return empty;

  const links = acceptedFamilyLinks(familyMembers, currentUserId, currentUserEmail);
  if (links.length === 0) return empty;

  const userIds = new Set<string>();
  userIds.add(currentUserId);
  transactions.forEach((tx) => {
    const id = tx.user_id || accounts.find((a) => a.id === tx.ID_Conta)?.user_id;
    if (id) userIds.add(id);
  });
  accounts.forEach((acc) => {
    if (acc.user_id) userIds.add(acc.user_id);
  });

  if (userIds.size <= 1) return empty;

  const emailByUserId = mapUserIdsToEmails(
    [...userIds],
    currentUserId,
    currentUserEmail,
    familyMembers
  );

  const sortedIds = [...userIds].sort((a, b) => {
    if (a === currentUserId) return -1;
    if (b === currentUserId) return 1;
    return a.localeCompare(b);
  });

  const owners: FamilyOwnerProfile[] = sortedIds.map((userId, index) => {
    const isSelf = userId === currentUserId;
    const email = emailByUserId.get(userId) || (isSelf ? currentUserEmail : `membro-${index + 1}`);
    const palette = OWNER_COLOR_PALETTE[Math.min(index, OWNER_COLOR_PALETTE.length - 1)];
    return {
      userId,
      email,
      label: resolveOwnerDisplayLabel(email, isSelf, memberNicknames),
      isSelf,
      chipClass: palette.chip,
      dotClass: palette.dot,
    };
  });

  const byUserId = new Map(owners.map((o) => [o.userId, o]));

  return {
    isActive: true,
    hasMultipleOwners: userIds.size > 1,
    showAttribution: userIds.size > 1,
    owners,
    byUserId,
    getProfile: (userId) => (userId ? byUserId.get(userId) : undefined),
    getTransactionOwnerId: resolveTransactionOwnerId,
    getAccountOwnerId: (account) => account.user_id,
  };
}
