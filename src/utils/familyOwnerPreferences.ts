export const FAMILY_OWNER_COLUMN_VISIBLE_KEY = 'finelo_family_owner_column_visible';
export const FAMILY_GROUP_BY_OWNER_KEY = 'finelo_family_group_by_owner';

export function loadFamilyOwnerColumnVisible(): boolean {
  try {
    const saved = localStorage.getItem(FAMILY_OWNER_COLUMN_VISIBLE_KEY);
    if (saved === 'false') return false;
    if (saved === 'true') return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function saveFamilyOwnerColumnVisible(visible: boolean): void {
  try {
    localStorage.setItem(FAMILY_OWNER_COLUMN_VISIBLE_KEY, visible ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

export function loadFamilyGroupByOwner(): boolean {
  try {
    const saved = localStorage.getItem(FAMILY_GROUP_BY_OWNER_KEY);
    if (saved === 'false') return false;
    if (saved === 'true') return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function saveFamilyGroupByOwner(enabled: boolean): void {
  try {
    localStorage.setItem(FAMILY_GROUP_BY_OWNER_KEY, enabled ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}
