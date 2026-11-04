'use server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { serverEnv } from '@/lib/env';
import type { ActionResult } from '@/components/ui/forms';

export async function requestReset(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const email = z.email().safeParse(fd.get('email'));
  if (!email.success) return { error: 'Enter a valid email address.' };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.data.toLowerCase(), { redirectTo: `${serverEnv().APP_URL}/update-password` });
  // Always the same response (no account enumeration).
  return { ok: true, message: 'If an account exists for that address, a reset link is on its way.' };
}
