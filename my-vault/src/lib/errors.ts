/** Turn any thrown value (Supabase, fetch, XHR, custom) into a friendly message. */
export function getErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!error) return fallback;
  const raw =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : '';
  const status =
    typeof error === 'object' && error !== null
      ? Number((error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode)
      : NaN;
  const msg = raw.toLowerCase();

  if (!navigator.onLine || msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network error'))
    return 'Network error. Check your internet connection and try again.';
  if (msg.includes('invalid login credentials')) return 'Incorrect email or password.';
  if (msg.includes('email not confirmed')) return 'Please confirm your email address before signing in.';
  if (msg.includes('storage_limit_exceeded')) return 'Storage limit reached. Empty the trash or increase your quota.';
  if (msg.includes('immutable_column')) return 'That property of a file cannot be changed.';
  if (msg.includes('empty_name')) return 'File name cannot be empty.';
  if (msg.includes('too_many_tags')) return 'A file can have at most 30 tags.';
  if (msg.includes('files_extension_not_blocked')) return 'This file type is not allowed for security reasons.';
  if (status === 413 || msg.includes('payload too large') || msg.includes('exceeded the maximum allowed size'))
    return 'File is too large for your storage plan.';
  if (msg.includes('mime type') && msg.includes('not supported')) return 'This file type is not supported.';
  if (status === 401 || msg.includes('jwt expired') || msg.includes('invalid jwt') || msg.includes('not authenticated'))
    return 'Your session has expired. Please sign in again.';
  if (status === 403 || msg.includes('row-level security') || msg.includes('unauthorized'))
    return 'You are not allowed to perform this action.';
  if (status === 404 || msg.includes('object not found') || msg.includes('not found')) return 'File not found. It may have been deleted.';
  if (msg.includes('rate limit')) return 'Too many attempts. Please wait a moment and try again.';
  if (msg.includes('password should be')) return raw;
  return raw || fallback;
}

export function isAuthError(error: unknown): boolean {
  const msg = getErrorMessage(error);
  return msg.startsWith('Your session has expired');
}
