const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const maxUploadMb = Number(import.meta.env.VITE_MAX_UPLOAD_MB ?? 50);

export const env = {
  supabaseUrl: url?.trim() ?? '',
  supabaseAnonKey: anonKey?.trim() ?? '',
  maxUploadBytes: (Number.isFinite(maxUploadMb) && maxUploadMb > 0 ? maxUploadMb : 50) * 1024 * 1024,
};

export const isConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);

export const BUCKET = 'vault-files';
