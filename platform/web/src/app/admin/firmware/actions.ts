'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { FLASH_LAYOUT } from '@ruview/shared/catalog';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { sha256Hex } from '@/lib/crypto';
import { validateFirmwareFile, type FirmwareRole } from '@/lib/firmware-validate';

const Meta = z.object({
  version: z.string().regex(/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/),
  flash_size_mb: z.union([z.literal(4), z.literal(8), z.literal(16)]),
  model_ids: z.array(z.string().min(1)).min(1),
  channel: z.enum(['stable', 'beta']),
  notes: z.string().max(5000).optional(),
  paths: z.object({ bootloader: z.string(), partition_table: z.string(), ota_data: z.string(), app: z.string() }),
});

/** Verifies uploaded binaries server-side (hash recomputed from Storage) and records a draft release. */
export async function createReleaseAction(input: unknown): Promise<{ ok: boolean; error?: string; warnings?: string[]; id?: string }> {
  const s = await requireAdmin();
  const p = Meta.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const m = p.data;
  const prefix = `esp32-csi-node/${m.version}/${m.flash_size_mb}MB/`;
  const admin = adminClient();
  const files: Record<string, { path: string; size: number; sha256: string; offset: number }> = {};
  const errors: string[] = [];
  let isMock = false;
  for (const role of ['bootloader', 'partition_table', 'ota_data', 'app'] as FirmwareRole[]) {
    const path = m.paths[role];
    if (!path.startsWith(prefix) || path.includes('..')) return { ok: false, error: `unexpected storage path for ${role}` };
    const { data, error } = await admin.storage.from('firmware').download(path);
    if (error || !data) return { ok: false, error: `could not read ${role} from storage` };
    const bytes = new Uint8Array(await data.arrayBuffer());
    const check = validateFirmwareFile(role, bytes, m.flash_size_mb);
    errors.push(...check.errors);
    isMock ||= check.isMockBuild;
    files[role] = { path, size: bytes.length, sha256: sha256Hex(bytes), offset: FLASH_LAYOUT[role] };
  }
  if (errors.length) return { ok: false, error: errors.join(' · ') };
  const db = await createClient();
  const { data, error } = await db.from('firmware_releases').insert({
    family: 'esp32-csi-node', version: m.version, flash_size_mb: m.flash_size_mb, model_ids: m.model_ids, channel: m.channel,
    notes: m.notes ?? null, files, app_size: files.app!.size, is_mock_build: isMock, status: 'draft', created_by: s.userId,
  }).select('id').single();
  if (error) return { ok: false, error: error.code === '23505' ? 'A release with this version and flash size already exists.' : error.message };
  revalidatePath('/admin/firmware');
  return { ok: true, id: data.id as string, warnings: isMock ? ['This image contains mock-CSI test code and can never be published.'] : [] };
}

export async function setReleaseStatusAction(fd: FormData) {
  await requireAdmin();
  const id = z.uuid().parse(fd.get('id'));
  const status = z.enum(['published', 'deprecated', 'draft']).parse(fd.get('status'));
  const db = await createClient();
  await db.from('firmware_releases').update({ status, ...(status === 'published' ? { published_at: new Date().toISOString() } : {}) }).eq('id', id);
  revalidatePath('/admin/firmware');
}
