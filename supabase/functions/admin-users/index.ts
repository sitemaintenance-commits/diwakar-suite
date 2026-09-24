// admin-users — privileged user-account operations.
//
// The service-role key exists ONLY here. Every request is authenticated with
// the caller's JWT and every permission decision is made by the database
// (has_permission / admin_* RPCs run as the caller), so this function can
// never do more than the caller is allowed to do.
//
// Actions:
//   invite         { email, full_name, redirect_to, data }
//   create         { email, password, full_name, data }
//   resend_invite  { user_id, redirect_to }
//   reset_password { user_id, redirect_to }
//   set_status     { user_id, status: 'active' | 'inactive' }
//
// `data` is passed to admin_save_user (phone, employee_code, department_id,
// designation_id, joining_date, role_ids, site_ids, all_sites).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function requirePerm(caller: SupabaseClient, module: string, action: string) {
  const { data, error } = await caller.rpc('has_permission', { p_module: module, p_action: action });
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(403, `Access denied: ${module} ${action.toUpperCase()} permission required.`);
}

async function emailOf(admin: SupabaseClient, userId: string): Promise<{ email: string; status: string }> {
  const { data, error } = await admin.from('profiles').select('email, status').eq('id', userId).single();
  if (error || !data) throw new HttpError(404, 'User not found.');
  return data as { email: string; status: string };
}

function safeRedirect(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  try {
    const u = new URL(url);
    if (allowed.length === 0 || allowed.includes('*') || allowed.includes(u.origin)) return u.toString();
  } catch { /* ignore */ }
  return undefined;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json(req, { error: 'Not signed in.' }, 401);

  // Caller-scoped client: all RPCs run with the caller's identity and RLS.
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Service client: only for auth.admin operations.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: userData, error: userErr } = await caller.auth.getUser();
    if (userErr || !userData.user) throw new HttpError(401, 'Session expired. Please sign in again.');

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');

    switch (action) {
      case 'invite':
      case 'create': {
        await requirePerm(caller, 'admin.users', 'create');
        const email = String(body.email ?? '').trim().toLowerCase();
        const fullName = String(body.full_name ?? '').trim();
        if (!EMAIL_RE.test(email)) throw new HttpError(400, 'A valid email address is required.');
        if (!fullName) throw new HttpError(400, 'Full name is required.');

        let newId: string;
        if (action === 'invite') {
          const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
            data: { full_name: fullName, phone: body.data?.phone ?? '' },
            redirectTo: safeRedirect(body.redirect_to),
          });
          if (error) throw new HttpError(400, error.message);
          newId = data.user.id;
        } else {
          const password = String(body.password ?? '');
          if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
          const { data, error } = await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: fullName, phone: body.data?.phone ?? '', initial_status: 'active' },
          });
          if (error) throw new HttpError(400, error.message);
          newId = data.user.id;
        }

        // Profile, employee record, roles and sites — as the caller, in one transaction.
        const { error: saveErr } = await caller.rpc('admin_save_user', {
          p_user_id: newId,
          p_data: { ...(body.data ?? {}), full_name: fullName },
          p_is_new: true,
        });
        if (saveErr) {
          await admin.auth.admin.deleteUser(newId); // roll back the auth account
          throw new HttpError(400, saveErr.message);
        }
        if (action === 'invite') {
          await caller.rpc('log_event', { p_action: 'user.invite', p_module: 'admin.users', p_summary: `Invitation sent to ${email}` });
        }
        return json(req, { id: newId });
      }

      case 'resend_invite': {
        await requirePerm(caller, 'admin.users', 'create');
        const target = await emailOf(admin, String(body.user_id));
        if (target.status !== 'invited') throw new HttpError(400, 'This user has already accepted the invitation.');
        const { error } = await admin.auth.admin.inviteUserByEmail(target.email, { redirectTo: safeRedirect(body.redirect_to) });
        if (error) throw new HttpError(400, error.message);
        await caller.rpc('log_event', { p_action: 'user.resend_invite', p_module: 'admin.users', p_summary: `Invitation re-sent to ${target.email}` });
        return json(req, { ok: true });
      }

      case 'reset_password': {
        await requirePerm(caller, 'admin.users', 'edit');
        const target = await emailOf(admin, String(body.user_id));
        const { error } = await admin.auth.resetPasswordForEmail(target.email, { redirectTo: safeRedirect(body.redirect_to) });
        if (error) throw new HttpError(400, error.message);
        await caller.rpc('log_event', { p_action: 'user.password_reset', p_module: 'admin.users', p_summary: `Password reset email sent to ${target.email}` });
        return json(req, { ok: true });
      }

      case 'set_status': {
        const userId = String(body.user_id ?? '');
        const status = body.status === 'active' ? 'active' : body.status === 'inactive' ? 'inactive' : null;
        if (!status) throw new HttpError(400, 'Status must be active or inactive.');
        // The RPC enforces: permission, not self, Super Admin protection, last Super Admin.
        const { error } = await caller.rpc('admin_set_user_status', { p_user_id: userId, p_status: status });
        if (error) throw new HttpError(error.code === '42501' ? 403 : 400, error.message);
        // Revoke / restore sign-in at the auth layer as well.
        const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
          ban_duration: status === 'inactive' ? '876000h' : 'none',
        });
        if (banErr) throw new HttpError(500, banErr.message);
        return json(req, { ok: true });
      }

      default:
        throw new HttpError(400, 'Unknown action.');
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Unexpected error';
    return json(req, { error: message }, status);
  }
});
