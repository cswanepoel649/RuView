'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { dbError, optStr, parseForm, reqStr } from '@/lib/actions';
import type { ActionResult } from '@/components/ui/forms';

// Shared by admin and client portals. RLS permits staff and client owners/members.
const ZoneForm = z.object({
  id: z.union([z.literal(''), z.guid()]).optional(),
  property_id: z.guid(), name: reqStr(120), description: optStr(500),
  active_modes: z.array(z.enum(['armed_home', 'armed_away'])).min(1, 'choose at least one mode'),
  entry_delay_s: z.coerce.number().int().min(0).max(300), enabled: z.string().optional(),
  rooms: z.array(z.guid()).default([]),
});

function revalidate(pid: string) {
  revalidatePath(`/admin/properties/${pid}`);
  revalidatePath(`/app/properties/${pid}/zones`);
  revalidatePath(`/app/properties/${pid}`);
}

export async function saveZoneAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireSession();
  const p = parseForm(ZoneForm, fd);
  if (!p.ok) return p.result;
  const { id, rooms, enabled, ...z_ } = p.data;
  const db = await createClient();
  const row = { ...z_, enabled: enabled === 'on' };
  let zoneId = id || null;
  if (zoneId) {
    const { error } = await db.from('security_zones').update(row).eq('id', zoneId);
    if (error) return dbError(error)!;
  } else {
    const { data, error } = await db.from('security_zones').insert(row).select('id').single();
    if (error) return dbError(error)!;
    zoneId = data.id as string;
  }
  const { error: delErr } = await db.from('zone_rooms').delete().eq('zone_id', zoneId);
  if (delErr) return dbError(delErr)!;
  if (rooms.length) {
    const { error } = await db.from('zone_rooms').insert(rooms.map((room_id) => ({ zone_id: zoneId, room_id })));
    if (error) return dbError(error)!;
  }
  revalidate(p.data.property_id);
  return { ok: true, message: 'Zone saved.', nonce: Date.now() };
}

export async function deleteZoneAction(fd: FormData) {
  await requireSession();
  const id = z.guid().parse(fd.get('id'));
  const pid = z.guid().parse(fd.get('property_id'));
  const db = await createClient();
  await db.from('security_zones').delete().eq('id', id);
  revalidate(pid);
}
