'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { redactProvisioningConfig, type NodeProvisioningConfig } from '@ruview/shared/nvs';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { encryptSecret, otaPsk } from '@/lib/crypto';
import { dbError, parseForm, reqStr } from '@/lib/actions';
import { assignDevice } from '../devices/actions';
import type { ActionResult } from '@/components/ui/forms';

const p = (id: string) => `/admin/installations/${id}`;

export async function createInstallationAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await requireStaff();
  const parsed = parseForm(z.object({ property_id: z.uuid(), scheduled_for: z.string().optional() }), fd);
  if (!parsed.ok) return parsed.result;
  const db = await createClient();
  const { data, error } = await db.from('installations').insert({
    property_id: parsed.data.property_id, technician_id: s.userId, created_by: s.userId,
    scheduled_for: parsed.data.scheduled_for ? new Date(parsed.data.scheduled_for).toISOString() : null,
  }).select('id').single();
  if (error) return dbError(error)!;
  redirect(p(data.id as string));
}

async function loadInstall(installationId: string) {
  const db = await createClient();
  const { data } = await db.from('installations').select('id, property_id, client_id, status, steps').eq('id', installationId).single();
  if (!data) throw new Error('installation not found');
  return { db, inst: data as { id: string; property_id: string; client_id: string; status: string; steps: Record<string, unknown> } };
}

export async function markStepAction(installationId: string, step: string, done: boolean, extra?: Record<string, unknown>) {
  await requireStaff();
  z.uuid().parse(installationId);
  z.enum(['survey', 'gateway', 'sensors', 'verify', 'handover']).parse(step);
  const { db, inst } = await loadInstall(installationId);
  const steps = { ...inst.steps, [step]: { ...(inst.steps[step] as object), ...extra, done, at: new Date().toISOString() } };
  await db.from('installations').update({ steps, current_step: step, status: inst.status === 'draft' ? 'in_progress' : inst.status, started_at: inst.status === 'draft' ? new Date().toISOString() : undefined }).eq('id', installationId);
  revalidatePath(p(installationId));
}

export async function markRoomVerifiedAction(installationId: string, roomId: string, verified: boolean) {
  await requireStaff();
  z.uuid().parse(roomId);
  const { db, inst } = await loadInstall(installationId);
  const verify = (inst.steps.verify ?? {}) as { rooms?: Record<string, string | null> };
  const rooms = { ...(verify.rooms ?? {}), [roomId]: verified ? new Date().toISOString() : null };
  await db.from('installations').update({ steps: { ...inst.steps, verify: { ...verify, rooms } } }).eq('id', installationId);
  revalidatePath(p(installationId));
}

export async function createGatewayAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const parsed = parseForm(z.object({ installation_id: z.uuid(), name: reqStr(120), model_id: z.enum(['gateway-rpi', 'gateway-linux']) }), fd);
  if (!parsed.ok) return parsed.result;
  const { db, inst } = await loadInstall(parsed.data.installation_id);
  const { error } = await db.from('devices').insert({ kind: 'gateway', model_id: parsed.data.model_id, name: parsed.data.name, property_id: inst.property_id, status: 'assigned' });
  if (error) return dbError(error)!;
  revalidatePath(p(inst.id));
  return { ok: true, message: 'Gateway created. Generate an enrollment code and run the installer on the gateway.' };
}

const Prepare = z.object({
  installationId: z.uuid(), gatewayId: z.uuid(), roomId: z.uuid(),
  mac: z.string().regex(/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/), chip: z.string(), flashSize: z.string().nullable(),
  name: z.string().min(1).max(120),
});
export type PrepareResult =
  | { ok: true; deviceId: string; nodeId: number; otaPsk: string; modelId: string; flashMb: number; reused: boolean }
  | { ok: false; error: string };

/**
 * Registers (or matches by MAC) the board, assigns room + node id on the
 * gateway, and returns a fresh OTA PSK for the NVS image. The PSK is only
 * persisted when completeProvisioningAction confirms the flash succeeded.
 */
export async function prepareProvisioningAction(input: z.infer<typeof Prepare>): Promise<PrepareResult> {
  await requireStaff();
  const a = Prepare.safeParse(input);
  if (!a.success) return { ok: false, error: 'Invalid board details' };
  if (a.data.chip !== 'ESP32-S3') return { ok: false, error: `${a.data.chip} is not supported — RuView CSI nodes require an ESP32-S3 (dual core).` };
  const flashMb = Number((a.data.flashSize ?? '8MB').replace('MB', '')) || 8;
  if (flashMb < 4) return { ok: false, error: `Board reports ${a.data.flashSize} flash; at least 4 MB is required.` };
  const { db, inst } = await loadInstall(a.data.installationId);
  const { data: gw } = await db.from('devices').select('id, kind, property_id').eq('id', a.data.gatewayId).single();
  if (!gw || gw.kind !== 'gateway' || gw.property_id !== inst.property_id) return { ok: false, error: 'Gateway is not installed at this property.' };

  const modelId = flashMb >= 8 ? 'esp32s3-8mb' : 'esp32s3-4mb';
  const { data: existing } = await db.from('devices').select('id, property_id, status, model_id').eq('hw_id', a.data.mac).maybeSingle();
  let deviceId: string;
  let reused = false;
  if (existing) {
    if (existing.property_id && existing.property_id !== inst.property_id && existing.status !== 'retired') {
      return { ok: false, error: 'This board is registered at another property. Unassign it there first.' };
    }
    deviceId = existing.id as string;
    reused = true;
    await db.from('devices').update({ name: a.data.name, ...(existing.status === 'retired' ? { status: 'inventory' } : {}) }).eq('id', deviceId);
  } else {
    const { data, error } = await db.from('devices').insert({ kind: 'sensor_node', model_id: modelId, name: a.data.name, hw_id: a.data.mac, status: 'inventory' }).select('id').single();
    if (error) return { ok: false, error: dbError(error)!.error! };
    deviceId = data.id as string;
  }
  const r = await assignDevice({ device_id: deviceId, property_id: inst.property_id, room_id: a.data.roomId, gateway_id: a.data.gatewayId });
  if (r.error || r.nodeId == null) return { ok: false, error: r.error ?? 'Could not allocate node id' };
  revalidatePath(p(inst.id));
  return { ok: true, deviceId, nodeId: r.nodeId, otaPsk: otaPsk(), modelId: (existing?.model_id as string) ?? modelId, flashMb, reused };
}

const Complete = z.object({
  installationId: z.uuid(), deviceId: z.uuid(), otaPsk: z.string().regex(/^[0-9a-f]{64}$/),
  releaseId: z.uuid().nullable(), firmwareVersion: z.string().max(64).nullable(),
  config: z.record(z.string(), z.unknown()), bootCheck: z.record(z.string(), z.unknown()).optional(),
});
export async function completeProvisioningAction(input: z.infer<typeof Complete>): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const a = Complete.safeParse(input);
  if (!a.success) return { ok: false, error: 'Invalid provisioning result' };
  const { db } = await loadInstall(a.data.installationId);
  const { error: secErr } = await adminClient().from('device_secrets').upsert({ device_id: a.data.deviceId, ota_psk_ciphertext: encryptSecret(a.data.otaPsk), rotated_at: new Date().toISOString() });
  if (secErr) return { ok: false, error: 'Could not store device key' };
  const snapshot = redactProvisioningConfig(a.data.config as unknown as NodeProvisioningConfig);
  const { error } = await db.from('devices').update({
    status: 'provisioned', provisioned_at: new Date().toISOString(), provisioned_config: { ...snapshot, boot_check: a.data.bootCheck ?? null },
    desired_config: snapshot, ...(a.data.releaseId ? { firmware_release_id: a.data.releaseId } : {}), ...(a.data.firmwareVersion ? { firmware_version: a.data.firmwareVersion } : {}),
  }).eq('id', a.data.deviceId).in('status', ['inventory', 'assigned', 'provisioned', 'offline', 'fault', 'online']);
  if (error) return { ok: false, error: error.message };
  revalidatePath(p(a.data.installationId));
  return { ok: true };
}

export async function completeInstallationAction(fd: FormData) {
  await requireStaff();
  const id = z.uuid().parse(fd.get('id'));
  const { db, inst } = await loadInstall(id);
  await db.from('installations').update({ status: 'completed', completed_at: new Date().toISOString(), steps: { ...inst.steps, handover: { done: true, at: new Date().toISOString() } } }).eq('id', id);
  await db.from('properties').update({ status: 'active' }).eq('id', inst.property_id).in('status', ['planned', 'installing']);
  revalidatePath(p(id));
  redirect(`/admin/properties/${inst.property_id}`);
}

export async function cancelInstallationAction(fd: FormData) {
  await requireStaff();
  const id = z.uuid().parse(fd.get('id'));
  const db = await createClient();
  await db.from('installations').update({ status: 'cancelled' }).eq('id', id);
  redirect('/admin/installations');
}
