'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { dbError, optStr, parseForm, reqStr } from '@/lib/actions';
import type { ActionResult } from '@/components/ui/forms';

const ROOM_TYPES = ['living', 'bedroom', 'kitchen', 'bathroom', 'hallway', 'entrance', 'office', 'garage', 'dining', 'laundry', 'storage', 'outdoor', 'other'] as const;
const path = (id: string) => `/admin/properties/${id}`;

const PropertyForm = z.object({
  id: z.guid(), name: reqStr(200), address_line1: optStr(200), address_line2: optStr(200), city: optStr(100), region: optStr(100),
  postal_code: optStr(20), country: optStr(60), timezone: z.string().min(1).max(64),
  exit_delay_s: z.coerce.number().int().min(0).max(600), status: z.enum(['planned', 'installing', 'active', 'suspended', 'archived']),
  wellness_vitals: z.string().optional(), access_notes: optStr(2000), notes: optStr(5000),
  latitude: z.union([z.literal(''), z.coerce.number().min(-90).max(90)]).optional(),
  longitude: z.union([z.literal(''), z.coerce.number().min(-180).max(180)]).optional(),
});
export async function updatePropertyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const p = parseForm(PropertyForm, fd);
  if (!p.ok) return p.result;
  const { id, wellness_vitals, latitude, longitude, ...rest } = p.data;
  const db = await createClient();
  const { data: cur } = await db.from('properties').select('features').eq('id', id).single();
  const features = { ...((cur?.features as Record<string, unknown>) ?? {}), wellness_vitals: wellness_vitals === 'on' };
  const { error } = await db.from('properties').update({
    ...rest, features, latitude: latitude === '' || latitude === undefined ? null : latitude, longitude: longitude === '' || longitude === undefined ? null : longitude,
  }).eq('id', id);
  if (error) return dbError(error)!;
  revalidatePath(path(id));
  return { ok: true, message: 'Property saved.' };
}

export async function createFloorAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const p = parseForm(z.object({ property_id: z.guid(), name: reqStr(60), level: z.coerce.number().int().min(-5).max(100) }), fd);
  if (!p.ok) return p.result;
  const db = await createClient();
  const { error } = await db.from('floors').insert({ ...p.data, sort_order: p.data.level });
  if (error) return dbError(error)!;
  revalidatePath(path(p.data.property_id));
  return { ok: true, message: 'Floor added.', nonce: Date.now() };
}

export async function deleteFloorAction(fd: FormData) {
  await requireStaff();
  const id = z.guid().parse(fd.get('id'));
  const pid = z.guid().parse(fd.get('property_id'));
  const db = await createClient();
  const { data: f } = await db.from('floors').select('plan_path').eq('id', id).single();
  await db.from('floors').delete().eq('id', id);
  if (f?.plan_path) await db.storage.from('floor-plans').remove([f.plan_path as string]);
  revalidatePath(path(pid));
}

export async function setFloorPlanAction(floorId: string, planPath: string, width: number, height: number): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const a = z.object({ floorId: z.guid(), planPath: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}-\d+\.(png|jpeg|webp|svg)$/), width: z.number().int().positive().max(20000), height: z.number().int().positive().max(20000) })
    .safeParse({ floorId, planPath, width, height });
  if (!a.success) return { ok: false, error: 'Invalid floor plan' };
  const db = await createClient();
  const { data: floor } = await db.from('floors').select('id, property_id, client_id, plan_path').eq('id', floorId).single();
  if (!floor || !planPath.startsWith(`${floor.client_id}/${floor.property_id}/${floorId}-`)) return { ok: false, error: 'Path does not match floor' };
  const { error } = await db.from('floors').update({ plan_path: planPath, plan_width: width, plan_height: height }).eq('id', floorId);
  if (error) return { ok: false, error: error.message };
  if (floor.plan_path && floor.plan_path !== planPath) await db.storage.from('floor-plans').remove([floor.plan_path as string]);
  revalidatePath(path(floor.property_id as string));
  return { ok: true };
}

const RoomForm = z.object({ property_id: z.guid(), floor_id: z.union([z.literal(''), z.guid()]).transform((v) => v || null), name: reqStr(120), room_type: z.enum(ROOM_TYPES) });
export async function createRoomAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const p = parseForm(RoomForm, fd);
  if (!p.ok) return p.result;
  const db = await createClient();
  const { error } = await db.from('rooms').insert(p.data);
  if (error) return dbError(error)!;
  revalidatePath(path(p.data.property_id));
  return { ok: true, message: `Room "${p.data.name}" added.`, nonce: Date.now() };
}

export async function updateRoomAction(fd: FormData) {
  await requireStaff();
  const p = z.object({ id: z.guid(), property_id: z.guid(), name: reqStr(120), room_type: z.enum(ROOM_TYPES),
    floor_id: z.union([z.literal(''), z.guid()]).transform((v) => v || null), monitoring_enabled: z.string().optional() }).parse(Object.fromEntries(fd));
  const db = await createClient();
  await db.from('rooms').update({ name: p.name, room_type: p.room_type, floor_id: p.floor_id, monitoring_enabled: p.monitoring_enabled === 'on' }).eq('id', p.id);
  revalidatePath(path(p.property_id));
}

export async function deleteRoomAction(fd: FormData) {
  await requireStaff();
  const id = z.guid().parse(fd.get('id'));
  const pid = z.guid().parse(fd.get('property_id'));
  const db = await createClient();
  await db.from('rooms').delete().eq('id', id);
  revalidatePath(path(pid));
}

export async function saveRoomShapeAction(roomId: string, shape: [number, number][] | null): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const s = z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(3).max(64).nullable().safeParse(shape);
  if (!s.success || !z.guid().safeParse(roomId).success) return { ok: false, error: 'Invalid outline' };
  const db = await createClient();
  const { data, error } = await db.from('rooms').update({ shape: s.data }).eq('id', roomId).select('property_id').single();
  if (error) return { ok: false, error: error.message };
  revalidatePath(path(data.property_id as string));
  return { ok: true };
}

export async function startInstallationAction(fd: FormData) {
  const s = await requireStaff();
  const pid = z.guid().parse(fd.get('property_id'));
  const db = await createClient();
  const { data: existing } = await db.from('installations').select('id').eq('property_id', pid).in('status', ['draft', 'in_progress']).maybeSingle();
  if (existing) redirect(`/admin/installations/${existing.id}`);
  const { data, error } = await db.from('installations').insert({ property_id: pid, technician_id: s.userId, created_by: s.userId, status: 'in_progress', started_at: new Date().toISOString() }).select('id').single();
  if (error) throw new Error(error.message);
  await db.from('properties').update({ status: 'installing' }).eq('id', pid).eq('status', 'planned');
  redirect(`/admin/installations/${data.id}`);
}
