import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { classifyAuthInit, shouldDeferStartupAuthEvent } from './utils/authSessionOutcome';
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
import { AuthLoadingScreen, ProtectedRoute } from './components/auth/ProtectedRoute';
import ReloadPrompt from './components/pwa/ReloadPrompt';
import { GlobalDialog } from './components/ui/GlobalDialog';

const AppContent: React.FC = () => {
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const { fetchAllData, setUser, user } = useAppStore();

  const ignoreNextSignedIn = useRef(false);
  const lastSessionIdRef = useRef<string | null>(null);
  const initialValidationDone = useRef(false);

  const stableFetchAllData = useCallback(fetchAllData, [fetchAllData]);

  useEffect(() => {
    let active = true;

    // getUser validates the persisted access token with Supabase Auth before any
    // protected content is rendered. getSession alone only reads local storage.
    const initializeAuth = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!active) return;

      switch (classifyAuthInit(Boolean(data.user), error)) {
        case 'authenticated': {
          setUser(data.user);
          void stableFetchAllData();
          break;
        }
        case 'offline-fallback': {
          const { data: local } = await supabase.auth.getSession();
          if (!active) return;

          setUser(local.session?.user ?? null);
          if (local.session) void stableFetchAllData();
          break;
        }
        case 'rejected': {
          // scope 'local' skips a network round-trip this dead token could not
          // authorize anyway, and leaves sessions on other devices alone.
          await supabase.auth.signOut({ scope: 'local' });
          if (!active) return;

          setUser(null);
          break;
        }
        default: {
          setUser(null);
        }
      }

      initialValidationDone.current = true;
      setIsAuthReady(true);
    };

    void initializeAuth();

    // Listener de Auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Trava de Sessão (especialmente para iOS/Safari)
      if (session?.access_token === lastSessionIdRef.current && (_event === 'SIGNED_IN' || _event === 'INITIAL_SESSION')) {
        return;
      }
      lastSessionIdRef.current = session?.access_token ?? null;

      // initializeAuth() é a autoridade até o servidor responder.
      if (shouldDeferStartupAuthEvent(_event, initialValidationDone.current)) {
        return;
      }

      if (_event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
        ignoreNextSignedIn.current = true;
        setIsAuthReady(true);
        return;
      }

      if (_event === 'SIGNED_IN' && ignoreNextSignedIn.current) {
        ignoreNextSignedIn.current = false;
        return;
      }

      setIsPasswordRecovery(false);
      setUser(session?.user ?? null);
      setIsAuthReady(true);

      if (_event === 'SIGNED_IN') {
        stableFetchAllData();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [stableFetchAllData, setUser]);

  // PWA Safety Update Check
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      const checkForUpdate = () => {
        void navigator.serviceWorker
          .getRegistration()
          .then(registration => registration?.update())
          .catch(() => undefined);
      };
      checkForUpdate();
      const interval = setInterval(checkForUpdate, 10 * 60 * 1000);
      window.addEventListener('focus', checkForUpdate);
      return () => {
        clearInterval(interval);
        window.removeEventListener('focus', checkForUpdate);
      };
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

  if (!isAuthReady) return <AuthLoadingScreen />;

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to="/app" replace /> : <LandingPage />} />
      <Route path="/login" element={user ? <Navigate to="/app" replace /> : <AuthView />} />
      <Route path="/update-password" element={<UpdatePasswordView />} />
      {/* MainLayout reads /pricing from the URL to open the in-app pricing view. */}
      <Route path="/pricing" element={user ? <Navigate to="/app?view=pricing" replace /> : <LandingPage />} />
      <Route element={<ProtectedRoute isAuthReady={isAuthReady} user={user} />}>
        <Route path="/app" element={<MainLayout />} />
        <Route path="/dashboard" element={<Navigate to="/app" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const App: React.FC = () => (
  <Router>
    <AppLock>
      <AppContent />
    </AppLock>
    <GlobalDialog />
    <ReloadPrompt />
    <Analytics />
    <SpeedInsights />
  </Router>
);

export default App;
