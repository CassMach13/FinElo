import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import {
  isAtomicImportEnabled,
  resolveAtomicImportEnabled,
} from '../src/services/featureFlagService';

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

  it('não habilita por e-mail quando os metadados e a flag global estão desligados', () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'false');

    expect(isAtomicImportEnabled(user({ email: 'CASSIOMQ@GMAIL.COM' }))).toBe(false);
    expect(isAtomicImportEnabled(user({ email: 'outro@finelo.invalid' }))).toBe(false);
  });

  it('permite rollback administrativo explícito mesmo na conta piloto', () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'true');

    expect(isAtomicImportEnabled(user({
      email: 'cassiomq@gmail.com',
      app_metadata: { atomic_imports_enabled: false },
    }))).toBe(false);
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

describe('resolveAtomicImportEnabled', () => {
  it('lê o opt-in atual diretamente do servidor mesmo com JWT sem a flag', async () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'false');
    const readServerFlag = vi.fn().mockResolvedValue({ data: 'enabled', error: null });

    await expect(resolveAtomicImportEnabled(user(), readServerFlag)).resolves.toBe(true);
    expect(readServerFlag).toHaveBeenCalledOnce();
  });

  it('aceita o rollback atual do servidor mesmo quando o JWT ainda contém opt-in antigo', async () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'false');
    const readServerFlag = vi.fn().mockResolvedValue({ data: 'disabled', error: null });

    await expect(resolveAtomicImportEnabled(user({
      app_metadata: { atomic_imports_enabled: true },
    }), readServerFlag)).resolves.toBe(false);
  });

  it('mantém desligado quando a consulta de servidor falha', async () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'false');

    await expect(resolveAtomicImportEnabled(user(), async () => ({
      data: null,
      error: { message: 'função indisponível' },
    }))).resolves.toBe(false);

    await expect(resolveAtomicImportEnabled(user(), async () => {
      throw new Error('rede indisponível');
    })).resolves.toBe(false);
  });

  it('aceita ativação atual do servidor mesmo quando o JWT ainda contém rollback antigo', async () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'false');
    const readServerFlag = vi.fn().mockResolvedValue({ data: 'enabled', error: null });

    await expect(resolveAtomicImportEnabled(user({
      app_metadata: { atomic_imports_enabled: false },
    }), readServerFlag)).resolves.toBe(true);
    expect(readServerFlag).toHaveBeenCalledOnce();
  });

  it('preserva a ativação global de staging quando não há opt-out', async () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'true');
    const readServerFlag = vi.fn().mockResolvedValue({ data: 'unset', error: null });

    await expect(resolveAtomicImportEnabled(user(), readServerFlag)).resolves.toBe(true);
    expect(readServerFlag).toHaveBeenCalledOnce();
  });

  it('faz o opt-out administrativo do servidor prevalecer sobre a ativação global', async () => {
    vi.stubEnv('VITE_ATOMIC_IMPORTS_ENABLED', 'true');

    await expect(resolveAtomicImportEnabled(user(), async () => ({
      data: 'disabled',
      error: null,
    }))).resolves.toBe(false);
  });
});
