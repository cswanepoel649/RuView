'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { parseForm } from '@/lib/actions';
import type { ActionResult } from '@/components/ui/forms';

export async function updateProfileAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await requireSession();
  const p = parseForm(z.object({ full_name: z.string().max(120), phone: z.string().max(40) }), fd);
  if (!p.ok) return p.result;
  const db = await createClient();
  const { error } = await db.from('profiles').update({ full_name: p.data.full_name || null, phone: p.data.phone || null }).eq('id', s.userId);
  if (error) return { error: error.message };
  revalidatePath('/account');
  return { ok: true, message: 'Profile saved.' };
}

export async function changePasswordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireSession();
  const pw = String(fd.get('password') ?? '');
  if (pw.length < 12 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return { error: 'Use at least 12 characters with upper- and lower-case letters and a digit.' };
  if (pw !== fd.get('confirm')) return { error: 'Passwords do not match.' };
  const db = await createClient();
  const { error } = await db.auth.updateUser({ password: pw });
  if (error) return { error: error.message };
  return { ok: true, message: 'Password changed.', nonce: Date.now() };
}
