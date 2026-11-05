import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { Account, Transaction } from '../../src/types';
import { isAppearancePilotEnabled, resolveAppearanceTheme } from '../../src/domain/appearance/theme';
import { computeAccountBalanceAsOf } from '../../src/utils/dashboardNetWorth';

const api = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
  persistAppearanceTheme: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../../src/supabaseClient', () => ({
  supabase: { auth: api, from: api.from, rpc: api.rpc },
  persistAppearanceTheme: api.persistAppearanceTheme,
}));

import { useAppStore } from '../../src/hooks/useAppStore';

function user(id: string, metadata: Record<string, unknown> = {}): User {
  return { id, user_metadata: metadata, app_metadata: { appearance_pilot: true } } as User;
}

function session(account: User) {
  return { data: { session: { user: account, access_token: 'token-' + account.id } }, error: null };
}

describe('resolução do tema e flag', () => {
  it.each([
    [undefined, false, 'dark'], ['invalid', false, 'dark'],
    ['dark', false, 'dark'], ['light', true, 'light'],
    ['system', true, 'dark'], ['system', false, 'light'],
  ])('resolve %s com preferência escura do sistema %s', (value, systemDark, expected) => {
    expect(resolveAppearanceTheme(value, systemDark)).toBe(expected);
  });

  it('exige build habilitado e inscrição administrativa', () => {
    expect(isAppearancePilotEnabled(user('a'), '', 'staging')).toBe(false);
    expect(isAppearancePilotEnabled(null, 'true', 'staging')).toBe(false);
    expect(isAppearancePilotEnabled({ ...user('a', { appearance_pilot: true }), app_metadata: {} }, 'true', 'staging')).toBe(false);
    expect(isAppearancePilotEnabled(user('a'), 'true', 'production')).toBe(false);
    expect(isAppearancePilotEnabled(user('a'), 'true', 'staging')).toBe(true);
  });
});

describe('preferência confirmada no store', () => {
  const a = user('a', { nome: 'QA' });
  const b = user('b');
  const store = useAppStore.getState;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('VITE_APPEARANCE_PILOT', 'true');
    vi.stubEnv('MODE', 'staging');
    api.getSession.mockResolvedValue(session(a));
    api.signOut.mockResolvedValue({ error: null });
    store().setUser(a);
  });

  afterEach(() => {
    store().setUser(null);
    vi.unstubAllEnvs();
  });

  it.each(['dark', 'light', 'system'])('persiste %s e restaura a escolha ao hidratar a conta', async theme => {
    const transactions = [{ ID_Conta: 'c1', Data: new Date(2026, 9, 3), Valor: -45.67 }] as Transaction[];
    const account = { id: 'c1', Tipo_Conta: 'Conta Corrente', Saldo_Inicial: 100, Data_Saldo_Inicial: new Date(2026, 9, 1) } as Account;
    useAppStore.setState({ transactions });
    await store().updateUserPreferences({ appearance_theme: theme });
    expect(api.persistAppearanceTheme).toHaveBeenCalledWith('token-a', theme);
    expect(store().user?.user_metadata).toEqual({ nome: 'QA', appearance_theme: theme });
    expect(store().transactions).toBe(transactions);
    expect(computeAccountBalanceAsOf(account, store().transactions, new Date(2026, 9, 4))).toBe(54.33);
    expect(api.from).not.toHaveBeenCalled();
    expect(api.rpc).not.toHaveBeenCalled();
    const serverSnapshot = store().user;
    store().setUser(null);
    store().setUser(serverSnapshot);
    expect(store().user?.user_metadata.appearance_theme).toBe(theme);
  });

  it('mantém a preferência confirmada em caso de falha e aceita nova tentativa', async () => {
    store().setUser(user('a', { appearance_theme: 'dark' }));
    api.persistAppearanceTheme.mockRejectedValueOnce(new Error('rede indisponível'));
    await expect(store().updateUserPreferences({ appearance_theme: 'light' })).rejects.toThrow('rede indisponível');
    expect(store().user?.user_metadata.appearance_theme).toBe('dark');
    await store().updateUserPreferences({ appearance_theme: 'light' });
    expect(store().user?.user_metadata.appearance_theme).toBe('light');
  });

  it('descarta a conclusão de uma gravação depois de sair e trocar de conta', async () => {
    let finish!: () => void;
    api.persistAppearanceTheme.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = store().updateUserPreferences({ appearance_theme: 'light' });
    await vi.waitFor(() => expect(api.persistAppearanceTheme).toHaveBeenCalledWith('token-a', 'light'));
    await expect(store().updateUserPreferences({ appearance_theme: 'system' })).rejects.toThrow('já está sendo salva');
    await store().signOut();
    expect(store().user).toBeNull();
    store().setUser(b);
    finish();
    await pending;
    expect(store().user).toEqual(b);
  });

  it('recusa uma sessão diferente, flag desligada e preferência inválida antes de gravar', async () => {
    api.getSession.mockResolvedValue(session(b));
    await expect(store().updateUserPreferences({ appearance_theme: 'light' })).rejects.toThrow('A sessão mudou');
    await expect(store().updateUserPreferences({ appearance_theme: 'unknown' })).rejects.toThrow('indisponível');
    vi.stubEnv('VITE_APPEARANCE_PILOT', 'false');
    await expect(store().updateUserPreferences({ appearance_theme: 'light' })).rejects.toThrow('indisponível');
    expect(api.persistAppearanceTheme).not.toHaveBeenCalled();
  });
});
