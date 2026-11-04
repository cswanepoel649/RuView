'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireClientUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { dbError, parseForm } from '@/lib/actions';
import type { ActionResult } from '@/components/ui/forms';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export async function savePreferencesAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await requireClientUser();
  const p = parseForm(z.object({
    client_id: z.uuid(), email_enabled: z.string().optional(), min_severity: z.enum(['info', 'warning', 'critical']),
    quiet_start: z.union([z.literal(''), hhmm]).optional(), quiet_end: z.union([z.literal(''), hhmm]).optional(),
    muted: z.array(z.string().regex(/^[a-z_]+$/)).default([]),
  }), fd);
  if (!p.ok) return p.result;
  const d = p.data;
  const db = await createClient();
  const { error } = await db.from('notification_preferences').upsert({
    user_id: s.userId, client_id: d.client_id, email_enabled: d.email_enabled === 'on', min_severity: d.min_severity,
    quiet_hours: d.quiet_start && d.quiet_end ? { start: d.quiet_start, end: d.quiet_end } : null, muted_event_types: d.muted,
  });
  if (error) return dbError(error)!;
  revalidatePath('/app/settings');
  return { ok: true, message: 'Preferences saved.' };
}

export async function addRuleAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireClientUser();
  const p = parseForm(z.object({
    client_id: z.uuid(), property_id: z.uuid(), event_type: z.string().regex(/^[a-z_]+$/),
    target: z.string().regex(/^(all|room:[0-9a-f-]{36}|zone:[0-9a-f-]{36})$/),
    start: z.union([z.literal(''), hhmm]).optional(), end: z.union([z.literal(''), hhmm]).optional(),
    email: z.string().optional(),
  }), fd);
  if (!p.ok) return p.result;
  const d = p.data;
  const [kind, id] = d.target.split(':');
  const db = await createClient();
  const { error } = await db.from('alert_rules').insert({
    client_id: d.client_id, property_id: d.property_id, event_type: d.event_type,
    room_id: kind === 'room' ? id : null, zone_id: kind === 'zone' ? id : null,
    schedule: d.start && d.end ? { start: d.start, end: d.end } : null,
    channels: d.email === 'on' ? ['in_app', 'email'] : ['in_app'],
  });
  if (error) return dbError(error)!;
  revalidatePath('/app/settings');
  return { ok: true, message: 'Alert rule added.', nonce: Date.now() };
}

export async function toggleRuleAction(fd: FormData) {
  await requireClientUser();
  const id = z.uuid().parse(fd.get('id'));
  const op = z.enum(['enable', 'disable', 'delete']).parse(fd.get('op'));
  const db = await createClient();
  if (op === 'delete') await db.from('alert_rules').delete().eq('id', id);
  else await db.from('alert_rules').update({ enabled: op === 'enable' }).eq('id', id);
  revalidatePath('/app/settings');
}
