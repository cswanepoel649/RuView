'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/components/ui/forms';

const Login = z.object({ email: z.email().max(254), password: z.string().min(1).max(200), next: z.string().optional() });

function safeNext(n?: string) {
  return n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/';
}

export async function signIn(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const p = Login.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: 'Enter a valid email and password.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: p.data.email.toLowerCase(), password: p.data.password });
  // Generic message: do not reveal whether the account exists.
  if (error) return { error: 'Incorrect email or password.' };
  redirect(safeNext(p.data.next));
}
