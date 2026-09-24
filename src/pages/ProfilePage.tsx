import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Camera, KeyRound, Loader2, MapPin, Save, ShieldCheck, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtDateTime } from '@/lib/format';
import { useAccess } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Field, PageHeader, UserAvatar } from '@/components/common';
import { useSites } from '@/features/admin/api';
import { passwordProblem } from '@/pages/ResetPasswordPage';

export function ProfilePage() {
  const { access, refresh } = useAccess();
  const qc = useQueryClient();
  const profile = access?.profile;
  const sites = useSites();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    setName(profile?.full_name ?? '');
    setPhone(profile?.phone ?? '');
  }, [profile?.full_name, profile?.phone]);

  if (!profile) return null;

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('profiles').update({ full_name: name.trim(), phone: phone.trim() || null }).eq('id', profile!.id);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success('Profile updated');
    await refresh();
  }

  async function uploadAvatar(file: File) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast.error('Use a PNG, JPG or WebP image.');
    if (file.size > 2 * 1024 * 1024) return toast.error('Image must be smaller than 2 MB.');
    setUploading(true);
    const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
    const path = `${profile!.id}/avatar-${Date.now()}.${ext}`;
    const up = await supabase.storage.from('avatars').upload(path, file, { upsert: false, contentType: file.type });
    if (up.error) {
      setUploading(false);
      return toast.error(errorMessage(up.error));
    }
    const old = profile!.avatar_path;
    const { error } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', profile!.id);
    if (!error && old) await supabase.storage.from('avatars').remove([old]);
    setUploading(false);
    if (error) return toast.error(errorMessage(error));
    toast.success('Photo updated');
    await qc.invalidateQueries({ queryKey: ['avatar-url'] });
    await refresh();
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (passwordProblem(pw) || pw !== pw2) return;
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwBusy(false);
    if (error) return toast.error(error.message);
    await supabase.rpc('log_event', { p_action: 'password.change', p_module: 'auth', p_summary: 'Password changed', p_details: null });
    setPw('');
    setPw2('');
    toast.success('Password changed');
  }

  const mySites = profile.all_sites || access?.is_super_admin ? null : (sites.data ?? []);

  return (
    <>
      <PageHeader icon={UserRound} title="My profile" description="Your personal details, access and password." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Personal details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-6 flex items-center gap-4">
              <div className="relative">
                <UserAvatar name={profile.full_name} path={profile.avatar_path} className="h-20 w-20 text-xl" />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border bg-card shadow-sm hover:bg-muted"
                  aria-label="Change photo"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadAvatar(f);
                    e.target.value = '';
                  }}
                />
              </div>
              <div>
                <p className="text-lg font-semibold">{profile.full_name}</p>
                <p className="text-sm text-muted-foreground">
                  {[profile.designation, profile.department].filter(Boolean).join(' · ') || profile.email}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Last sign-in {fmtDateTime(profile.last_login_at, 'never')}</p>
              </div>
            </div>
            <form onSubmit={saveProfile} className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="p_name" required>
                <Input id="p_name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Phone" htmlFor="p_phone">
                <Input id="p_phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
              </Field>
              <Field label="Email" hint="Contact your administrator to change your email.">
                <Input value={profile.email} disabled />
              </Field>
              <Field label="Employee ID">
                <Input value={profile.employee_code ?? '—'} disabled />
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={busy || !name.trim()}>
                  {busy ? <Loader2 className="animate-spin" /> : <Save />} Save
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" /> Access
              </CardTitle>
              <CardDescription>Managed by your administrator</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap gap-1.5">
                {access?.roles.length ? access.roles.map((r) => <Badge key={r.id}>{r.name}</Badge>) : <span className="text-sm text-muted-foreground">No roles</span>}
              </div>
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <MapPin className="h-4 w-4 text-muted-foreground" /> Sites
                </p>
                {mySites === null ? (
                  <Badge variant="info">All sites</Badge>
                ) : mySites.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {mySites.map((s) => (
                      <Badge key={s.id} variant="outline">
                        {s.name}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">No sites assigned</span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" /> Change password
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={changePassword} className="grid gap-3">
                <Field label="New password" htmlFor="p_pw" error={pw ? passwordProblem(pw) : null}>
                  <Input id="p_pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
                </Field>
                <Field label="Confirm" htmlFor="p_pw2" error={pw2 && pw2 !== pw ? 'Passwords do not match.' : null}>
                  <Input id="p_pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
                </Field>
                <Button type="submit" variant="outline" disabled={pwBusy || !pw || Boolean(passwordProblem(pw)) || pw !== pw2}>
                  {pwBusy && <Loader2 className="animate-spin" />} Update password
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
