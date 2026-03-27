import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Session } from '@supabase/supabase-js';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { useAppStore } from './hooks/useAppStore';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';

// Vistas Públicas
import LandingPage from './components/views/LandingPage';
import AuthView from './components/views/AuthView';
import UpdatePasswordView from './components/views/UpdatePasswordView';

// Core
import MainLayout from './layouts/MainLayout';
import { AppLock } from './components/auth/AppLock';
import ReloadPrompt from './components/pwa/ReloadPrompt';

const AppContent: React.FC = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const { fetchAllData, setUser, user, signOut } = useAppStore();

  const ignoreNextSignedIn = useRef(false);
  const lastSessionIdRef = useRef<string | null>(null);

  const stableFetchAllData = useCallback(fetchAllData, [fetchAllData]);

  useEffect(() => {
    // Inicialização da Sessão
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (session) {
        supabase.auth.getUser().then(({ data, error }) => {
          if (error || !data.user) {
            console.warn('[Security] Sessão inválida. Forçando logout.');
            signOut();
            setSession(null);
          } else {
            stableFetchAllData();
          }
        });
      }
    });

    // Listener de Auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Trava de Sessão (especialmente para iOS/Safari)
      if (session?.access_token === lastSessionIdRef.current && (_event === 'SIGNED_IN' || _event === 'INITIAL_SESSION')) {
        return;
      }
      lastSessionIdRef.current = session?.access_token ?? null;

      console.log(`%c[Auth Event] %c${_event}`, 'color: yellow; font-weight: bold;', 'color: cyan; font-weight: bold;', { session });

      if (_event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
        ignoreNextSignedIn.current = true;
        setSession(session);
        return;
      }

      if (_event === 'SIGNED_IN' && ignoreNextSignedIn.current) {
        ignoreNextSignedIn.current = false;
        return;
      }

      setIsPasswordRecovery(false);
      setSession(session);
      setUser(session?.user ?? null);

      if (_event === 'SIGNED_IN') {
        stableFetchAllData();
      }
    });

    return () => subscription.unsubscribe();
  }, [stableFetchAllData, setUser, signOut]);

  // PWA Safety Update Check
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      const interval = setInterval(() => {
        navigator.serviceWorker.getRegistration().then(reg => reg && reg.update());
      }, 10 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, []);

  // Sincronização automática quando o app volta ao primeiro plano (resolve conflito de múltiplas instâncias)
  useEffect(() => {
    const handleVisibilitySync = () => {
      if (document.visibilityState === 'visible' && user) {
        console.log('%c[Sync] %cApp visível, recarregando dados para garantir sincronia...', 'color: yellow; font-weight: bold;', 'color: cyan;');
        stableFetchAllData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilitySync);
    window.addEventListener('focus', handleVisibilitySync); // Backup para alguns navegadores
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilitySync);
      window.removeEventListener('focus', handleVisibilitySync);
    };
  }, [user, stableFetchAllData]);

  if (isPasswordRecovery) {
    return <UpdatePasswordView />;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<AuthView />} />
        <Route path="/update-password" element={<UpdatePasswordView />} />
        <Route path="/pricing" element={<LandingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/update-password" element={<UpdatePasswordView />} />
      <Route path="/" element={<MainLayout />} />
      <Route path="/pricing" element={<MainLayout />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const App: React.FC = () => (
  <Router>
    <AppLock>
      <AppContent />
    </AppLock>
    <ReloadPrompt />
    <Analytics />
    <SpeedInsights />
  </Router>
);

export default App;
