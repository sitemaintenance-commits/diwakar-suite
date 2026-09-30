import { supabase } from '@/lib/supabase';
import { BUCKET } from '@/lib/env';
import { canvasToBlob } from '@/lib/pdf';
import type { Preferences, Profile } from '@/types';

export async function getProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!data) {
    // Profile row is created by a database trigger; this only happens if the
    // schema was installed after the user was created and not backfilled.
    throw new Error('Profile not found. Re-run supabase/schema.sql to backfill profiles.');
  }
  return data as Profile;
}

export async function updateProfile(
  userId: string,
  patch: { full_name?: string; avatar_path?: string | null; preferences?: Partial<Preferences> },
): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', userId).select('*').single();
  if (error) throw error;
  return data as Profile;
}

export async function getAvatarUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24);
  if (error) return null;
  return data.signedUrl;
}

async function resizeAvatar(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process image.');
  // centre-crop to a square
  const side = Math.min(bmp.width, bmp.height);
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  const blob = await canvasToBlob(canvas, 0.85);
  if (!blob) throw new Error('Could not process image.');
  return blob;
}

export async function uploadAvatar(userId: string, file: File, previousPath: string | null): Promise<Profile> {
  if (!file.type.startsWith('image/')) throw new Error('Avatar must be an image.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Avatar image must be under 10 MB.');
  const blob = await resizeAvatar(file);
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${userId}/avatar/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type });
  if (error) throw error;
  const profile = await updateProfile(userId, { avatar_path: path });
  if (previousPath) void supabase.storage.from(BUCKET).remove([previousPath]);
  return profile;
}

export async function removeAvatar(userId: string, path: string): Promise<Profile> {
  const profile = await updateProfile(userId, { avatar_path: null });
  void supabase.storage.from(BUCKET).remove([path]);
  return profile;
}
