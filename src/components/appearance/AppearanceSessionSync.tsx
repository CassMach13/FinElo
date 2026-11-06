import { useEffect } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import { supabase } from '../../supabaseClient';
import { isAppearancePilotEnabled } from '../../domain/appearance/theme';
import { APPEARANCE_CHANGED, APPEARANCE_CHANNEL } from '../../domain/appearance/session';

/** Appearance-only synchronization. Never hydrates financial data. */
export default function AppearanceSessionSync() {
  const user = useAppStore(state => state.user);
  const enabled = isAppearancePilotEnabled(user);
  const id = user?.id;
  useEffect(() => {
    if (!enabled || !id) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reconcile = () => {
      clearTimeout(timer);
      // Auth callbacks execute under the SDK lock. Do not call Auth synchronously in them.
      timer = setTimeout(() => {
        if (active) void useAppStore.getState().syncAppearancePreferences();
      }, 0);
    };
    const refresh = () => {
      reconcile();
      // Omit the session argument: never restore the captured account after logout/switch.
      void supabase.auth.refreshSession().catch(() => undefined);
    };
    const visible = () => { if (document.visibilityState === 'visible') reconcile(); };
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (['TOKEN_REFRESHED', 'USER_UPDATED', 'SIGNED_IN'].includes(event)) reconcile();
    });
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(APPEARANCE_CHANNEL);
      channel.onmessage = reconcile;
    } catch { /* Optional multi-tab optimization. */ }
    window.addEventListener(APPEARANCE_CHANGED, refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', reconcile);
    document.addEventListener('visibilitychange', visible);
    reconcile();
    return () => {
      active = false;
      clearTimeout(timer);
      subscription.unsubscribe();
      channel?.close();
      window.removeEventListener(APPEARANCE_CHANGED, refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', reconcile);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [enabled, id]);
  return null;
}
