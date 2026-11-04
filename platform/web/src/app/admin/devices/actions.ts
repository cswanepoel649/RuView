'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { FIRMWARE_OTA_MAX_BYTES } from '@ruview/shared/catalog';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { enrollmentCode, sha256Hex } from '@/lib/crypto';
import { dbError, optStr, parseForm, reqStr } from '@/lib/actions';
import type { ActionResult } from '@/components/ui/forms';

const mac = z.string().regex(/^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/, 'MAC must be aa:bb:cc:dd:ee:ff');

const RegisterForm = z.object({
  kind: z.enum(['sensor_node', 'gateway']), model_id: reqStr(64), name: reqStr(120), serial_number: optStr(80),
  hw_id: z.string().max(128).optional().transform((v) => v || null), notes: optStr(2000),
});
export async function registerDeviceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const p = parseForm(RegisterForm, fd);
  if (!p.ok) return p.result;
  if (p.data.kind === 'sensor_node' && p.data.hw_id && !mac.safeParse(p.data.hw_id).success) return { error: 'Sensor hardware id must be the board MAC (aa:bb:cc:dd:ee:ff).' };
  const db = await createClient();
  const { data, error } = await db.from('devices').insert({ ...p.data, hw_id: p.data.hw_id?.toLowerCase() ?? null, status: 'inventory' }).select('id').single();
  if (error) return dbError(error)!;
  revalidatePath('/admin/devices');
  redirect(`/admin/devices/${data.id}`);
}

const AssignForm = z.object({
  device_id: z.uuid(), property_id: z.uuid(),
  room_id: z.union([z.literal(''), z.uuid()]).transform((v) => v || null),
  gateway_id: z.union([z.literal(''), z.uuid()]).transform((v) => v || null),
});
export async function assignDeviceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const p = parseForm(AssignForm, fd);
  if (!p.ok) return p.result;
  const r = await assignDevice(p.data);
  if (r.error) return r;
  revalidatePath(`/admin/properties/${p.data.property_id}`);
  revalidatePath(`/admin/devices/${p.data.device_id}`);
  return { ok: true, message: 'Device assigned.' };
}

/** Shared by the inventory UI and the installation wizard. */
export async function assignDevice(a: z.infer<typeof AssignForm>): Promise<ActionResult & { nodeId?: number }> {
  const db = await createClient();
  const { data: dev } = await db.from('devices').select('id, kind, status, gateway_id, node_id, property_id').eq('id', a.device_id).single();
  if (!dev) return { error: 'Device not found' };
  if (dev.status === 'retired') return { error: 'Retired devices cannot be assigned.' };
  const update: Record<string, unknown> = { property_id: a.property_id, room_id: dev.kind === 'sensor_node' ? a.room_id : null };
  let nodeId: number | undefined;
  if (dev.kind === 'sensor_node') {
    if (!a.gateway_id) return { error: 'Choose the gateway this sensor will stream to.' };
    update.gateway_id = a.gateway_id;
    if (dev.gateway_id !== a.gateway_id || dev.node_id == null) {
      const { data: n, error } = await db.rpc('allocate_node_id', { p_gateway: a.gateway_id });
      if (error) return dbError(error)!;
      update.node_id = n;
      nodeId = n as number;
    } else nodeId = dev.node_id as number;
  }
  if (dev.status === 'inventory') update.status = 'assigned';
  const { error } = await db.from('devices').update(update).eq('id', a.device_id);
  if (error) return dbError(error)!;
  return { ok: true, nodeId };
}

export async function unassignDeviceAction(fd: FormData) {
  await requireStaff();
  const id = z.uuid().parse(fd.get('id'));
  const db = await createClient();
  const { data: d } = await db.from('devices').select('property_id').eq('id', id).single();
  await db.from('devices').update({ property_id: null, room_id: null, gateway_id: null, node_id: null, client_id: null, status: 'inventory' }).eq('id', id);
  revalidatePath(`/admin/devices/${id}`);
  if (d?.property_id) revalidatePath(`/admin/properties/${d.property_id}`);
}

const UpdateForm = z.object({
  id: z.uuid(), name: reqStr(120), room_id: z.union([z.literal(''), z.uuid()]).transform((v) => v || null),
  status: z.enum(['inventory', 'assigned', 'provisioned', 'online', 'offline', 'fault', 'retired']),
  serial_number: optStr(80), mount_notes: optStr(1000), notes: optStr(2000),
});
export async function updateDeviceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const p = parseForm(UpdateForm, fd);
  if (!p.ok) return p.result;
  const db = await createClient();
  const { error } = await db.from('devices').update(p.data).eq('id', p.data.id);
  if (error) return dbError(error)!;
  revalidatePath(`/admin/devices/${p.data.id}`);
  return { ok: true, message: 'Device saved.' };
}

/** One-time gateway enrollment code (24 h). Only its hash is stored; shown once. */
export async function createEnrollmentCodeAction(gatewayId: string): Promise<{ ok: boolean; code?: string; expiresAt?: string; error?: string }> {
  const s = await requireStaff();
  if (!z.uuid().safeParse(gatewayId).success) return { ok: false, error: 'invalid gateway' };
  const db = await createClient();
  const { data: gw } = await db.from('devices').select('id, kind, property_id').eq('id', gatewayId).single();
  if (!gw || gw.kind !== 'gateway') return { ok: false, error: 'Not a gateway' };
  if (!gw.property_id) return { ok: false, error: 'Assign the gateway to a property before enrolling it.' };
  const code = enrollmentCode();
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const { error } = await adminClient().from('gateway_enrollments').insert({ device_id: gatewayId, code_hash: sha256Hex(code), expires_at: expiresAt, created_by: s.userId });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/devices/${gatewayId}`);
  return { ok: true, code, expiresAt };
}

export async function revokeGatewayTokensAction(fd: FormData) {
  await requireStaff();
  const id = z.uuid().parse(fd.get('id'));
  const db = await createClient();
  await db.from('device_credentials').update({ revoked_at: new Date().toISOString() }).eq('device_id', id).is('revoked_at', null);
  revalidatePath(`/admin/devices/${id}`);
}

export async function queueOtaAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await requireStaff();
  const p = parseForm(z.object({ device_id: z.uuid(), release_id: z.uuid() }), fd);
  if (!p.ok) return p.result;
  const db = await createClient();
  const [{ data: dev }, { data: rel }] = await Promise.all([
    db.from('devices').select('id, kind, model_id, gateway_id, property_id, status').eq('id', p.data.device_id).single(),
    db.from('firmware_releases').select('id, version, status, model_ids, app_size, is_mock_build').eq('id', p.data.release_id).single(),
  ]);
  if (!dev || dev.kind !== 'sensor_node' || !dev.gateway_id) return { error: 'OTA requires a sensor node attached to a gateway.' };
  if (!rel || rel.status !== 'published' || rel.is_mock_build) return { error: 'Only published, non-mock releases can be deployed.' };
  if (!(rel.model_ids as string[]).includes(dev.model_id as string)) return { error: `Release ${rel.version} is not built for model ${dev.model_id}.` };
  if ((rel.app_size ?? 0) > FIRMWARE_OTA_MAX_BYTES) {
    return { error: `This image is ${rel.app_size} bytes; the node firmware rejects OTA uploads above ${FIRMWARE_OTA_MAX_BYTES} bytes. Re-flash over USB from the installation wizard instead.` };
  }
  const { data: hasSecret } = await adminClient().from('device_secrets').select('device_id').eq('device_id', dev.id).maybeSingle();
  if (!hasSecret) return { error: 'This node has no OTA key on record (not provisioned by the platform). Re-provision it over USB first.' };
  const { error } = await db.from('device_commands').insert({
    device_id: dev.id, gateway_id: dev.gateway_id, property_id: dev.property_id, command_type: 'ota_update',
    payload: { release_id: rel.id, version: rel.version }, requested_by: s.userId,
  });
  if (error) return dbError(error)!;
  revalidatePath(`/admin/devices/${dev.id}`);
  return { ok: true, message: `Update to ${rel.version} queued — the gateway picks it up within ~30 s.` };
}

export async function queueProbeAction(fd: FormData) {
  const s = await requireStaff();
  const id = z.uuid().parse(fd.get('id'));
  const db = await createClient();
  const { data: dev } = await db.from('devices').select('id, gateway_id, property_id').eq('id', id).single();
  if (dev?.gateway_id) {
    await db.from('device_commands').insert({ device_id: id, gateway_id: dev.gateway_id, property_id: dev.property_id, command_type: 'probe_node', requested_by: s.userId, expires_at: new Date(Date.now() + 3600_000).toISOString() });
  }
  revalidatePath(`/admin/devices/${id}`);
}

export async function cancelCommandAction(fd: FormData) {
  await requireStaff();
  const id = z.uuid().parse(fd.get('id'));
  const deviceId = z.uuid().parse(fd.get('device_id'));
  const db = await createClient();
  await db.from('device_commands').update({ status: 'cancelled', completed_at: new Date().toISOString() }).eq('id', id).eq('status', 'queued');
  revalidatePath(`/admin/devices/${deviceId}`);
}
