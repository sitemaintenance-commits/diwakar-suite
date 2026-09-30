import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Camera, HardDrive, KeyRound, LayoutGrid, List, LogOut, Mail, Monitor, Moon, ShieldCheck, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Input';
import { Avatar, Card, Segmented, Skeleton } from '@/components/ui/misc';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useAuth, useUser } from '@/context/AuthContext';
import { PAGE_SIZES, useAvatarUrl, useDisplayName, usePreferences, useProfile } from '@/hooks/useProfile';
import { useStats } from '@/hooks/useFiles';
import { removeAvatar, updateProfile, uploadAvatar } from '@/services/profile';
import { supabase } from '@/lib/supabase';
import { getErrorMessage } from '@/lib/errors';
import { qk, queryClient } from '@/lib/queryClient';
import { StorageBreakdown } from './StoragePage';
import { MIN_PASSWORD } from './PasswordPages';
import type { Profile, ThemePref, ViewMode } from '@/types';
import { formatBytes } from '@/utils/format';

function Section({ title, description, icon, children }: { title: string; description: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="grid gap-5 lg:grid-cols-[260px_1fr] lg:gap-10">
        <div className="flex gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">{icon}</div>
          <div>
            <h3 className="text-base font-semibold text-ink">{title}</h3>
            <p className="mt-0.5 text-sm text-muted">{description}</p>
          </div>
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </Card>
  );
}

function ProfileSection() {
  const user = useUser();
  const { data: profile, isLoading } = useProfile();
  const { data: avatarUrl } = useAvatarUrl(profile?.avatar_path);
  const displayName = useDisplayName();
  const [name, setName] = useState('');
  const [email, setEmail] = useState(user.email ?? '');
  const [saving, setSaving] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile) setName(profile.full_name);
  }, [profile]);

  const setProfile = (p: Profile) => queryClient.setQueryData(qk.profile(user.id), p);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      setProfile(await updateProfile(user.id, { full_name: name.trim() }));
      toast.success('Profile updated');
    } catch (err) {
      toast.error('Could not save profile', { description: getErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  const saveEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (email.trim() === user.email) return;
    setSavingEmail(true);
    const { error } = await supabase.auth.updateUser({ email: email.trim() }, { emailRedirectTo: `${window.location.origin}/settings` });
    setSavingEmail(false);
    if (error) toast.error('Could not change email', { description: getErrorMessage(error) });
    else toast.success('Confirm your new email', { description: 'We sent confirmation links. The change applies after you confirm.' });
  };

  const onAvatar = async (file?: File) => {
    if (!file) return;
    setAvatarBusy(true);
    try {
      setProfile(await uploadAvatar(user.id, file, profile?.avatar_path ?? null));
      toast.success('Avatar updated');
    } catch (err) {
      toast.error('Avatar upload failed', { description: getErrorMessage(err) });
    } finally {
      setAvatarBusy(false);
    }
  };

  const onRemoveAvatar = async () => {
    if (!profile?.avatar_path) return;
    setAvatarBusy(true);
    try {
      setProfile(await removeAvatar(user.id, profile.avatar_path));
    } catch (err) {
      toast.error('Could not remove avatar', { description: getErrorMessage(err) });
    } finally {
      setAvatarBusy(false);
    }
  };

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Avatar name={displayName} url={avatarUrl} size={64} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Camera className="size-4" />} loading={avatarBusy} onClick={() => fileRef.current?.click()}>
            Change avatar
          </Button>
          {profile?.avatar_path && (
            <Button size="sm" variant="ghost" disabled={avatarBusy} onClick={onRemoveAvatar}>
              Remove
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void onAvatar(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <form onSubmit={saveName} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label="Name" htmlFor="profile-name">
            <Input id="profile-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </Field>
        </div>
        <Button type="submit" loading={saving} disabled={name.trim() === (profile?.full_name ?? '')}>
          Save name
        </Button>
      </form>
      <form onSubmit={saveEmail} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label="Email" htmlFor="profile-email" hint="Changing your email requires confirming the new address.">
            <Input id="profile-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} leftIcon={<Mail className="size-4" />} />
          </Field>
        </div>
        <Button type="submit" variant="secondary" loading={savingEmail} disabled={!email.trim() || email.trim() === user.email}>
          Update email
        </Button>
      </form>
    </div>
  );
}

function SecuritySection() {
  const user = useUser();
  const { signOut } = useAuth();
  const confirm = useConfirm();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < MIN_PASSWORD) return setError(`New password must be at least ${MIN_PASSWORD} characters.`);
    if (next !== again) return setError('New passwords do not match.');
    if (next === current) return setError('New password must be different from the current one.');
    setSaving(true);
    try {
      // Re-verify the current password before allowing a change.
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email: user.email!, password: current });
      if (verifyError) throw new Error('Current password is incorrect.');
      const { error: updateError } = await supabase.auth.updateUser({ password: next });
      if (updateError) throw updateError;
      setCurrent('');
      setNext('');
      setAgain('');
      toast.success('Password changed');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const sendReset = async () => {
    setSendingReset(true);
    const { error } = await supabase.auth.resetPasswordForEmail(user.email!, { redirectTo: `${window.location.origin}/reset-password` });
    setSendingReset(false);
    if (error) toast.error('Could not send reset email', { description: getErrorMessage(error) });
    else toast.success('Reset email sent', { description: `Check ${user.email}.` });
  };

  const signOutEverywhere = async () => {
    const ok = await confirm({
      title: 'Sign out of all devices?',
      message: 'Every active session, including this one, will be signed out.',
      confirmLabel: 'Sign out everywhere',
      danger: true,
    });
    if (!ok) return;
    try {
      await signOut('global');
    } catch (err) {
      toast.error('Sign out failed', { description: getErrorMessage(err) });
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={changePassword} className="space-y-3" noValidate>
        <h4 className="text-sm font-semibold text-ink">Change password</h4>
        {error && <p className="rounded-lg bg-danger-soft p-2.5 text-sm text-danger">{error}</p>}
        <Field label="Current password" htmlFor="pw-current">
          <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="New password" htmlFor="pw-new" hint={`At least ${MIN_PASSWORD} characters.`}>
            <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Confirm new password" htmlFor="pw-again">
            <Input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" loading={saving} disabled={!current || !next || !again} icon={<KeyRound className="size-4" />}>
          Change password
        </Button>
      </form>
      <div className="space-y-3 border-t border-line pt-5">
        <h4 className="text-sm font-semibold text-ink">Sessions & recovery</h4>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<LogOut className="size-4" />} onClick={() => signOut().catch((e) => toast.error(getErrorMessage(e)))}>
            Sign out of this device
          </Button>
          <Button variant="secondary" icon={<ShieldCheck className="size-4" />} onClick={signOutEverywhere}>
            Sign out everywhere
          </Button>
          <Button variant="ghost" icon={<Mail className="size-4" />} loading={sendingReset} onClick={sendReset}>
            Email me a password reset link
          </Button>
        </div>
      </div>
    </div>
  );
}

function PreferencesSection() {
  const { prefs, setPrefs } = usePreferences();
  return (
    <div className="space-y-5">
      <Field label="Default view">
        <div>
          <Segmented<ViewMode>
            label="Default view"
            value={prefs.view}
            onChange={(v) => setPrefs({ view: v })}
            options={[
              { value: 'grid', label: 'Grid', icon: <LayoutGrid className="size-4" /> },
              { value: 'list', label: 'List', icon: <List className="size-4" /> },
            ]}
          />
        </div>
      </Field>
      <Field label="Files loaded per page" htmlFor="page-size" hint="More items per page means fewer loads while scrolling.">
        <Select id="page-size" value={prefs.pageSize} onChange={(e) => setPrefs({ pageSize: Number(e.target.value) })} className="sm:w-48">
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n} files
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Theme">
        <div>
          <Segmented<ThemePref>
            label="Theme"
            value={prefs.theme}
            onChange={(v) => setPrefs({ theme: v })}
            options={[
              { value: 'light', label: 'Light', icon: <Sun className="size-4" /> },
              { value: 'dark', label: 'Dark', icon: <Moon className="size-4" /> },
              { value: 'system', label: 'System', icon: <Monitor className="size-4" /> },
            ]}
          />
        </div>
      </Field>
    </div>
  );
}

function StorageSection() {
  const { data: stats, isLoading } = useStats();
  if (isLoading || !stats) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-subtle/70 p-4">
          <p className="text-xs text-muted">Total files</p>
          <p className="mt-1 text-xl font-bold text-ink">{stats.total_files.toLocaleString()}</p>
        </div>
        <div className="rounded-xl bg-subtle/70 p-4">
          <p className="text-xs text-muted">Total storage</p>
          <p className="mt-1 text-xl font-bold text-ink">{formatBytes(stats.total_bytes)}</p>
          {stats.quota_bytes ? <p className="text-xs text-faint">of {formatBytes(stats.quota_bytes, 0)}</p> : null}
        </div>
      </div>
      <StorageBreakdown stats={stats} />
    </div>
  );
}

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-ink">Settings</h2>
        <p className="mt-1 text-sm text-muted">Manage your profile, security and preferences.</p>
      </div>
      <Section title="Profile" description="Your name, email and avatar." icon={<Camera className="size-5" />}>
        <ProfileSection />
      </Section>
      <Section title="Security" description="Password and active sessions." icon={<ShieldCheck className="size-5" />}>
        <SecuritySection />
      </Section>
      <Section title="Preferences" description="Synced to your account across devices." icon={<LayoutGrid className="size-5" />}>
        <PreferencesSection />
      </Section>
      <Section title="Storage" description="How your space is used." icon={<HardDrive className="size-5" />}>
        <StorageSection />
      </Section>
    </div>
  );
}
