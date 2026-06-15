export type FamilyMemberNicknames = Record<string, string>;

export const FAMILY_MEMBER_NICKNAMES_METADATA_KEY = 'family_member_nicknames';

export function normalizeFamilyMemberEmail(email?: string | null): string {
  return (email || '').trim().toLowerCase();
}

export function parseFamilyMemberNicknames(metadata: unknown): FamilyMemberNicknames {
  if (!metadata || typeof metadata !== 'object') return {};
  const raw = (metadata as Record<string, unknown>)[FAMILY_MEMBER_NICKNAMES_METADATA_KEY];
  if (!raw || typeof raw !== 'object') return {};

  const parsed: FamilyMemberNicknames = {};
  for (const [email, nickname] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof nickname !== 'string') continue;
    const normalizedEmail = normalizeFamilyMemberEmail(email);
    const trimmed = nickname.trim();
    if (!normalizedEmail || !trimmed) continue;
    parsed[normalizedEmail] = trimmed;
  }
  return parsed;
}

export function resolveFamilyMemberNickname(
  email: string,
  nicknames?: FamilyMemberNicknames
): string | undefined {
  const nickname = nicknames?.[normalizeFamilyMemberEmail(email)]?.trim();
  return nickname || undefined;
}

export function setFamilyMemberNickname(
  nicknames: FamilyMemberNicknames,
  email: string,
  nickname: string
): FamilyMemberNicknames {
  const key = normalizeFamilyMemberEmail(email);
  const trimmed = nickname.trim();
  const next = { ...nicknames };
  if (!key) return next;
  if (!trimmed) {
    delete next[key];
  } else {
    next[key] = trimmed;
  }
  return next;
}

export function getOtherFamilyMemberEmail(params: {
  member: { owner_id: string; owner_email: string; member_email: string };
  currentUserId?: string | null;
  currentUserEmail?: string | null;
}): string | null {
  const { member, currentUserId, currentUserEmail } = params;
  const me = normalizeFamilyMemberEmail(currentUserEmail);
  if (!me) return null;

  if (normalizeFamilyMemberEmail(member.member_email) === me) {
    return normalizeFamilyMemberEmail(member.owner_email) || null;
  }

  if (currentUserId && member.owner_id === currentUserId) {
    return normalizeFamilyMemberEmail(member.member_email) || null;
  }

  return null;
}
