'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/components/ui/forms';

export async function updatePassword(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const pw = String(fd.get('password') ?? '');
  if (pw.length < 12 || pw.length > 200) return { error: 'Use at least 12 characters.' };
  if (pw !== fd.get('confirm')) return { error: 'Passwords do not match.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) return { error: error.message };
  redirect('/');
}
