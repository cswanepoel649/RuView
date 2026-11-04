'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/** Acknowledge / resolve via RPCs that re-check authorisation (staff or client owner/member). */
export async function eventAction(fd: FormData) {
  await requireSession();
  const id = z.uuid().parse(fd.get('id'));
  const op = z.enum(['ack', 'resolve']).parse(fd.get('op'));
  const note = z.string().max(1000).optional().parse(fd.get('note') || undefined);
  const db = await createClient();
  await db.rpc(op === 'ack' ? 'acknowledge_event' : 'resolve_event', { p_event: id, p_note: note ?? null });
  revalidatePath('/admin/alerts');
  revalidatePath('/app/alerts');
}

export async function markAllReadAction() {
  const s = await requireSession();
  const db = await createClient();
  await db.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', s.userId).is('read_at', null);
  revalidatePath('/app', 'layout');
}
