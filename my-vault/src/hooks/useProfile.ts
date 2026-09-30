import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { getAvatarUrl, getProfile, updateProfile } from '@/services/profile';
import { qk, queryClient } from '@/lib/queryClient';
import { getErrorMessage } from '@/lib/errors';
import type { Preferences, Profile, ThemePref } from '@/types';

export const DEFAULT_PREFS: Preferences = { view: 'grid', pageSize: 48, theme: 'system' };
export const PAGE_SIZES = [24, 48, 96];

const THEME_KEY = 'vault.theme';

export function useProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.profile(user?.id),
    queryFn: () => getProfile(user!.id),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });
}

export function useDisplayName(): string {
  const { user } = useAuth();
  const { data } = useProfile();
  return data?.full_name?.trim() || (user?.email ? user.email.split('@')[0] : 'there');
}

export function useAvatarUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: qk.avatar(path),
    queryFn: () => getAvatarUrl(path!),
    enabled: Boolean(path),
    staleTime: 12 * 60 * 60_000,
  });
}

/** Preferences are stored on the profile row so they follow the user across devices. */
export function usePreferences() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const prefs: Preferences = { ...DEFAULT_PREFS, ...(profile?.preferences ?? {}) };
  if (!PAGE_SIZES.includes(prefs.pageSize)) prefs.pageSize = DEFAULT_PREFS.pageSize;

  const mutation = useMutation({
    mutationFn: (patch: Partial<Preferences>) =>
      updateProfile(user!.id, { preferences: { ...prefs, ...patch } }),
    onMutate: async (patch) => {
      const key = qk.profile(user?.id);
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<Profile>(key);
      if (prev) queryClient.setQueryData<Profile>(key, { ...prev, preferences: { ...prev.preferences, ...patch } });
      return { prev };
    },
    onError: (err, _patch, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(qk.profile(user?.id), ctx.prev);
      toast.error('Could not save preference', { description: getErrorMessage(err) });
    },
    onSuccess: (profile) => queryClient.setQueryData(qk.profile(user?.id), profile),
  });

  return { prefs, setPrefs: mutation.mutate, saving: mutation.isPending };
}

function resolveTheme(theme: ThemePref): 'light' | 'dark' {
  if (theme === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return theme;
}

function applyTheme(theme: ThemePref) {
  document.documentElement.classList.toggle('dark', resolveTheme(theme) === 'dark');
}

/** Apply the stored theme before login (no flash), then follow the profile. */
export function initThemeFromCache() {
  try {
    applyTheme((localStorage.getItem(THEME_KEY) as ThemePref) || 'system');
  } catch {
    applyTheme('system');
  }
}

export function useThemeSync(theme: ThemePref) {
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable */
    }
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);
}
