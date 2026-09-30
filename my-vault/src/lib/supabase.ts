import { createClient } from '@supabase/supabase-js';
import { env } from './env';

const REMEMBER_KEY = 'vault.remember-session';
const RECOVERY_KEY = 'vault.password-recovery';

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function getRememberSession(): boolean {
  return safe(() => localStorage.getItem(REMEMBER_KEY) !== '0', true);
}

export function setRememberSession(remember: boolean) {
  safe(() => localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0'), undefined);
}

/**
 * Password-recovery landings are the only way to set a new password without
 * knowing the current one. Detect them from the URL before the client
 * consumes the token (the PASSWORD_RECOVERY event also marks it).
 */
export function markRecoverySession() {
  safe(() => sessionStorage.setItem(RECOVERY_KEY, '1'), undefined);
}
export function isRecoverySession(): boolean {
  return safe(() => sessionStorage.getItem(RECOVERY_KEY) === '1', false);
}
export function clearRecoverySession() {
  safe(() => sessionStorage.removeItem(RECOVERY_KEY), undefined);
}
if (
  typeof window !== 'undefined' &&
  window.location.pathname === '/reset-password' &&
  (/type=recovery|access_token=/.test(window.location.hash) || /[?&]code=/.test(window.location.search))
) {
  markRecoverySession();
}

/**
 * "Remember session" support: when unchecked, the Supabase session lives in
 * sessionStorage and disappears when the browser/tab is closed.
 */
const authStorage = {
  getItem(key: string) {
    return safe(() => localStorage.getItem(key) ?? sessionStorage.getItem(key), null);
  },
  setItem(key: string, value: string) {
    safe(() => {
      if (getRememberSession()) {
        localStorage.setItem(key, value);
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
        localStorage.removeItem(key);
      }
    }, undefined);
  },
  removeItem(key: string) {
    safe(() => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }, undefined);
  },
};

// Only the public anon key is used here. All access control is enforced by
// Postgres RLS and Storage policies on the server.
export const supabase = createClient(
  env.supabaseUrl || 'http://localhost:54321',
  env.supabaseAnonKey || 'missing-anon-key',
  {
    auth: {
      storage: authStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
