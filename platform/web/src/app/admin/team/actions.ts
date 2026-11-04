'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { serverEnv } from '@/lib/env';
import { parseForm } from '@/lib/actions';
import type { ActionResult } from '@/components/ui/forms';

export async function inviteStaffAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const p = parseForm(z.object({ email: z.email(), full_name: z.string().max(120).optional(), role: z.enum(['platform_admin', 'installer']) }), fd);
  if (!p.ok) return p.result;
  const email = p.data.email.toLowerCase();
  const admin = adminClient();
  let { data: prof } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
  if (!prof) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${serverEnv().APP_URL}/auth/confirm`, data: { full_name: p.data.full_name } });
    if (error || !data.user) return { error: `Invite failed: ${error?.message}` };
    prof = { id: data.user.id };
    await admin.from('profiles').upsert({ id: data.user.id, email, full_name: p.data.full_name ?? null });
  }
  const db = await createClient();
  const { error } = await db.from('profiles').update({ platform_role: p.data.role }).eq('id', prof.id);
  if (error) return { error: error.message };
  revalidatePath('/admin/team');
  return { ok: true, message: `${email} now has ${p.data.role === 'platform_admin' ? 'administrator' : 'installer'} access.`, nonce: Date.now() };
}

export async function setStaffRoleAction(fd: FormData) {
  const s = await requireAdmin();
  const id = z.uuid().parse(fd.get('id'));
  const role = z.enum(['platform_admin', 'installer', 'none']).parse(fd.get('role'));
  if (id === s.userId) return; // never demote yourself (avoids locking out the last admin)
  const db = await createClient();
  await db.from('profiles').update({ platform_role: role === 'none' ? null : role }).eq('id', id);
  revalidatePath('/admin/team');
}
