import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAppearancePilotEnabled, resolveAppearanceTheme } from '../../src/domain/appearance/theme';
import { readFileSync } from 'node:fs';
import { functionalSourceHash } from './functionalSourceHash';

const authenticated = { id: 'release-user', app_metadata: {} };
const pilot = { ...authenticated, app_metadata: { appearance_pilot: true } };
afterEach(() => vi.unstubAllEnvs());

describe('production appearance release', () => {
  it('keeps the reviewed staging fingerprint while rejecting any unrelated gate change', () => {
    const file = 'src/domain/appearance/theme.ts';
    const source = readFileSync(file, 'utf8');
    const reviewed = 'c5649ebf42f00353ab9635723c0e586fad3fe82a578b0985dbf6e6059d856a52';
    expect(functionalSourceHash(file, source)).toBe(reviewed);
    expect(functionalSourceHash(file, source + '\n// unrelated')).not.toBe(reviewed);
  });
  it('admits authenticated users without pilot metadata only with the production release flag', () => {
    expect(isAppearancePilotEnabled(authenticated, '', 'production', 'true')).toBe(true);
    expect(isAppearancePilotEnabled(authenticated, 'false', 'production', 'true')).toBe(true);
    expect(isAppearancePilotEnabled(pilot, 'true', 'production', 'false')).toBe(false);
  });

  it.each(['', 'false', 'TRUE', '1'])('stays dark when the release flag is %s', releaseFlag => {
    expect(isAppearancePilotEnabled(authenticated, 'true', 'production', releaseFlag)).toBe(false);
  });

  it('fails closed when the release variable is absent', () => {
    vi.stubEnv('VITE_APPEARANCE_RELEASE', undefined);
    expect(isAppearancePilotEnabled(authenticated, 'true', 'production')).toBe(false);
  });

  it('does not grant access to unauthenticated users or other build modes', () => {
    expect(isAppearancePilotEnabled(null, 'true', 'production', 'true')).toBe(false);
    expect(isAppearancePilotEnabled({ ...authenticated, id: '' }, 'true', 'production', 'true')).toBe(false);
    for (const mode of ['development', 'test', 'preview']) {
      expect(isAppearancePilotEnabled(pilot, 'true', mode, 'true')).toBe(false);
    }
  });

  it('preserves both staging pilot requirements independently of the release flag', () => {
    expect(isAppearancePilotEnabled(authenticated, 'true', 'staging', 'true')).toBe(false);
    expect(isAppearancePilotEnabled(pilot, 'false', 'staging', 'true')).toBe(false);
    expect(isAppearancePilotEnabled(pilot, 'true', 'staging', 'false')).toBe(true);
  });

  it.each([false, true])('defaults to dark before a choice, even when systemDark=%s', systemDark => {
    expect(resolveAppearanceTheme(undefined, systemDark)).toBe('dark');
    expect(resolveAppearanceTheme('dark', systemDark)).toBe('dark');
    expect(resolveAppearanceTheme('light', systemDark)).toBe('light');
    expect(resolveAppearanceTheme('system', systemDark)).toBe(systemDark ? 'dark' : 'light');
  });
});
