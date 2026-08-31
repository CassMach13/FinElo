import type { User } from '@supabase/supabase-js';
import type { ReactElement } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

interface ProtectedRouteProps {
  isAuthReady: boolean;
  user: User | null;
}

const AuthLoadingScreen = (): ReactElement => (
  <div className="flex min-h-screen items-center justify-center bg-[#0B1120] text-sm text-slate-400">
    Verificando sua sessão...
  </div>
);

/**
 * Prevents protected content from rendering until Supabase has validated the
 * persisted session. Database authorization still belongs to RLS policies.
 */
export const ProtectedRoute = ({ isAuthReady, user }: ProtectedRouteProps): ReactElement => {
  const location = useLocation();

  if (!isAuthReady) return <AuthLoadingScreen />;

  if (!user) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ returnTo }} />;
  }

  return <Outlet />;
};

export { AuthLoadingScreen };
