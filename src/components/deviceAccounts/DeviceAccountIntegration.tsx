import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { authForAddingAccount, isMultiAccountActive } from '../../domain/session/accounts/appAccountSessions';
import { isProviderReturn, takeDeviceCallback } from '../../domain/session/accounts/deviceAuth';
import { additionalAccountForm, useDeviceAccountState, type AdditionalAccountFormOptions } from '../../domain/session/accounts/deviceAccountActions';
import { DeviceAccountDialogs, DeviceAccountNotice, DeviceAccountOperationScreen } from './DeviceAccounts';

interface BoundaryProps {
  user: User | null;
  switching: boolean;
  children: ReactNode;
  renderLogin(options: AdditionalAccountFormOptions): ReactNode;
}

export function DeviceAccountBoundary({ user, switching, children, renderLogin }: BoundaryProps) {
  const { operation } = useDeviceAccountState();
  if (switching || operation === 'switch' || operation === 'signOut' || operation === 'signOutAll' || operation === 'remove') {
    return <DeviceAccountOperationScreen switching={switching || operation === 'switch'} />;
  }
  return <>
    {children}
    <DeviceAccountDialogs user={user} renderLogin={account => renderLogin(additionalAccountForm(account))} />
    <DeviceAccountNotice />
  </>;
}

export function DeviceAccountRecovery() {
  // AppLock lê o PIN ao montar. Espere esse primeiro efeito antes de consumir o código de uso único.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return mounted ? <RecoveryForm /> : null;
}

function RecoveryForm() {
  const [step, setStep] = useState<'checking' | 'recovery' | 'added' | 'saving' | 'done' | 'invalid' | 'relayed'>('checking');
  const [password, setPassword] = useState('');
  const pending = useRef<Promise<'recovery' | 'added'> | null>(null);
  useEffect(() => {
    if (isProviderReturn()) { setStep('relayed'); window.close(); return; }
    let live = true;
    try {
      pending.current ??= authForAddingAccount().callback(takeDeviceCallback());
      void pending.current.then(value => { if (live) setStep(value); }, () => { if (live) setStep('invalid'); });
    } catch { setStep('invalid'); }
    return () => { live = false; };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (step !== 'recovery') return;
    setStep('saving');
    setPassword('');
    try {
      await authForAddingAccount().updatePassword(password);
      setStep('done');
    } catch { setStep('invalid'); }
  };
  return <main className="grid min-h-dvh place-items-center bg-theme-canvas p-6 text-theme-content">
    <section className="space-y-4">
      {step === 'recovery' ? <form className="space-y-4" onSubmit={submit}>
        <h1>Redefinir senha</h1>
        <label>Nova senha <input required minLength={6} autoComplete="new-password" type="password"
          value={password} onChange={event => setPassword(event.target.value)} /></label>
        <button type="submit">Salvar nova senha</button>
      </form> : <p role="status">{{
        relayed: 'Retorne à aba do FinElo para concluir.', checking: 'Confirmando a tentativa…', saving: 'Salvando…', added: 'Conta disponível neste dispositivo.',
        done: 'Senha atualizada.', invalid: 'Tentativa inválida ou expirada. Solicite um novo link na aba de origem.',
      }[step]}</p>}
      <a href="/app" onClick={() => { if (isMultiAccountActive() && (step === 'recovery' || step === 'checking')) authForAddingAccount().cancel(); }}>
        {step === 'recovery' || step === 'checking' ? 'Cancelar' : 'Voltar ao FinElo'}
      </a>
    </section>
  </main>;
}
