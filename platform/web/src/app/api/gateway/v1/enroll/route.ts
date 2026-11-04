import { EnrollRequest, normaliseEnrollmentCode } from '@ruview/shared/protocol';
import { adminClient } from '@/lib/supabase/admin';
import { randomToken, sha256Hex } from '@/lib/crypto';
import { rateLimit } from '@/lib/ratelimit';
import { ApiError, clientIp, handle, json, pgError, readJson } from '@/lib/gateway-api';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  const ip = clientIp(req) ?? 'unknown';
  const rl = rateLimit(`enroll:${ip}`, 10, 60_000);
  if (!rl.ok) throw new ApiError(429, 'too many enrollment attempts', { 'retry-after': String(rl.retryAfterS) });
  const body = await readJson(req, EnrollRequest);
  const token = randomToken('gw');
  const { data, error } = await adminClient().rpc('gateway_enroll', {
    p_code_hash: sha256Hex(normaliseEnrollmentCode(body.enrollment_code)),
    p_token_hash: sha256Hex(token),
    p_token_prefix: token.slice(0, 10),
    p_hw_id: body.hw_id,
    p_info: { agent_version: body.agent_version, hostname: body.hostname, platform: body.platform, ip },
  });
  if (error) throw pgError(error);
  const r = data as { gateway_id: string; property_id: string | null };
  return json(200, { gateway_id: r.gateway_id, property_id: r.property_id, token });
});
