import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  /** True after the user arrived via a password-recovery or invite link. */
  passwordSetupPending: boolean;
  clearPasswordSetup: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function arrivedViaSetupLink() {
  const hash = window.location.hash;
  return /type=(recovery|invite|signup)/.test(hash) || /type=(recovery|invite)/.test(window.location.search);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordSetupPending, setPasswordSetupPending] = useState(arrivedViaSetupLink);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'PASSWORD_RECOVERY') setPasswordSetupPending(true);
      if (event === 'SIGNED_OUT') setPasswordSetupPending(false);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    // Best-effort audit entry; sign-out must never be blocked by it.
    await supabase.rpc('log_event', { p_action: 'logout', p_module: 'auth', p_summary: 'Signed out', p_details: null }).then(
      () => undefined,
      () => undefined,
    );
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      passwordSetupPending,
      clearPasswordSetup: () => setPasswordSetupPending(false),
      signOut,
    }),
    [session, loading, passwordSetupPending, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
