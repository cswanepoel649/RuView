'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const Args = z.object({ propertyId: z.uuid(), mode: z.enum(['disarmed', 'armed_home', 'armed_away']) });

/** Arm/disarm. Authorisation is re-checked inside the set_security_mode RPC (staff or owner/member). */
export async function setSecurityMode(propertyId: string, mode: string): Promise<{ ok: boolean; error?: string; mode?: string; changedAt?: string }> {
  await requireSession();
  const a = Args.safeParse({ propertyId, mode });
  if (!a.success) return { ok: false, error: 'Invalid request' };
  const db = await createClient();
  const { data, error } = await db.rpc('set_security_mode', { p_property: a.data.propertyId, p_mode: a.data.mode });
  if (error) return { ok: false, error: error.code === '42501' ? 'You do not have permission to change the security mode.' : error.message };
  revalidatePath(`/app/properties/${a.data.propertyId}`);
  revalidatePath(`/admin/properties/${a.data.propertyId}`);
  const p = data as { security_mode: string; security_mode_changed_at: string };
  return { ok: true, mode: p.security_mode, changedAt: p.security_mode_changed_at };
}
