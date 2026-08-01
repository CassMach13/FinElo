import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { isAtomicImportEnabled } from '../src/services/featureFlagService';

const user = (overrides: Partial<User> = {}): User => ({
  id: '00000000-0000-4000-8000-000000000001',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isAtomicImportEnabled', () => {
  it('permanece desligada por padrão', () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'false');
    expect(isAtomicImportEnabled(user())).toBe(false);
    expect(isAtomicImportEnabled(null)).toBe(false);
  });

  it('habilita somente a conta piloto por app_metadata com a flag global desligada', () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'false');
    expect(isAtomicImportEnabled(user({
      app_metadata: { atomic_imports_enabled: true },
    }))).toBe(true);
  });

  it('não aceita opt-in vindo de user_metadata', () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'false');
    expect(isAtomicImportEnabled(user({
      user_metadata: { atomic_imports_enabled: true },
    }))).toBe(false);
  });

  it('permite ativação global quando não existe opt-out', () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'true');
    expect(isAtomicImportEnabled(user())).toBe(true);
  });

  it('opt-out administrativo prevalece sobre piloto e ativação global', () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'true');
    expect(isAtomicImportEnabled(user({
      app_metadata: {
        atomic_imports_enabled: true,
        atomic_imports_disabled: true,
      },
    }))).toBe(false);
  });

  it('mantém o opt-out legado do usuário como desligamento de emergência', () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'true');
    expect(isAtomicImportEnabled(user({
      user_metadata: { atomic_imports_disabled: true },
    }))).toBe(false);
  });
});
