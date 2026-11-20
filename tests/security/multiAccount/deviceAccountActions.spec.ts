import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RememberedAccount } from '../../../src/domain/session/accounts/accountStore';

vi.hoisted(() => vi.stubEnv('VITE_MULTI_ACCOUNT_SESSIONS', 'false'));

const app = vi.hoisted(() => ({
  manager: { activeUserId: vi.fn() },
  listRememberedAccounts: vi.fn(),
  switchActiveAccount: vi.fn(),
  signOutActiveAccount: vi.fn(),
  removeRememberedAccount: vi.fn(),
  signOutEveryAccount: vi.fn(),
  enableMultiAccountSessions: vi.fn(),
}));

vi.mock('../../../src/supabaseClient', () => ({ supabase: {} }));
vi.mock('../../../src/domain/session/accounts/appAccountSessions', () => app);
vi.mock('../../../src/domain/session/accounts/multiAccountSessions', () => ({
  enableMultiAccountSessions: app.enableMultiAccountSessions,
  getSessionAccountManager: () => app.manager,
}));

import {
  activateDeviceAccounts,
  closeDeviceAccountPanel,
  confirmDeviceSignOut,
  deviceSignOutNotice,
  deviceSwitchError,
  openDeviceAccountPanel,
  selectDeviceAccount,
} from '../../../src/domain/session/accounts/deviceAccountActions';

const account: RememberedAccount = {
  userId: 'b1a10909-1009-4e65-8a49-100000000001',
  email: 'a@example.test',
  addedAt: 0,
  lastUsedAt: 0,
  signedOut: false,
};

const signedOut = { localCleared: true, serverConfirmed: true, error: null };

beforeEach(() => {
  vi.clearAllMocks();
  closeDeviceAccountPanel();
  app.manager.activeUserId.mockReturnValue(account.userId);
  app.listRememberedAccounts.mockReturnValue([account]);
  app.signOutActiveAccount.mockResolvedValue(signedOut);
  app.removeRememberedAccount.mockResolvedValue(signedOut);
  app.signOutEveryAccount.mockResolvedValue([{ userId: account.userId, outcome: signedOut }]);
});

describe('ações da interface de contas deste dispositivo', () => {
  it('não migra o navegador com o build desativado, mesmo após aceitar o diálogo', async () => {
    openDeviceAccountPanel({ kind: 'consent' });
    await activateDeviceAccounts();
    expect(app.enableMultiAccountSessions).not.toHaveBeenCalled();
  });

  it('bloqueia uma segunda troca e permite repetir a seleção após o ponto quieto ser recusado', async () => {
    let finish: (value: unknown) => void;
    app.switchActiveAccount.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const current = selectDeviceAccount(account);
    await selectDeviceAccount(account);
    const callsDuringSwitch = [...app.switchActiveAccount.mock.calls];

    finish!({ ok: false, reason: 'operations_pending', restoredUserId: null });
    await current;
    expect(callsDuringSwitch).toEqual([[account.userId]]);
    app.switchActiveAccount.mockResolvedValueOnce({ ok: true, userId: account.userId });
    await selectDeviceAccount(account);
    expect(app.switchActiveAccount).toHaveBeenCalledTimes(2);
    expect(deviceSwitchError('operations_pending')).toMatch(/operação em andamento/);
  });

  it('preserva a intenção da confirmação quando a conta ativa muda', async () => {
    app.manager.activeUserId.mockReturnValue(null);
    await confirmDeviceSignOut({ kind: 'signOut', account });
    expect(app.signOutActiveAccount).not.toHaveBeenCalled();
    expect(app.removeRememberedAccount).not.toHaveBeenCalled();
    expect(app.signOutEveryAccount).not.toHaveBeenCalled();
  });

  it('delega cada confirmação à ação de sessão correspondente', async () => {
    await confirmDeviceSignOut({ kind: 'signOut', account });
    expect(app.signOutActiveAccount).toHaveBeenCalledOnce();
    expect(app.removeRememberedAccount).not.toHaveBeenCalled();
    expect(app.signOutEveryAccount).not.toHaveBeenCalled();

    await confirmDeviceSignOut({ kind: 'remove', account });
    expect(app.removeRememberedAccount.mock.calls).toEqual([[account.userId]]);
    expect(app.signOutEveryAccount).not.toHaveBeenCalled();

    await confirmDeviceSignOut({ kind: 'signOutAll' });
    expect(app.signOutEveryAccount).toHaveBeenCalledOnce();
  });

  it('distingue a confirmação local da revogação no servidor sem expor o erro bruto', () => {
    expect(deviceSignOutNotice([signedOut])).toBeNull();
    expect(deviceSignOutNotice([{ ...signedOut, serverConfirmed: false, error: 'detalhe interno' }])).toMatch(/servidor não confirmou/);
    expect(deviceSignOutNotice([{ localCleared: false, serverConfirmed: false, error: 'detalhe interno' }])).toMatch(/Não foi possível confirmar/);
  });
});
