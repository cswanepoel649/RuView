import { TelemetryRequest } from '@ruview/shared/protocol';
import { adminClient } from '@/lib/supabase/admin';
import { authenticateGateway, handle, json, pgError, readJson } from '@/lib/gateway-api';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  const gatewayId = await authenticateGateway(req);
  const body = await readJson(req, TelemetryRequest);
  const { data, error } = await adminClient().rpc('ingest_telemetry', { p_gateway: gatewayId, p_payload: body });
  if (error) throw pgError(error);
  return json(200, data);
});
