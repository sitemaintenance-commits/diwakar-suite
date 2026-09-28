import { createClient, FunctionsHttpError } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False when the deployment has no Supabase environment variables. */
export const supabaseConfigured = Boolean(url && anonKey && !url.includes('YOUR-PROJECT'));

// The browser only ever holds the public anon key + the user's JWT.
// Every read/write is authorized by Postgres RLS.
export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Call the admin-users Edge Function and surface its error message. */
export async function callAdminUsers<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      throw new Error(payload?.error ?? error.message);
    }
    throw error;
  }
  return data as T;
}

const PAGE_SIZE = 1000;

/**
 * Every row a list query matches, fetched page by page. PostgREST caps a
 * single response (1,000 rows on Supabase by default), so one large
 * `.limit()` silently returns a truncated export. The query must be
 * ordered on something unique -- callers add `.order('id')` as a tie-break.
 */
export async function selectAll<R extends { data: unknown[] | null; error: unknown; count?: number | null }>(query: {
  range(from: number, to: number): PromiseLike<R>;
}): Promise<{ data: NonNullable<R['data']>; error: null; count: number | null }> {
  const rows: unknown[] = [];
  let count: number | null = null;
  for (let from = 0; ; from += PAGE_SIZE) {
    const res = await query.range(from, from + PAGE_SIZE - 1);
    if (res.error) throw res.error;
    const page = res.data ?? [];
    rows.push(...page);
    count = res.count ?? count;
    // Stop on an empty page, on reaching the reported total, or -- when no
    // total was asked for -- on a short page.
    if (page.length === 0 || (count !== null ? rows.length >= count : page.length < PAGE_SIZE)) break;
  }
  return { data: rows as NonNullable<R['data']>, error: null, count };
}

/** Short-lived signed URL for a private storage object (avatars etc.). */
export async function signedUrl(bucket: string, path: string | null | undefined, expiresIn = 3600) {
  if (!path) return null;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}
