export const APPEARANCE_THEME_KEY = 'appearance_theme';
export const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

export type AppearanceTheme = 'dark' | 'light' | 'system';

export function isAppearanceTheme(value: unknown): value is AppearanceTheme {
  return value === 'dark' || value === 'light' || value === 'system';
}

export function resolveAppearanceTheme(value: unknown, systemDark: boolean): 'dark' | 'light' {
  return value === 'light' || (value === 'system' && !systemDark) ? 'light' : 'dark';
}

export function isAppearancePilotEnabled(
  user: { id: string; app_metadata: Record<string, unknown> } | null,
  flag = import.meta.env.VITE_APPEARANCE_PILOT,
  mode = import.meta.env.MODE,
  releaseFlag = import.meta.env.VITE_APPEARANCE_RELEASE
): boolean {
  if (!user?.id) return false;
  // Production release and staging pilot are independent, build-time opt-ins.
  if (mode === 'production') return releaseFlag === 'true';
  return mode === 'staging' && flag === 'true' && user.app_metadata.appearance_pilot === true;
}
