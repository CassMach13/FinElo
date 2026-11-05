import { isAppearanceTheme, type AppearanceTheme } from './theme';

// Only a confirmed presentation preference is cached. No session/credentials or financial data.
const key = (id: string) => `finelo.appearance.v1.${id}`;
export const APPEARANCE_CHANGED = 'finelo-appearance-confirmed';
export const APPEARANCE_CHANNEL = 'finelo-appearance-v1';

export function readConfirmedAppearance(id: string): AppearanceTheme | undefined {
  try {
    const value = globalThis.localStorage?.getItem(key(id));
    return isAppearanceTheme(value) ? value : undefined;
  } catch { return undefined; }
}

export function cacheConfirmedAppearance(id: string, theme: AppearanceTheme) {
  try { globalThis.localStorage?.setItem(key(id), theme); } catch { /* Storage is optional. */ }
}

export function signalAppearanceChange(notifyCurrentWindow = true) {
  if (typeof window === 'undefined') return;
  if (notifyCurrentWindow) window.dispatchEvent(new Event(APPEARANCE_CHANGED));
  // A signal only: each tab validates its own account against Auth.
  try {
    const channel = new BroadcastChannel(APPEARANCE_CHANNEL);
    channel.postMessage('changed');
    channel.close();
  } catch { /* Focus/online/Auth events also reconcile when BroadcastChannel is unavailable. */ }
}
