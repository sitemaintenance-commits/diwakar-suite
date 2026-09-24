/** Human-readable message from Supabase/Postgres/JS errors. */
export function errorMessage(err: unknown): string {
  if (!err) return 'Something went wrong.';
  if (typeof err === 'string') return err;
  const e = err as { message?: string; code?: string; details?: string };
  if (e.code === '23505') return 'A record with the same value already exists.';
  if (e.code === '23503' && !e.message?.includes('assigned to')) return 'This record is still referenced by other data.';
  if (e.code === '42501' && e.message?.includes('row-level security')) return 'You do not have permission to perform this action.';
  return e.message || 'Something went wrong.';
}
