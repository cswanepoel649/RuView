import { HeartbeatRequest } from '@ruview/shared/protocol';
import { FIRMWARE_OTA_MAX_BYTES } from '@ruview/shared/catalog';
import { adminClient } from '@/lib/supabase/admin';
import { decryptSecret } from '@/lib/crypto';
import { authenticateGateway, clientIp, handle, json, pgError, readJson } from '@/lib/gateway-api';

export const dynamic = 'force-dynamic';

interface RawCommand { id: string; device_id: string; type: string; payload: Record<string, unknown>; attempt: number; node_id: number | null; node_ip: string | null }

export const POST = handle(async (req) => {
  const gatewayId = await authenticateGateway(req);
  const body = await readJson(req, HeartbeatRequest);
  const db = adminClient();
  const { data, error } = await db.rpc('gateway_heartbeat', { p_gateway: gatewayId, p_payload: body, p_remote_ip: clientIp(req) });
  if (error) throw pgError(error);
  const res = data as { commands: RawCommand[] } & Record<string, unknown>;

  // Enrich commands with short-lived download URLs and decrypted device secrets.
  const commands = [];
  for (const c of res.commands ?? []) {
    try {
      commands.push(await enrich(c));
    } catch (e) {
      await db.rpc('gateway_complete_command', {
        p_gateway: gatewayId, p_command: c.id, p_success: false, p_result: {}, p_error: `platform could not prepare command: ${(e as Error).message}`,
      });
    }
  }
  return json(200, { ...res, commands });
});

async function enrich(c: RawCommand) {
  const db = adminClient();
  if (c.type !== 'ota_update') return { ...c, payload: c.payload ?? {} };
  const releaseId = String(c.payload.release_id ?? '');
  const { data: rel } = await db.from('firmware_releases').select('id, version, status, files').eq('id', releaseId).single();
  const app = (rel?.files as Record<string, { path: string; size: number; sha256: string }> | undefined)?.app;
  if (!rel || rel.status !== 'published' || !app) throw new Error('release not published or has no app image');
  if (app.size > FIRMWARE_OTA_MAX_BYTES) throw new Error(`app image ${app.size} B exceeds firmware OTA limit ${FIRMWARE_OTA_MAX_BYTES} B`);
  const { data: secret } = await db.from('device_secrets').select('ota_psk_ciphertext').eq('device_id', c.device_id).single();
  if (!secret) throw new Error('device has no OTA PSK (re-provision over USB)');
  const { data: signed, error } = await db.storage.from('firmware').createSignedUrl(app.path, 3600);
  if (error || !signed) throw new Error('could not sign firmware URL');
  return {
    ...c,
    payload: { release_id: rel.id, version: rel.version, url: signed.signedUrl, sha256: app.sha256, size: app.size, psk: decryptSecret(secret.ota_psk_ciphertext as string) },
  };
}
