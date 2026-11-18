import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import Avatar from '../../Avatar';
import { CheckIcon, LogoutIcon, SettingsIcon } from '../ui/icons';
import {
  activateDeviceAccounts,
  closeDeviceAccountPanel,
  confirmDeviceSignOut,
  DEVICE_ACCOUNT_LIMIT,
  dismissDeviceAccountNotice,
  openDeviceAccountPanel,
  operationMessages,
  resumeDeviceAccountPanel,
  selectDeviceAccount,
  useDeviceAccountState,
  useRememberedDeviceAccounts,
  type AccountPanel,
} from '../../domain/session/accounts/deviceAccountActions';
import { isMultiAccountActive } from '../../domain/session/accounts/appAccountSessions';
import type { RememberedAccount } from '../../domain/session/accounts/accountStore';
import './deviceAccounts.css';

const accountLabel = (account: RememberedAccount) => account.email ?? 'Conta lembrada';

function AccountIdentity({ account, user }: { account: RememberedAccount; user?: User | null }) {
  const active = user?.id === account.userId;
  const name = active ? user.user_metadata.full_name || user.user_metadata.name : undefined;
  const email = account.email ?? (active ? user.email : undefined);
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {active
        ? <Avatar user={user} className="h-8 w-8 shrink-0" />
        : <span className="device-account-avatar" aria-hidden="true">{email?.slice(0, 2).toUpperCase() || 'FE'}</span>}
      <span className="min-w-0">
        <span className="block break-words text-sm font-semibold">{typeof name === 'string' && name ? name : accountLabel(account)}</span>
        {typeof name === 'string' && name && email && <span className="block break-all text-xs">{email}</span>}
        <span className="device-account-detail block text-xs">{active ? 'Ativa nesta aba' : account.signedOut ? 'Requer novo login' : 'Sessão iniciada'}</span>
      </span>
    </span>
  );
}

function startAddingAccount() {
  openDeviceAccountPanel({ kind: isMultiAccountActive() ? 'add' : 'consent' });
}

function openAccount(account: RememberedAccount) {
  if (account.signedOut) openDeviceAccountPanel({ kind: 'add', account });
  else void selectDeviceAccount(account);
}

const actionClass = 'device-account-action';
const menuRowClass = 'device-account-menu-row';

export function DeviceAccountMenu({ user }: { user: User }) {
  const accounts = useRememberedDeviceAccounts();
  const { operation } = useDeviceAccountState();
  const atLimit = accounts.length >= DEVICE_ACCOUNT_LIMIT;
  const active = accounts.find(({ userId }) => userId === user.id);
  const others = accounts.filter(({ userId }) => userId !== user.id);

  return (
    <div data-appearance-part="divider" className="device-account-profile border-b pb-1">
      {isMultiAccountActive() && (
        <div aria-label="Contas do dispositivo" className="mb-1">
          {active && (
            <div className="device-account-current px-3 py-2">
              <span className="min-w-0 flex-1"><AccountIdentity account={active} user={user} /></span>
              <CheckIcon className="h-4 w-4 shrink-0" />
            </div>
          )}
          {others.map(account => (
            <button key={account.userId} type="button" className={menuRowClass} disabled={Boolean(operation)} onClick={() => openAccount(account)}
              aria-label={(account.signedOut ? 'Entrar em ' : 'Alternar para ') + accountLabel(account)}>
              <AccountIdentity account={account} />
            </button>
          ))}
        </div>
      )}
      <button type="button" className={menuRowClass} disabled={atLimit || Boolean(operation)} onClick={startAddingAccount}>
        <span aria-hidden="true" className="inline-flex w-5 justify-center text-lg leading-none">+</span>
        Adicionar outra conta
      </button>
      {atLimit && <p className="device-account-detail px-3 pb-1 text-xs">Limite de {DEVICE_ACCOUNT_LIMIT} contas. Remova uma para adicionar outra.</p>}
      {isMultiAccountActive() && (
        <button type="button" className={menuRowClass} disabled={Boolean(operation)} onClick={() => openDeviceAccountPanel({ kind: 'manage' })}>
          <SettingsIcon className="h-5 w-5 shrink-0" />
          Gerenciar contas deste dispositivo
        </button>
      )}
    </div>
  );
}

export function DeviceAccountSignOut({ user }: { user: User }) {
  const accounts = useRememberedDeviceAccounts();
  const active = accounts.find(({ userId }) => userId === user.id);
  const { operation } = useDeviceAccountState();
  return (
    <button type="button" className={menuRowClass + ' device-account-danger'} disabled={!active || Boolean(operation)}
      onClick={() => { if (active) openDeviceAccountPanel({ kind: 'signOut', account: active }); }}>
      <LogoutIcon className="h-5 w-5 shrink-0" />
      Sair da conta atual
    </button>
  );
}

export function RememberedAccountLogin() {
  const accounts = useRememberedDeviceAccounts();
  if (!accounts.length) return null;
  return (
    <section aria-label="Contas lembradas" className="mb-4 border-b border-theme-divider pb-3 text-theme-content">
      <p className="device-account-detail mb-1 text-xs font-semibold">Contas lembradas</p>
      {accounts.map(account => (
        <button key={account.userId} type="button" className={menuRowClass} onClick={() => openAccount(account)}
          aria-label={(account.signedOut ? 'Entrar em ' : 'Alternar para ') + accountLabel(account)}>
          <AccountIdentity account={account} />
        </button>
      ))}
      <button type="button" className={menuRowClass} onClick={() => openDeviceAccountPanel({ kind: 'manage' })}>
        <SettingsIcon className="h-5 w-5 shrink-0" />
        Gerenciar contas deste dispositivo
      </button>
    </section>
  );
}

const panelTitles: Record<AccountPanel['kind'], string> = {
  consent: 'Usar várias contas',
  add: 'Adicionar outra conta',
  manage: 'Contas deste dispositivo',
  switch: 'Alternar conta',
  remove: 'Remover conta deste dispositivo',
  signOut: 'Sair da conta atual',
  signOutAll: 'Sair de todas as contas',
};

function ManageAccounts({ activeUser, accounts }: { activeUser: User | null; accounts: ReadonlyArray<RememberedAccount> }) {
  const atLimit = accounts.length >= DEVICE_ACCOUNT_LIMIT;
  const active = accounts.find(({ userId }) => userId === activeUser?.id);
  return (
    <>
      <p className="device-account-detail mb-2 text-sm">{accounts.length} de {DEVICE_ACCOUNT_LIMIT} contas neste navegador</p>
      {accounts.length ? (
        <ul className="divide-y divide-theme-divider">
          {accounts.map(account => (
            <li key={account.userId} className="space-y-2 py-3">
              <AccountIdentity account={account} user={activeUser} />
              <div className="flex flex-wrap gap-2 pl-10">
                {account.userId !== activeUser?.id && (
                  <button type="button" className={actionClass} aria-label={(account.signedOut ? 'Entrar em ' : 'Alternar para ') + accountLabel(account)} onClick={() => openAccount(account)}>
                    {account.signedOut ? 'Entrar' : 'Alternar'}
                  </button>
                )}
                <button type="button" className={actionClass + ' device-account-danger'} aria-label={'Remover ' + accountLabel(account)}
                  onClick={() => openDeviceAccountPanel({ kind: 'remove', account })}>Remover</button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="py-3 text-sm">Nenhuma conta lembrada neste navegador.</p>}
      <div className="device-account-controls mt-3 border-t border-theme-divider pt-3">
        <button type="button" className={actionClass} disabled={atLimit} onClick={startAddingAccount}>Adicionar outra conta</button>
        {active && <button type="button" className={actionClass} onClick={() => openDeviceAccountPanel({ kind: 'signOut', account: active })}>Sair da conta atual</button>}
        {accounts.length > 0 && <button type="button" className={actionClass + ' device-account-danger'} onClick={() => openDeviceAccountPanel({ kind: 'signOutAll' })}>Sair de todas</button>}
      </div>
      {atLimit && <p className="device-account-detail mt-2 text-xs">Remova uma conta para adicionar outra.</p>}
    </>
  );
}

interface AccountDialogsProps {
  user: User | null;
  renderLogin(account?: RememberedAccount): ReactNode;
}

export function DeviceAccountDialogs({ user, renderLogin }: AccountDialogsProps) {
  const { panel, operation, error } = useDeviceAccountState();
  const accounts = useRememberedDeviceAccounts();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const kind = panel?.kind;
  const open = Boolean(panel);

  useEffect(() => {
    if (user) resumeDeviceAccountPanel();
  }, [user?.id]);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallback = previous?.closest('[data-device-account-widget]')?.querySelector<HTMLElement>('[data-device-account-trigger]');
    element.showModal();
    return () => {
      element.close();
      const target = previous?.isConnected ? previous : fallback;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [open]);

  useLayoutEffect(() => {
    if (kind) title.current?.focus({ preventScroll: true });
  }, [kind]);

  if (!panel) return null;
  const titleText = panel.kind === 'add' && panel.account ? 'Entrar novamente' : panelTitles[panel.kind];

  return (
    <dialog ref={dialog} className="device-account-dialog" aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); closeDeviceAccountPanel(); }}>
      <div className="flex items-center justify-between gap-3 border-b border-theme-divider p-4">
        <h2 ref={title} id={titleId} tabIndex={-1} className="text-lg font-semibold">{titleText}</h2>
        {!operation && <button type="button" className={actionClass} onClick={closeDeviceAccountPanel} aria-label="Fechar painel de contas">&times;</button>}
      </div>
      <div className="space-y-3 p-4 sm:p-5">
        {operation && <p className="text-sm" role="status">{operationMessages[operation]}</p>}
        {error && <p className="device-account-error text-sm" role="alert">{error}</p>}
        {!operation && panel.kind === 'manage' && <ManageAccounts activeUser={user} accounts={accounts} />}
        {!operation && panel.kind === 'add' && (
          <>
            {user && <p className="device-account-detail text-sm">Sua conta atual continuará conectada.</p>}
            {renderLogin(panel.account)}
          </>
        )}
        {!operation && panel.kind === 'consent' && (
          <>
            <p className="text-sm">Permitir que este navegador lembre até {DEVICE_ACCOUNT_LIMIT} contas do FinElo? Faça isso apenas em um dispositivo de confiança.</p>
            <div className="device-account-controls">
              <button type="button" className={actionClass} onClick={closeDeviceAccountPanel}>Cancelar</button>
              <button type="button" className={actionClass + ' device-account-primary'} onClick={() => void activateDeviceAccounts()}>Ativar e continuar</button>
            </div>
          </>
        )}
        {!operation && panel.kind === 'switch' && (
          <div className="device-account-controls">
            <button type="button" className={actionClass} onClick={closeDeviceAccountPanel}>Voltar</button>
            <button type="button" className={actionClass + ' device-account-primary'} onClick={() => void selectDeviceAccount(panel.account)}>Tentar novamente</button>
          </div>
        )}
        {!operation && (panel.kind === 'remove' || panel.kind === 'signOut' || panel.kind === 'signOutAll') && (
          <>
            <p className="text-sm">{panel.kind === 'signOutAll'
              ? 'Todas as contas serão desconectadas e esquecidas neste navegador. Você precisará entrar novamente.'
              : panel.kind === 'remove'
                ? 'A sessão será encerrada em todas as abas deste navegador e a conta será esquecida.'
                : 'Esta conta será desconectada em todas as abas deste navegador e continuará na lista de contas.'}</p>
            {panel.kind !== 'signOutAll' && <AccountIdentity account={panel.account} user={user} />}
            <div className="device-account-controls">
              <button type="button" className={actionClass} onClick={closeDeviceAccountPanel}>Cancelar</button>
              <button type="button" className={actionClass + ' device-account-danger'} onClick={() => void confirmDeviceSignOut(panel)}>
                {panel.kind === 'signOutAll' ? 'Sair de todas' : panel.kind === 'remove' ? 'Remover conta' : 'Sair desta conta'}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}

export function DeviceAccountNotice() {
  const { notice } = useDeviceAccountState();
  if (!notice) return null;
  return (
    <div className="device-account-notice" role="status">
      <p className="text-sm">{notice}</p>
      <button type="button" className={actionClass} aria-label="Dispensar aviso" onClick={dismissDeviceAccountNotice}>&times;</button>
    </div>
  );
}

export function DeviceAccountOperationScreen({ switching }: { switching: boolean }) {
  const { operation } = useDeviceAccountState();
  if (!operation && !switching) return null;
  if (!switching && operation !== 'signOut' && operation !== 'signOutAll' && operation !== 'remove') return null;
  return (
    <div className="grid min-h-dvh place-items-center bg-theme-canvas px-4 text-theme-content">
      <p role="status" className="text-sm">{switching ? operationMessages.switch : operationMessages[operation]}</p>
    </div>
  );
}
