'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { dbError, parseForm } from '@/lib/actions';
import type { ActionResult } from '@/components/ui/forms';

// Shared by both portals. A DB trigger sanitises client-supplied fields (status, priority, assignee).
const NewTicket = z.object({
  client_id: z.uuid(),
  property_id: z.union([z.literal(''), z.uuid()]).transform((v) => v || null),
  device_id: z.union([z.literal(''), z.uuid()]).transform((v) => v || null),
  category: z.enum(['device', 'alert', 'installation', 'account', 'other']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  subject: z.string().min(3).max(200), description: z.string().min(1).max(10000),
});
export async function createTicketAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await requireSession();
  const p = parseForm(NewTicket, fd);
  if (!p.ok) return p.result;
  const db = await createClient();
  const { data, error } = await db.from('support_tickets').insert({ ...p.data, opened_by: s.userId }).select('id').single();
  if (error) return dbError(error)!;
  redirect(`${s.isStaff ? '/admin/tickets' : '/app/support'}/${data.id}`);
}

export async function replyTicketAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await requireSession();
  const p = parseForm(z.object({ ticket_id: z.uuid(), body: z.string().min(1).max(10000), internal: z.string().optional(), status: z.string().optional() }), fd);
  if (!p.ok) return p.result;
  const db = await createClient();
  const { error } = await db.from('ticket_messages').insert({ ticket_id: p.data.ticket_id, body: p.data.body, internal: s.isStaff && p.data.internal === 'on', author_id: s.userId });
  if (error) return dbError(error)!;
  if (p.data.status) {
    const st = z.enum(['open', 'in_progress', 'waiting_client', 'resolved', 'closed']).safeParse(p.data.status);
    if (st.success) await db.from('support_tickets').update({ status: st.data }).eq('id', p.data.ticket_id);
  }
  revalidatePath(`/admin/tickets/${p.data.ticket_id}`);
  revalidatePath(`/app/support/${p.data.ticket_id}`);
  return { ok: true, nonce: Date.now() };
}

export async function updateTicketAction(fd: FormData) {
  const s = await requireSession();
  if (!s.isStaff) return;
  const id = z.uuid().parse(fd.get('id'));
  const status = z.enum(['open', 'in_progress', 'waiting_client', 'resolved', 'closed']).parse(fd.get('status'));
  const priority = z.enum(['low', 'normal', 'high', 'urgent']).parse(fd.get('priority'));
  const assigned_to = z.union([z.literal(''), z.uuid()]).transform((v) => v || null).parse(fd.get('assigned_to') ?? '');
  const db = await createClient();
  await db.from('support_tickets').update({ status, priority, assigned_to }).eq('id', id);
  revalidatePath(`/admin/tickets/${id}`);
}
