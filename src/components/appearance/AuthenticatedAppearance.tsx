import './appearance.css';
import { useSyncExternalStore, type ReactNode } from 'react';
import { useMatch } from 'react-router-dom';
import {
  APPEARANCE_THEME_KEY,
  SYSTEM_DARK_QUERY,
  isAppearancePilotEnabled,
  resolveAppearanceTheme,
} from '../../domain/appearance/theme';
import { useAppStore } from '../../hooks/useAppStore';

function subscribeToSystemTheme(onChange: () => void) {
  const media = window.matchMedia?.(SYSTEM_DARK_QUERY);
  media?.addEventListener?.('change', onChange);
  return () => media?.removeEventListener?.('change', onChange);
}

const readSystemTheme = () => window.matchMedia?.(SYSTEM_DARK_QUERY).matches ?? true;
const subscribeToNothing = () => () => {};
const darkSnapshot = () => true;

export default function AuthenticatedAppearance({ children }: { children: ReactNode }) {
  const inApp = useMatch('/app') !== null;
  const preference = useAppStore(({ user }) =>
    inApp && user && isAppearancePilotEnabled(user)
      ? user.user_metadata[APPEARANCE_THEME_KEY]
      : undefined
  );
  const automatic = preference === 'system';
  const systemDark = useSyncExternalStore(
    automatic ? subscribeToSystemTheme : subscribeToNothing,
    automatic ? readSystemTheme : darkSnapshot,
    darkSnapshot
  );

  return (
    <div className="contents" data-finelo-theme={inApp ? resolveAppearanceTheme(preference, systemDark) : undefined}>
      {children}
    </div>
  );
}
